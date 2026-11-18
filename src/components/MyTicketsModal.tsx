import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { CheckCircle2, Clock, Download, Ticket, X, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { formatINR, formatShowDate } from '../lib/defaults';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { downloadTicketPDF } from '../lib/pdfTicket';
import type { BookingRecord, TicketRecord } from '../types/cinema';
import { QrCodeCanvas } from './QrCodeCanvas';

interface MyTicketsModalProps {
  open: boolean;
  onClose: () => void;
}

export function MyTicketsModal({ open, onClose }: MyTicketsModalProps) {
  const { user, signInWithGoogle, signingIn } = useAuth();
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user) {
      setBookings([]);
      setTickets([]);
      return;
    }

    setLoading(true);
    const bq = query(collection(db, 'bookings'), where('customerId', '==', user.uid));
    const tq = query(collection(db, 'tickets'), where('customerId', '==', user.uid));

    const unsubBookings = onSnapshot(
      bq,
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as BookingRecord)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        setBookings(list);
        setLoading(false);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'bookings')
    );

    const unsubTickets = onSnapshot(
      tq,
      (snap) => {
        setTickets(snap.docs.map((d) => d.data() as TicketRecord));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'tickets')
    );

    return () => {
      unsubBookings();
      unsubTickets();
    };
  }, [open, user]);

  if (!open) return null;

  const ticketByBooking = new Map<string, TicketRecord>();
  for (const t of tickets) {
    ticketByBooking.set(t.bookingId, t);
  }

  const handleDownloadPdf = async (ticket: TicketRecord) => {
    setDownloadingId(ticket.ticketId);
    try {
      await downloadTicketPDF(ticket);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-cinema-dark-deep/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-3xl bg-cinema-surface border border-cinema-accent shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="bg-cinema-primary px-6 py-4 border-b border-cinema-accent/40 flex items-center justify-between text-cinema-bg">
          <div className="flex items-center gap-3">
            <Ticket className="w-5 h-5 text-cinema-accent-light" />
            <div>
              <h2 className="font-display text-xl font-semibold">My Bookings & Digital Tickets</h2>
              <p className="text-xs text-cinema-bg/90">
                Verified QR entry passes appear automatically once payment is confirmed.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tickets dialog"
            className="p-2 text-cinema-accent-light hover:bg-cinema-primary-hover transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {!user ? (
            <div className="text-center py-10 space-y-4">
              <p className="text-sm text-cinema-text/90 max-w-md mx-auto">
                Sign in with the Google account you used during booking to view your reservation status and download verified QR tickets.
              </p>
              <button
                type="button"
                onClick={() => void signInWithGoogle()}
                disabled={signingIn}
                className="px-6 py-3 bg-cinema-primary text-cinema-bg text-xs font-bold uppercase tracking-[0.14em] hover:bg-cinema-primary-hover transition-colors cursor-pointer disabled:opacity-60"
              >
                {signingIn ? 'Signing in...' : 'Sign in with Google'}
              </button>
            </div>
          ) : loading ? (
            <div className="py-12 text-center text-sm text-cinema-muted">Loading your bookings...</div>
          ) : bookings.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <p className="font-display text-lg text-cinema-text">No bookings found yet</p>
              <p className="text-sm text-cinema-muted">
                Signed in as {user.email}. Book your seats for APNE BEECH to see your passes here.
              </p>
            </div>
          ) : (
            bookings.map((booking) => {
              const ticket = ticketByBooking.get(booking.bookingId);
              const isVerified = booking.paymentStatus === 'VERIFIED' && ticket;
              const isCancelled = booking.bookingStatus === 'CANCELLED';

              return (
                <div
                  key={booking.bookingId}
                  className="border border-cinema-accent/50 bg-cinema-bg p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-cinema-accent/25 pb-3">
                    <div>
                      <p className="font-mono text-xs text-cinema-muted">
                        BOOKING {booking.bookingId} · SHOW {booking.screeningId}
                      </p>
                      <h3 className="font-display text-xl font-semibold text-cinema-primary mt-0.5">
                        {booking.movieTitle}
                      </h3>
                      <p className="text-xs text-cinema-text/85 mt-1">
                        {formatShowDate(booking.date)} · {booking.startTime || 'Timing TBA'}
                      </p>
                    </div>

                    <div className="text-right">
                      {isVerified ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#166534]">
                          <CheckCircle2 className="w-4 h-4" />
                          PAYMENT VERIFIED · {ticket.ticketStatus}
                        </span>
                      ) : isCancelled ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#991B1B]">
                          <XCircle className="w-4 h-4" />
                          CANCELLED
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#92400E]">
                          <Clock className="w-4 h-4" />
                          {booking.paymentStatus.replace('_', ' ')}
                        </span>
                      )}
                      <p className="font-mono text-base font-bold text-cinema-text tabular-nums mt-1">
                        {formatINR(booking.grandTotal)}
                      </p>
                      {booking.discountAmount && booking.discountAmount > 0 ? (
                        <p className="text-[11px] font-semibold text-[#166534]">
                          Discount Applied: -{formatINR(booking.discountAmount)}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="block text-cinema-muted uppercase">Seats</span>
                      <span className="font-mono font-semibold text-cinema-text">
                        {booking.seatNumbers.join(', ')}
                      </span>
                    </div>
                    <div>
                      <span className="block text-cinema-muted uppercase">Tickets</span>
                      <span className="font-mono font-semibold tabular-nums">
                        {booking.ticketCount} ({formatINR(booking.ticketSubtotal)})
                      </span>
                    </div>
                    <div>
                      <span className="block text-cinema-muted uppercase">Mocktails</span>
                      <span className="font-mono font-semibold tabular-nums">
                        {booking.complimentaryDrinks ? 'Complimentary (₹0)' : formatINR(booking.mocktailSubtotal)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-cinema-muted uppercase">UPI Reference</span>
                      <span className="font-mono font-semibold text-cinema-text break-all">
                        {booking.upiTransactionRef || '—'}
                      </span>
                    </div>
                  </div>

                  {isVerified && ticket ? (
                    <div className="bg-cinema-surface border border-cinema-accent p-4 flex flex-col sm:flex-row items-center justify-between gap-5">
                      <div className="space-y-1.5 text-xs flex-1">
                        <p className="uppercase tracking-[0.16em] text-cinema-primary font-bold">
                          SPLENDORA CINEMA · VERIFIED DIGITAL PASS
                        </p>
                        <p className="text-cinema-text/85">
                          Ticket ID: <span className="font-mono font-semibold">{ticket.ticketId}</span>
                        </p>
                        <p className="text-cinema-text/85">
                          Guest: <span className="font-semibold">{ticket.customerName}</span>
                        </p>
                        <p className="text-cinema-text/85">
                          In-Seat Mocktails:{' '}
                          <span className="font-medium">{ticket.mocktailSummary}</span>
                        </p>
                        {ticket.complimentaryDrinks && (
                          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#166534]">
                            Complimentary Drinks Included (₹0)
                          </p>
                        )}
                        {ticket.discountAmount && ticket.discountAmount > 0 ? (
                          <p className="text-[11px] font-semibold text-[#166534]">
                            Counter Discount: -{formatINR(ticket.discountAmount)}
                            {ticket.discountReason ? ` (${ticket.discountReason})` : ''}
                          </p>
                        ) : null}
                        <div className="pt-2">
                          <button
                            type="button"
                            onClick={() => void handleDownloadPdf(ticket)}
                            disabled={downloadingId === ticket.ticketId}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-cinema-primary text-cinema-bg text-xs font-semibold uppercase tracking-[0.1em] hover:bg-cinema-primary-hover transition-colors cursor-pointer"
                          >
                            <Download className="w-4 h-4" />
                            {downloadingId === ticket.ticketId ? 'Generating PDF...' : 'Download QR Ticket PDF'}
                          </button>
                        </div>
                      </div>
                      <div className="shrink-0 p-2 bg-cinema-surface border border-cinema-accent/50 text-center">
                        <QrCodeCanvas value={ticket.qrPayload} size={132} />
                        <p className="font-mono text-[10px] text-cinema-muted mt-1">{ticket.ticketId}</p>
                      </div>
                    </div>
                  ) : !isCancelled ? (
                    <div className="bg-[#FEF3C7]/60 border border-[#D97706]/30 px-4 py-3 text-xs text-[#78350F]">
                      Your payment is currently in <strong>PENDING VERIFICATION</strong>. A valid digital entry QR code is generated only after cinema administration verifies the payment record.
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
