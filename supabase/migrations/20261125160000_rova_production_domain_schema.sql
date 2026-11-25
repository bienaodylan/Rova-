-- ============================================================================
-- ROVA PRODUCTION DOMAIN SCHEMA & RLS MIGRATION
-- Follows 20261125150000_rova_firebase_migration_foundation.sql
-- ============================================================================
-- 1. Safely archives any legacy (legacy_id, data jsonb) staging tables created
--    by 20261125150000 into schema `legacy_import` so zero data is lost and no
--    table/column collision occurs.
-- 2. Creates normalized ROVA domain tables matching /server/supabaseRoutes.ts.
-- 3. Applies least-privilege RLS policies and enables Supabase Realtime.
-- ============================================================================

create extension if not exists "pgcrypto";
create schema if not exists legacy_import;
revoke all on schema legacy_import from anon, authenticated;
grant usage on schema legacy_import to service_role;

-- Step 1: Move empty/staging legacy tables (identified by `legacy_id` column)
-- from `public` to `legacy_import` so normalized production tables can be created cleanly.
do $$
declare
  tbl text;
  has_legacy_col boolean;
  target_exists boolean;
begin
  foreach tbl in array array[
    'users', 'admins', 'businesses', 'members', 'recipients', 'drivers',
    'driver_dispatch', 'vehicles', 'equipment', 'equipment_assignments',
    'partners', 'deliveries', 'public_tracking', 'reservations',
    'pricing_rules', 'incidents', 'notifications', 'waitlist', 'audit_logs',
    'business_members', 'business_recipients', 'delivery_stops'
  ]
  loop
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = tbl
        and column_name = 'legacy_id'
    ) into has_legacy_col;

    if has_legacy_col then
      select exists (
        select 1
        from information_schema.tables
        where table_schema = 'legacy_import'
          and table_name = tbl
      ) into target_exists;

      if not target_exists then
        execute format('alter table public.%I set schema legacy_import;', tbl);
      else
        execute format('alter table public.%I rename to %I;', tbl, tbl || '_staging_backup');
        execute format('alter table public.%I set schema legacy_import;', tbl || '_staging_backup');
      end if;
    end if;
  end loop;
end $$;

-- Helper trigger function for updated_at columns
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. USERS & ADMINS (preserves firebase_uid for legacy UID mapping)
-- ============================================================================
create table if not exists public.users (
  uid text primary key,
  firebase_uid text unique,
  email text not null,
  display_name text not null,
  phone text,
  role text not null default 'merchant' check (
    role in (
      'merchant', 'business_owner', 'business_employee',
      'independent_driver', 'rova_driver', 'fleet_partner', 'fleet_manager',
      'recipient', 'dispatcher', 'operations_manager', 'admin', 'super_admin'
    )
  ),
  business_id text,
  country text,
  primary_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_firebase_uid on public.users(firebase_uid);

create table if not exists public.admins (
  uid text primary key,
  email text not null,
  level text not null default 'admin' check (
    level in ('dispatcher', 'operations_manager', 'admin', 'super_admin')
  ),
  created_at timestamptz not null default now()
);

-- Server-trusted admin check: verifies public.admins table OR server-set JWT app_metadata.role
create or replace function public.is_rova_admin(check_uid text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.admins where uid = check_uid)
    or coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'super_admin'), false);
$$;

