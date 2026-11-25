import { CityConfig, DEFAULT_CITIES } from './geospatialEngine.ts';

export type CanonicalDeliveryStatus =
  | 'created'
  | 'quoted'
  | 'confirmed'
  | 'pending'
  | 'searching_courier'
  | 'scheduled'
  | 'driver_assigned'
  | 'driver_approaching_pickup'
  | 'at_pickup'
  | 'package_collected'
  | 'in_transit'
  | 'approaching_recipient'
  | 'arrived'
  | 'delivered'
  | 'cancelled'
  | 'failed'
  | 'rescheduled'
  | 'unassigned'
  | 'return_required'
  | 'return_in_progress'
  | 'return_completed'
  | 'disputed'
  | 'needs_support';

export type ActorRole = 'customer' | 'courier' | 'admin' | 'system';

export type CustodyStatus =
  | 'with_sender'
  | 'with_courier'
  | 'delivered_to_recipient'
  | 'return_in_transit'
  | 'returned_to_sender'
  | 'held_at_hub';

export type ProofVerificationMethod =
  | 'otp'
  | 'pin'
  | 'qr'
  | 'photo'
  | 'signature'
  | 'recipient_confirm';

export interface ProofVerificationPayload {
  method: ProofVerificationMethod;
  providedCode?: string;
  expectedCode?: string;
  photoUrl?: string;
  signatureHash?: string;
  recipientName?: string;
  notes?: string;
}

export const TERMINAL_DELIVERY_STATUSES = new Set<CanonicalDeliveryStatus>([
  'delivered',
  'cancelled',
  'return_completed',
]);

export const POST_PICKUP_STATUSES = new Set<CanonicalDeliveryStatus>([
  'package_collected',
  'in_transit',
  'approaching_recipient',
  'arrived',
  'return_required',
  'return_in_progress',
]);

const ALLOWED_TRANSITIONS: Record<CanonicalDeliveryStatus, CanonicalDeliveryStatus[]> = {
  created: ['quoted', 'confirmed', 'pending', 'searching_courier', 'scheduled', 'cancelled'],
  quoted: ['confirmed', 'pending', 'searching_courier', 'scheduled', 'cancelled'],
  confirmed: ['pending', 'searching_courier', 'scheduled', 'cancelled'],
  pending: ['searching_courier', 'driver_assigned', 'unassigned', 'needs_support', 'cancelled', 'scheduled'],
  searching_courier: ['driver_assigned', 'unassigned', 'needs_support', 'cancelled'],
  scheduled: ['searching_courier', 'pending', 'driver_assigned', 'cancelled'],
  unassigned: ['searching_courier', 'driver_assigned', 'needs_support', 'cancelled'],
  driver_assigned: ['driver_approaching_pickup', 'at_pickup', 'unassigned', 'searching_courier', 'cancelled', 'needs_support'],
  driver_approaching_pickup: ['at_pickup', 'unassigned', 'cancelled', 'needs_support'],
  at_pickup: ['package_collected', 'failed', 'cancelled', 'needs_support'],
  package_collected: ['in_transit', 'approaching_recipient', 'arrived', 'return_required', 'failed', 'needs_support'],
  in_transit: ['approaching_recipient', 'arrived', 'failed', 'return_required', 'needs_support'],
  approaching_recipient: ['arrived', 'failed', 'return_required', 'needs_support'],
  arrived: ['delivered', 'failed', 'return_required', 'rescheduled', 'needs_support'],
  delivered: ['disputed'],
  failed: ['return_required', 'rescheduled', 'needs_support', 'disputed'],
  rescheduled: ['searching_courier', 'driver_assigned', 'in_transit', 'return_required', 'cancelled'],
  return_required: ['return_in_progress', 'needs_support', 'disputed'],
  return_in_progress: ['return_completed', 'needs_support', 'disputed'],
  return_completed: ['disputed'],
  disputed: ['needs_support', 'return_required', 'delivered'],
  needs_support: ['searching_courier', 'driver_assigned', 'return_required', 'return_in_progress', 'return_completed', 'cancelled', 'delivered'],
  cancelled: [],
};

