# ROVA Firestore Security Specification

## Data Invariants
1. A user cannot self-assign privileged roles (`admin`, `super_admin`, `dispatcher`, `operations_manager`) unless verified as the bootstrapped super admin email (`bienaodylan428@gmail.com` with `email_verified == true`).
2. A driver cannot self-approve (`approvalStatus: 'approved'`) or manipulate their own rating/earnings/completedDeliveries during registration or profile updates.
3. PII (`users`, `drivers`) is strictly isolated to the owner or an admin. Nearby driver discovery uses a PII-free `driverDispatch` projection.
4. A merchant cannot read or mutate another merchant's `businesses`, `deliveries`, `reservations`, or `recipients`.
5. A delivery stop cannot exist without a valid parent delivery owned by the merchant (`exists()` Master Gate).
6. Recipients tracking via `publicTracking/{trackingToken}` can only `get` their exact token document; `list` is permanently denied so other stops/recipients can never be enumerated.
7. Once a delivery reaches a terminal state (`delivered` or `cancelled`), non-admin updates are blocked.
8. All client writes must strictly enforce `request.time` on `createdAt`/`updatedAt`, strict `keys().hasAll`/`hasOnly` allowlists, and `.size()` limits on every string field.

## The "Dirty Dozen" Payloads (All Must Return PERMISSION_DENIED)
1. **Privilege Escalation on User Create**: `{ uid: "attacker", email: "a@b.com", displayName: "A", role: "super_admin", createdAt: serverTimestamp(), updatedAt: serverTimestamp() }`
2. **Self-Approving Driver Registration**: `{ uid: "drv1", fullName: "Fake", phone: "+233500", approvalStatus: "approved", ... }`
3. **Shadow Ghost Field Injection on Delivery**: Creating a delivery with an extra `isFree: true` field.
4. **Cross-Merchant Delivery Read**: Merchant B calling `get` on Merchant A's delivery.
5. **Cross-Driver PII Scraping**: Signed-in merchant calling `get` or `list` on `/drivers/{otherDriverId}`.
6. **Public Tracking Enumeration**: Anonymous user calling `list` on `/publicTracking`.
7. **ID Poisoning**: Creating `/deliveries/${"a".repeat(200)}` (exceeds 128-char regex ID guard).
8. **Terminal State Tampering**: Merchant or Driver updating a delivery whose status is already `delivered`.
9. **Client Timestamp Forgery**: Creating a delivery with `createdAt: new Date("2020-01-01")` instead of `serverTimestamp()`.
10. **Owner Hijack on Update**: Merchant attempting to update `merchantUid` on an existing delivery.
11. **Pricing Rule Tampering**: Non-admin attempting to update `/pricingRules/{ruleId}` to `baseFee: 0`.
12. **Audit Log Deletion**: Any non-admin attempting to update or delete `/auditLogs/{logId}`.
