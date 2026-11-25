import React from 'react';

interface IllustrationProps {
  className?: string;
}

/**
 * Editorial White / Black / Crimson Red vector illustrations for ROVA.
 * Designed for crisp rendering on both dark and light surfaces with zero latency.
 */

export function HeroDeliveryScene({ className = 'w-52 h-32' }: IllustrationProps) {
  return (
    <svg viewBox="0 0 240 130" fill="none" className={className} aria-hidden="true">
      {/* Subtle architectural map grid lines */}
      <path
        d="M14 96H226M34 108H198M140 24V112M186 24V112"
        stroke="white"
        strokeOpacity="0.1"
        strokeWidth="1"
        strokeDasharray="3 4"
      />

      {/* Winding urban delivery trajectory */}
      <path
        d="M22 92C52 92 64 56 102 56C136 56 146 34 190 34"
        stroke="white"
        strokeOpacity="0.28"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="5 5"
      />

      {/* Origin point */}
      <circle cx="24" cy="92" r="4" fill="white" fillOpacity="0.85" />
      <circle cx="24" cy="92" r="8" stroke="white" strokeOpacity="0.22" strokeWidth="1.5" />

      {/* Crimson destination pin */}
      <g transform="translate(182 14)">
        <circle cx="14" cy="14" r="13" fill="#DC2626" fillOpacity="0.22" />
        <path
          d="M14 4C9.58 4 6 7.58 6 12C6 17.5 14 25 14 25C14 25 22 17.5 22 12C22 7.58 18.42 4 14 4Z"
          fill="#DC2626"
        />
        <circle cx="14" cy="12" r="3" fill="white" />
      </g>

      {/* Motion trails behind the van */}
      <line x1="36" y1="74" x2="54" y2="74" stroke="white" strokeOpacity="0.4" strokeWidth="2" strokeLinecap="round" />
      <line x1="44" y1="82" x2="62" y2="82" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" />

      {/* Stylized ROVA cargo van */}
      <g transform="translate(68 48)">
        {/* Cargo body */}
        <path
          d="M6 42V14C6 9.58 9.58 6 14 6H74L98 22L112 26C115.3 27 118 30 118 33.5V42H6Z"
          fill="white"
          fillOpacity="0.14"
          stroke="white"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        {/* Cabin window */}
        <path
          d="M72 6V24H98"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Red courier stripe & parcel emblem */}
        <rect x="18" y="18" width="24" height="3.5" rx="1.75" fill="#DC2626" />
        <rect x="18" y="26" width="14" height="2.5" rx="1.25" fill="white" fillOpacity="0.45" />
        {/* Headlight & crimson taillight */}
        <rect x="112" y="32" width="5" height="3.5" rx="1.5" fill="white" />
        <rect x="5" y="31" width="4" height="5" rx="1.5" fill="#DC2626" />
        {/* Wheels */}
        <circle cx="32" cy="44" r="10.5" fill="#0A0A0A" stroke="white" strokeWidth="2.6" />
        <circle cx="32" cy="44" r="3.5" fill="#DC2626" />
        <circle cx="92" cy="44" r="10.5" fill="#0A0A0A" stroke="white" strokeWidth="2.6" />
        <circle cx="92" cy="44" r="3.5" fill="white" />
      </g>
    </svg>
  );
}

export function ScheduleVehicleIllustration({ className = 'w-28 h-24' }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 96" fill="none" className={className} aria-hidden="true">
      {/* Calendar card */}
      <rect
        x="18"
        y="16"
        width="72"
        height="62"
        rx="14"
        fill="#FAFAFA"
        stroke="#0A0A0A"
        strokeWidth="2"
      />
      {/* Top header strip */}
      <path d="M18 32H90" stroke="#0A0A0A" strokeWidth="1.8" />
      {/* Binding rings */}
      <rect x="34" y="10" width="5" height="12" rx="2.5" fill="#0A0A0A" />
      <rect x="69" y="10" width="5" height="12" rx="2.5" fill="#0A0A0A" />

      {/* Date grid dots */}
      <rect x="30" y="42" width="10" height="8" rx="2.5" fill="#E5E5E5" />
      <rect x="46" y="42" width="10" height="8" rx="2.5" fill="#E5E5E5" />
      <rect x="62" y="42" width="16" height="8" rx="2.5" fill="#DC2626" />
      <rect x="30" y="56" width="10" height="8" rx="2.5" fill="#E5E5E5" />
      <rect x="46" y="56" width="10" height="8" rx="2.5" fill="#0A0A0A" />

      {/* Floating clock badge */}
      <circle cx="92" cy="68" r="18" fill="white" stroke="#0A0A0A" strokeWidth="2.2" />
      <path d="M92 59V68L98 72" stroke="#0A0A0A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="92" cy="68" r="2.2" fill="#DC2626" />
    </svg>
  );
}

