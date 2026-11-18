import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

interface QrCodeCanvasProps {
  value: string;
  size?: number;
  className?: string;
}

export function QrCodeCanvas({ value, size = 180, className = '' }: QrCodeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !value) return;
    QRCode.toCanvas(
      canvasRef.current,
      value,
      {
        width: size,
        margin: 1,
        color: {
          dark: '#2A1812',
          light: '#FFFDF9',
        },
      },
      (err) => {
        if (err) console.error('QR render error:', err);
      }
    );
  }, [value, size]);

  return <canvas ref={canvasRef} width={size} height={size} className={className} />;
}
