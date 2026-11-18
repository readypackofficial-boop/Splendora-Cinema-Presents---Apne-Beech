import jsQR from 'jsqr';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  QrCode,
  Search,
  Upload,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { formatINR, formatShowDate } from '../../lib/defaults';
import type { ScanTicketResponse } from '../../types/cinema';

export function TicketScannerPanel() {
  const { getIdToken } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [scanResult, setScanResult] = useState<ScanTicketResponse | null>(null);
  const [lastScannedPayload, setLastScannedPayload] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const verifyPayloadOnServer = async (params: { qrPayload?: string; manualId?: string }) => {
    setScanning(true);
    setActionMessage(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Admin token missing');
      const resp = await fetch('/api/admin/tickets/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(params),
      });
      const data = (await resp.json()) as ScanTicketResponse & { error?: string };
      if (!resp.ok) {
        throw new Error(data.error || 'Ticket verification failed');
      }
      setScanResult(data);
      if (params.qrPayload) {
        setLastScannedPayload(params.qrPayload);
      } else {
        setLastScannedPayload(null);
      }
    } catch (err) {
      setScanResult({
        status: 'INVALID_TICKET',
        badge: 'INVALID TICKET',
        message: err instanceof Error ? err.message : 'Verification error',
      });
    } finally {
      setScanning(false);
    }
  };

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
          scanVideoFrame();
        }
      }, 100);
    } catch (err) {
      setCameraError(
        err instanceof Error
          ? `Camera unavailable: ${err.message}. You can upload a QR image or enter Ticket ID manually.`
          : 'Camera permission denied.'
      );
      setCameraActive(false);
    }
  };

  const scanVideoFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });
        if (decoded && decoded.data) {
          stopCamera();
          void verifyPayloadOnServer({ qrPayload: decoded.data });
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(scanVideoFrame);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height);
        if (decoded?.data) {
          void verifyPayloadOnServer({ qrPayload: decoded.data });
        } else {
          setScanResult({
            status: 'INVALID_TICKET',
            badge: 'INVALID TICKET',
            message: 'No readable QR code found in the uploaded image.',
          });
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmEntry = async () => {
    if (!scanResult?.ticket?.ticketId) return;
    setCheckingIn(true);
    setActionMessage(null);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/admin/tickets/check-in', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ticketId: scanResult.ticket.ticketId,
          qrPayload: lastScannedPayload || undefined,
        }),
      });
      const data = (await resp.json()) as {
        checkedIn?: boolean;
        message?: string;
        error?: string;
        ticket?: ScanTicketResponse['ticket'];
      };
      if (!resp.ok) {
        setScanResult((prev) =>
          prev
            ? {
                ...prev,
                status: 'ALREADY_USED',
                badge: 'ALREADY USED',
                message: data.error || 'ALREADY USED — ENTRY NOT ALLOWED',
              }
            : null
        );
        return;
      }
      setActionMessage(data.message || 'Entry confirmed.');
      setScanResult({
        status: 'ALREADY_USED',
        badge: 'USED — CHECKED IN',
        message: 'Check-in completed. Future scans will reject duplicate entry.',
        ticket: data.ticket || scanResult.ticket,
        booking: scanResult.booking,
      });
    } finally {
      setCheckingIn(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cinema-accent/40 pb-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-cinema-primary">Ticket Scanner</h2>
          <p className="text-sm text-cinema-muted">
            Scan customer QR passes with device camera or enter Ticket / Booking ID for atomic server verification.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Camera + Manual Input */}
        <div className="lg:col-span-6 bg-cinema-surface border border-cinema-accent/60 p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            {!cameraActive ? (
              <button
                type="button"
                onClick={() => void startCamera()}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-cinema-primary text-cinema-bg text-xs font-bold uppercase tracking-[0.12em] hover:bg-cinema-primary-hover cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                Start Camera Scanner
              </button>
            ) : (
              <button
                type="button"
                onClick={stopCamera}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#991B1B] text-white text-xs font-bold uppercase tracking-[0.12em] cursor-pointer"
              >
                <CameraOff className="w-4 h-4" />
                Stop Camera
              </button>
            )}

            <label className="inline-flex items-center gap-2 px-4 py-2.5 border border-cinema-accent text-xs font-semibold text-cinema-primary hover:bg-cinema-bg cursor-pointer">
              <Upload className="w-4 h-4" />
              Scan QR Image
              <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
            </label>
          </div>

          {cameraError && (
            <div className="bg-[#FEF3C7] border border-[#D97706]/40 p-3 text-xs text-[#92400E]">
              {cameraError}
            </div>
          )}

          <div className="aspect-video bg-cinema-dark-deep border border-cinema-accent/50 flex items-center justify-center overflow-hidden relative">
            {cameraActive ? (
              <>
                <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
                <div className="absolute inset-8 border-2 border-cinema-accent-light/70 pointer-events-none" />
              </>
            ) : (
              <div className="text-center text-cinema-accent-light/85 p-6 space-y-2">
                <QrCode className="w-10 h-10 mx-auto text-cinema-accent-light opacity-80" />
                <p className="text-xs">Camera preview inactive. Click Start Camera Scanner or enter Ticket ID below.</p>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (manualInput.trim()) {
                void verifyPayloadOnServer({ manualId: manualInput.trim() });
              }
            }}
            className="space-y-2 pt-2 border-t border-cinema-accent/30"
          >
            <label className="block text-xs font-semibold text-cinema-text/85">
              Manual Ticket ID / Booking ID / QR Token
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="e.g. TKT_..., SC..., or SP1..."
                className="flex-1 px-3 py-2.5 bg-cinema-bg border border-cinema-accent/60 font-mono text-xs focus:outline-none focus:border-cinema-primary"
              />
              <button
                type="submit"
                disabled={scanning || !manualInput.trim()}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-cinema-primary text-cinema-bg text-xs font-bold uppercase tracking-[0.12em] hover:bg-cinema-primary-hover cursor-pointer disabled:opacity-50"
              >
                <Search className="w-3.5 h-3.5" />
                Verify
              </button>
            </div>
          </form>
        </div>

        {/* Verification Result Panel */}
        <div className="lg:col-span-6 bg-cinema-surface border border-cinema-accent/60 p-6 space-y-5">
          <h3 className="font-display text-xl font-semibold text-cinema-primary">
            Verification Result
          </h3>

          {!scanResult ? (
            <div className="py-16 text-center text-sm text-cinema-muted border border-dashed border-cinema-accent/40">
              Scan a QR pass or enter a Ticket ID to inspect entry validity.
            </div>
          ) : (
            <div className="space-y-5">
              {/* Status Banner */}
              <div
                className={`p-4 border flex items-start gap-3 ${
                  scanResult.status === 'VALID'
                    ? 'bg-[#DCFCE7] border-[#16A34A] text-[#14532D]'
                    : scanResult.status === 'PAYMENT_PENDING'
                    ? 'bg-[#FEF3C7] border-[#D97706] text-[#78350F]'
                    : 'bg-[#FEE2E2] border-[#DC2626] text-[#7F1D1D]'
                }`}
              >
                {scanResult.status === 'VALID' ? (
                  <CheckCircle2 className="w-6 h-6 shrink-0" />
                ) : scanResult.status === 'PAYMENT_PENDING' ? (
                  <AlertTriangle className="w-6 h-6 shrink-0" />
                ) : (
                  <XCircle className="w-6 h-6 shrink-0" />
                )}
                <div>
                  <p className="text-xs font-mono font-bold uppercase tracking-[0.14em]">
                    {scanResult.badge}
                  </p>
                  <p className="text-sm font-semibold mt-0.5">{scanResult.message}</p>
                </div>
              </div>

              {actionMessage && (
                <div className="bg-[#DCFCE7] border border-[#16A34A] p-3 text-xs font-semibold text-[#14532D]">
                  {actionMessage}
                </div>
              )}

              {scanResult.ticket && (
                <div className="border border-cinema-accent/40 bg-cinema-bg p-4 space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="block text-cinema-muted uppercase">Guest Name</span>
                      <span className="font-semibold text-sm text-cinema-text">
                        {scanResult.ticket.customerName}
                      </span>
                    </div>
                    <div>
                      <span className="block text-cinema-muted uppercase">Movie</span>
                      <span className="font-semibold text-sm text-cinema-primary">
                        {scanResult.ticket.movieTitle}
                      </span>
                    </div>
                    <div>
                      <span className="block text-cinema-muted uppercase">Date & Time</span>
                      <span className="font-medium">
                        {formatShowDate(scanResult.ticket.date)} · {scanResult.ticket.startTime}
                      </span>
                    </div>
                    <div>
                      <span className="block text-cinema-muted uppercase">Seat Numbers</span>
                      <span className="font-mono font-bold text-cinema-primary text-sm">
                        {scanResult.ticket.seatNumbers.join(', ')}
                      </span>
                    </div>
                    <div>
                      <span className="block text-cinema-muted uppercase">Payment Status</span>
                      <span className="font-mono font-semibold">
                        {scanResult.booking?.paymentStatus || 'VERIFIED'} ({formatINR(scanResult.ticket.grandTotal)})
                      </span>
                    </div>
                    <div>
                      <span className="block text-cinema-muted uppercase">Check-In Status</span>
                      <span className="font-mono font-bold">{scanResult.ticket.ticketStatus}</span>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-cinema-accent/25">
                    <span className="block text-cinema-muted uppercase">Mocktail Order</span>
                    <span className="font-medium">{scanResult.ticket.mocktailSummary}</span>
                  </div>
                  {scanResult.ticket.checkedInAt && (
                    <div className="pt-2 border-t border-cinema-accent/25 font-mono text-[11px] text-[#7F1D1D]">
                      Checked in at {new Date(scanResult.ticket.checkedInAt).toLocaleString()} by{' '}
                      {scanResult.ticket.checkedInBy}
                    </div>
                  )}
                </div>
              )}

              {scanResult.status === 'VALID' && scanResult.ticket && (
                <button
                  type="button"
                  onClick={() => void handleConfirmEntry()}
                  disabled={checkingIn}
                  className="w-full py-3.5 px-6 bg-[#166534] text-white text-xs font-bold uppercase tracking-[0.16em] hover:bg-[#14532D] transition-colors cursor-pointer disabled:opacity-60"
                >
                  {checkingIn ? 'Confirming Entry...' : 'Confirm Entry (Mark Ticket Used)'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
