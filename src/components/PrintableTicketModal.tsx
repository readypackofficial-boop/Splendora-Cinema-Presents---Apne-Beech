import { Download, Printer, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { formatINR, formatShowDate, formatShowTime } from '../lib/defaults';
import { downloadTicketPDF } from '../lib/pdfTicket';
import type { TicketRecord } from '../types/cinema';

interface PrintableTicketModalProps {
  ticket: TicketRecord | null;
  onClose: () => void;
}

export function PrintableTicketModal({ ticket, onClose }: PrintableTicketModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [paperFormat, setPaperFormat] = useState<'A5' | 'THERMAL'>('A5');

  useEffect(() => {
    if (!ticket?.qrPayload) {
      setQrDataUrl('');
      return;
    }
    let active = true;
    QRCode.toDataURL(ticket.qrPayload, {
      width: 320,
      margin: 1,
      color: { dark: '#1A0509', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [ticket?.qrPayload]);

  if (!ticket) return null;

  const handleTriggerPrint = () => {
    window.print();
  };

  return (
    <>
      {/* Screen Interactive Print Preview Modal (hidden when printing) */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-cinema-dark-deep/85 overflow-y-auto no-print"
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full max-w-lg bg-cinema-surface border border-cinema-accent shadow-2xl my-6 overflow-hidden">
          <div className="bg-cinema-primary px-5 py-3.5 text-cinema-bg flex items-center justify-between border-b border-cinema-accent/40">
            <div className="flex items-center gap-2">
              <Printer className="w-4 h-4 text-cinema-accent-light" />
              <span className="font-display text-lg font-semibold">Print Cinema Ticket</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-cinema-accent-light hover:bg-cinema-primary-hover cursor-pointer"
              aria-label="Close print preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4 text-xs">
            <div className="flex items-center justify-between gap-3 bg-cinema-bg border border-cinema-accent/40 p-2.5">
              <span className="font-semibold text-cinema-primary">Print Layout Format:</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPaperFormat('A5')}
                  className={`px-3 py-1 border font-semibold cursor-pointer ${
                    paperFormat === 'A5'
                      ? 'bg-cinema-primary text-cinema-bg border-cinema-primary'
                      : 'bg-cinema-surface border-cinema-accent/50'
                  }`}
                >
                  Classic A5 Pass
                </button>
                <button
                  type="button"
                  onClick={() => setPaperFormat('THERMAL')}
                  className={`px-3 py-1 border font-semibold cursor-pointer ${
                    paperFormat === 'THERMAL'
                      ? 'bg-cinema-primary text-cinema-bg border-cinema-primary'
                      : 'bg-cinema-surface border-cinema-accent/50'
                  }`}
                >
                  80mm Counter Receipt
                </button>
              </div>
            </div>

            {/* Ticket Preview */}
            <div className="flex justify-center bg-[#EAE3D5] p-4 border border-cinema-accent/40">
              <TicketPrintCard ticket={ticket} qrDataUrl={qrDataUrl} paperFormat={paperFormat} />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-cinema-accent/30">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-cinema-accent cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void downloadTicketPDF(ticket)}
                className="inline-flex items-center gap-1.5 px-4 py-2 border border-cinema-primary text-cinema-primary font-semibold hover:bg-cinema-surface-alt cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Download PDF
              </button>
              <button
                type="button"
                onClick={handleTriggerPrint}
                className="inline-flex items-center gap-2 px-5 py-2 bg-cinema-primary text-cinema-bg font-bold uppercase tracking-[0.12em] hover:bg-cinema-primary-hover cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                Print Now
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Dedicated Print-Only Output (renders cleanly alone when window.print() is triggered) */}
      <div className="hidden print-only p-4 flex justify-center">
        <TicketPrintCard ticket={ticket} qrDataUrl={qrDataUrl} paperFormat={paperFormat} />
      </div>
    </>
  );
}

function TicketPrintCard({
  ticket,
  qrDataUrl,
  paperFormat,
}: {
  ticket: TicketRecord;
  qrDataUrl: string;
  paperFormat: 'A5' | 'THERMAL';
}) {
  const widthClass = paperFormat === 'THERMAL' ? 'w-[300px]' : 'w-full max-w-[400px]';
  return (
    <div
      className={`${widthClass} bg-white text-[#1A0509] border-2 border-[#5B0E1D] p-4 space-y-3 mx-auto shadow-sm`}
    >
      <div className="border-b-2 border-[#5B0E1D] pb-2 text-center space-y-0.5">
        <p className="font-display text-lg font-bold tracking-[0.12em] text-[#5B0E1D]">
          SPLENDORA CINEMA
        </p>
        <p className="text-[10px] uppercase tracking-[0.18em] text-[#6B4F43]">
          Official Verified Admit Pass
        </p>
      </div>

      <div className="text-center border-b border-dashed border-[#C6A15B] pb-2">
        <p className="font-display text-xl font-bold text-[#1A0509]">
          {ticket.movieTitle || 'APNE BEECH'}
        </p>
        <p className="text-xs font-medium mt-0.5">
          {formatShowDate(ticket.date)} · {formatShowTime(ticket.startTime)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="block text-[10px] uppercase text-[#6B4F43]">Guest Name</span>
          <span className="font-bold">{ticket.customerName}</span>
        </div>
        <div className="text-right">
          <span className="block text-[10px] uppercase text-[#6B4F43]">Seats ({ticket.seatNumbers.length})</span>
          <span className="font-mono font-bold text-[#5B0E1D]">
            {ticket.seatNumbers.join(', ')}
          </span>
        </div>
        <div>
          <span className="block text-[10px] uppercase text-[#6B4F43]">Booking ID</span>
          <span className="font-mono">{ticket.bookingId}</span>
        </div>
        <div className="text-right">
          <span className="block text-[10px] uppercase text-[#6B4F43]">Show ID</span>
          <span className="font-mono">{ticket.screeningId}</span>
        </div>
      </div>

      <div className="border-t border-b border-dashed border-[#C6A15B] py-2 text-xs space-y-1">
        <div className="flex justify-between gap-2">
          <span className="text-[#6B4F43]">Refreshments:</span>
          <span className="font-medium text-right">{ticket.mocktailSummary || 'None'}</span>
        </div>
        {ticket.complimentaryDrinks && (
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#166534]">
            Complimentary Drinks Included
          </div>
        )}
        {ticket.discountAmount && ticket.discountAmount > 0 ? (
          <div className="flex justify-between gap-2 text-[11px] text-[#166534] font-semibold">
            <span>Counter Discount{ticket.discountReason ? ` (${ticket.discountReason})` : ''}:</span>
            <span className="font-mono">-{formatINR(ticket.discountAmount)}</span>
          </div>
        ) : null}
        <div className="flex justify-between items-baseline pt-1">
          <span className="font-bold uppercase text-[11px]">Total Paid</span>
          <span className="font-mono text-base font-bold text-[#5B0E1D] tabular-nums">
            {formatINR(ticket.grandTotal)}
          </span>
        </div>
      </div>

      <div className="text-center space-y-1.5 pt-1">
        {qrDataUrl && (
          <img
            src={qrDataUrl}
            alt={`Ticket QR ${ticket.ticketId}`}
            className="w-32 h-32 mx-auto border border-[#C6A15B] p-1 bg-white"
          />
        )}
        <p className="font-mono text-[11px] font-bold text-[#5B0E1D]">{ticket.ticketId}</p>
        <p className="text-[10px] text-[#6B4F43]">
          Status: {ticket.ticketStatus} · Single Atomic Entry Check-In
        </p>
      </div>
    </div>
  );
}
