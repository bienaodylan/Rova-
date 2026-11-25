-- ROVA Firebase-to-Supabase migration foundation.
-- Empty target only. Do not switch production clients until data import/RLS parity tests pass.
create extension if not exists pgcrypto;
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 firebase_uid text unique, email text, display_name text, avatar_url text,
 legacy_profile jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path=public
as $$ begin new.updated_at=now(); return new; end $$;

do $$
declare t text;
begin
 foreach t in array array[
 'users','admins','businesses','members','recipients','drivers','driver_dispatch',
 'vehicles','equipment','equipment_assignments','partners','deliveries','public_tracking',
 'reservations','pricing_rules','incidents','notifications','waitlist','audit_logs'
 ] loop
  execute format('create table if not exists public.%I (legacy_id text primary key, firebase_uid text, data jsonb not null default ''{}''::jsonb, source_created_at timestamptz, source_updated_at timestamptz, imported_at timestamptz not null default now())',t);
 end loop;
end $$;
create table if not exists public.business_members (legacy_id text primary key,business_legacy_id text not null,data jsonb not null default '{}'::jsonb,source_created_at timestamptz,source_updated_at timestamptz,imported_at timestamptz not null default now());
create table if not exists public.business_recipients (legacy_id text primary key,business_legacy_id text not null,data jsonb not null default '{}'::jsonb,source_created_at timestamptz,source_updated_at timestamptz,imported_at timestamptz not null default now());
create table if not exists public.delivery_stops (legacy_id text primary key,delivery_legacy_id text not null,data jsonb not null default '{}'::jsonb,source_created_at timestamptz,source_updated_at timestamptz,imported_at timestamptz not null default now());
create index if not exists business_members_parent_idx on public.business_members(business_legacy_id);
create index if not exists business_recipients_parent_idx on public.business_recipients(business_legacy_id);
create index if not exists delivery_stops_parent_idx on public.delivery_stops(delivery_legacy_id);
create table if not exists public.migration_runs (
 id uuid primary key default gen_random_uuid(),source text not null default 'firebase_firestore',
 collection_name text not null,status text not null default 'pending'
 check(status in ('pending','exported','imported','verified','failed')),
 exported_count bigint,imported_count bigint,checksum text,details jsonb not null default '{}'::jsonb,
 started_at timestamptz,completed_at timestamptz,created_at timestamptz not null default now()
);
do $$
declare t text;
begin
 foreach t in array array[
 'profiles','users','admins','businesses','members','recipients','drivers','driver_dispatch',
 'vehicles','equipment','equipment_assignments','partners','deliveries','public_tracking',
 'reservations','pricing_rules','incidents','notifications','waitlist','audit_logs',
 'business_members','business_recipients','delivery_stops','migration_runs'
 ] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from anon,authenticated',t);
  execute format('grant all on table public.%I to service_role',t);
 end loop;
end $$;
