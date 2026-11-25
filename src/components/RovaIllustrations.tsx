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