-- ============================================================================
-- 2. BUSINESSES, MEMBERS & SAVED RECIPIENTS
-- ============================================================================
create table if not exists public.businesses (
  id text primary key default gen_random_uuid()::text,
  owner_id text not null references public.users(uid) on delete cascade,
  name text not null,
  industry text,
  city text not null default 'Abidjan',
  country text not null default 'Côte d’Ivoire',
  currency text not null default 'XOF',
  verification_status text not null default 'pending' check (
    verification_status in ('pending', 'verified', 'suspended')
  ),
  wallet_balance numeric(12, 2) not null default 0,
  default_pickup_address text,
  default_pickup_landmark text,
  default_pickup_digital_address text,
  default_pickup_lat double precision,
  default_pickup_lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_businesses_owner_id on public.businesses(owner_id);

create table if not exists public.business_members (
  id text primary key default gen_random_uuid()::text,
  business_id text not null references public.businesses(id) on delete cascade,
  owner_id text not null,
  email text not null,
  name text not null,
  member_role text not null default 'employee' check (
    member_role in ('owner', 'manager', 'employee')
  ),
  status text not null default 'invited' check (
    status in ('invited', 'active', 'revoked')
  ),
  created_at timestamptz not null default now()
);

create table if not exists public.saved_recipients (
  id text primary key default gen_random_uuid()::text,
  business_id text references public.businesses(id) on delete cascade,
  owner_id text not null,
  name text not null,
  phone text not null,
  address text not null,
  landmark text,
  digital_address text,
  instructions text,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_saved_recipients_owner_id on public.saved_recipients(owner_id);

-- ============================================================================
-- 3. DRIVERS, DISPATCH INDEX, VEHICLES, EQUIPMENT & PARTNERS
-- ============================================================================
create table if not exists public.drivers (
  uid text primary key references public.users(uid) on delete cascade,
  full_name text not null,
  phone text not null,
  partner_type text not null default 'independent' check (
    partner_type in ('independent', 'rova_fleet', 'fleet_partner', 'commercial_partner')
  ),
  vehicle_category text not null default 'motorcycle' check (
    vehicle_category in ('motorcycle', 'cargo_motorcycle', 'tricycle', 'cargo_van', 'commercial_van', 'truck')
  ),
  vehicle_plate text not null,
  license_number text not null,
  insurance_ref text,
  service_area text not null,
  approval_status text not null default 'pending' check (
    approval_status in ('pending', 'under_review', 'approved', 'suspended')
  ),
  is_online boolean not null default false,
  current_lat double precision,
  current_lng double precision,
  rating numeric(3, 2) not null default 5.00,
  completed_deliveries integer not null default 0,
  acceptance_rate numeric(5, 2) not null default 100.00,
  earnings_total numeric(12, 2) not null default 0,
  active_delivery_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.driver_dispatch (
  uid text primary key,
  first_name text not null,
  partner_type text not null,
  vehicle_category text not null,
  service_area text not null,
  approval_status text not null default 'approved',
  is_online boolean not null default false,
  current_lat double precision not null,
  current_lng double precision not null,
  rating numeric(3, 2) not null default 5.00,
  completed_deliveries integer not null default 0,
  acceptance_rate numeric(5, 2) not null default 100.00,
  active_delivery_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_driver_dispatch_online on public.driver_dispatch(approval_status, is_online);

create table if not exists public.vehicles (
  id text primary key default gen_random_uuid()::text,
  fleet_number text not null,
  registration text not null,
  category text not null,
  owner_type text not null default 'rova',
  partner_name text,
  assigned_driver_id text,
  capacity_kg numeric(10, 2) not null default 50,
  status text not null default 'available',
  service_area text not null,
  maintenance_status text not null default 'nominal',
  insurance_expiry text,
  branding_status text not null default 'branded',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.equipment (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  category text not null,
  size text,
  total_stock integer not null default 0,
  assigned_count integer not null default 0,
  available_stock integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.equipment_assignments (
  id text primary key default gen_random_uuid()::text,
  equipment_id text not null references public.equipment(id) on delete cascade,
  equipment_name text not null,
  driver_id text not null,
  driver_name text not null,
  quantity integer not null default 1,
  size text,
  status text not null default 'assigned',
  assigned_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partners (
  id text primary key default gen_random_uuid()::text,
  company_name text not null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text not null,
  partner_type text not null,
  status text not null default 'pending',
  service_area text not null,
  commission_rate numeric(5, 2) not null default 15,
  payment_terms text,
  vehicle_count integer not null default 0,
  driver_count integer not null default 0,
  contract_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 4. DELIVERIES, STOPS, PUBLIC TRACKING & RESERVATIONS
-- ============================================================================
create table if not exists public.deliveries (
  id text primary key default gen_random_uuid()::text,
  reference text not null unique,
  business_id text,
  merchant_uid text not null,
  merchant_name text not null,
  driver_uid text not null default '',
  driver_name text,
  vehicle_category text not null,
  timing_type text not null default 'instant',
  scheduled_for text,
  pickup_address text not null,
  pickup_landmark text,
  pickup_digital_address text,
  pickup_instructions text,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  package_type text not null,
  package_size text not null default 'small',
  weight_kg numeric(10, 2) not null default 1,
  quantity integer not null default 1,
  fragile boolean not null default false,
  special_handling text,
  proof_required text not null default 'otp',
  status text not null default 'pending',
  is_multi_stop boolean not null default false,
  stop_count integer not null default 1,
  completed_stop_count integer not null default 0,
  primary_destination_label text,
  stop_ids jsonb not null default '[]'::jsonb,
  total_distance_km numeric(10, 2) not null default 1,
  estimated_duration_min integer not null default 15,
  quoted_price numeric(12, 2) not null default 0,
  currency text not null default 'XOF',
  payment_method text not null default 'mobile_money',
  payment_status text not null default 'authorized',
  driver_lat double precision,
  driver_lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_deliveries_merchant_uid on public.deliveries(merchant_uid, created_at desc);
create index if not exists idx_deliveries_driver_uid on public.deliveries(driver_uid, created_at desc);

create table if not exists public.delivery_stops (
  id text primary key default gen_random_uuid()::text,
  delivery_id text not null references public.deliveries(id) on delete cascade,
  merchant_uid text not null,
  driver_uid text not null default '',
  sequence integer not null,
  recipient_name text not null,
  recipient_phone text not null,
  address text not null,
  landmark text,
  digital_address text,
  instructions text,
  lat double precision not null,
  lng double precision not null,
  package_ref text,
  status text not null default 'pending',
  otp_code text not null,
  proof_type text,
  proof_value text,
  proof_notes text,
  tracking_token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_delivery_stops_delivery_id on public.delivery_stops(delivery_id, sequence asc);

create table if not exists public.public_tracking (
  tracking_token text primary key,
  delivery_id text not null references public.deliveries(id) on delete cascade,
  stop_id text not null references public.delivery_stops(id) on delete cascade,
  merchant_uid text not null,
  driver_uid text not null default '',
  reference text not null,
  recipient_first_name text not null,
  destination_label text not null,
  destination_lat double precision not null,
  destination_lng double precision not null,
  status text not null default 'pending',
  driver_first_name text,
  vehicle_category text not null,
  driver_lat double precision,
  driver_lng double precision,
  eta_minutes integer,
  show_live_driver boolean not null default false,
  otp_hint text,
  updated_at timestamptz not null default now()
);

create table if not exists public.reservations (
  id text primary key default gen_random_uuid()::text,
  business_id text,
  merchant_uid text not null,
  merchant_name text not null,
  vehicle_id text,
  vehicle_category text not null,
  driver_uid text not null default '',
  reservation_date text not null,
  start_time text not null,
  end_time text not null,
  duration_type text not null default 'window',
  pickup_address text not null,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  destinations_summary text,
  cargo_requirements text,
  quoted_price numeric(12, 2) not null default 0,
  currency text not null default 'XOF',
  status text not null default 'pending_approval',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_reservations_merchant_uid on public.reservations(merchant_uid, created_at desc);

-- ============================================================================
-- 5. PRICING RULES, INCIDENTS, NOTIFICATIONS, WAITLIST & AUDIT LOGS
-- ============================================================================
create table if not exists public.pricing_rules (
  id text primary key default gen_random_uuid()::text,
  zone_name text not null,
  city text not null,
  country text not null,
  currency text not null default 'XOF',
  vehicle_category text not null,
  base_fee numeric(10, 2) not null default 18,
  per_km_rate numeric(10, 2) not null default 4.5,
  minimum_fare numeric(10, 2) not null default 20,
  waiting_fee_per_min numeric(10, 2) not null default 0.5,
  scheduled_fee numeric(10, 2) not null default 5,
  cargo_surcharge numeric(10, 2) not null default 12,
  multi_stop_fee numeric(10, 2) not null default 6,
  priority_multiplier numeric(5, 2) not null default 1.25,
  peak_multiplier numeric(5, 2) not null default 1.15,
  full_day_rate numeric(12, 2) not null default 320,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.incidents (
  id text primary key default gen_random_uuid()::text,
  delivery_id text,
  reported_by_uid text not null,
  reporter_role text not null default 'merchant',
  category text not null,
  description text not null,
  status text not null default 'open',
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id text primary key default gen_random_uuid()::text,
  user_id text not null,
  title text not null,
  message text not null,
  event_type text not null,
  delivery_id text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_id on public.notifications(user_id, created_at desc);

create table if not exists public.waitlist (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  email text not null,
  company text,
  city text,
  platform text not null default 'contact',
  message text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id text primary key default gen_random_uuid()::text,
  actor_uid text not null,
  actor_email text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  summary text not null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 6. UPDATED_AT TRIGGERS
-- ============================================================================
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'users', 'businesses', 'drivers', 'driver_dispatch', 'vehicles',
    'equipment', 'equipment_assignments', 'partners', 'deliveries',
    'delivery_stops', 'public_tracking', 'reservations', 'pricing_rules', 'incidents'
  ]
  loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I;', tbl, tbl);
    execute format(
      'create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at();',
      tbl, tbl
    );
  end loop;
end $$;

-- ============================================================================
-- 7. ROW LEVEL SECURITY (RLS) & LEAST-PRIVILEGE GRANTS
-- ============================================================================
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'users', 'admins', 'businesses', 'business_members', 'saved_recipients',
    'drivers', 'driver_dispatch', 'vehicles', 'equipment', 'equipment_assignments',
    'partners', 'deliveries', 'delivery_stops', 'public_tracking', 'reservations',
    'pricing_rules', 'incidents', 'notifications', 'waitlist', 'audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security;', tbl);
    execute format('revoke all on table public.%I from anon;', tbl);
    execute format('grant select, insert, update, delete on table public.%I to authenticated;', tbl);
    execute format('grant all on table public.%I to service_role;', tbl);
  end loop;
end $$;

-- Strictly append-only audit_logs & admin-only operational tables
revoke update, delete on table public.audit_logs from authenticated;
grant insert on table public.waitlist to anon;

-- Users: self read/write (cannot escalate own role via client) or admin
drop policy if exists "users_self_select" on public.users;
create policy "users_self_select" on public.users for select
  using (auth.uid()::text = uid or public.is_rova_admin(auth.uid()::text));

drop policy if exists "users_self_insert" on public.users;
create policy "users_self_insert" on public.users for insert
  with check (
    auth.uid()::text = uid
    and role in ('merchant', 'business_owner', 'independent_driver', 'recipient')
  );

drop policy if exists "users_self_update" on public.users;
create policy "users_self_update" on public.users for update
  using (auth.uid()::text = uid or public.is_rova_admin(auth.uid()::text))
  with check (
    public.is_rova_admin(auth.uid()::text)
    or (
      auth.uid()::text = uid
      and role in ('merchant', 'business_owner', 'business_employee', 'independent_driver', 'recipient')
    )
  );

-- Admins: read self/admin only, write via service_role only
drop policy if exists "admins_self_select" on public.admins;
create policy "admins_self_select" on public.admins for select
  using (auth.uid()::text = uid or public.is_rova_admin(auth.uid()::text));

-- Businesses: owner or admin
drop policy if exists "businesses_owner_all" on public.businesses;
create policy "businesses_owner_all" on public.businesses for all
  using (auth.uid()::text = owner_id or public.is_rova_admin(auth.uid()::text))
  with check (auth.uid()::text = owner_id or public.is_rova_admin(auth.uid()::text));

-- Business members: owner or admin
drop policy if exists "business_members_owner_all" on public.business_members;
create policy "business_members_owner_all" on public.business_members for all
  using (auth.uid()::text = owner_id or public.is_rova_admin(auth.uid()::text))
  with check (auth.uid()::text = owner_id or public.is_rova_admin(auth.uid()::text));

-- Saved recipients: owner or admin
drop policy if exists "saved_recipients_owner_all" on public.saved_recipients;
create policy "saved_recipients_owner_all" on public.saved_recipients for all
  using (auth.uid()::text = owner_id or public.is_rova_admin(auth.uid()::text))
  with check (auth.uid()::text = owner_id or public.is_rova_admin(auth.uid()::text));

-- Drivers (private PII): self or admin
drop policy if exists "drivers_self_or_admin" on public.drivers;
create policy "drivers_self_or_admin" on public.drivers for all
  using (auth.uid()::text = uid or public.is_rova_admin(auth.uid()::text))
  with check (auth.uid()::text = uid or public.is_rova_admin(auth.uid()::text));

-- Driver dispatch (PII-free online index): authenticated read, self/admin write
drop policy if exists "driver_dispatch_auth_read" on public.driver_dispatch;
create policy "driver_dispatch_auth_read" on public.driver_dispatch for select
  using (auth.role() = 'authenticated');

drop policy if exists "driver_dispatch_self_write" on public.driver_dispatch;
create policy "driver_dispatch_self_write" on public.driver_dispatch for all
  using (auth.uid()::text = uid or public.is_rova_admin(auth.uid()::text))
  with check (auth.uid()::text = uid or public.is_rova_admin(auth.uid()::text));

-- Deliveries: merchant, assigned driver, or admin
drop policy if exists "deliveries_scoped_select" on public.deliveries;
create policy "deliveries_scoped_select" on public.deliveries for select
  using (
    auth.uid()::text = merchant_uid
    or auth.uid()::text = driver_uid
    or public.is_rova_admin(auth.uid()::text)
  );

drop policy if exists "deliveries_merchant_insert" on public.deliveries;
create policy "deliveries_merchant_insert" on public.deliveries for insert
  with check (auth.uid()::text = merchant_uid or public.is_rova_admin(auth.uid()::text));

drop policy if exists "deliveries_scoped_update" on public.deliveries;
create policy "deliveries_scoped_update" on public.deliveries for update
  using (
    auth.uid()::text = merchant_uid
    or auth.uid()::text = driver_uid
    or public.is_rova_admin(auth.uid()::text)
  );

-- Delivery stops: merchant, assigned driver, or admin
drop policy if exists "delivery_stops_scoped_all" on public.delivery_stops;
create policy "delivery_stops_scoped_all" on public.delivery_stops for all
  using (
    auth.uid()::text = merchant_uid
    or auth.uid()::text = driver_uid
    or public.is_rova_admin(auth.uid()::text)
  )
  with check (
    auth.uid()::text = merchant_uid
    or auth.uid()::text = driver_uid
    or public.is_rova_admin(auth.uid()::text)
  );

-- Public tracking: public lookup is strictly token-only via /api/v1/tracking/:token
drop policy if exists "public_tracking_participants_all" on public.public_tracking;
create policy "public_tracking_participants_all" on public.public_tracking for all
  using (
    auth.uid()::text = merchant_uid
    or auth.uid()::text = driver_uid
    or public.is_rova_admin(auth.uid()::text)
  )
  with check (
    auth.uid()::text = merchant_uid
    or auth.uid()::text = driver_uid
    or public.is_rova_admin(auth.uid()::text)
  );

-- Reservations: merchant, assigned driver, or admin
drop policy if exists "reservations_scoped_all" on public.reservations;
create policy "reservations_scoped_all" on public.reservations for all
  using (
    auth.uid()::text = merchant_uid
    or auth.uid()::text = driver_uid
    or public.is_rova_admin(auth.uid()::text)
  )
  with check (
    auth.uid()::text = merchant_uid
    or public.is_rova_admin(auth.uid()::text)
  );

-- Pricing rules: active rules readable by authenticated users, writable by admins
drop policy if exists "pricing_rules_auth_select" on public.pricing_rules;
create policy "pricing_rules_auth_select" on public.pricing_rules for select
  using (active = true or public.is_rova_admin(auth.uid()::text));

drop policy if exists "pricing_rules_admin_write" on public.pricing_rules;
create policy "pricing_rules_admin_write" on public.pricing_rules for all
  using (public.is_rova_admin(auth.uid()::text))
  with check (public.is_rova_admin(auth.uid()::text));

-- Incidents: reporter or admin
drop policy if exists "incidents_owner_or_admin" on public.incidents;
create policy "incidents_owner_or_admin" on public.incidents for all
  using (auth.uid()::text = reported_by_uid or public.is_rova_admin(auth.uid()::text))
  with check (auth.uid()::text = reported_by_uid or public.is_rova_admin(auth.uid()::text));

-- Notifications: owner or admin
drop policy if exists "notifications_owner_all" on public.notifications;
create policy "notifications_owner_all" on public.notifications for all
  using (auth.uid()::text = user_id or public.is_rova_admin(auth.uid()::text))
  with check (auth.uid()::text = user_id or public.is_rova_admin(auth.uid()::text));

-- Admin-only operational tables
drop policy if exists "vehicles_admin_all" on public.vehicles;
create policy "vehicles_admin_all" on public.vehicles for all
  using (public.is_rova_admin(auth.uid()::text))
  with check (public.is_rova_admin(auth.uid()::text));

drop policy if exists "equipment_admin_all" on public.equipment;
create policy "equipment_admin_all" on public.equipment for all
  using (public.is_rova_admin(auth.uid()::text))
  with check (public.is_rova_admin(auth.uid()::text));

drop policy if exists "equipment_assignments_admin_all" on public.equipment_assignments;
create policy "equipment_assignments_admin_all" on public.equipment_assignments for all
  using (public.is_rova_admin(auth.uid()::text))
  with check (public.is_rova_admin(auth.uid()::text));

drop policy if exists "partners_admin_all" on public.partners;
create policy "partners_admin_all" on public.partners for all
  using (public.is_rova_admin(auth.uid()::text))
  with check (public.is_rova_admin(auth.uid()::text));

drop policy if exists "waitlist_public_insert" on public.waitlist;
create policy "waitlist_public_insert" on public.waitlist for insert
  with check (true);

drop policy if exists "waitlist_admin_select" on public.waitlist;
create policy "waitlist_admin_select" on public.waitlist for select
  using (public.is_rova_admin(auth.uid()::text));

drop policy if exists "audit_logs_admin_select" on public.audit_logs;
create policy "audit_logs_admin_select" on public.audit_logs for select
  using (public.is_rova_admin(auth.uid()::text));

drop policy if exists "audit_logs_admin_insert" on public.audit_logs;
create policy "audit_logs_admin_insert" on public.audit_logs for insert
  with check (public.is_rova_admin(auth.uid()::text));

-- ============================================================================
-- 8. REALTIME PUBLICATION
-- ============================================================================
do $$
declare
  rt_tbl text;
begin
  foreach rt_tbl in array array[
    'deliveries', 'delivery_stops', 'reservations', 'saved_recipients', 'notifications', 'driver_dispatch'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I;', rt_tbl);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;
