
-- ROVA normalized operational schema, additive and non-destructive.
-- Existing legacy_id/data primary-key staging fields remain intact; defaults keep new API inserts compatible.

create extension if not exists pgcrypto;

do $$
declare t text;
begin
  foreach t in array array['users','admins','businesses','deliveries','delivery_stops','public_tracking','reservations','notifications','driver_dispatch','pricing_rules','waitlist'] loop
    execute format('alter table public.%I alter column legacy_id set default gen_random_uuid()::text', t);
    execute format('alter table public.%I alter column data set default ''{}''::jsonb', t);
  end loop;
end $$;

alter table public.users
 add column if not exists uid text, add column if not exists email text,
 add column if not exists display_name text, add column if not exists phone text,
 add column if not exists role text not null default 'merchant', add column if not exists business_id text,
 add column if not exists country text, add column if not exists primary_address text,
 add column if not exists created_at timestamptz not null default now(),
 add column if not exists updated_at timestamptz not null default now();
update public.users set uid=coalesce(uid,firebase_uid,legacy_id) where uid is null;
create unique index if not exists users_uid_uidx on public.users(uid);

alter table public.admins add column if not exists uid text;
update public.admins set uid=coalesce(uid,legacy_id) where uid is null;
create unique index if not exists admins_uid_uidx on public.admins(uid);

alter table public.businesses
 add column if not exists id text, add column if not exists owner_id text,
 add column if not exists name text, add column if not exists industry text,
 add column if not exists city text not null default 'Abidjan',
 add column if not exists country text not null default 'Côte d’Ivoire',
 add column if not exists currency text not null default 'XOF',
 add column if not exists verification_status text not null default 'pending',
 add column if not exists wallet_balance numeric(14,2) not null default 0,
 add column if not exists default_pickup_address text, add column if not exists default_pickup_landmark text,
 add column if not exists default_pickup_digital_address text,
 add column if not exists default_pickup_lat double precision, add column if not exists default_pickup_lng double precision,
 add column if not exists created_at timestamptz not null default now(),
 add column if not exists updated_at timestamptz not null default now();
update public.businesses set id=coalesce(id,legacy_id) where id is null;
create unique index if not exists businesses_id_uidx on public.businesses(id);
create index if not exists businesses_owner_id_idx on public.businesses(owner_id);

alter table public.deliveries
 add column if not exists id text, add column if not exists reference text,
 add column if not exists business_id text, add column if not exists merchant_uid text,
 add column if not exists merchant_name text, add column if not exists driver_uid text not null default '',
 add column if not exists driver_name text, add column if not exists vehicle_category text not null default 'motorcycle',
 add column if not exists timing_type text not null default 'instant', add column if not exists scheduled_for text,
 add column if not exists pickup_address text not null default '', add column if not exists pickup_landmark text,
 add column if not exists pickup_digital_address text, add column if not exists pickup_instructions text,
 add column if not exists pickup_lat double precision not null default 0, add column if not exists pickup_lng double precision not null default 0,
 add column if not exists package_type text not null default '', add column if not exists package_size text not null default 'small',
 add column if not exists weight_kg numeric(10,2) not null default 1, add column if not exists quantity integer not null default 1,
 add column if not exists fragile boolean not null default false, add column if not exists special_handling text,
 add column if not exists proof_required text not null default 'otp', add column if not exists status text not null default 'pending',
 add column if not exists is_multi_stop boolean not null default false, add column if not exists stop_count integer not null default 1,
 add column if not exists completed_stop_count integer not null default 0, add column if not exists primary_destination_label text,
 add column if not exists stop_ids text[] not null default '{}',
 add column if not exists total_distance_km numeric(10,2) not null default 0,
 add column if not exists estimated_duration_min integer not null default 0,
 add column if not exists quoted_price numeric(14,2) not null default 0,
 add column if not exists currency text not null default 'XOF',
 add column if not exists payment_method text not null default 'mobile_money',
 add column if not exists payment_status text not null default 'pending',
 add column if not exists driver_lat double precision, add column if not exists driver_lng double precision,
 add column if not exists created_at timestamptz not null default now(),
 add column if not exists updated_at timestamptz not null default now();
