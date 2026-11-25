import React, { useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

interface SignaturePadProps {
  onChange: (dataUrl: string) => void;
}

export function SignaturePad({ onChange }: SignaturePadProps) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasStroke, setHasStroke] = useState(false);

  const getCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e);
    ctx.strokeStyle = '#0a0a0a';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasStroke(true);
  };

  const handlePointerUp = () => {
    if (!drawing || !canvasRef.current) return;
    setDrawing(false);
    if (hasStroke) {
      onChange(canvasRef.current.toDataURL('image/png', 0.6));
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
    onChange('');
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-600">
          {t('Signature du destinataire', 'Recipient signature')}
        </span>
        <button
          type="button"
          onClick={clear}
          className="text-xs text-neutral-500 hover:text-neutral-950 flex items-center gap-1"
        >
          <RotateCcw className="w-3 h-3" />
          {t('Effacer', 'Clear')}
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={420}
        height={140}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="w-full h-36 rounded-2xl border border-neutral-300 bg-white touch-none cursor-crosshair"
      />
    </div>
  );
}