const COURIER_ALLOWED_TARGET_STATUSES = new Set<CanonicalDeliveryStatus>([
  'driver_approaching_pickup',
  'at_pickup',
  'package_collected',
  'in_transit',
  'approaching_recipient',
  'arrived',
  'delivered',
  'failed',
  'return_required',
  'return_in_progress',
  'return_completed',
]);

export interface StateTransitionRequest {
  currentStatus: CanonicalDeliveryStatus;
  nextStatus: CanonicalDeliveryStatus;
  actorUid: string;
  actorRole: ActorRole;
  merchantUid: string;
  assignedDriverUid?: string | null;
  proofRequired?: ProofVerificationMethod;
  proofPayload?: ProofVerificationPayload;
  pickupConfirmed?: boolean;
  failureReason?: string;
}

export interface StateTransitionResult {
  ok: boolean;
  idempotent?: boolean;
  code?:
    | 'INVALID_TRANSITION'
    | 'UNAUTHORIZED_ACTOR'
    | 'PICKUP_CONFIRMATION_REQUIRED'
    | 'PROOF_OF_DELIVERY_REQUIRED'
    | 'INVALID_PROOF_CODE'
    | 'FAILURE_REASON_REQUIRED'
    | 'POST_PICKUP_CANCEL_BLOCKED';
  messageFr?: string;
  messageEn?: string;
  eventType?: string;
  nextCustodyStatus?: CustodyStatus;
  shouldStopTracking?: boolean;
}

export function mapStatusToEventType(status: CanonicalDeliveryStatus): string {
  const map: Record<CanonicalDeliveryStatus, string> = {
    created: 'delivery.created',
    quoted: 'delivery.quoted',
    confirmed: 'delivery.confirmed',
    pending: 'delivery.searching_courier',
    searching_courier: 'delivery.searching_courier',
    scheduled: 'delivery.scheduled',
    unassigned: 'delivery.unassigned',
    driver_assigned: 'delivery.courier_assigned',
    driver_approaching_pickup: 'delivery.courier_approaching_pickup',
    at_pickup: 'delivery.courier_at_pickup',
    package_collected: 'delivery.package_collected',
    in_transit: 'delivery.in_transit',
    approaching_recipient: 'delivery.approaching_recipient',
    arrived: 'delivery.arrived',
    delivered: 'delivery.delivered',
    cancelled: 'delivery.cancelled',
    failed: 'delivery.failed',
    rescheduled: 'delivery.rescheduled',
    return_required: 'delivery.return_required',
    return_in_progress: 'delivery.return_in_progress',
    return_completed: 'delivery.return_completed',
    disputed: 'delivery.disputed',
    needs_support: 'delivery.needs_support',
  };
  return map[status] || `delivery.${status}`;
}

export function deriveCustodyStatus(
  nextStatus: CanonicalDeliveryStatus,
  currentCustody: CustodyStatus = 'with_sender'
): CustodyStatus {
  switch (nextStatus) {
    case 'package_collected':
    case 'in_transit':
    case 'approaching_recipient':
    case 'arrived':
    case 'return_required':
      return 'with_courier';
    case 'delivered':
      return 'delivered_to_recipient';
    case 'return_in_progress':
      return 'return_in_transit';
    case 'return_completed':
      return 'returned_to_sender';
    case 'failed':
      return currentCustody === 'with_courier' ? 'with_courier' : currentCustody;
    default:
      return currentCustody;
  }
}