update public.deliveries set id=coalesce(id,legacy_id) where id is null;
create unique index if not exists deliveries_id_uidx on public.deliveries(id);
create unique index if not exists deliveries_reference_uidx on public.deliveries(reference) where reference is not null;
create index if not exists deliveries_merchant_created_idx on public.deliveries(merchant_uid,created_at desc);
create index if not exists deliveries_driver_idx on public.deliveries(driver_uid);

alter table public.delivery_stops
 add column if not exists id text, add column if not exists delivery_id text,
 add column if not exists merchant_uid text, add column if not exists driver_uid text not null default '',
 add column if not exists sequence integer not null default 1,
 add column if not exists recipient_name text not null default '', add column if not exists recipient_phone text not null default '',
 add column if not exists address text not null default '', add column if not exists landmark text,
 add column if not exists digital_address text, add column if not exists instructions text,
 add column if not exists lat double precision not null default 0, add column if not exists lng double precision not null default 0,
 add column if not exists package_ref text, add column if not exists status text not null default 'pending',
 add column if not exists otp_code text not null default '', add column if not exists proof_type text,
 add column if not exists proof_value text, add column if not exists proof_notes text,
 add column if not exists tracking_token text, add column if not exists created_at timestamptz not null default now(),
 add column if not exists updated_at timestamptz not null default now();
update public.delivery_stops set id=coalesce(id,legacy_id) where id is null;
create unique index if not exists delivery_stops_id_uidx on public.delivery_stops(id);
create index if not exists delivery_stops_delivery_sequence_idx on public.delivery_stops(delivery_id,sequence);

alter table public.public_tracking
 add column if not exists tracking_token text, add column if not exists delivery_id text,
 add column if not exists stop_id text, add column if not exists merchant_uid text,
 add column if not exists driver_uid text not null default '', add column if not exists reference text,
 add column if not exists recipient_first_name text, add column if not exists destination_label text,
 add column if not exists destination_lat double precision not null default 0,
 add column if not exists destination_lng double precision not null default 0,
 add column if not exists status text not null default 'pending', add column if not exists driver_first_name text,
 add column if not exists vehicle_category text not null default 'motorcycle',
 add column if not exists driver_lat double precision, add column if not exists driver_lng double precision,
 add column if not exists eta_minutes integer, add column if not exists show_live_driver boolean not null default false,
 add column if not exists otp_hint text, add column if not exists updated_at timestamptz not null default now();
create unique index if not exists public_tracking_token_uidx on public.public_tracking(tracking_token);
create index if not exists public_tracking_delivery_idx on public.public_tracking(delivery_id);

alter table public.reservations
 add column if not exists id text, add column if not exists business_id text,
 add column if not exists merchant_uid text, add column if not exists merchant_name text,
 add column if not exists vehicle_id text, add column if not exists vehicle_category text not null default 'motorcycle',
 add column if not exists driver_uid text not null default '', add column if not exists reservation_date date,
 add column if not exists start_time text, add column if not exists end_time text,
 add column if not exists duration_type text not null default 'window',
 add column if not exists pickup_address text not null default '',
 add column if not exists pickup_lat double precision not null default 0, add column if not exists pickup_lng double precision not null default 0,
 add column if not exists destinations_summary text, add column if not exists cargo_requirements text,
 add column if not exists quoted_price numeric(14,2) not null default 0, add column if not exists currency text not null default 'XOF',
 add column if not exists status text not null default 'pending_approval',
 add column if not exists created_at timestamptz not null default now(), add column if not exists updated_at timestamptz not null default now();
update public.reservations set id=coalesce(id,legacy_id) where id is null;
create unique index if not exists reservations_id_uidx on public.reservations(id);
create index if not exists reservations_merchant_created_idx on public.reservations(merchant_uid,created_at desc);

create table if not exists public.saved_recipients (
 id text primary key default gen_random_uuid()::text, owner_id text not null, business_id text,
 name text not null, phone text not null, address text not null, landmark text,
 digital_address text, instructions text, lat double precision not null, lng double precision not null,
 created_at timestamptz not null default now()
);
create index if not exists saved_recipients_owner_created_idx on public.saved_recipients(owner_id,created_at desc);

