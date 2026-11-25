import React from 'react';
import { VehicleCategory } from '../types/rova';

interface VehicleIllustrationProps {
  category: VehicleCategory;
  className?: string;
}

/**
 * Clean White / Black / Red vector vehicle silhouettes tailored to ROVA's visual identity.
 */
export function VehicleIllustration({ category, className = 'w-12 h-9' }: VehicleIllustrationProps) {
  switch (category) {
    case 'motorcycle':
      return (
        <svg viewBox="0 0 64 40" fill="none" className={className} aria-hidden="true">
          <circle cx="16" cy="29" r="7" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="16" cy="29" r="2" fill="#DC2626" />
          <circle cx="48" cy="29" r="7" stroke="currentColor" strokeWidth="2.4" />
          <path d="M16 29L26 17H39L48 29" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M23 17L20 12H28" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M39 17L43 11H49" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="18" cy="14" r="1.8" fill="#DC2626" />
        </svg>
      );
    case 'cargo_motorcycle':
      return (
        <svg viewBox="0 0 64 40" fill="none" className={className} aria-hidden="true">
          <rect x="8" y="9" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="2.2" fill="currentColor" fillOpacity="0.08" />
          <rect x="12" y="14" width="10" height="2.4" rx="1.2" fill="#DC2626" />
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
          <rect x="12" y="16" width="12" height="2.5" rx="1.2" fill="#DC2626" />
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
          <rect x="14" y="16" width="16" height="2.6" rx="1.3" fill="#DC2626" />
          <circle cx="19" cy="30" r="5.5" fill="white" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="19" cy="30" r="1.8" fill="#DC2626" />
          <circle cx="46" cy="30" r="5.5" fill="white" stroke="currentColor" strokeWidth="2.4" />
        </svg>
      );
    case 'commercial_van':
      return (
        <svg viewBox="0 0 64 40" fill="none" className={className} aria-hidden="true">
          <path d="M6 28V11C6 9.3 7.3 8 9 8H40L52 16L57 19V28H6Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" fill="currentColor" fillOpacity="0.07" />
          <path d="M39 8V18H52" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="13" y="14" width="18" height="2.6" rx="1.3" fill="#DC2626" />
          <circle cx="18" cy="30" r="5.5" fill="white" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="18" cy="30" r="1.8" fill="#DC2626" />
          <circle cx="47" cy="30" r="5.5" fill="white" stroke="currentColor" strokeWidth="2.4" />
        </svg>
      );
    case 'truck':
      return (
        <svg viewBox="0 0 64 40" fill="none" className={className} aria-hidden="true">
          <rect x="6" y="7" width="33" height="20" rx="2.5" stroke="currentColor" strokeWidth="2.2" fill="currentColor" fillOpacity="0.08" />
          <rect x="12" y="13" width="18" height="2.8" rx="1.4" fill="#DC2626" />
          <path d="M39 14H50L57 21V27H39V14Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
          <circle cx="17" cy="30" r="5.5" fill="white" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="17" cy="30" r="1.8" fill="#DC2626" />
          <circle cx="48" cy="30" r="5.5" fill="white" stroke="currentColor" strokeWidth="2.4" />
        </svg>
      );
  }
}