export function verifyProofOfDelivery(
  proofRequired: ProofVerificationMethod,
  payload?: ProofVerificationPayload
): { ok: true } | { ok: false; code: 'PROOF_OF_DELIVERY_REQUIRED' | 'INVALID_PROOF_CODE'; messageFr: string; messageEn: string } {
  if (!payload) {
    return {
      ok: false,
      code: 'PROOF_OF_DELIVERY_REQUIRED',
      messageFr: 'Une preuve de livraison vérifiée est obligatoire pour clôturer cette livraison.',
      messageEn: 'Verified proof of delivery is required before marking this delivery as delivered.',
    };
  }

  if (proofRequired === 'otp' || proofRequired === 'pin' || payload.method === 'otp' || payload.method === 'pin') {
    const provided = (payload.providedCode || '').trim();
    const expected = (payload.expectedCode || '').trim();
    if (!provided) {
      return {
        ok: false,
        code: 'PROOF_OF_DELIVERY_REQUIRED',
        messageFr: 'Le code de confirmation destinataire (OTP/PIN) est requis.',
        messageEn: 'Recipient OTP/PIN confirmation code is required.',
      };
    }
    if (expected && provided !== expected) {
      return {
        ok: false,
        code: 'INVALID_PROOF_CODE',
        messageFr: 'Le code de confirmation saisi est incorrect.',
        messageEn: 'Provided confirmation code does not match.',
      };
    }
    return { ok: true };
  }

  if (proofRequired === 'photo') {
    if (!payload.photoUrl || !payload.photoUrl.trim()) {
      return {
        ok: false,
        code: 'PROOF_OF_DELIVERY_REQUIRED',
        messageFr: 'Une photo de preuve de remise est requise.',
        messageEn: 'A delivery proof photo is required.',
      };
    }
    return { ok: true };
  }

  if (proofRequired === 'signature') {
    if (!payload.signatureHash && !payload.recipientName?.trim()) {
      return {
        ok: false,
        code: 'PROOF_OF_DELIVERY_REQUIRED',
        messageFr: 'La signature ou le nom du signataire est requis.',
        messageEn: 'Recipient signature or signer name is required.',
      };
    }
    return { ok: true };
  }

  return { ok: true };
}

/**
 * Authoritative Centralized Delivery State Machine Validator.
 */