export function MultiStopRouteIllustration({ className = 'w-28 h-24' }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 96" fill="none" className={className} aria-hidden="true">
      {/* Subtle geometric map blocks */}
      <rect x="14" y="14" width="92" height="68" rx="14" fill="#FAFAFA" stroke="#E5E5E5" strokeWidth="1.5" />
      <path d="M44 14V82M76 14V82M14 48H106" stroke="#EAEAEA" strokeWidth="1.2" />

      {/* Multi-stop winding curve */}
      <path
        d="M28 66C44 66 44 34 62 34C78 34 78 58 92 50"
        stroke="#0A0A0A"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray="4 4"
      />

      {/* Stop 1 (Pickup - Black) */}
      <circle cx="28" cy="66" r="7.5" fill="#0A0A0A" stroke="white" strokeWidth="2" />
      <circle cx="28" cy="66" r="2.2" fill="white" />

      {/* Stop 2 (Midpoint - White/Black) */}
      <circle cx="62" cy="34" r="7.5" fill="white" stroke="#0A0A0A" strokeWidth="2.2" />
      <circle cx="62" cy="34" r="2.5" fill="#0A0A0A" />

      {/* Stop 3 (Final destination - Red Pin) */}
      <g transform="translate(80 28)">
        <path
          d="M12 2C7.58 2 4 5.58 4 10C4 15.5 12 23 12 23C12 23 20 15.5 20 10C20 5.58 16.42 2 12 2Z"
          fill="#DC2626"
        />
        <circle cx="12" cy="10" r="3" fill="white" />
      </g>
    </svg>
  );
}

export function TrackingParcelIllustration({ className = 'w-28 h-24' }: IllustrationProps) {
  return (
    <svg viewBox="0 0 140 104" fill="none" className={className} aria-hidden="true">
      {/* Background map plate */}
      <rect x="10" y="16" width="120" height="74" rx="18" fill="#FAFAFA" stroke="#E5E5E5" strokeWidth="1.5" />
      <path d="M18 68C46 68 58 40 94 40" stroke="#0A0A0A" strokeOpacity="0.25" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />

      {/* Isometric Parcel Box */}
      <g transform="translate(36 28)">
        <path d="M28 6L52 18V44L28 56L4 44V18L28 6Z" fill="white" stroke="#0A0A0A" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M4 18L28 30L52 18" stroke="#0A0A0A" strokeWidth="2" strokeLinejoin="round" />
        <path d="M28 30V56" stroke="#0A0A0A" strokeWidth="2" strokeLinecap="round" />
        {/* Signature Red Tape Seal */}
        <path d="M16 12L40 24V34L34 31V27L16 18V12Z" fill="#DC2626" />
      </g>

      {/* Live GPS Pin */}
      <g transform="translate(86 16)">
        <circle cx="16" cy="16" r="14" fill="#DC2626" fillOpacity="0.12" />
        <path
          d="M16 6C11.58 6 8 9.58 8 14C8 19.5 16 27 16 27C16 27 24 19.5 24 14C24 9.58 20.42 6 16 6Z"
          fill="#DC2626"
        />
        <circle cx="16" cy="14" r="3" fill="white" />
      </g>
    </svg>
  );
}

