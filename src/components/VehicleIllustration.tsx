import React, { useState } from 'react';
import { VehicleCategory } from '../types/rova';
import expressImg from '../assets/images/rovia_service_express_1795725520695.jpg';
import multistopImg from '../assets/images/rovia_service_multistop_1795725522959.jpg';
import cargoImg from '../assets/images/rovia_service_cargo_1795725523138.jpg';
import freightImg from '../assets/images/rovia_service_freight_1795725523882.jpg';

interface VehicleIllustrationProps {
  category: VehicleCategory;
  className?: string;
}

const STUDIO_VEHICLE_MAP: Record<
  VehicleCategory,
  { src: string; altFr: string; altEn: string; flipHorizontal?: boolean }
> = {
  motorcycle: {
    src: expressImg,
    altFr: 'Moto express Rovia',
    altEn: 'Rovia express motorcycle',
  },
  cargo_motorcycle: {
    src: multistopImg,
    altFr: 'Moto cargo Rovia',
    altEn: 'Rovia cargo motorcycle',
  },
  tricycle: {
    src: multistopImg,
    altFr: 'Tricycle utilitaire Rovia',
    altEn: 'Rovia utility cargo tricycle',
  },
  cargo_van: {
    src: cargoImg,
    altFr: 'Fourgonnette cargo Rovia',
    altEn: 'Rovia cargo van',
    flipHorizontal: true,
  },
  commercial_van: {
    src: cargoImg,
    altFr: 'Fourgon commercial Rovia',
    altEn: 'Rovia commercial van',
    flipHorizontal: true,
  },
  truck: {
    src: freightImg,
    altFr: 'Camion porteur Rovia',
    altEn: 'Rovia freight box truck',
    flipHorizontal: true,
  },
};

interface VehicleStudioImageProps {
  category: VehicleCategory;
  className?: string;
  alt?: string;
}

/**
 * Cohesive studio 3D vehicle renders aligned to Rovia's white / obsidian / crimson
 * palette with automatic vector fallback so an image slot never breaks.
 */
export function VehicleStudioImage({
  category,
  className = 'w-full h-full object-contain',
  alt,
}: VehicleStudioImageProps) {
  const [failed, setFailed] = useState(false);
  const spec = STUDIO_VEHICLE_MAP[category] || STUDIO_VEHICLE_MAP.motorcycle;

  if (failed) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <VehicleIllustration category={category} className="w-16 h-12 text-[#171717]" />
      </div>
    );
  }

  return (
    <img
      src={spec.src}
      alt={alt || spec.altFr}
      referrerPolicy="no-referrer"
      loading="eager"
      draggable={false}
      onError={() => setFailed(true)}
      className={`select-none pointer-events-none mix-blend-multiply ${
        spec.flipHorizontal ? '-scale-x-100' : ''
      } ${className}`}
    />
  );
}

/**
 * Clean White / Black / Red vector vehicle silhouettes tailored to Rovia's visual identity.
 */
export function VehicleIllustration({ category, className = 'w-12 h-9' }: VehicleIllustrationProps) {
  switch (category) {
    case 'motorcycle':
      return (
        <svg viewBox="0 0 64 40" fill="none" className={className} aria-hidden="true">
          <circle cx="16" cy="29" r="7" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="16" cy="29" r="2" fill="#E52B32" />
          <circle cx="48" cy="29" r="7" stroke="currentColor" strokeWidth="2.4" />
          <path d="M16 29L26 17H39L48 29" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M23 17L20 12H28" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M39 17L43 11H49" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="18" cy="14" r="1.8" fill="#E52B32" />
        </svg>
      );
    case 'cargo_motorcycle':
      return (
        <svg viewBox="0 0 64 40" fill="none" className={className} aria-hidden="true">
          <rect x="8" y="9" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="2.2" fill="currentColor" fillOpacity="0.08" />
          <rect x="12" y="14" width="10" height="2.4" rx="1.2" fill="#E52B32" />
          <circle cx="17" cy="30" r="6.5" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="48" cy="30" r="6.5" stroke="currentColor" strokeWidth="2.4" />
          <path d="M26 22H40L48 30" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M39 22L43 13H49" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'tricycle':
      return (
        <svg viewBox="0 0 64 40" fill="none" className={className} aria-hidden="true">
          <rect x="7" y="11" width="24" height="15" rx="3" stroke="currentColor" strokeWidth="2.2" fill="currentColor" fillOpacity="0.08" />
          <rect x="12" y="16" width="12" height="2.5" rx="1.2" fill="#E52B32" />
          <path d="M31 16H44L52 24V28H31V16Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
          <circle cx="17" cy="30" r="5.5" stroke="currentColor" strokeWidth="2.3" />
          <circle cx="46" cy="30" r="5.5" stroke="currentColor" strokeWidth="2.3" />
        </svg>
      );
    case 'cargo_van':
      return (
        <svg viewBox="0 0 64 40" fill="none" className={className} aria-hidden="true">
          <path d="M8 28V14C8 11.8 9.8 10 12 10H38L49 18L55 20V28H8Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" fill="currentColor" fillOpacity="0.06" />
          <path d="M37 10V19H49" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="14" y="16" width="16" height="2.6" rx="1.3" fill="#E52B32" />
          <circle cx="19" cy="30" r="5.5" fill="white" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="19" cy="30" r="1.8" fill="#E52B32" />
          <circle cx="46" cy="30" r="5.5" fill="white" stroke="currentColor" strokeWidth="2.4" />
        </svg>
      );
    case 'commercial_van':
      return (
        <svg viewBox="0 0 64 40" fill="none" className={className} aria-hidden="true">
          <path d="M6 28V11C6 9.3 7.3 8 9 8H40L52 16L57 19V28H6Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" fill="currentColor" fillOpacity="0.07" />
          <path d="M39 8V18H52" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="13" y="14" width="18" height="2.6" rx="1.3" fill="#E52B32" />
          <circle cx="18" cy="30" r="5.5" fill="white" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="18" cy="30" r="1.8" fill="#E52B32" />
          <circle cx="47" cy="30" r="5.5" fill="white" stroke="currentColor" strokeWidth="2.4" />
        </svg>
      );
    case 'truck':
      return (
        <svg viewBox="0 0 64 40" fill="none" className={className} aria-hidden="true">
          <rect x="6" y="7" width="33" height="20" rx="2.5" stroke="currentColor" strokeWidth="2.2" fill="currentColor" fillOpacity="0.08" />
          <rect x="12" y="13" width="18" height="2.8" rx="1.4" fill="#E52B32" />
          <path d="M39 14H50L57 21V27H39V14Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
          <circle cx="17" cy="30" r="5.5" fill="white" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="17" cy="30" r="1.8" fill="#E52B32" />
          <circle cx="48" cy="30" r="5.5" fill="white" stroke="currentColor" strokeWidth="2.4" />
        </svg>
      );
  }
}
