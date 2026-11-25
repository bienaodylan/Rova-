import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { markGoogleMapsAuthFailed } from './lib/mapsConfig';

// Google Maps Platform auth & quota failure listeners.
// Separates quota warnings from invalid/restricted API keys so mobile & preview domains
// seamlessly fall back to OpenStreetMap/Leaflet instead of displaying "API key required".
(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
  markGoogleMapsAuthFailed('gm_authFailure');
};

const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  origConsoleError.apply(console, args);
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
  if (
    msg.includes('MissingKeyMapError') ||
    msg.includes('InvalidKeyMapError') ||
    msg.includes('RefererNotAllowedMapError') ||
    msg.includes('ApiNotActivatedMapError') ||
    msg.includes('BillingNotEnabledMapError') ||
    msg.includes('NoApiKeys')
  ) {
    markGoogleMapsAuthFailed(msg.slice(0, 160));
  }
};

createRoot(document.getElementById('root')!).render(<App />);
