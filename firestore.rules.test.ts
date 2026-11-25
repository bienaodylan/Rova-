/**
 * ROVA Firestore Security Rules Verification Spec
 * Verifies the "Dirty Dozen" adversarial payloads against firestore.rules.
 */
export const dirtyDozenPayloads = [
  {
    name: '1. Privilege Escalation on User Create',
    path: '/users/attacker_uid',
    op: 'create',
    payload: { uid: 'attacker_uid', email: 'a@b.com', displayName: 'A', role: 'super_admin' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '2. Self-Approving Driver Registration',
    path: '/drivers/attacker_uid',
    op: 'create',
    payload: { uid: 'attacker_uid', fullName: 'Fake', phone: '+233500', approvalStatus: 'approved' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '3. Shadow Ghost Field Injection on Delivery',
    path: '/deliveries/del_shadow_1',
    op: 'create',
    payload: { reference: 'ROVA-0001', merchantUid: 'merchant_1', isFree: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '4. Cross-Merchant Delivery Read',
    path: '/deliveries/del_merchant_a',
    op: 'get',
    asUid: 'merchant_b',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '5. Cross-Driver PII Scraping',
    path: '/drivers/driver_a',
    op: 'get',
    asUid: 'merchant_a',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '6. Public Tracking Enumeration',
    path: '/publicTracking',
    op: 'list',
    asUid: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '7. ID Poisoning (>128 chars)',
    path: `/deliveries/${'a'.repeat(160)}`,
    op: 'create',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '8. Terminal State Tampering',
    path: '/deliveries/del_completed',
    op: 'update',
    payload: { status: 'pending' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '9. Client Timestamp Forgery',
    path: '/deliveries/del_time_1',
    op: 'create',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '10. Owner Hijack on Update',
    path: '/deliveries/del_merchant_a',
    op: 'update',
    payload: { merchantUid: 'attacker_uid' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '11. Pricing Rule Tampering by Non-Admin',
    path: '/pricingRules/rule_accra_moto',
    op: 'update',
    asUid: 'merchant_a',
    payload: { baseFee: 0 },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '12. Audit Log Deletion',
    path: '/auditLogs/log_1',
    op: 'delete',
    asUid: 'merchant_a',
    expected: 'PERMISSION_DENIED',
  },
] as const;