alter table public.notifications
 add column if not exists id text, add column if not exists user_id text,
 add column if not exists title text not null default '', add column if not exists message text not null default '',
 add column if not exists event_type text not null default '', add column if not exists delivery_id text,
 add column if not exists read boolean not null default false, add column if not exists created_at timestamptz not null default now();
update public.notifications set id=coalesce(id,legacy_id) where id is null;
create unique index if not exists notifications_id_uidx on public.notifications(id);
create index if not exists notifications_user_created_idx on public.notifications(user_id,created_at desc);

alter table public.driver_dispatch
 add column if not exists uid text, add column if not exists first_name text not null default '',
 add column if not exists partner_type text not null default 'independent',
 add column if not exists vehicle_category text not null default 'motorcycle',
 add column if not exists service_area text not null default '',
 add column if not exists approval_status text not null default 'pending',
 add column if not exists is_online boolean not null default false,
 add column if not exists current_lat double precision not null default 0,
 add column if not exists current_lng double precision not null default 0,
 add column if not exists rating numeric(3,2) not null default 5,
 add column if not exists completed_deliveries integer not null default 0,
 add column if not exists acceptance_rate numeric(5,2) not null default 100,
 add column if not exists active_delivery_count integer not null default 0,
 add column if not exists updated_at timestamptz not null default now();
update public.driver_dispatch set uid=coalesce(uid,legacy_id) where uid is null;
create unique index if not exists driver_dispatch_uid_uidx on public.driver_dispatch(uid);

alter table public.pricing_rules
 add column if not exists id text, add column if not exists zone_name text not null default '',
 add column if not exists city text not null default '', add column if not exists country text not null default '',
 add column if not exists currency text not null default 'XOF',
 add column if not exists vehicle_category text not null default 'motorcycle',
 add column if not exists base_fee numeric(12,2) not null default 18,
 add column if not exists per_km_rate numeric(12,2) not null default 4.5,
 add column if not exists minimum_fare numeric(12,2) not null default 20,
 add column if not exists waiting_fee_per_min numeric(12,2) not null default 0.5,
 add column if not exists scheduled_fee numeric(12,2) not null default 5,
 add column if not exists cargo_surcharge numeric(12,2) not null default 12,
 add column if not exists multi_stop_fee numeric(12,2) not null default 6,
 add column if not exists priority_multiplier numeric(8,3) not null default 1.25,
 add column if not exists peak_multiplier numeric(8,3) not null default 1.15,
 add column if not exists full_day_rate numeric(12,2) not null default 320,
 add column if not exists active boolean not null default false,
 add column if not exists updated_at timestamptz not null default now();
update public.pricing_rules set id=coalesce(id,legacy_id) where id is null;
create unique index if not exists pricing_rules_id_uidx on public.pricing_rules(id);

alter table public.waitlist
 add column if not exists name text not null default 'ROVA Contact',
 add column if not exists email text not null default '', add column if not exists company text,
 add column if not exists city text, add column if not exists platform text not null default 'contact',
 add column if not exists message text, add column if not exists created_at timestamptz not null default now();

-- The application server uses the service role after validating the Supabase JWT.
-- Browser profile fallback is limited to the current authenticated user.
alter table public.users enable row level security;
drop policy if exists "rova_users_select_own" on public.users;
create policy "rova_users_select_own" on public.users
 for select to authenticated using (uid=auth.uid()::text);

alter table public.businesses enable row level security;
alter table public.deliveries enable row level security;
alter table public.delivery_stops enable row level security;
alter table public.public_tracking enable row level security;
alter table public.reservations enable row level security;
alter table public.saved_recipients enable row level security;
alter table public.notifications enable row level security;
alter table public.driver_dispatch enable row level security;

do $$
declare t text;
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['deliveries','delivery_stops','public_tracking','notifications','driver_dispatch'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
    execute format('alter publication supabase_realtime add table public.%I',t);
   end if;
  end loop;
 end if;
end $$;
