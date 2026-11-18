import {
  CheckCircle2,
  Download,
  Gift,
  Percent,
  Printer,
  QrCode,
  RotateCcw,
  Search,
  Ticket,
  Wine,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useScreeningSeats } from '../../hooks/useCinemaPublicData';
import {
  SEAT_COLS,
  SEAT_ROWS,
  formatINR,
  formatShowDate,
  formatShowTime,
  getScreeningPriceRange,
  getSeatRowPrice,
} from '../../lib/defaults';
import { downloadTicketPDF } from '../../lib/pdfTicket';
import type {
  BookingRecord,
  DiscountType,
  MocktailProduct,
  ScreeningRecord,
  SeatRecord,
  TicketRecord,
} from '../../types/cinema';
import { PrintableTicketModal } from '../PrintableTicketModal';
import { QrCodeCanvas } from '../QrCodeCanvas';

export function BoxOfficeCounterPanel({
  screenings,
  mocktails,
  bookings = [],
}: {
  screenings: ScreeningRecord[];
  mocktails: MocktailProduct[];
  bookings?: BookingRecord[];
}) {
  const { getIdToken, hasFeature } = useAuth();
  const canGrantDiscountsAndComps = hasFeature('grantDiscountsAndComps');
  const canPrintTickets =
    hasFeature('printTickets') || hasFeature('boxOfficeCounter') || hasFeature('ticketScanner');
  const canGrantExistingCompDrinks =
    canGrantDiscountsAndComps || hasFeature('manageMocktails') || hasFeature('boxOfficeCounter');

  const bookableShows = useMemo(
    () => screenings.filter((s) => s.salesStatus !== 'CANCELLED' && s.salesStatus !== 'COMPLETED'),
    [screenings]
  );

  const [selectedShowId, setSelectedShowId] = useState<string>('');
  useEffect(() => {
    if (!selectedShowId && bookableShows.length > 0) {
      setSelectedShowId(bookableShows[0].screeningId);
    }
  }, [bookableShows, selectedShowId]);

  const activeShow = useMemo(
    () => bookableShows.find((s) => s.screeningId === selectedShowId) || null,
    [bookableShows, selectedShowId]
  );

  const { seats } = useScreeningSeats(selectedShowId || null);
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<
    'COUNTER_CASH' | 'COUNTER_UPI' | 'COMPLIMENTARY_VIP'
  >('COUNTER_CASH');
  const [referenceCode, setReferenceCode] = useState('');
  const [notes, setNotes] = useState('');
  const [drinkQtyByProduct, setDrinkQtyByProduct] = useState<Record<string, number>>({});

  // Discounts & complimentary drinks state
  const [discountType, setDiscountType] = useState<DiscountType>('NONE');
  const [discountValue, setDiscountValue] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [complimentaryDrinks, setComplimentaryDrinks] = useState(false);

  const [issuing, setIssuing] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [issuedTicket, setIssuedTicket] = useState<TicketRecord | null>(null);
  const [printTicket, setPrintTicket] = useState<TicketRecord | null>(null);

  // Grant complimentary drinks to existing booking panel
  const [compPanelOpen, setCompPanelOpen] = useState(false);
  const [compBookingId, setCompBookingId] = useState('');
  const [compQtyByProduct, setCompQtyByProduct] = useState<Record<string, number>>({});
  const [compNotes, setCompNotes] = useState('');
  const [compSaving, setCompSaving] = useState(false);
  const [compMsg, setCompMsg] = useState<string | null>(null);
  const [compErr, setCompErr] = useState<string | null>(null);

  const seatMap = useMemo(() => {
    const m = new Map<string, SeatRecord>();
    for (const s of seats) m.set(s.seatNumber, s);
    return m;
  }, [seats]);

  const toggleSeat = (seat: SeatRecord) => {
    const holdExp = seat.holdExpiresAt ? Date.parse(seat.holdExpiresAt) : 0;
    const isExpiredHold = seat.status === 'HELD' && (!holdExp || holdExp < Date.now());
    const available = seat.status === 'AVAILABLE' || isExpiredHold;
    if (!available) return;
    setErrMsg(null);
    setSelectedSeats((prev) =>
      prev.includes(seat.seatNumber)
        ? prev.filter((s) => s !== seat.seatNumber)
        : [...prev, seat.seatNumber].sort()
    );
  };

  const isComplimentary = paymentMethod === 'COMPLIMENTARY_VIP';
  const effectiveCompDrinks =
    isComplimentary || (canGrantDiscountsAndComps && complimentaryDrinks);

  const ticketSubtotal = isComplimentary
    ? 0
    : selectedSeats.reduce((sum, seatNum) => sum + getSeatRowPrice(activeShow, seatNum), 0);

  const enabledMocktails = useMemo(() => mocktails.filter((m) => m.enabled), [mocktails]);
  const mocktailSubtotal = effectiveCompDrinks
    ? 0
    : enabledMocktails.reduce(
        (sum, p) => sum + p.price * (drinkQtyByProduct[p.productId] || 0),
        0
      );

  const rawBeforeDiscount = ticketSubtotal + mocktailSubtotal;
  const parsedDiscountVal = Number(discountValue || 0);
  let discountAmount = 0;
  if (!isComplimentary && canGrantDiscountsAndComps && parsedDiscountVal > 0) {
    if (discountType === 'FLAT') {
      discountAmount = Math.min(rawBeforeDiscount, Math.round(parsedDiscountVal * 100) / 100);
    } else if (discountType === 'PERCENT') {
      const clampedPct = Math.min(100, Math.max(0, parsedDiscountVal));
      discountAmount = Math.min(
        rawBeforeDiscount,
        Math.round(((rawBeforeDiscount * clampedPct) / 100) * 100) / 100
      );
    }
  }
  const grandTotal = Math.max(0, Math.round((rawBeforeDiscount - discountAmount) * 100) / 100);

  const handleIssueWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShow) return;
    setErrMsg(null);

    if (selectedSeats.length === 0) {
      setErrMsg('Please select at least one available seat from the chart.');
      return;
    }
    if (!customerName.trim()) {
      setErrMsg('Guest / Customer Name is required.');
      return;
    }

    const firstSeat = selectedSeats[0];
    const mocktailAssignments = enabledMocktails
      .filter((p) => (drinkQtyByProduct[p.productId] || 0) > 0)
      .map((p) => ({
        seatNumber: firstSeat,
        productId: p.productId,
        quantity: drinkQtyByProduct[p.productId],
      }));

    setIssuing(true);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/admin/bookings/walk-in', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          screeningId: activeShow.screeningId,
          seatNumbers: selectedSeats,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerEmail: customerEmail.trim(),
          paymentMethod,
          referenceCode: referenceCode.trim(),
          notes: notes.trim(),
          mocktailAssignments,
          discountType: canGrantDiscountsAndComps && !isComplimentary ? discountType : 'NONE',
          discountValue:
            canGrantDiscountsAndComps && !isComplimentary ? Number(discountValue || 0) : 0,
          discountReason: canGrantDiscountsAndComps ? discountReason.trim() : '',
          complimentaryDrinks: effectiveCompDrinks && mocktailAssignments.length > 0,
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        created?: boolean;
        ticket?: TicketRecord;
        error?: string;
      };
      if (!resp.ok || !data.created || !data.ticket) {
        throw new Error(data.error || 'Could not issue walk-in ticket.');
      }

      setIssuedTicket(data.ticket);
      setSelectedSeats([]);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerEmail('');
      setReferenceCode('');
      setNotes('');
      setDrinkQtyByProduct({});
      setDiscountType('NONE');
      setDiscountValue('');
      setDiscountReason('');
      setComplimentaryDrinks(false);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Walk-in booking failed.');
    } finally {
      setIssuing(false);
    }
  };

  const activeBookings = useMemo(
    () => bookings.filter((b) => b.bookingStatus !== 'CANCELLED'),
    [bookings]
  );

  const selectedExistingBooking = useMemo(
    () => activeBookings.find((b) => b.bookingId === compBookingId.trim()) || null,
    [activeBookings, compBookingId]
  );

  const handleGrantExistingCompDrinks = async (e: React.FormEvent) => {
    e.preventDefault();
    setCompErr(null);
    setCompMsg(null);
    const cleanId = compBookingId.trim();
    if (!cleanId) {
      setCompErr('Please select or enter a valid Booking ID.');
      return;
    }
    const items = enabledMocktails
      .filter((p) => (compQtyByProduct[p.productId] || 0) > 0)
      .map((p) => ({
        seatNumber: selectedExistingBooking?.seatNumbers?.[0],
        productId: p.productId,
        quantity: compQtyByProduct[p.productId],
      }));
    if (items.length === 0) {
      setCompErr('Select at least 1 complimentary drink quantity to grant.');
      return;
    }

    setCompSaving(true);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/admin/bookings/grant-complimentary-drinks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookingId: cleanId,
          items,
          notes: compNotes.trim(),
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        granted?: boolean;
        summary?: string;
        error?: string;
      };
      if (!resp.ok || !data.granted) {
        throw new Error(data.error || 'Could not grant complimentary drinks.');
      }
      setCompMsg(`Complimentary drinks granted for ${cleanId}: ${data.summary || 'Updated'}.`);
      setCompQtyByProduct({});
      setCompNotes('');
    } catch (err) {
      setCompErr(err instanceof Error ? err.message : 'Failed to grant complimentary drinks.');
    } finally {
      setCompSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cinema-accent/40 pb-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-cinema-primary">
            Box Office Counter & VIP Issuance
          </h2>
          <p className="text-sm text-cinema-muted">
            Issue walk-in tickets with row-wise pricing, apply discounts, grant complimentary drinks, and print or download QR passes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canGrantExistingCompDrinks && enabledMocktails.length > 0 && (
            <button
              type="button"
              onClick={() => setCompPanelOpen((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-cinema-primary text-cinema-primary text-xs font-bold uppercase tracking-[0.1em] hover:bg-cinema-surface-alt cursor-pointer"
            >
              <Gift className="w-3.5 h-3.5" />
              {compPanelOpen ? 'Hide Comp Drinks Drawer' : 'Grant Comp Drinks'}
            </button>
          )}
          <select
            value={selectedShowId}
            onChange={(e) => {
              setSelectedShowId(e.target.value);
              setSelectedSeats([]);
            }}
            className="px-3 py-2 bg-cinema-surface border border-cinema-accent/60 text-xs"
          >
            {bookableShows.map((s) => (
              <option key={s.screeningId} value={s.screeningId}>
                {s.screeningId} · {formatShowDate(s.date)} ({s.startTime || 'TBA'}) —{' '}
                {getScreeningPriceRange(s).formatted}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Complimentary Drinks Drawer for Existing Bookings */}
      {compPanelOpen && canGrantExistingCompDrinks && (
        <form
          onSubmit={(e) => void handleGrantExistingCompDrinks(e)}
          className="bg-cinema-surface border border-cinema-primary p-5 space-y-4 text-xs"
        >
          <div className="flex items-start justify-between gap-4 border-b border-cinema-accent/30 pb-3">
            <div>
              <h3 className="font-display text-lg font-semibold text-cinema-primary flex items-center gap-2">
                <Gift className="w-4 h-4" />
                Provide Complimentary Drinks (₹0) to Any Guest Booking
              </h3>
              <p className="text-cinema-muted">
                Creates a ₹0 refreshment seat delivery order and appends complimentary drinks onto the guest&apos;s verified ticket.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCompPanelOpen(false)}
              className="p-1 text-cinema-muted cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {compErr && (
            <div className="bg-[#FEE2E2] border border-[#DC2626] p-2.5 text-[#991B1B] font-semibold">
              {compErr}
            </div>
          )}
          {compMsg && (
            <div className="bg-[#DCFCE7] border border-[#16A34A] p-2.5 text-[#14532D] font-semibold">
              {compMsg}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold mb-1">Select Confirmed / Active Booking</label>
              <select
                value={compBookingId}
                onChange={(e) => setCompBookingId(e.target.value)}
                className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 font-mono"
              >
                <option value="">-- Choose Guest Booking --</option>
                {activeBookings.map((b) => (
                  <option key={b.bookingId} value={b.bookingId}>
                    {b.bookingId} · {b.customerName} ({b.seatNumbers.join(', ')})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">Or Enter Booking ID Directly</label>
              <input
                type="text"
                value={compBookingId}
                onChange={(e) => setCompBookingId(e.target.value)}
                placeholder="e.g. BKG_..."
                className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {enabledMocktails.map((p) => {
              const qty = compQtyByProduct[p.productId] || 0;
              return (
                <div
                  key={p.productId}
                  className="flex items-center justify-between bg-cinema-bg border border-cinema-accent/50 px-3 py-2"
                >
                  <div>
                    <p className="font-semibold">{p.name}</p>
                    <p className="font-mono text-[11px] text-[#166534]">Complimentary ₹0</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setCompQtyByProduct((prev) => ({
                          ...prev,
                          [p.productId]: Math.max(0, (prev[p.productId] || 0) - 1),
                        }))
                      }
                      className="w-6 h-6 border border-cinema-accent font-bold cursor-pointer"
                    >
                      −
                    </button>
                    <span className="w-4 text-center font-mono font-bold">{qty}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setCompQtyByProduct((prev) => ({
                          ...prev,
                          [p.productId]: (prev[p.productId] || 0) + 1,
                        }))
                      }
                      className="w-6 h-6 bg-cinema-primary text-cinema-bg font-bold cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="block font-semibold mb-1">Complimentary Note (Optional)</label>
              <input
                type="text"
                value={compNotes}
                onChange={(e) => setCompNotes(e.target.value)}
                placeholder="e.g. VIP hospitality, birthday celebration"
                className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
              />
            </div>
            <button
              type="submit"
              disabled={compSaving}
              className="px-5 py-2.5 bg-cinema-primary text-cinema-bg font-bold uppercase tracking-[0.12em] hover:bg-cinema-primary-hover cursor-pointer disabled:opacity-50"
            >
              {compSaving ? 'Granting Drinks...' : 'Confirm Complimentary Drinks (₹0)'}
            </button>
          </div>
        </form>
      )}

      {errMsg && (
        <div className="bg-[#FEE2E2] border border-[#DC2626] p-3 text-xs font-semibold text-[#991B1B]">
          {errMsg}
        </div>
      )}

      {issuedTicket && (
        <div className="bg-cinema-surface border-2 border-[#16A34A] p-6 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          <div className="md:col-span-8 space-y-2 text-xs">
            <div className="inline-flex items-center gap-2 text-[#166534] font-bold uppercase tracking-[0.14em]">
              <CheckCircle2 className="w-4 h-4" />
              Verified Box Office Ticket Issued
            </div>
            <h3 className="font-display text-2xl font-semibold text-cinema-primary">
              {issuedTicket.customerName} — Seats: {issuedTicket.seatNumbers.join(', ')}
            </h3>
            <p className="font-mono text-cinema-text/85">
              Ticket ID: <strong>{issuedTicket.ticketId}</strong> · Booking:{' '}
              <strong>{issuedTicket.bookingId}</strong>
            </p>
            <p className="text-cinema-muted">
              {formatShowDate(issuedTicket.date)} · {formatShowTime(issuedTicket.startTime)} · Paid:{' '}
              <strong>{formatINR(issuedTicket.grandTotal)}</strong>
              {issuedTicket.discountAmount && issuedTicket.discountAmount > 0 ? (
                <span className="ml-2 text-[#166534] font-semibold">
                  (Discount -{formatINR(issuedTicket.discountAmount)})
                </span>
              ) : null}
              {issuedTicket.complimentaryDrinks ? (
                <span className="ml-2 text-[#166534] font-semibold">· Comp Drinks Included</span>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              {canPrintTickets && (
                <button
                  type="button"
                  onClick={() => setPrintTicket(issuedTicket)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-cinema-primary text-cinema-bg font-bold uppercase tracking-[0.12em] cursor-pointer hover:bg-cinema-primary-hover"
                >
                  <Printer className="w-4 h-4" />
                  Print Ticket
                </button>
              )}
              <button
                type="button"
                onClick={() => void downloadTicketPDF(issuedTicket)}
                className="inline-flex items-center gap-2 px-4 py-2 border border-cinema-primary text-cinema-primary font-bold uppercase tracking-[0.12em] cursor-pointer hover:bg-cinema-surface-alt"
              >
                <Download className="w-4 h-4" />
                Download PDF Ticket
              </button>
              <button
                type="button"
                onClick={() => setIssuedTicket(null)}
                className="px-4 py-2 border border-cinema-accent cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
          <div className="md:col-span-4 flex justify-center md:justify-end">
            <div className="p-2 border border-cinema-accent bg-white">
              <QrCodeCanvas value={issuedTicket.qrPayload} size={136} />
            </div>
          </div>
        </div>
      )}

      {!activeShow ? (
        <div className="bg-cinema-surface border border-cinema-accent/60 p-8 text-center text-sm text-cinema-muted">
          No active screenings are available for counter ticket issuance.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Live Seat Picker with Row-Wise Pricing */}
          <div className="lg:col-span-6 bg-cinema-surface border border-cinema-accent/60 p-6 space-y-5">
            <div className="text-center text-[11px] uppercase tracking-[0.25em] text-cinema-muted border-b border-cinema-accent/40 pb-2">
              Auditorium Seat Selection ({activeShow.screeningId} ·{' '}
              {getScreeningPriceRange(activeShow).formatted})
            </div>
            <div className="space-y-2.5">
              {SEAT_ROWS.map((row) => {
                const rowPrice = getSeatRowPrice(activeShow, row);
                return (
                  <div key={row} className="flex items-center gap-2.5">
                    <div className="w-12 shrink-0 text-right pr-1 font-mono leading-tight">
                      <span className="block text-xs font-bold text-cinema-text">{row}</span>
                      <span className="block text-[10px] font-semibold text-cinema-primary">
                        {formatINR(rowPrice)}
                      </span>
                    </div>
                    <div className="grid grid-cols-6 gap-2 flex-1">
                      {SEAT_COLS.map((col) => {
                        const num = `${row}${col}`;
                        const seat = seatMap.get(num);
                        if (!seat) return null;
                        const selected = selectedSeats.includes(num);
                        const holdExp = seat.holdExpiresAt ? Date.parse(seat.holdExpiresAt) : 0;
                        const isExpiredHold =
                          seat.status === 'HELD' && (!holdExp || holdExp < Date.now());
                        const isAvail = seat.status === 'AVAILABLE' || isExpiredHold;

                        let cls =
                          'bg-cinema-bg border-cinema-accent text-cinema-text hover:bg-cinema-surface-alt cursor-pointer';
                        if (selected) {
                          cls =
                            'bg-cinema-primary border-cinema-primary text-cinema-bg ring-2 ring-cinema-accent cursor-pointer';
                        } else if (seat.status === 'BOOKED') {
                          cls =
                            'bg-cinema-dark text-cinema-accent-light/70 cursor-not-allowed opacity-70';
                        } else if (seat.status === 'BLOCKED') {
                          cls =
                            'bg-[#E5E0D8] border-[#991B1B] text-[#991B1B] line-through cursor-not-allowed';
                        } else if (!isAvail) {
                          cls =
                            'bg-[#FEF3C7] border-[#D97706] text-[#92400E] cursor-not-allowed';
                        }

                        return (
                          <button
                            key={num}
                            type="button"
                            disabled={!isAvail && !selected}
                            onClick={() => toggleSeat(seat)}
                            title={`${num} — ${formatINR(rowPrice)}`}
                            className={`h-10 border font-mono text-xs font-semibold ${cls}`}
                          >
                            {num}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Walk-in Guest & Counter Settlement Form */}
          <form
            onSubmit={(e) => void handleIssueWalkIn(e)}
            className="lg:col-span-6 bg-cinema-surface border border-cinema-accent/60 p-6 space-y-4 text-xs"
          >
            <h3 className="font-display text-xl font-semibold text-cinema-primary">
              Walk-In / VIP Guest Details
            </h3>

            <div className="bg-cinema-bg border border-cinema-accent/40 p-3 flex items-center justify-between gap-2">
              <span>Selected Seats ({selectedSeats.length}):</span>
              <span className="font-mono font-bold text-cinema-primary text-right">
                {selectedSeats.length > 0
                  ? selectedSeats
                      .map((s) => `${s} (${formatINR(getSeatRowPrice(activeShow, s))})`)
                      .join(', ')
                  : 'None selected'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Guest Full Name *</label>
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Guest full name"
                  className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Mobile Number</label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="Optional contact phone"
                  className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Guest Email (Optional)</label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="Optional guest email"
                  className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Counter Settlement Mode</label>
                <select
                  value={paymentMethod}
                  onChange={(e) =>
                    setPaymentMethod(
                      e.target.value as 'COUNTER_CASH' | 'COUNTER_UPI' | 'COMPLIMENTARY_VIP'
                    )
                  }
                  className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 font-semibold"
                >
                  <option value="COUNTER_CASH">Cash at Box Office Counter</option>
                  <option value="COUNTER_UPI">UPI Paid at Counter</option>
                  <option value="COMPLIMENTARY_VIP">Complimentary VIP Pass (₹0)</option>
                </select>
              </div>
            </div>

            {enabledMocktails.length > 0 && (
              <div className="border border-cinema-accent/40 bg-cinema-bg p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-cinema-primary inline-flex items-center gap-1.5">
                    <Wine className="w-3.5 h-3.5" />
                    Optional Counter Mocktails
                  </p>
                  {canGrantDiscountsAndComps && !isComplimentary && (
                    <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-[#166534]">
                      <input
                        type="checkbox"
                        checked={complimentaryDrinks}
                        onChange={(e) => setComplimentaryDrinks(e.target.checked)}
                      />
                      <span>Complimentary Drinks (₹0)</span>
                    </label>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {enabledMocktails.map((p) => {
                    const qty = drinkQtyByProduct[p.productId] || 0;
                    return (
                      <div
                        key={p.productId}
                        className="flex items-center justify-between bg-cinema-surface border border-cinema-accent/40 px-2.5 py-1.5"
                      >
                        <div>
                          <p className="font-semibold">{p.name}</p>
                          <p className="font-mono text-[11px] text-cinema-muted">
                            {effectiveCompDrinks ? '₹0 (Complimentary)' : formatINR(p.price)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setDrinkQtyByProduct((prev) => ({
                                ...prev,
                                [p.productId]: Math.max(0, (prev[p.productId] || 0) - 1),
                              }))
                            }
                            className="w-6 h-6 border border-cinema-accent font-bold cursor-pointer"
                          >
                            −
                          </button>
                          <span className="w-4 text-center font-mono font-bold">{qty}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setDrinkQtyByProduct((prev) => ({
                                ...prev,
                                [p.productId]: (prev[p.productId] || 0) + 1,
                              }))
                            }
                            className="w-6 h-6 bg-cinema-primary text-cinema-bg font-bold cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Counter Discount Controls */}
            {canGrantDiscountsAndComps && !isComplimentary && (
              <div className="border border-cinema-accent/50 bg-cinema-bg p-3 space-y-2.5">
                <p className="font-semibold text-cinema-primary inline-flex items-center gap-1.5">
                  <Percent className="w-3.5 h-3.5" />
                  Apply Counter Discount (Optional)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as DiscountType)}
                    className="px-2.5 py-2 bg-cinema-surface border border-cinema-accent/60 font-semibold"
                  >
                    <option value="NONE">No Discount</option>
                    <option value="FLAT">Flat Discount (₹)</option>
                    <option value="PERCENT">Percentage (%)</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={discountType === 'PERCENT' ? 100 : undefined}
                    disabled={discountType === 'NONE'}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder={discountType === 'PERCENT' ? '% off (0–100)' : '₹ amount off'}
                    className="px-2.5 py-2 bg-cinema-surface border border-cinema-accent/60 font-mono disabled:opacity-50"
                  />
                  <input
                    type="text"
                    disabled={discountType === 'NONE'}
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.target.value)}
                    placeholder="Reason (e.g. Student, Senior)"
                    className="px-2.5 py-2 bg-cinema-surface border border-cinema-accent/60 disabled:opacity-50"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Receipt / UTR Reference</label>
                <input
                  type="text"
                  value={referenceCode}
                  onChange={(e) => setReferenceCode(e.target.value)}
                  placeholder="Optional receipt # or UTR"
                  className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Box Office Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Guest of director, front row"
                  className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                />
              </div>
            </div>

            <div className="border-t border-cinema-accent/30 pt-3 space-y-2">
              <div className="space-y-1 text-[11px] text-cinema-muted">
                <div className="flex justify-between">
                  <span>Seats Subtotal</span>
                  <span className="font-mono">{formatINR(ticketSubtotal)}</span>
                </div>
                {mocktailSubtotal > 0 && (
                  <div className="flex justify-between">
                    <span>Counter Mocktails</span>
                    <span className="font-mono">{formatINR(mocktailSubtotal)}</span>
                  </div>
                )}
                {discountAmount > 0 && (
                  <div className="flex justify-between text-[#166534] font-semibold">
                    <span>
                      Discount ({discountType === 'PERCENT' ? `${parsedDiscountVal}%` : 'Flat'})
                    </span>
                    <span className="font-mono">-{formatINR(discountAmount)}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-1">
                <div>
                  <span className="text-cinema-muted uppercase tracking-[0.12em]">Total Payable</span>
                  <p className="font-mono text-2xl font-bold text-cinema-primary tabular-nums">
                    {formatINR(grandTotal)}
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={issuing || selectedSeats.length === 0}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-cinema-primary text-cinema-bg font-bold uppercase tracking-[0.14em] hover:bg-cinema-primary-hover cursor-pointer disabled:opacity-50"
                >
                  <Ticket className="w-4 h-4" />
                  {issuing ? 'Issuing Ticket...' : 'Issue Verified Ticket'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      <PrintableTicketModal ticket={printTicket} onClose={() => setPrintTicket(null)} />
    </div>
  );
}

export function TicketsDirectoryPanel({
  tickets,
  screenings,
}: {
  tickets: TicketRecord[];
  screenings: ScreeningRecord[];
}) {
  const { getIdToken, hasFeature } = useAuth();
  const canOverrideTicket = hasFeature('ticketScanner');
  const canPrintTickets =
    hasFeature('printTickets') || hasFeature('boxOfficeCounter') || hasFeature('ticketScanner');

  const [search, setSearch] = useState('');
  const [showFilter, setShowFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [previewTicket, setPreviewTicket] = useState<TicketRecord | null>(null);
  const [printTicket, setPrintTicket] = useState<TicketRecord | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (showFilter !== 'ALL' && t.screeningId !== showFilter) return false;
      if (statusFilter !== 'ALL' && t.ticketStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        t.ticketId.toLowerCase().includes(q) ||
        t.bookingId.toLowerCase().includes(q) ||
        t.customerName.toLowerCase().includes(q) ||
        t.customerEmail.toLowerCase().includes(q) ||
        t.seatNumbers.join(',').toLowerCase().includes(q)
      );
    });
  }, [tickets, showFilter, statusFilter, search]);

  const handleOverride = async (ticket: TicketRecord, nextStatus: 'VALID' | 'USED') => {
    setBusyId(ticket.ticketId);
    setFeedback(null);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/admin/tickets/override-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ticketId: ticket.ticketId, nextStatus }),
      });
      const data = (await resp.json().catch(() => ({}))) as { error?: string };
      if (!resp.ok) throw new Error(data.error || 'Could not update ticket status.');
      setFeedback(`Ticket ${ticket.ticketId} updated to ${nextStatus}.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Status update failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-cinema-accent/40 pb-4">
        <h2 className="font-display text-2xl font-semibold text-cinema-primary">
          Issued Tickets Directory ({filtered.length})
        </h2>
        <p className="text-sm text-cinema-muted">
          Inspect issued QR passes, print counter tickets or PDF passes for guests, or manually check in / reset entry status.
        </p>
      </div>

      {feedback && (
        <div className="bg-cinema-surface-alt border border-cinema-accent p-3 text-xs font-semibold text-cinema-text">
          {feedback}
        </div>
      )}

      <div className="bg-cinema-surface border border-cinema-accent/60 p-4 flex flex-wrap gap-3 text-xs">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-cinema-muted absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Ticket ID, Booking ID, guest name, seat..."
            className="w-full pl-8 pr-3 py-2 bg-cinema-bg border border-cinema-accent/50"
          />
        </div>
        <select
          value={showFilter}
          onChange={(e) => setShowFilter(e.target.value)}
          className="px-3 py-2 bg-cinema-bg border border-cinema-accent/50"
        >
          <option value="ALL">All Shows</option>
          {screenings.map((s) => (
            <option key={s.screeningId} value={s.screeningId}>
              {s.screeningId} ({s.date})
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-cinema-bg border border-cinema-accent/50"
        >
          <option value="ALL">All Statuses</option>
          <option value="VALID">VALID</option>
          <option value="USED">USED (Checked In)</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>
      </div>

      <div className="bg-cinema-surface border border-cinema-accent/60 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-cinema-surface-alt border-b border-cinema-accent/40 text-cinema-primary uppercase">
            <tr>
              <th className="py-3 px-4">Ticket / Booking</th>
              <th className="py-3 px-4">Guest</th>
              <th className="py-3 px-4">Show</th>
              <th className="py-3 px-4">Seats</th>
              <th className="py-3 px-4 text-right">Amount</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cinema-accent/25">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-cinema-muted">
                  No tickets match the selected filters.
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={t.ticketId} className="hover:bg-cinema-bg/70">
                  <td className="py-3 px-4 font-mono">
                    <p className="font-semibold text-cinema-primary">{t.ticketId}</p>
                    <p className="text-[11px] text-cinema-muted">{t.bookingId}</p>
                  </td>
                  <td className="py-3 px-4">
                    <p className="font-semibold">{t.customerName}</p>
                    <p className="text-[11px] text-cinema-muted">{t.customerEmail}</p>
                    {t.complimentaryDrinks && (
                      <span className="text-[10px] font-semibold text-[#166534] block">
                        Comp Drinks
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <p className="font-mono">{t.screeningId}</p>
                    <p className="text-[11px] text-cinema-muted">
                      {t.date} · {t.startTime || 'TBA'}
                    </p>
                  </td>
                  <td className="py-3 px-4 font-mono font-semibold">{t.seatNumbers.join(', ')}</td>
                  <td className="py-3 px-4 text-right font-mono font-bold tabular-nums">
                    <span>{formatINR(t.grandTotal)}</span>
                    {t.discountAmount && t.discountAmount > 0 ? (
                      <span className="block text-[10px] text-[#166534] font-normal">
                        -{formatINR(t.discountAmount)} off
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3 px-4 font-mono font-semibold">
                    <span
                      className={
                        t.ticketStatus === 'VALID'
                          ? 'text-[#166534]'
                          : t.ticketStatus === 'USED'
                          ? 'text-[#1D4ED8]'
                          : 'text-[#991B1B]'
                      }
                    >
                      {t.ticketStatus}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPreviewTicket(t)}
                        className="px-2.5 py-1.5 border border-cinema-accent/60 hover:bg-cinema-surface-alt inline-flex items-center gap-1 cursor-pointer"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        QR
                      </button>
                      {canPrintTickets && (
                        <button
                          type="button"
                          onClick={() => setPrintTicket(t)}
                          className="px-2.5 py-1.5 border border-cinema-primary text-cinema-primary hover:bg-cinema-surface-alt inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Print
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void downloadTicketPDF(t)}
                        className="px-2.5 py-1.5 border border-cinema-accent/60 hover:bg-cinema-surface-alt inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        PDF
                      </button>
                      {canOverrideTicket && t.ticketStatus === 'VALID' && (
                        <button
                          type="button"
                          disabled={busyId === t.ticketId}
                          onClick={() => void handleOverride(t, 'USED')}
                          className="px-2.5 py-1.5 bg-[#166534] text-white font-semibold hover:bg-[#14532D] inline-flex items-center gap-1 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Check In
                        </button>
                      )}
                      {canOverrideTicket && t.ticketStatus === 'USED' && (
                        <button
                          type="button"
                          disabled={busyId === t.ticketId}
                          onClick={() => void handleOverride(t, 'VALID')}
                          className="px-2.5 py-1.5 border border-cinema-accent text-cinema-primary hover:bg-cinema-surface-alt inline-flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reset
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {previewTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-cinema-dark-deep/80 no-print">
          <div className="w-full max-w-sm bg-cinema-surface border border-cinema-accent p-6 space-y-4 text-center shadow-2xl">
            <div className="flex items-center justify-between border-b border-cinema-accent/30 pb-2">
              <span className="font-mono text-xs font-bold text-cinema-primary">
                {previewTicket.ticketId}
              </span>
              <button
                type="button"
                onClick={() => setPreviewTicket(null)}
                className="p-1 text-cinema-muted cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <h3 className="font-display text-xl font-semibold text-cinema-primary">
                {previewTicket.customerName}
              </h3>
              <p className="text-xs text-cinema-muted">
                {formatShowDate(previewTicket.date)} · {formatShowTime(previewTicket.startTime)}
              </p>
              <p className="font-mono text-xs font-bold mt-1">
                Seats: {previewTicket.seatNumbers.join(', ')}
              </p>
            </div>
            <div className="inline-block p-2 border border-cinema-accent bg-white">
              <QrCodeCanvas value={previewTicket.qrPayload} size={180} />
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {canPrintTickets && (
                <button
                  type="button"
                  onClick={() => {
                    const target = previewTicket;
                    setPreviewTicket(null);
                    setPrintTicket(target);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-cinema-primary text-cinema-bg text-xs font-bold uppercase tracking-[0.12em] cursor-pointer hover:bg-cinema-primary-hover"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Ticket
                </button>
              )}
              <button
                type="button"
                onClick={() => void downloadTicketPDF(previewTicket)}
                className="inline-flex items-center gap-1.5 px-4 py-2 border border-cinema-primary text-cinema-primary text-xs font-bold uppercase tracking-[0.12em] cursor-pointer hover:bg-cinema-surface-alt"
              >
                <Download className="w-3.5 h-3.5" />
                PDF
              </button>
              <button
                type="button"
                onClick={() => setPreviewTicket(null)}
                className="px-4 py-2 border border-cinema-accent text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <PrintableTicketModal ticket={printTicket} onClose={() => setPrintTicket(null)} />
    </div>
  );
}
