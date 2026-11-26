-- ============================================================================
-- ROVA SCHEDULED DELIVERY & VEHICLE RESERVATION SYSTEM MIGRATION
-- Non-destructive, idempotent schema extension for real availability, holds,
-- separated lifecycle states, payment verification, audit ledger, and atomic RPCs.
-- ============================================================================

-- 1. Extend cities with scheduling_policy jsonb
ALTER TABLE public.cities
  ADD COLUMN IF NOT EXISTS scheduling_policy jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Extend reservations with authoritative scheduling, pricing, payment, and dispatch fields
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS city_id text DEFAULT 'abidjan',
  ADD COLUMN IF NOT EXISTS city_name text,
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'Africa/Abidjan',
  ADD COLUMN IF NOT EXISTS pickup_window_start timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_window_end timestamptz,
  ADD COLUMN IF NOT EXISTS service_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS destination_address text,
  ADD COLUMN IF NOT EXISTS destination_lat double precision,
  ADD COLUMN IF NOT EXISTS destination_lng double precision,
  ADD COLUMN IF NOT EXISTS estimated_weight_kg numeric(10,2),
  ADD COLUMN IF NOT EXISTS fragile boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS courier_earnings numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_commission numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pricing_rule_version_id text,
  ADD COLUMN IF NOT EXISTS quote_id text,
  ADD COLUMN IF NOT EXISTS pricing_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'mobile_money',
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS reservation_status text NOT NULL DEFAULT 'hold',
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS assignment_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS execution_status text NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS assigned_driver_name text,
  ADD COLUMN IF NOT EXISTS cancellation_fee numeric(12,2),
  ADD COLUMN IF NOT EXISTS refund_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_reason text,
  ADD COLUMN IF NOT EXISTS reminders_sent jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Unique per-merchant idempotency key (only when provided)
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_merchant_idempotency
  ON public.reservations (merchant_uid, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_city_vehicle_date
  ON public.reservations (city_id, vehicle_category, reservation_date, reservation_status);

CREATE INDEX IF NOT EXISTS idx_reservations_driver_window
  ON public.reservations (driver_uid, pickup_window_start, service_end_at)
  WHERE driver_uid IS NOT NULL AND driver_uid <> '';

CREATE INDEX IF NOT EXISTS idx_reservations_hold_expiry
  ON public.reservations (hold_expires_at)
  WHERE reservation_status IN ('hold', 'pending_payment');

-- 3. Immutable Reservation Audit Event Ledger
CREATE TABLE IF NOT EXISTS public.reservation_events (
  id text PRIMARY KEY,
  reservation_id text NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_uid text NOT NULL,
  actor_role text NOT NULL,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservation_events_reservation_created
  ON public.reservation_events (reservation_id, created_at DESC);

ALTER TABLE public.reservation_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reservation_events' AND policyname = 'reservation_events_read_owner_or_admin'
  ) THEN
    CREATE POLICY reservation_events_read_owner_or_admin
      ON public.reservation_events
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.reservations r
          WHERE r.id = reservation_events.reservation_id
            AND (r.merchant_uid = auth.uid()::text OR r.driver_uid = auth.uid()::text)
        )
        OR EXISTS (
          SELECT 1 FROM public.admins a WHERE a.uid = auth.uid()::text
        )
      );
  END IF;
END $$;

-- 4. Reservation Payments & Webhook Deduplication Table
CREATE TABLE IF NOT EXISTS public.reservation_payments (
  id text PRIMARY KEY,
  reservation_id text NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  webhook_event_id text UNIQUE,
  provider text NOT NULL,
  provider_reference text,
  payment_method text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'XOF',
  status text NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservation_payments_reservation
  ON public.reservation_payments (reservation_id, created_at DESC);

ALTER TABLE public.reservation_payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reservation_payments' AND policyname = 'reservation_payments_read_owner_or_admin'
  ) THEN
    CREATE POLICY reservation_payments_read_owner_or_admin
      ON public.reservation_payments
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.reservations r
          WHERE r.id = reservation_payments.reservation_id
            AND r.merchant_uid = auth.uid()::text
        )
        OR EXISTS (
          SELECT 1 FROM public.admins a WHERE a.uid = auth.uid()::text
        )
      );
  END IF;
END $$;

