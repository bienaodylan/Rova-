# ROVA Operational Infrastructure — Audit réel (Phase 1)

Date: 2026-11-25
Base audited: `main` (Vite + React + TypeScript + Express + Vercel)
Supabase project: `ghnfdvqnhqmwgmilngda`

## Executive status

ROVA is an existing application with customer, driver and operations interfaces. It is **not yet** the complete operational logistics system described in the master specification. The current architecture has a dual Firebase/Supabase data path; the Supabase API is partially implemented, while several important screens and workflows still use Firestore directly.

No production data or configuration was modified during this audit.

## Verified architecture

- Frontend: React 19, TypeScript, Vite.
- API: Express application mounted as a Vercel serverless function at `api/index.ts`; local development runs through `server.ts`.
- Authentication: Firebase Auth remains an active fallback; Supabase Auth is selected when public Supabase configuration is hydrated.
- Data: Firestore remains used directly by driver and operations screens and by Firebase fallback paths in the workspace context. Supabase REST routes exist under `/api/v1/*`.
- Maps: Google Maps Platform browser integration, server geocoding/routing endpoints, Geoapify fallback and Leaflet fallback.
- Realtime: Supabase Realtime is used for part of the merchant workspace; Firestore listeners remain in several workspaces.
- Database: normalized Supabase domain tables exist, including users, businesses, drivers, driver_dispatch, deliveries, delivery_stops, public_tracking, pricing_rules, incidents, notifications and audit_logs.

## Database audit findings

The live Supabase project currently reports:
- 25 public tables.
- All 25 public tables report 0 rows.
- `migration_runs` contains 0 rows.
- Only one public RLS policy is currently visible; the repository migration defines a much broader policy set.
- The live migration history contains two migration records, but the effective live policy state does not match the full policy coverage expected from the checked-in migration.

**Consequence:** schema existence is not proof of a completed Firebase data migration or production-ready authorization. Do not cut over production data or rely on direct client table access until schema drift and RLS coverage are reconciled and tested.

## Critical gaps against the master specification

### P0 — Data/auth migration and authorization
- Firebase Auth and Firestore remain in application code and are still used by driver and operations screens.
- Supabase and Firebase user IDs are not interchangeable; the migration must preserve an explicit Firebase UID mapping.
- Live Supabase data import has not been verified.
- RLS policy coverage in the live database is materially incomplete compared with the repository SQL.
- Server routes use a service-role client, so every route must enforce ownership, role, and field-level authorization itself.

### P0 — Delivery integrity
- `POST /api/v1/deliveries` accepts client-supplied quoted price, distance, duration, and optional driver identity.
- Delivery creation inserts the delivery, stops, tracking rows and notification in separate requests rather than one database transaction. Partial records are possible.
- The current status endpoint checks participant access and whether a status name is allowed, but does not enforce a strict from-state → to-state transition graph.
- Status updates are not persisted as immutable delivery events.
- A customer-supplied status is not an authoritative lifecycle operation.

### P0 — Dispatch and courier operations
- No dedicated delivery-offer lifecycle or atomic assignment engine was found in the current Supabase API.
- Existing driver interfaces still use Firestore listeners and direct document writes for online state, claiming jobs, status progression and proof-of-delivery flows.
- The current proximity index is not sufficient on its own for eligibility: city, GPS freshness, vehicle compatibility, workload and service-area boundaries must be validated server-side.

### P1 — Geospatial eligibility and pricing
- Address search and route endpoints exist.
- The current code does not establish the required city → service-area → zone eligibility model for deliveries.
- Pricing fallback values exist in frontend logistics utilities.
- A server-authoritative quote lifecycle, pricing-rule version, expiry and tamper-resistant confirmation flow are not yet demonstrated.

### P1 — Notifications, tracking and recovery
- Some notifications are inserted from request handlers or frontend flows; a durable outbox, retry worker and deduplication lifecycle were not found.
- Public tracking records exist, but the full protected realtime tracking lifecycle and stale-GPS policy are not yet demonstrated.
- Scheduled reconciliation, offer expiration, stuck-delivery recovery and dead-letter handling were not found in the inspected code.

### P1 — Operations
- Operations and driver screens exist, but their current Firestore dependency means they are not fully integrated with the Supabase operational backend.
- Admin-side pricing, fleet and delivery controls need to move behind authenticated server operations and audit logging.

## Files inspected

- `package.json`, `server.ts`, `api/index.ts`, `server/apiApp.ts`
- `server/supabaseAdmin.ts`, `server/supabaseRoutes.ts`
- `src/main.tsx`, `src/lib/firebase.ts`, `src/lib/supabase.ts`
- `src/context/AuthContext.tsx`, `src/context/RovaAppContext.tsx`, `src/context/MapsContext.tsx`
- `src/pages/DriverWorkspace.tsx`, `src/pages/OperationsCenter.tsx`
- `src/lib/logistics.ts`, `src/types/rova.ts`
- Supabase migrations and the live Supabase table/policy/migration metadata.

## Safe implementation order

1. Reconcile live Supabase schema and RLS against checked-in migrations; add automated policy tests.
2. Build a server-owned delivery transaction and immutable event/state-transition service. Do not trust client price, distance, status or driver assignment.
3. Add city and service-area configuration and server-side geospatial eligibility.
4. Add quote snapshots and server-authoritative pricing.
5. Add courier availability/GPS freshness, delivery offers, dispatch waves and atomic assignment.
6. Migrate driver and operations workspaces from Firestore to authenticated Supabase APIs, one workflow at a time.
7. Add event outbox, notification delivery/retries, tracking lifecycle and reconciliation.
8. Add integration, concurrency, authorization and recovery tests before production cutover.

## Production safety decisions

- Keep Firebase operational until data export/import, identity mapping, parity tests and rollback are complete.
- Do not delete or rewrite existing collections.
- Do not enable permissive RLS policies to make the UI work.
- Do not use a client-provided price or GPS coordinate as authoritative proof.
- Do not mark dispatch, payment, notification or delivery success unless the backend confirms it.
- Any schema change must be additive, reviewed, tested and applied as a versioned migration.
