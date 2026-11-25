-- ============================================================================
-- ROVA PRODUCTION DELIVERY INFRASTRUCTURE MIGRATION
-- City Logistics Isolation · Server Pricing & Quotes · Courier GPS · Dispatch
-- Offers with Atomic Concurrency Locking · Delivery State Machine & Audit
-- Events · Event-Driven Notification Outbox · PoD & Cancellation/Return
-- Idempotent & non-destructive over existing 20261125150000 & 20261125160000
-- ============================================================================

-- 1. CITIES & GEOSPATIAL SERVICE BOUNDARIES
create table if not exists public.cities (
  id text primary key,
  country_code text not null,
  country_name text not null,
  name text not null,
  currency text not null default 'XOF',
  timezone text not null default 'Africa/Abidjan',
  is_active boolean not null default true,
  center_lat double precision not null,
  center_lng double precision not null,
  service_radius_km double precision not null default 35,
  min_lat double precision not null,
  max_lat double precision not null,
  min_lng double precision not null,
  max_lng double precision not null,
  max_delivery_distance_km double precision not null default 45,
  max_delivery_duration_min integer not null default 150,
  allowed_vehicles text[] not null default array['motorcycle','cargo_motorcycle','tricycle','cargo_van','commercial_van','truck'],
  operating_hours jsonb not null default '{"open":"06:00","close":"23:00","days":[0,1,2,3,4,5,6]}'::jsonb,
  dispatch_config jsonb not null default '{"offerTtlSeconds":30,"maxWaves":3,"waveRadiiKm":[3,8,18],"waveBatchSize":3,"searchTimeoutSeconds":240}'::jsonb,
  cancellation_policy jsonb not null default '{"freeCancelWindowSec":120,"assignedFee":500,"approachingPickupFee":1000,"atPickupFee":1500,"postPickupAllowed":false,"returnFeeMultiplier":0.75}'::jsonb,
  gps_policy jsonb not null default '{"maxStaleSeconds":90,"maxAccuracyMeters":150,"idleIntervalSec":30,"enRouteIntervalSec":10,"approachingIntervalSec":5}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed core West African cities (isolated urban logistics areas)
insert into public.cities (
  id, country_code, country_name, name, currency, timezone, is_active,
  center_lat, center_lng, service_radius_km, min_lat, max_lat, min_lng, max_lng,
  max_delivery_distance_km, max_delivery_duration_min, cancellation_policy
) values
  (
    'abidjan', 'CI', 'Côte d’Ivoire', 'Abidjan', 'XOF', 'Africa/Abidjan', true,
    5.3480, -4.0170, 32, 5.18, 5.56, -4.28, -3.72,
    45, 150,
    '{"freeCancelWindowSec":120,"assignedFee":500,"approachingPickupFee":1000,"atPickupFee":1500,"postPickupAllowed":false,"returnFeeMultiplier":0.75}'::jsonb
  ),
  (
    'bouake', 'CI', 'Côte d’Ivoire', 'Bouaké', 'XOF', 'Africa/Abidjan', true,
    7.6900, -5.0300, 22, 7.50, 7.88, -5.22, -4.84,
    30, 120,
    '{"freeCancelWindowSec":120,"assignedFee":400,"approachingPickupFee":800,"atPickupFee":1200,"postPickupAllowed":false,"returnFeeMultiplier":0.75}'::jsonb
  ),
  (
    'yamoussoukro', 'CI', 'Côte d’Ivoire', 'Yamoussoukro', 'XOF', 'Africa/Abidjan', true,
    6.8276, -5.2893, 20, 6.66, 7.00, -5.46, -5.10,
    28, 120,
    '{"freeCancelWindowSec":120,"assignedFee":400,"approachingPickupFee":800,"atPickupFee":1200,"postPickupAllowed":false,"returnFeeMultiplier":0.75}'::jsonb
  ),
  (
    'accra', 'GH', 'Ghana', 'Accra', 'GHS', 'Africa/Accra', true,
    5.6037, -0.1870, 32, 5.45, 5.82, -0.42, 0.08,
    45, 150,
    '{"freeCancelWindowSec":120,"assignedFee":10,"approachingPickupFee":18,"atPickupFee":25,"postPickupAllowed":false,"returnFeeMultiplier":0.75}'::jsonb
  ),
  (
    'dakar', 'SN', 'Sénégal', 'Dakar', 'XOF', 'Africa/Dakar', true,
    14.7167, -17.4677, 28, 14.58, 14.88, -17.56, -17.18,
    40, 150,
    '{"freeCancelWindowSec":120,"assignedFee":500,"approachingPickupFee":1000,"atPickupFee":1500,"postPickupAllowed":false,"returnFeeMultiplier":0.75}'::jsonb
  )
on conflict (id) do nothing;

-- 2. VERSIONED CITY PRICING RULES
create table if not exists public.pricing_rule_versions (
  id text primary key,
  city_id text not null references public.cities(id) on delete cascade,
  vehicle_category text not null,
  version_number integer not null default 1,
  currency text not null default 'XOF',
  base_fee numeric(12,2) not null,
  per_km_rate numeric(12,2) not null,
  per_min_rate numeric(12,2) not null default 0,
  minimum_fare numeric(12,2) not null,
  cargo_surcharge numeric(12,2) not null default 0,
  fragile_surcharge numeric(12,2) not null default 0,
  multi_stop_fee numeric(12,2) not null default 0,
  scheduled_fee numeric(12,2) not null default 0,
  waiting_fee_per_min numeric(12,2) not null default 0,
  return_fee_multiplier numeric(5,2) not null default 0.75,
  platform_commission_rate numeric(5,4) not null default 0.2000,
  priority_multiplier numeric(5,2) not null default 1.25,
  peak_multiplier numeric(5,2) not null default 1.15,
  full_day_rate numeric(12,2) not null default 0,
  is_active boolean not null default true,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by_uid text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pricing_rule_versions_city_veh
  on public.pricing_rule_versions (city_id, vehicle_category, is_active);

-- 3. AUTHORITATIVE SERVER-SIDE DELIVERY QUOTES
create table if not exists public.delivery_quotes (
  id text primary key,
  user_uid text,
  city_id text not null references public.cities(id),
  pricing_rule_version_id text not null,
  vehicle_category text not null,
  timing_type text not null default 'instant',
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  stops_json jsonb not null default '[]'::jsonb,
  distance_km numeric(10,2) not null,
  duration_min integer not null,
  distance_source text not null default 'osrm',
  is_fallback_estimate boolean not null default false,
  currency text not null default 'XOF',
  customer_total numeric(12,2) not null,
  courier_earnings numeric(12,2) not null,
  platform_commission numeric(12,2) not null,
  breakdown_json jsonb not null default '[]'::jsonb,
  signature_hash text not null,
  status text not null default 'active',
  expires_at timestamptz not null,
  consumed_by_delivery_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_delivery_quotes_user_status
  on public.delivery_quotes (user_uid, status, expires_at desc);

-- 4. EXTEND DRIVERS, DRIVER_DISPATCH & DELIVERIES NON-DESTRUCTIVELY
alter table public.drivers
  add column if not exists city_id text references public.cities(id),
  add column if not exists availability_status text not null default 'OFFLINE',
  add column if not exists gps_accuracy_m double precision,
  add column if not exists gps_heading double precision,
  add column if not exists gps_speed_mps double precision,
  add column if not exists gps_updated_at timestamptz,
  add column if not exists max_concurrent_deliveries integer not null default 1;

alter table public.driver_dispatch
  add column if not exists city_id text references public.cities(id),
  add column if not exists availability_status text not null default 'OFFLINE',
  add column if not exists gps_accuracy_m double precision,
  add column if not exists gps_heading double precision,
  add column if not exists gps_speed_mps double precision,
  add column if not exists gps_updated_at timestamptz,
  add column if not exists max_concurrent_deliveries integer not null default 1;

create index if not exists idx_driver_dispatch_city_avail
  on public.driver_dispatch (city_id, approval_status, is_online, availability_status);

alter table public.deliveries
  add column if not exists city_id text references public.cities(id),
  add column if not exists quote_id text references public.delivery_quotes(id),
  add column if not exists pricing_rule_version_id text,
  add column if not exists distance_source text not null default 'osrm',
  add column if not exists is_fallback_estimate boolean not null default false,
  add column if not exists courier_earnings numeric(12,2) not null default 0,
  add column if not exists platform_commission numeric(12,2) not null default 0,
  add column if not exists cancellation_fee numeric(12,2) not null default 0,
  add column if not exists return_fee numeric(12,2) not null default 0,
  add column if not exists custody_status text not null default 'with_sender',
  add column if not exists pickup_confirmed_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_uid text,
  add column if not exists cancellation_reason text,
  add column if not exists failure_reason text,
  add column if not exists dispatch_wave integer not null default 0,
  add column if not exists search_started_at timestamptz,
  add column if not exists pod_verified boolean not null default false,
  add column if not exists pod_method text;

create index if not exists idx_deliveries_city_status
  on public.deliveries (city_id, status, created_at desc);

-- 5. COURIER GPS TELEMETRY STREAM (TIME-SERIES)
create table if not exists public.courier_locations (
  id uuid primary key default gen_random_uuid(),
  courier_uid text not null,
  delivery_id text references public.deliveries(id) on delete set null,
  city_id text references public.cities(id),
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision not null default 25,
  heading double precision,
  speed_mps double precision,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_courier_locations_courier_time
  on public.courier_locations (courier_uid, recorded_at desc);

create index if not exists idx_courier_locations_delivery_time
  on public.courier_locations (delivery_id, recorded_at desc)
  where delivery_id is not null;

-- 6. DISPATCH DELIVERY OFFERS (WITH DATABASE-LEVEL SINGLE-WINNER INVARIANT)
create table if not exists public.delivery_offers (
  id text primary key,
  delivery_id text not null references public.deliveries(id) on delete cascade,
  city_id text not null references public.cities(id),
  courier_uid text not null,
  wave_number integer not null default 1,
  status text not null default 'SENT',
  internal_score numeric(8,3) not null default 0,
  estimated_pickup_distance_km numeric(8,2) not null default 0,
  estimated_pickup_eta_min integer not null default 5,
  offered_earnings numeric(12,2) not null default 0,
  currency text not null default 'XOF',
  expires_at timestamptz not null,
  sent_at timestamptz not null default now(),
  delivered_at timestamptz,
  viewed_at timestamptz,
  responded_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Prevent a delivery from ever having more than ONE ACCEPTED offer
create unique index if not exists uq_delivery_offers_single_accepted
  on public.delivery_offers (delivery_id)
  where status = 'ACCEPTED';

-- Prevent duplicate active offers to the same courier for the same delivery
create unique index if not exists uq_delivery_offers_active_per_courier
  on public.delivery_offers (delivery_id, courier_uid)
  where status in ('CREATED', 'SENT', 'DELIVERED', 'VIEWED');

create index if not exists idx_delivery_offers_courier_open
  on public.delivery_offers (courier_uid, status, expires_at);

create index if not exists idx_delivery_offers_expiry
  on public.delivery_offers (status, expires_at)
  where status in ('CREATED', 'SENT', 'DELIVERED', 'VIEWED');

-- 7. IMMUTABLE DELIVERY LIFECYCLE EVENT LEDGER
create table if not exists public.delivery_events (
  id text primary key,
  delivery_id text not null references public.deliveries(id) on delete cascade,
  city_id text references public.cities(id),
  event_type text not null,
  actor_uid text,
  actor_role text not null default 'system',
  from_status text,
  to_status text,
  correlation_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_delivery_events_delivery_time
  on public.delivery_events (delivery_id, created_at desc);

-- 8. EVENT-DRIVEN NOTIFICATION OUTBOX & DELIVERY LOGS
create table if not exists public.notification_outbox (
  id text primary key,
  event_id text,
  delivery_id text references public.deliveries(id) on delete cascade,
  recipient_uid text,
  recipient_contact text,
  recipient_role text not null default 'customer',
  channel text not null default 'in_app',
  template_key text not null,
  locale text not null default 'fr',
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_retry_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_notification_outbox_retry
  on public.notification_outbox (status, next_retry_at)
  where status in ('pending', 'failed');

create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  outbox_id text not null references public.notification_outbox(id) on delete cascade,
  channel text not null,
  provider text not null,
  attempt_number integer not null default 1,
  status text not null,
  error_message text,
  created_at timestamptz not null default now()
);

-- 9. PROOF OF DELIVERY & CANCELLATION / RETURN RECORDS
create table if not exists public.proof_of_delivery (
  id uuid primary key default gen_random_uuid(),
  delivery_id text not null references public.deliveries(id) on delete cascade,
  stop_id text,
  method text not null,
  otp_verified boolean not null default false,
  recipient_name text,
  photo_url text,
  signature_hash text,
  notes text,
  lat double precision,
  lng double precision,
  verified_by_uid text not null,
  verified_at timestamptz not null default now()
);

create index if not exists idx_proof_of_delivery_delivery
  on public.proof_of_delivery (delivery_id, verified_at desc);

create table if not exists public.cancellation_records (
  id uuid primary key default gen_random_uuid(),
  delivery_id text not null references public.deliveries(id) on delete cascade,
  cancelled_by_uid text not null,
  cancelled_by_role text not null,
  delivery_status_at_cancel text not null,
  reason_code text not null,
  reason_notes text,
  fee_amount numeric(12,2) not null default 0,
  refund_amount numeric(12,2) not null default 0,
  currency text not null default 'XOF',
  policy_applied text not null,
  return_required boolean not null default false,
  created_at timestamptz not null default now()
);

-- 10. ATOMIC CONCURRENCY-SAFE OFFER ACCEPTANCE RPC
create or replace function public.accept_delivery_offer(
  p_offer_id text,
  p_courier_uid text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer record;
  v_delivery record;
  v_driver record;
begin
  -- 1. Lock the offer row first
  select * into v_offer
  from public.delivery_offers
  where id = p_offer_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'OFFER_NOT_FOUND', 'message', 'Offer does not exist.');
  end if;

  if v_offer.courier_uid <> p_courier_uid then
    return jsonb_build_object('ok', false, 'code', 'OFFER_UNAUTHORIZED', 'message', 'Offer does not belong to this courier.');
  end if;

  if v_offer.status = 'ACCEPTED' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'delivery_id', v_offer.delivery_id, 'offer_id', v_offer.id);
  end if;

  if v_offer.status not in ('CREATED', 'SENT', 'DELIVERED', 'VIEWED') then
    return jsonb_build_object('ok', false, 'code', 'OFFER_NOT_OPEN', 'message', 'Offer is no longer active (' || v_offer.status || ').');
  end if;

  if v_offer.expires_at <= now() then
    update public.delivery_offers
      set status = 'EXPIRED', updated_at = now()
      where id = v_offer.id;
    return jsonb_build_object('ok', false, 'code', 'OFFER_EXPIRED', 'message', 'Offer has expired.');
  end if;

  -- 2. Lock the parent delivery row to guarantee single-winner assignment
  select * into v_delivery
  from public.deliveries
  where id = v_offer.delivery_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'DELIVERY_NOT_FOUND', 'message', 'Delivery does not exist.');
  end if;

  if coalesce(v_delivery.driver_uid, '') <> '' or v_delivery.status not in ('pending', 'searching_courier', 'unassigned', 'scheduled') then
    update public.delivery_offers
      set status = 'SUPERSEDED', updated_at = now()
      where id = v_offer.id;
    return jsonb_build_object('ok', false, 'code', 'DELIVERY_ALREADY_ASSIGNED', 'message', 'Delivery has already been claimed.');
  end if;

  -- 3. Verify courier eligibility under lock
  select * into v_driver
  from public.driver_dispatch
  where uid = p_courier_uid
  for update;

  if not found or v_driver.approval_status <> 'approved' or not v_driver.is_online then
    return jsonb_build_object('ok', false, 'code', 'COURIER_NOT_ELIGIBLE', 'message', 'Courier must be approved and online.');
  end if;

  if coalesce(v_driver.active_delivery_count, 0) >= coalesce(v_driver.max_concurrent_deliveries, 1) then
    return jsonb_build_object('ok', false, 'code', 'COURIER_AT_CAPACITY', 'message', 'Courier has reached max active deliveries.');
  end if;

  -- 4. Commit atomic assignment
  update public.delivery_offers
    set status = 'ACCEPTED', responded_at = now(), updated_at = now()
    where id = v_offer.id;

  update public.delivery_offers
    set status = 'SUPERSEDED', updated_at = now()
    where delivery_id = v_offer.delivery_id
      and id <> v_offer.id
      and status in ('CREATED', 'SENT', 'DELIVERED', 'VIEWED');

  update public.deliveries
    set driver_uid = p_courier_uid,
        driver_name = v_driver.first_name,
        driver_lat = v_driver.current_lat,
        driver_lng = v_driver.current_lng,
        status = 'driver_assigned',
        updated_at = now()
    where id = v_offer.delivery_id;

  update public.delivery_stops
    set driver_uid = p_courier_uid,
        status = 'driver_assigned',
        updated_at = now()
    where delivery_id = v_offer.delivery_id;

  update public.public_tracking
    set driver_uid = p_courier_uid,
        driver_first_name = v_driver.first_name,
        driver_lat = v_driver.current_lat,
        driver_lng = v_driver.current_lng,
        status = 'driver_assigned',
        show_live_driver = true,
        updated_at = now()
    where delivery_id = v_offer.delivery_id;

  update public.driver_dispatch
    set availability_status = 'ASSIGNED',
        active_delivery_count = coalesce(active_delivery_count, 0) + 1,
        updated_at = now()
    where uid = p_courier_uid;

  update public.drivers
    set availability_status = 'ASSIGNED',
        active_delivery_count = coalesce(active_delivery_count, 0) + 1,
        updated_at = now()
    where uid = p_courier_uid;

  insert into public.delivery_events (
    id, delivery_id, city_id, event_type, actor_uid, actor_role, from_status, to_status, payload
  ) values (
    'evt_' || replace(gen_random_uuid()::text, '-', ''),
    v_offer.delivery_id,
    v_offer.city_id,
    'delivery.courier_assigned',
    p_courier_uid,
    'courier',
    v_delivery.status,
    'driver_assigned',
    jsonb_build_object('offerId', v_offer.id, 'wave', v_offer.wave_number, 'courierName', v_driver.first_name)
  );

  return jsonb_build_object(
    'ok', true,
    'delivery_id', v_offer.delivery_id,
    'offer_id', v_offer.id,
    'courier_uid', p_courier_uid,
    'courier_name', v_driver.first_name
  );
end;
$$;

-- 11. ROW LEVEL SECURITY (STRICT ISOLATION — ZERO DATA LEAKS)
alter table public.cities enable row level security;
alter table public.pricing_rule_versions enable row level security;
alter table public.delivery_quotes enable row level security;
alter table public.courier_locations enable row level security;
alter table public.delivery_offers enable row level security;
alter table public.delivery_events enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.notification_logs enable row level security;
alter table public.proof_of_delivery enable row level security;
alter table public.cancellation_records enable row level security;

-- Cities: publicly readable active cities only; admin manages
drop policy if exists cities_read_active on public.cities;
create policy cities_read_active on public.cities
  for select using (is_active = true or public.is_rova_admin());

drop policy if exists cities_admin_write on public.cities;
create policy cities_admin_write on public.cities
  for all using (public.is_rova_admin()) with check (public.is_rova_admin());

-- Pricing rule versions: authenticated read active, admin write
drop policy if exists pricing_versions_read on public.pricing_rule_versions;
create policy pricing_versions_read on public.pricing_rule_versions
  for select using (is_active = true or public.is_rova_admin());

drop policy if exists pricing_versions_admin_write on public.pricing_rule_versions;
create policy pricing_versions_admin_write on public.pricing_rule_versions
  for all using (public.is_rova_admin()) with check (public.is_rova_admin());

-- Delivery quotes: owner or admin can read own quotes; writes via backend service_role/admin
drop policy if exists delivery_quotes_read_own on public.delivery_quotes;
create policy delivery_quotes_read_own on public.delivery_quotes
  for select using (user_uid = auth.uid()::text or public.is_rova_admin());

drop policy if exists delivery_quotes_admin_write on public.delivery_quotes;
create policy delivery_quotes_admin_write on public.delivery_quotes
  for all using (public.is_rova_admin()) with check (public.is_rova_admin());

-- Courier locations: courier sees own; assigned customer sees ONLY during active delivery; admin sees all
drop policy if exists courier_locations_read_scoped on public.courier_locations;
create policy courier_locations_read_scoped on public.courier_locations
  for select using (
    courier_uid = auth.uid()::text
    or public.is_rova_admin()
    or (
      delivery_id is not null and exists (
        select 1 from public.deliveries d
        where d.id = courier_locations.delivery_id
          and d.merchant_uid = auth.uid()::text
          and d.status in ('driver_assigned','driver_approaching_pickup','at_pickup','package_collected','in_transit','approaching_recipient','arrived')
      )
    )
  );

-- Delivery offers: courier sees ONLY own offers (internal_score stripped by API); admin sees all
drop policy if exists delivery_offers_read_own on public.delivery_offers;
create policy delivery_offers_read_own on public.delivery_offers
  for select using (courier_uid = auth.uid()::text or public.is_rova_admin());

-- Delivery events: delivery owner, assigned courier, or admin
drop policy if exists delivery_events_read_scoped on public.delivery_events;
create policy delivery_events_read_scoped on public.delivery_events
  for select using (
    public.is_rova_admin()
    or exists (
      select 1 from public.deliveries d
      where d.id = delivery_events.delivery_id
        and (d.merchant_uid = auth.uid()::text or d.driver_uid = auth.uid()::text)
    )
  );

-- Notification outbox & logs: admin only (customers read public.notifications)
drop policy if exists notification_outbox_admin on public.notification_outbox;
create policy notification_outbox_admin on public.notification_outbox
  for all using (public.is_rova_admin()) with check (public.is_rova_admin());

drop policy if exists notification_logs_admin on public.notification_logs;
create policy notification_logs_admin on public.notification_logs
  for all using (public.is_rova_admin()) with check (public.is_rova_admin());

-- Proof of delivery: delivery owner, verifying courier, or admin
drop policy if exists pod_read_scoped on public.proof_of_delivery;
create policy pod_read_scoped on public.proof_of_delivery
  for select using (
    public.is_rova_admin()
    or verified_by_uid = auth.uid()::text
    or exists (
      select 1 from public.deliveries d
      where d.id = proof_of_delivery.delivery_id
        and d.merchant_uid = auth.uid()::text
    )
  );

-- Cancellation records: delivery owner, assigned courier, or admin
drop policy if exists cancellation_records_read_scoped on public.cancellation_records;
create policy cancellation_records_read_scoped on public.cancellation_records
  for select using (
    public.is_rova_admin()
    or cancelled_by_uid = auth.uid()::text
    or exists (
      select 1 from public.deliveries d
      where d.id = cancellation_records.delivery_id
        and (d.merchant_uid = auth.uid()::text or d.driver_uid = auth.uid()::text)
    )
  );
