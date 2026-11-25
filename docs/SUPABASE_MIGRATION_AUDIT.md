# ROVA Firebase to Supabase migration audit

## Source system
- Frontend: Vite, React, TypeScript.
- Auth: Firebase Authentication; Google and Apple popup OAuth in src/context/AuthContext.tsx.
- Database: Firestore project integrated-voltage-kvr20, named database ai-studio-coligosuividecol-c9072cb1-6266-4b5c-ba8c-1c50dac9b72c.
- Data access: src/context/RovaAppContext.tsx and operations, merchant, driver and tracking screens.
- Server: Express app in server/apiApp.ts; it currently has Firebase-era services and no Supabase health endpoint.
- Security source of truth: firestore.rules, including default-deny and collection-specific authorization.

## Collections found in Firestore rules
Root collections: users, admins, businesses, members, recipients, drivers, driverDispatch, vehicles, equipment, equipmentAssignments, partners, deliveries, publicTracking, reservations, pricingRules, incidents, notifications, waitlist, auditLogs.
Nested collections: businesses/{businessId}/members, businesses/{businessId}/recipients, deliveries/{deliveryId}/stops.

## Auth migration
The inspected AuthContext uses Google and Apple OAuth; no email/password flow was found there. Firebase UIDs are referenced by application data and must be retained as a unique legacy mapping to new Supabase Auth UUIDs. Do not assume Firebase UID equals Supabase UUID. Trusted roles must be assigned server-side in app_metadata, never user_metadata.

## Target project
- Supabase project: ROVA
- Project ref: ghnfdvqnhqmwgmilngda
- Region: eu-west-1 (West Europe)
- URL: https://ghnfdvqnhqmwgmilngda.supabase.co
- Status at creation: ACTIVE_HEALTHY
- Initial database schema is empty of imported user data. RLS is enabled and anon/authenticated table privileges are revoked.

## Initial database foundation
A migration creates profiles, legacy collection tables, nested collection tables and migration_runs. It preserves Firestore document IDs and JSON payloads as a compatibility stage. This is not the final normalized domain schema and no permissive RLS policies have been added. This intentionally denies client access until collection-specific authorization is translated and tested.

## Required next steps
1. Obtain a secure Firestore export or Firebase Admin service-account access through a secret manager. Do not paste private keys into chat.
2. Inventory actual document counts, nested paths, field shapes, references and PII.
3. Design and test RLS policies against firestore.rules, including public tracking token-only access, delivery stop privacy, business membership, driver dispatch, admin-only operations and append-only audit logs.
4. Configure Supabase Google and Apple OAuth using the existing OAuth client credentials and exact redirect URLs.
5. Build resumable import with preserved document IDs, timestamps, nested collections, per-collection counts and checksums.
6. Add Supabase client/data-access compatibility layer and migrate individual screens behind controlled flags.
7. Validate staging workflows and realtime behavior; only then configure Vercel production secrets and schedule cutover.
8. Keep Firebase live and retain a tested rollback path until production parity is proven.

## Safety
No Firebase resources, production Vercel settings, live authentication or production app code were changed during this preparation. Do not cut over until the data export, policies, OAuth and staging verification are complete.
