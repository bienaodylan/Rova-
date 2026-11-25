import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Camera, CheckCircle2, Loader2, QrCode, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

interface QrScannerSheetProps {
  open: boolean;
  onClose: () => void;
  onDetected: (trackingToken: string) => void;
}

type BarcodeResult = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeResult[]>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function getTrackingToken(rawValue: string): string {
  const value = rawValue.trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    const token = url.searchParams.get('track') || url.searchParams.get('token') ||
      url.searchParams.get('tracking') || url.pathname.split('/').filter(Boolean).pop();
    return (token || '').trim();
  } catch {
    return value;
  }
}

export function QrScannerSheet({ open, onClose, onDetected }: QrScannerSheetProps) {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectedRef = useRef(false);
  const [cameraError, setCameraError] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [starting, setStarting] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer = 0;
    detectedRef.current = false;
    setCameraError('');
    setCameraReady(false);
    setStarting(true);

    const stopCamera = () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(t('La caméra nécessite un navigateur sécurisé (HTTPS).', 'Camera access requires a secure browser (HTTPS).'));
        }
        const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
        if (!Detector) {
          throw new Error(t('Le scan QR automatique n’est pas pris en charge par ce navigateur. Saisissez le code manuellement.', 'Automatic QR scanning is not supported by this browser. Enter the code manually.'));
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setCameraReady(true);
        setStarting(false);
        const detector = new Detector({ formats: ['qr_code'] });
        const scan = async () => {
          if (cancelled || detectedRef.current || !videoRef.current) return;
          try {
            const results = await detector.detect(videoRef.current);
            const raw = results.find((result) => result.rawValue)?.rawValue || '';
            const token = getTrackingToken(raw);
            if (token) {
              detectedRef.current = true;
              stopCamera();
              onDetected(token);
              onClose();
              return;
            }
          } catch {
            // A frame can be temporarily unavailable while the camera initializes.
          }
          if (!cancelled && !detectedRef.current) timer = window.setTimeout(scan, 180);
        };
        timer = window.setTimeout(scan, 180);
      } catch (error) {
        if (cancelled) return;
        setStarting(false);
        setCameraError(error instanceof Error ? error.message : t('Impossible d’accéder à la caméra.', 'Unable to access the camera.'));
      }
    };

    void start();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stopCamera();
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [open]);

  const submitManualCode = (event: React.FormEvent) => {
    event.preventDefault();
    const token = getTrackingToken(manualCode);
    if (!token) return;
    onDetected(token);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-[#171717]/55 backdrop-blur-sm p-0 sm:p-5" role="dialog" aria-modal="true" aria-label={t('Scanner un colis', 'Scan a package')}>
      <div className="w-full max-w-lg overflow-hidden rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-[#E5E5E5] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FEF2F2] text-[#E52B32]"><QrCode className="h-5 w-5" /></span>
            <div>
              <h2 className="text-base font-bold text-[#171717]">{t('Scanner un colis', 'Scan a package')}</h2>
              <p className="mt-0.5 text-xs text-[#777777]">{t('Placez le QR code dans le cadre.', 'Place the QR code inside the frame.')}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Fermer', 'Close')} className="flex h-10 w-10 items-center justify-center rounded-full text-[#777777] hover:bg-[#F3F3F3]"><X className="h-5 w-5" /></button>
        </header>

        <div className="space-y-4 p-5">
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[#171717]">
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative h-44 w-44 rounded-2xl border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.28)]">
                <span className="absolute -left-0.5 -top-0.5 h-5 w-5 rounded-tl-lg border-l-4 border-t-4 border-[#E52B32]" />
                <span className="absolute -right-0.5 -top-0.5 h-5 w-5 rounded-tr-lg border-r-4 border-t-4 border-[#E52B32]" />
                <span className="absolute -bottom-0.5 -left-0.5 h-5 w-5 rounded-bl-lg border-b-4 border-l-4 border-[#E52B32]" />
                <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-br-lg border-b-4 border-r-4 border-[#E52B32]" />
              </div>
            </div>
            {starting && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#171717]/70 text-white"><Loader2 className="h-6 w-6 animate-spin" /><span className="text-xs">{t('Activation de la caméra…', 'Starting camera…')}</span></div>}
            {!cameraReady && !starting && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#171717]/85 px-6 text-center text-white"><Camera className="h-7 w-7" /><span className="text-sm font-semibold">{t('Caméra indisponible', 'Camera unavailable')}</span></div>}
          </div>

          {cameraError && <p className="flex items-start gap-2 rounded-xl bg-[#FEF2F2] px-3.5 py-3 text-xs leading-relaxed text-[#991B1B]" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{cameraError}</p>}
          {cameraReady && <p className="flex items-center gap-2 text-xs text-[#15803D]"><CheckCircle2 className="h-4 w-4" />{t('Caméra active · lecture automatique du QR code', 'Camera active · QR code will be detected automatically')}</p>}

          <form onSubmit={submitManualCode} className="space-y-2.5">
            <label htmlFor="rovia-manual-tracking-code" className="block text-xs font-semibold text-[#171717]">{t('Ou saisir le code de suivi', 'Or enter a tracking code')}</label>
            <div className="flex gap-2">
              <input id="rovia-manual-tracking-code" value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder={t('Code ou lien de suivi', 'Tracking code or link')} className="min-w-0 flex-1 rounded-xl border border-[#E5E5E5] px-3.5 py-3 text-sm outline-none focus:border-[#171717]" />
              <button type="submit" disabled={!manualCode.trim()} className="min-h-11 rounded-xl bg-[#E52B32] px-4 text-sm font-semibold text-white transition hover:bg-[#CC2229] disabled:opacity-40">{t('Suivre', 'Track')}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