-- 5. Atomic Capacity Hold RPC (prevents concurrent overbooking via advisory transaction lock)
CREATE OR REPLACE FUNCTION public.create_reservation_hold(
  p_id text,
  p_reference text,
  p_merchant_uid text,
  p_merchant_name text,
  p_business_id text,
  p_city_id text,
  p_city_name text,
  p_timezone text,
  p_vehicle_category text,
  p_reservation_date text,
  p_start_time text,
  p_end_time text,
  p_pickup_window_start timestamptz,
  p_pickup_window_end timestamptz,
  p_service_end_at timestamptz,
  p_duration_type text,
  p_pickup_address text,
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_destination_address text,
  p_destination_lat double precision,
  p_destination_lng double precision,
  p_destinations_summary text,
  p_cargo_requirements text,
  p_estimated_weight_kg numeric,
  p_fragile boolean,
  p_quoted_price numeric,
  p_courier_earnings numeric,
  p_platform_commission numeric,
  p_currency text,
  p_pricing_rule_version_id text,
  p_quote_id text,
  p_pricing_breakdown jsonb,
  p_payment_method text,
  p_hold_expires_at timestamptz,
  p_idempotency_key text,
  p_max_capacity integer,
  p_buffer_minutes integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing public.reservations%ROWTYPE;
  v_occupied integer;
  v_lock_key bigint;
BEGIN
  -- Serialize concurrent holds for the same city + vehicle + date
  v_lock_key := hashtext(p_city_id || ':' || p_vehicle_category || ':' || p_reservation_date);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
    SELECT * INTO v_existing
    FROM public.reservations
    WHERE merchant_uid = p_merchant_uid AND idempotency_key = p_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'deduplicated', true, 'reservation_id', v_existing.id);
    END IF;
  END IF;

  -- Count active overlapping reservations + unexpired holds (including transition buffer)
  SELECT count(*) INTO v_occupied
  FROM public.reservations
  WHERE city_id = p_city_id
    AND vehicle_category = p_vehicle_category
    AND (
      reservation_status = 'confirmed'
      OR (reservation_status IN ('hold', 'pending_payment') AND hold_expires_at > now())
    )
    AND execution_status NOT IN ('completed', 'cancelled')
    AND pickup_window_start < (p_service_end_at + make_interval(mins => p_buffer_minutes))
    AND (COALESCE(service_end_at, pickup_window_end) + make_interval(mins => p_buffer_minutes)) > p_pickup_window_start;

  IF v_occupied >= p_max_capacity THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SLOT_UNAVAILABLE', 'occupied', v_occupied, 'capacity', p_max_capacity);
  END IF;

  INSERT INTO public.reservations (
    id, reference, business_id, merchant_uid, merchant_name,
    city_id, city_name, timezone, vehicle_category, driver_uid,
    reservation_date, start_time, end_time,
    pickup_window_start, pickup_window_end, service_end_at, duration_type,
    pickup_address, pickup_lat, pickup_lng,
    destination_address, destination_lat, destination_lng,
    destinations_summary, cargo_requirements, estimated_weight_kg, fragile,
    quoted_price, courier_earnings, platform_commission, currency,
    pricing_rule_version_id, quote_id, pricing_breakdown,
    payment_method, reservation_status, payment_status, assignment_status, execution_status,
    status, hold_expires_at, idempotency_key
  ) VALUES (
    p_id, p_reference, NULLIF(p_business_id, ''), p_merchant_uid, p_merchant_name,
    p_city_id, p_city_name, p_timezone, p_vehicle_category, '',
    p_reservation_date, p_start_time, p_end_time,
    p_pickup_window_start, p_pickup_window_end, p_service_end_at, p_duration_type,
    p_pickup_address, p_pickup_lat, p_pickup_lng,
    NULLIF(p_destination_address, ''), p_destination_lat, p_destination_lng,
    NULLIF(p_destinations_summary, ''), NULLIF(p_cargo_requirements, ''), p_estimated_weight_kg, COALESCE(p_fragile, false),
    p_quoted_price, p_courier_earnings, p_platform_commission, p_currency,
    p_pricing_rule_version_id, p_quote_id, COALESCE(p_pricing_breakdown, '[]'::jsonb),
    p_payment_method, 'hold', 'unpaid', 'not_requested', 'scheduled',
    'pending_approval', p_hold_expires_at, NULLIF(p_idempotency_key, '')
  );

  RETURN jsonb_build_object('ok', true, 'deduplicated', false, 'reservation_id', p_id);
END;
$$;