export function validateDeliveryTransition(
  req: StateTransitionRequest,
  currentCustody: CustodyStatus = 'with_sender'
): StateTransitionResult {
  const { currentStatus, nextStatus, actorUid, actorRole, merchantUid, assignedDriverUid } = req;

  // 1. Authorization check per actor role
  if (actorRole === 'customer') {
    if (actorUid !== merchantUid) {
      return {
        ok: false,
        code: 'UNAUTHORIZED_ACTOR',
        messageFr: 'Vous n’êtes pas autorisé à modifier cette livraison.',
        messageEn: 'You are not authorized to modify this delivery.',
      };
    }
    if (nextStatus !== 'cancelled' && nextStatus !== 'disputed') {
      return {
        ok: false,
        code: 'UNAUTHORIZED_ACTOR',
        messageFr: 'Les clients ne peuvent pas forcer manuellement les statuts opérationnels.',
        messageEn: 'Customers cannot manually force courier operational delivery states.',
      };
    }
    if (nextStatus === 'cancelled' && POST_PICKUP_STATUSES.has(currentStatus)) {
      return {
        ok: false,
        code: 'POST_PICKUP_CANCEL_BLOCKED',
        messageFr:
          'Annulation directe impossible après prise en charge du colis. Veuillez demander un retour expéditeur ou contacter le support.',
        messageEn:
          'Normal cancellation is blocked after package pickup. Please initiate a return-to-sender or support incident workflow.',
      };
    }
  } else if (actorRole === 'courier') {
    if (!assignedDriverUid || assignedDriverUid !== actorUid) {
      return {
        ok: false,
        code: 'UNAUTHORIZED_ACTOR',
        messageFr: 'Seul le livreur assigné peut faire évoluer cette livraison.',
        messageEn: 'Only the assigned courier may advance this delivery.',
      };
    }
    if (!COURIER_ALLOWED_TARGET_STATUSES.has(nextStatus)) {
      return {
        ok: false,
        code: 'UNAUTHORIZED_ACTOR',
        messageFr: `Transition vers « ${nextStatus} » non autorisée pour un livreur.`,
        messageEn: `Courier role is not allowed to transition to "${nextStatus}".`,
      };
    }
  }

  // 2. Idempotent duplicate check (after auth check!)
  if (currentStatus === nextStatus) {
    return {
      ok: true,
      idempotent: true,
      eventType: mapStatusToEventType(nextStatus),
      nextCustodyStatus: currentCustody,
      shouldStopTracking: TERMINAL_DELIVERY_STATUSES.has(nextStatus),
    };
  }

  // 3. Graph transition check
  const allowedNext = ALLOWED_TRANSITIONS[currentStatus] || [];
  if (!allowedNext.includes(nextStatus)) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      messageFr: `Transition d’état invalide : ${currentStatus} → ${nextStatus}.`,
      messageEn: `Invalid delivery state transition: ${currentStatus} -> ${nextStatus}.`,
    };
  }

  // 4. Pickup confirmation guard before transit
  if (nextStatus === 'package_collected' && req.pickupConfirmed === false) {
    return {
      ok: false,
      code: 'PICKUP_CONFIRMATION_REQUIRED',
      messageFr: 'La confirmation de remise du colis par l’expéditeur est requise.',
      messageEn: 'Explicit pickup confirmation is required before marking package collected.',
    };
  }

  // 5. Proof of Delivery enforcement before marking delivered
  if (nextStatus === 'delivered' && actorRole !== 'admin') {
    const pod = verifyProofOfDelivery(req.proofRequired || 'otp', req.proofPayload);
    if (!pod.ok) {
      return {
        ok: false,
        code: pod.code,
        messageFr: pod.messageFr,
        messageEn: pod.messageEn,
      };
    }
  }

  // 6. Structured failure reason required
  if (nextStatus === 'failed' && (!req.failureReason || req.failureReason.trim().length < 3)) {
    return {
      ok: false,
      code: 'FAILURE_REASON_REQUIRED',
      messageFr: 'Un motif structuré d’échec de livraison est obligatoire.',
      messageEn: 'A structured failure reason is required when marking delivery failed.',
    };
  }

  const nextCustodyStatus = deriveCustodyStatus(nextStatus, currentCustody);
  return {
    ok: true,
    idempotent: false,
    eventType: mapStatusToEventType(nextStatus),
    nextCustodyStatus,
    shouldStopTracking:
      TERMINAL_DELIVERY_STATUSES.has(nextStatus) || nextStatus === 'failed',
  };
}

// ============================================================================
// STATE-BASED CANCELLATION & RETURN WORKFLOW EVALUATOR
// ============================================================================
export interface CancellationEvaluation {
  allowed: boolean;
  requiresReturnWorkflow: boolean;
  feeAmount: number;
  refundAmount: number;
  returnFeeAmount: number;
  currency: string;
  policyApplied: string;
  messageFr: string;
  messageEn: string;
}