export function ActivityLedgerIllustration({ className = 'w-28 h-24' }: IllustrationProps) {
  return (
    <svg viewBox="0 0 132 96" fill="none" className={className} aria-hidden="true">
      {/* Stacked ledger cards */}
      <rect x="26" y="14" width="84" height="62" rx="14" fill="#F5F5F5" stroke="#D4D4D4" strokeWidth="1.5" />
      <rect x="18" y="22" width="84" height="62" rx="14" fill="white" stroke="#0A0A0A" strokeWidth="2" />

      {/* Timeline rows */}
      <circle cx="34" cy="40" r="4" fill="#DC2626" />
      <rect x="44" y="37" width="44" height="6" rx="3" fill="#0A0A0A" />

      <circle cx="34" cy="56" r="4" fill="#0A0A0A" />
      <rect x="44" y="53" width="34" height="5" rx="2.5" fill="#D4D4D4" />

      <circle cx="34" cy="70" r="3.5" fill="#D4D4D4" />
      <rect x="44" y="67.5" width="26" height="5" rx="2.5" fill="#E5E5E5" />

      {/* Vertical connector */}
      <path d="M34 45V51M34 61V65" stroke="#D4D4D4" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function AddressMapIllustration({ className = 'w-24 h-20' }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 90" fill="none" className={className} aria-hidden="true">
      {/* Folded map shape */}
      <path
        d="M14 24L44 14L76 24L106 14V68L76 78L44 68L14 78V24Z"
        fill="#FAFAFA"
        stroke="#0A0A0A"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M44 14V68M76 24V78" stroke="#D4D4D4" strokeWidth="1.5" />
      <path d="M22 52L44 44L76 54L96 42" stroke="#0A0A0A" strokeOpacity="0.22" strokeWidth="2" strokeDasharray="3 3" />

      {/* Red Location Pin */}
      <g transform="translate(48 18)">
        <circle cx="12" cy="24" r="7" fill="#DC2626" fillOpacity="0.14" />
        <path
          d="M12 2C7.58 2 4 5.58 4 10C4 15.5 12 23 12 23C12 23 20 15.5 20 10C20 5.58 16.42 2 12 2Z"
          fill="#DC2626"
        />
        <circle cx="12" cy="10" r="3" fill="white" />
      </g>
    </svg>
  );
}

/**
 * Minimalist urban skyline + live trajectory arc for the RovaHomeView greeting band.
 */
export function UrbanHorizonIllustration({ className = 'w-40 h-16' }: IllustrationProps) {
  return (
    <svg viewBox="0 0 180 68" fill="none" className={className} aria-hidden="true">
      {/* Ground baseline */}
      <line x1="8" y1="56" x2="172" y2="56" stroke="#D4D4D4" strokeWidth="1.4" strokeLinecap="round" />

      {/* Minimalist architectural skyline silhouettes */}
      <rect x="16" y="34" width="18" height="22" rx="3" fill="#FAFAFA" stroke="#0A0A0A" strokeWidth="1.6" />
      <rect x="40" y="22" width="22" height="34" rx="3" fill="white" stroke="#0A0A0A" strokeWidth="1.6" />
      <line x1="46" y1="30" x2="56" y2="30" stroke="#D4D4D4" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="46" y1="36" x2="56" y2="36" stroke="#D4D4D4" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="46" y1="42" x2="52" y2="42" stroke="#D4D4D4" strokeWidth="1.5" strokeLinecap="round" />

      <rect x="116" y="28" width="20" height="28" rx="3" fill="#FAFAFA" stroke="#0A0A0A" strokeWidth="1.6" />
      <rect x="142" y="18" width="22" height="38" rx="3" fill="white" stroke="#0A0A0A" strokeWidth="1.6" />
      <line x1="148" y1="26" x2="158" y2="26" stroke="#D4D4D4" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="148" y1="32" x2="158" y2="32" stroke="#D4D4D4" strokeWidth="1.5" strokeLinecap="round" />

      {/* Express trajectory arc */}
      <path
        d="M25 32C58 6 112 6 152 16"
        stroke="#0A0A0A"
        strokeWidth="1.8"
        strokeDasharray="4 4"
        strokeLinecap="round"
      />
      <circle cx="25" cy="32" r="3.5" fill="#0A0A0A" />
      {/* Crimson live destination beacon */}
      <circle cx="152" cy="16" r="7" fill="#DC2626" fillOpacity="0.16" />
      <circle cx="152" cy="16" r="3.5" fill="#DC2626" />

      {/* Minimalist courier parcel node at midpoint */}
      <rect x="81" y="42" width="18" height="14" rx="3" fill="#0A0A0A" />
      <rect x="87" y="42" width="6" height="5" rx="1" fill="#DC2626" />
    </svg>
  );
}

/**
 * Subtle monochrome + red micro-illustrations for RovaHomeView shortcut cards.
 */
export function ShortcutCardIllustration({
  kind,
  className = 'w-14 h-12',
}: IllustrationProps & { kind: 'addresses' | 'payments' | 'history' | 'support' }) {
  if (kind === 'addresses') {
    return (
      <svg viewBox="0 0 64 52" fill="none" className={className} aria-hidden="true">
        <path
          d="M8 18L24 12L40 18L56 12V40L40 46L24 40L8 46V18Z"
          fill="#FAFAFA"
          stroke="#D4D4D4"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M24 12V40M40 18V46" stroke="#E5E5E5" strokeWidth="1.2" />
        <path
          d="M32 10C28.69 10 26 12.69 26 16C26 20.2 32 26 32 26C32 26 38 20.2 38 16C38 12.69 35.31 10 32 10Z"
          fill="#0A0A0A"
        />
        <circle cx="32" cy="16" r="2.2" fill="#DC2626" />
      </svg>
    );
  }
  if (kind === 'payments') {
    return (
      <svg viewBox="0 0 64 52" fill="none" className={className} aria-hidden="true">
        <rect x="8" y="14" width="46" height="30" rx="7" fill="#FAFAFA" stroke="#D4D4D4" strokeWidth="1.5" />
        <line x1="8" y1="24" x2="54" y2="24" stroke="#0A0A0A" strokeWidth="2.5" />
        <rect x="14" y="31" width="14" height="4" rx="2" fill="#0A0A0A" />
        <circle cx="44" cy="33" r="3.5" fill="#DC2626" />
        <circle cx="39" cy="33" r="3.5" fill="#0A0A0A" fillOpacity="0.25" />
      </svg>
    );
  }
  if (kind === 'history') {
    return (
      <svg viewBox="0 0 64 52" fill="none" className={className} aria-hidden="true">
        <rect x="12" y="10" width="40" height="34" rx="7" fill="#FAFAFA" stroke="#D4D4D4" strokeWidth="1.5" />
        <circle cx="22" cy="21" r="2.5" fill="#DC2626" />
        <rect x="28" y="19" width="17" height="4" rx="2" fill="#0A0A0A" />
        <circle cx="22" cy="32" r="2.5" fill="#0A0A0A" />
        <rect x="28" y="30" width="13" height="4" rx="2" fill="#D4D4D4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 52" fill="none" className={className} aria-hidden="true">
      <rect x="10" y="12" width="38" height="24" rx="8" fill="#FAFAFA" stroke="#D4D4D4" strokeWidth="1.5" />
      <path d="M18 36L14 43L25 36" fill="#FAFAFA" stroke="#D4D4D4" strokeWidth="1.5" strokeLinejoin="round" />
      <line x1="18" y1="21" x2="38" y2="21" stroke="#0A0A0A" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="18" y1="27" x2="30" y2="27" stroke="#D4D4D4" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="48" cy="14" r="4" fill="#DC2626" />
    </svg>
  );
}

/**
 * Step 1 — Pickup / Collecte minimalist illustration
 */
export function PickupStepIllustration({ className = 'w-20 h-14' }: IllustrationProps) {
  return (
    <svg viewBox="0 0 96 64" fill="none" className={className} aria-hidden="true">
      {/* Warehouse / storefront block */}
      <rect x="10" y="22" width="44" height="30" rx="6" fill="white" stroke="#0A0A0A" strokeWidth="1.8" />
      <path d="M8 24L14 14H50L56 24" fill="#FAFAFA" stroke="#0A0A0A" strokeWidth="1.8" strokeLinejoin="round" />
      <rect x="24" y="34" width="16" height="18" rx="2.5" fill="#F5F5F5" stroke="#0A0A0A" strokeWidth="1.5" />

      {/* Dashed route departure */}
      <path d="M54 40H74" stroke="#0A0A0A" strokeWidth="1.8" strokeDasharray="3 3" strokeLinecap="round" />

      {/* Origin P pin with crimson halo */}
      <circle cx="76" cy="30" r="14" fill="#DC2626" fillOpacity="0.1" />
      <circle cx="76" cy="30" r="9.5" fill="#0A0A0A" />
      <text
        x="76"
        y="34"
        textAnchor="middle"
        fill="white"
        fontSize="10"
        fontWeight="700"
        fontFamily="monospace"
      >
        P
      </text>
      <circle cx="84" cy="21" r="3" fill="#DC2626" />
    </svg>
  );
}

/**
 * Step 2 — Delivery Location / Lieu de livraison minimalist illustration
 */
export function DestinationStepIllustration({ className = 'w-20 h-14' }: IllustrationProps) {
  return (
    <svg viewBox="0 0 96 64" fill="none" className={className} aria-hidden="true">
      {/* Clean route card */}
      <rect x="8" y="12" width="80" height="42" rx="10" fill="white" stroke="#E5E5E5" strokeWidth="1.5" />
      <path d="M22 42C36 42 38 24 52 24C64 24 66 38 74 34" stroke="#0A0A0A" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" />

      {/* Start node */}
      <circle cx="22" cy="42" r="4.5" fill="#0A0A0A" />
      {/* Mid waypoint */}
      <circle cx="52" cy="24" r="4.5" fill="white" stroke="#0A0A0A" strokeWidth="2" />
      {/* Crimson destination pin */}
      <g transform="translate(62 12)">
        <circle cx="12" cy="12" r="10" fill="#DC2626" fillOpacity="0.14" />
        <path
          d="M12 4C8.69 4 6 6.69 6 10C6 14.5 12 20 12 20C12 20 18 14.5 18 10C18 6.69 15.31 4 12 4Z"
          fill="#DC2626"
        />
        <circle cx="12" cy="10" r="2.2" fill="white" />
      </g>
    </svg>
  );
}

/**
 * Step 3 — Fleet / Véhicule minimalist illustration
 */
export function FleetStepIllustration({ className = 'w-20 h-14' }: IllustrationProps) {
  return (
    <svg viewBox="0 0 96 64" fill="none" className={className} aria-hidden="true">
      {/* Ground line */}
      <line x1="8" y1="50" x2="88" y2="50" stroke="#E5E5E5" strokeWidth="1.5" strokeLinecap="round" />

      {/* Motion lines */}
      <line x1="10" y1="30" x2="20" y2="30" stroke="#D4D4D4" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="14" y1="36" x2="24" y2="36" stroke="#DC2626" strokeWidth="1.8" strokeLinecap="round" />

      {/* Crisp monochrome delivery van */}
      <path
        d="M28 46V24C28 21.8 29.8 20 32 20H62L74 30L82 32.5C84.2 33.2 85.5 35 85.5 37.2V46H28Z"
        fill="white"
        stroke="#0A0A0A"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M62 20V31H75" stroke="#0A0A0A" strokeWidth="1.8" strokeLinejoin="round" />
      <rect x="35" y="28" width="16" height="3" rx="1.5" fill="#DC2626" />
      <circle cx="42" cy="47" r="6" fill="#0A0A0A" stroke="white" strokeWidth="2" />
      <circle cx="42" cy="47" r="1.8" fill="#DC2626" />
      <circle cx="72" cy="47" r="6" fill="#0A0A0A" stroke="white" strokeWidth="2" />
      <circle cx="72" cy="47" r="1.8" fill="white" />
    </svg>
  );
}

/**
 * Step 4 — Parcel Details & Timing minimalist illustration
 */
export function ParcelDetailsIllustration({ className = 'w-20 h-14' }: IllustrationProps) {
  return (
    <svg viewBox="0 0 96 64" fill="none" className={className} aria-hidden="true">
      {/* Isometric parcel */}
      <g transform="translate(14 10)">
        <path d="M22 4L42 14V36L22 46L2 36V14L22 4Z" fill="white" stroke="#0A0A0A" strokeWidth="1.9" strokeLinejoin="round" />
        <path d="M2 14L22 24L42 14" stroke="#0A0A0A" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M22 24V46" stroke="#0A0A0A" strokeWidth="1.8" />
        <path d="M12 9L32 19V26L27 23.5V21L12 13.5V9Z" fill="#DC2626" />
      </g>

      {/* OTP / Shield seal badge */}
      <g transform="translate(58 18)">
        <circle cx="14" cy="14" r="13" fill="#FAFAFA" stroke="#0A0A0A" strokeWidth="1.8" />
        <path d="M9.5 14.5L12.5 17.5L18.5 11" stroke="#DC2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/**
 * Step 5 — Confirmation & Checkout minimalist illustration
 */
export function CheckoutSummaryIllustration({ className = 'w-20 h-14' }: IllustrationProps) {
  return (
    <svg viewBox="0 0 96 64" fill="none" className={className} aria-hidden="true">
      {/* Verified dispatch slip */}
      <rect x="14" y="8" width="52" height="48" rx="9" fill="white" stroke="#0A0A0A" strokeWidth="1.9" />
      <circle cx="25" cy="21" r="3" fill="#0A0A0A" />
      <rect x="32" y="19" width="24" height="4" rx="2" fill="#0A0A0A" />
      <line x1="25" y1="25" x2="25" y2="33" stroke="#D4D4D4" strokeWidth="1.5" strokeDasharray="2 2" />
      <circle cx="25" cy="37" r="3" fill="#DC2626" />
      <rect x="32" y="35" width="18" height="4" rx="2" fill="#D4D4D4" />
      <line x1="22" y1="47" x2="56" y2="47" stroke="#EAEAEA" strokeWidth="1.5" strokeLinecap="round" />

      {/* Crimson confirmation badge */}
      <circle cx="72" cy="40" r="13" fill="#DC2626" />
      <path d="M66.5 40.5L70.2 44.2L77.5 36.5" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