export function evaluateCancellationPolicy(params: {
  status: CanonicalDeliveryStatus;
  quotedPrice: number;
  city?: CityConfig | null;
  createdAtMs: number;
  actorRole: ActorRole;
  nowMs?: number;
}): CancellationEvaluation {
  const city = params.city || DEFAULT_CITIES[0];
  const policy = city.cancellationPolicy;
  const nowMs = params.nowMs ?? Date.now();
  const elapsedSec = Math.max(0, (nowMs - params.createdAtMs) / 1000);
  const price = Math.max(0, params.quotedPrice);

  if (TERMINAL_DELIVERY_STATUSES.has(params.status)) {
    return {
      allowed: false,
      requiresReturnWorkflow: false,
      feeAmount: 0,
      refundAmount: 0,
      returnFeeAmount: 0,
      currency: city.currency,
      policyApplied: 'already_terminal',
      messageFr: 'Cette livraison est déjà clôturée et ne peut plus être annulée.',
      messageEn: 'This delivery is already completed or cancelled.',
    };
  }

  // Post-pickup: block standard customer cancellation -> require Return-to-Sender
  if (POST_PICKUP_STATUSES.has(params.status)) {
    const returnFeeAmount =
      city.currency === 'XOF'
        ? Math.round((price * policy.returnFeeMultiplier) / 50) * 50
        : Number((price * policy.returnFeeMultiplier).toFixed(2));
    return {
      allowed: false,
      requiresReturnWorkflow: true,
      feeAmount: price,
      refundAmount: 0,
      returnFeeAmount,
      currency: city.currency,
      policyApplied: 'post_pickup_return_required',
      messageFr:
        'Le colis est déjà en possession du livreur. Une procédure de retour vers l’expéditeur est requise.',
      messageEn:
        'Parcel is already in courier custody. A return-to-sender workflow is required instead of normal cancellation.',
    };
  }

  // Pre-assignment (free cancellation)
  if (
    params.status === 'created' ||
    params.status === 'quoted' ||
    params.status === 'confirmed' ||
    params.status === 'pending' ||
    params.status === 'searching_courier' ||
    params.status === 'scheduled' ||
    params.status === 'unassigned'
  ) {
    return {
      allowed: true,
      requiresReturnWorkflow: false,
      feeAmount: 0,
      refundAmount: price,
      returnFeeAmount: 0,
      currency: city.currency,
      policyApplied: 'pre_assignment_free',
      messageFr: 'Annulation gratuite avant affectation d’un livreur.',
      messageEn: 'Free cancellation before courier assignment.',
    };
  }

  // Admin override can waive fees; customer pays transparent state-based fee
  if (params.status === 'driver_assigned') {
    const withinFreeWindow = elapsedSec <= policy.freeCancelWindowSec;
    const fee = withinFreeWindow || params.actorRole === 'admin' ? 0 : Math.min(price, policy.assignedFee);
    return {
      allowed: true,
      requiresReturnWorkflow: false,
      feeAmount: fee,
      refundAmount: Math.max(0, Number((price - fee).toFixed(2))),
      returnFeeAmount: 0,
      currency: city.currency,
      policyApplied: fee === 0 ? 'assigned_grace_window' : 'assigned_cancel_fee',
      messageFr:
        fee === 0
          ? 'Annulation gratuite dans le délai de grâce.'
          : `Frais d’annulation appliqués après affectation du livreur (${fee} ${city.currency}).`,
      messageEn:
        fee === 0
          ? 'Free cancellation within grace window.'
          : `Cancellation fee applied after courier assignment (${fee} ${city.currency}).`,
    };
  }

  if (params.status === 'driver_approaching_pickup') {
    const fee = params.actorRole === 'admin' ? 0 : Math.min(price, policy.approachingPickupFee);
    return {
      allowed: true,
      requiresReturnWorkflow: false,
      feeAmount: fee,
      refundAmount: Math.max(0, Number((price - fee).toFixed(2))),
      returnFeeAmount: 0,
      currency: city.currency,
      policyApplied: 'approaching_pickup_fee',
      messageFr: `Le livreur est déjà en route vers la collecte. Frais de déplacement : ${fee} ${city.currency}.`,
      messageEn: `Courier is en route to pickup. Dispatch fee: ${fee} ${city.currency}.`,
    };
  }

  if (params.status === 'at_pickup') {
    const fee = params.actorRole === 'admin' ? 0 : Math.min(price, policy.atPickupFee);
    return {
      allowed: true,
      requiresReturnWorkflow: false,
      feeAmount: fee,
      refundAmount: Math.max(0, Number((price - fee).toFixed(2))),
      returnFeeAmount: 0,
      currency: city.currency,
      policyApplied: 'at_pickup_fee',
      messageFr: `Le livreur est arrivé au point de collecte. Frais d’attente et déplacement : ${fee} ${city.currency}.`,
      messageEn: `Courier has arrived at pickup. Arrival & waiting fee: ${fee} ${city.currency}.`,
    };
  }

  return {
    allowed: true,
    requiresReturnWorkflow: false,
    feeAmount: 0,
    refundAmount: price,
    returnFeeAmount: 0,
    currency: city.currency,
    policyApplied: 'standard_cancel',
    messageFr: 'Annulation autorisée.',
    messageEn: 'Cancellation permitted.',
  };
}
