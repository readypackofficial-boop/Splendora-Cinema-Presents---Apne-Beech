import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Film,
  Mail,
  MapPin,
  Phone,
  Play,
  ShieldCheck,
  Ticket,
  User,
  Wine,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCinemaPublicData, useScreeningSeats } from '../hooks/useCinemaPublicData';
import {
  DEFAULT_POSTER_URL,
  DEFAULT_TICKET_PRICE,
  HERO_BACKDROP_URL,
  SEAT_COLS,
  SEAT_ROWS,
  formatINR,
  formatShowDate,
  formatShowTime,
  getEmbedTrailerUrl,
  getScreeningPriceRange,
  getSeatRowPrice,
} from '../lib/defaults';
import type {
  MocktailCartItem,
  SeatDrinkAssignment,
  SeatRecord,
} from '../types/cinema';
import { MocktailPopup } from './MocktailPopup';
import { MyTicketsModal } from './MyTicketsModal';
import { Navbar } from './Navbar';

type BookingStep = 'SELECT_SEATS' | 'ASSIGN_MOCKTAILS' | 'CHECKOUT' | 'SUBMITTED';

export function CustomerHome() {
  const { user, signInWithGoogle, signingIn, getIdToken } = useAuth();
  const { movie, castMembers, screenings, mocktails, websiteSettings, paymentSettings } =
    useCinemaPublicData();

  const bookingSectionRef = useRef<HTMLElement | null>(null);
  const [myTicketsOpen, setMyTicketsOpen] = useState(false);

  // Published & open shows only on customer website
  const openScreenings = useMemo(
    () => screenings.filter((s) => s.isPublished && s.salesStatus === 'OPEN'),
    [screenings]
  );

  const uniqueDates = useMemo(
    () => Array.from(new Set(openScreenings.map((s) => s.date))).sort(),
    [openScreenings]
  );

  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedScreeningId, setSelectedScreeningId] = useState<string>('');

  // Keep selected date & show synchronized with live Firestore updates
  useEffect(() => {
    if (uniqueDates.length === 0) {
      setSelectedDate('');
      setSelectedScreeningId('');
      return;
    }
    const activeDate = uniqueDates.includes(selectedDate) ? selectedDate : uniqueDates[0];
    if (activeDate !== selectedDate) setSelectedDate(activeDate);

    const showsForDate = openScreenings.filter((s) => s.date === activeDate);
    if (showsForDate.length > 0 && !showsForDate.some((s) => s.screeningId === selectedScreeningId)) {
      setSelectedScreeningId(showsForDate[0].screeningId);
      setSelectedSeats([]);
      setStep('SELECT_SEATS');
      setMocktailChoiceMade(false);
    }
  }, [uniqueDates, openScreenings, selectedDate, selectedScreeningId]);

  const showsOnSelectedDate = useMemo(
    () => openScreenings.filter((s) => s.date === selectedDate),
    [openScreenings, selectedDate]
  );

  const activeScreening = useMemo(
    () => openScreenings.find((s) => s.screeningId === selectedScreeningId) || null,
    [openScreenings, selectedScreeningId]
  );

  const { seats } = useScreeningSeats(activeScreening?.screeningId || null);

  // Booking flow state
  const [step, setStep] = useState<BookingStep>('SELECT_SEATS');
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [mocktailPopupOpen, setMocktailPopupOpen] = useState(false);
  const [mocktailChoiceMade, setMocktailChoiceMade] = useState(false);
  const [mocktailCart, setMocktailCart] = useState<MocktailCartItem[]>([]);
  const [seatAssignments, setSeatAssignments] = useState<SeatDrinkAssignment[]>([]);

  // Checkout state
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [upiRef, setUpiRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [submittedBookingId, setSubmittedBookingId] = useState<string | null>(null);
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [posterError, setPosterError] = useState(false);

  useEffect(() => {
    if (user?.displayName && !customerName) {
      setCustomerName(user.displayName);
    }
  }, [user, customerName]);

  const scrollToBooking = () => {
    bookingSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const seatMap = useMemo(() => {
    const m = new Map<string, SeatRecord>();
    for (const s of seats) m.set(s.seatNumber, s);
    return m;
  }, [seats]);

  const isSeatHeldActive = (seat?: SeatRecord): boolean => {
    if (!seat) return false;
    if (seat.status === 'RESERVED') return true;
    if (seat.status !== 'HELD') return false;
    if (seat.heldByUid && user && seat.heldByUid === user.uid) return false;
    if (!seat.holdExpiresAt) return true;
    return Date.parse(seat.holdExpiresAt) > Date.now();
  };

  const toggleSeat = (seatNum: string) => {
    const seat = seatMap.get(seatNum);
    if (!seat) return;
    if (seat.status === 'BOOKED' || seat.status === 'BLOCKED' || isSeatHeldActive(seat)) {
      return;
    }
    setBookingError(null);
    setSelectedSeats((prev) =>
      prev.includes(seatNum) ? prev.filter((s) => s !== seatNum) : [...prev, seatNum].sort()
    );
  };

  const handleContinueFromSeats = () => {
    if (selectedSeats.length === 0) {
      setBookingError('Please select at least one seat to continue.');
      return;
    }
    setBookingError(null);
    const enabledMocktails = mocktails.filter((m) => m.enabled);
    if (!mocktailChoiceMade && enabledMocktails.length > 0) {
      setMocktailPopupOpen(true);
    } else if (mocktailCart.length > 0) {
      setStep('ASSIGN_MOCKTAILS');
    } else {
      setStep('CHECKOUT');
    }
  };

  const buildInitialAssignments = (items: MocktailCartItem[], seatsList: string[]) => {
    const next: SeatDrinkAssignment[] = [];
    if (seatsList.length === 0) return next;
    let idx = 0;
    for (const item of items) {
      for (let i = 0; i < item.quantity; i++) {
        const seatNumber = seatsList[idx % seatsList.length];
        idx += 1;
        const existing = next.find(
          (a) => a.seatNumber === seatNumber && a.productId === item.productId
        );
        if (existing) {
          existing.quantity += 1;
        } else {
          next.push({
            seatNumber,
            productId: item.productId,
            productName: item.productName,
            quantity: 1,
            unitPrice: item.price,
          });
        }
      }
    }
    return next;
  };

  const handleAddMocktails = (items: MocktailCartItem[]) => {
    setMocktailChoiceMade(true);
    setMocktailPopupOpen(false);
    setMocktailCart(items);
    setSeatAssignments(buildInitialAssignments(items, selectedSeats));
    setStep('ASSIGN_MOCKTAILS');
  };

  const handleSkipMocktails = () => {
    setMocktailChoiceMade(true);
    setMocktailPopupOpen(false);
    setMocktailCart([]);
    setSeatAssignments([]);
    setStep('CHECKOUT');
  };

  const handleAssignmentChange = (seatNumber: string, productId: string, delta: number) => {
    const prod = mocktails.find((m) => m.productId === productId);
    if (!prod) return;
    setSeatAssignments((prev) => {
      const next = prev.map((a) => ({ ...a }));
      const idx = next.findIndex((a) => a.seatNumber === seatNumber && a.productId === productId);
      if (idx >= 0) {
        const newQty = Math.max(0, next[idx].quantity + delta);
        if (newQty === 0) {
          next.splice(idx, 1);
        } else {
          next[idx].quantity = newQty;
        }
      } else if (delta > 0) {
        next.push({
          seatNumber,
          productId,
          productName: prod.name,
          quantity: delta,
          unitPrice: prod.price,
        });
      }
      return next;
    });
  };

  const activePriceRange = getScreeningPriceRange(activeScreening);
  const ticketSubtotal = useMemo(
    () => selectedSeats.reduce((sum, seatNum) => sum + getSeatRowPrice(activeScreening, seatNum), 0),
    [selectedSeats, activeScreening]
  );
  const mocktailSubtotal = useMemo(() => {
    if (step === 'SELECT_SEATS') {
      return mocktailCart.reduce((sum, i) => sum + i.price * i.quantity, 0);
    }
    return seatAssignments.reduce((sum, a) => sum + a.unitPrice * a.quantity, 0);
  }, [step, mocktailCart, seatAssignments]);
  const grandTotal = ticketSubtotal + mocktailSubtotal;

  const handlePlaceBookingAndHold = async () => {
    setBookingError(null);
    if (!activeScreening) return;
    if (!user) {
      await signInWithGoogle();
      return;
    }
    if (!customerName.trim()) {
      setBookingError('Please enter your full name.');
      return;
    }
    if (!customerPhone.trim() || customerPhone.trim().length < 7) {
      setBookingError('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!paymentSettings.isConfigured || paymentSettings.mode === 'UNCONFIGURED') {
      setBookingError(
        'Payment settings are not configured yet by cinema administration. Please check back once UPI or payment gateway is enabled.'
      );
      return;
    }
    if (paymentSettings.mode === 'MANUAL_UPI' && upiRef.trim().length < 4) {
      setBookingError('Please complete the UPI transfer and enter your UPI Transaction Reference / UTR number.');
      return;
    }

    setSubmitting(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication token unavailable. Please sign in again.');

      // 1. Place atomic hold check
      const holdResp = await fetch('/api/bookings/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          screeningId: activeScreening.screeningId,
          seatNumbers: selectedSeats,
        }),
      });
      if (!holdResp.ok) {
        const err = (await holdResp.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Selected seats are no longer available.');
      }

      // 2. Create server-validated booking + payment + mocktail assignments
      const createResp = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          screeningId: activeScreening.screeningId,
          seatNumbers: selectedSeats,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          mocktailAssignments: seatAssignments.map((a) => ({
            seatNumber: a.seatNumber,
            productId: a.productId,
            quantity: a.quantity,
          })),
          upiTransactionRef: upiRef.trim(),
          paymentMethod: paymentSettings.mode,
        }),
      });

      const createData = (await createResp.json().catch(() => ({}))) as {
        bookingId?: string;
        error?: string;
      };
      if (!createResp.ok || !createData.bookingId) {
        throw new Error(createData.error || 'Could not complete booking.');
      }

      setSubmittedBookingId(createData.bookingId);
      setStep('SUBMITTED');
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : 'Booking submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetBookingFlow = () => {
    setSelectedSeats([]);
    setMocktailCart([]);
    setSeatAssignments([]);
    setMocktailChoiceMade(false);
    setUpiRef('');
    setSubmittedBookingId(null);
    setBookingError(null);
    setStep('SELECT_SEATS');
  };

  const trailer = getEmbedTrailerUrl(movie.trailerUrl);
  const posterSrc = activeScreening?.posterUrl || movie.posterUrl || DEFAULT_POSTER_URL;

  useEffect(() => {
    setPosterError(false);
  }, [posterSrc]);

  const movieFacts = [
    movie.language && { label: 'Language', value: movie.language },
    movie.genre && { label: 'Genre', value: movie.genre },
    movie.duration && { label: 'Duration', value: movie.duration },
    movie.certificate && { label: 'Certification', value: movie.certificate },
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <div id="top" className="min-h-screen bg-cinema-bg text-cinema-text flex flex-col">
      <Navbar
        cinemaName={websiteSettings.cinemaName}
        logoUrl={websiteSettings.logoUrl}
        onBookClick={scrollToBooking}
        onMyTicketsClick={() => setMyTicketsOpen(true)}
      />

      {websiteSettings.announcementText?.trim() && (
        <div className="bg-cinema-primary text-cinema-accent-light border-b border-cinema-accent/45 py-2 px-4 text-center text-xs font-medium tracking-[0.14em] uppercase">
          {websiteSettings.announcementText}
        </div>
      )}

      {/* HERO SECTION */}
      <section
        id="featured-film"
        className="relative bg-cinema-dark-deep text-cinema-bg overflow-hidden border-b border-cinema-accent/40"
      >
        <div className="absolute inset-0">
          <img
            src={websiteSettings.heroBannerUrl?.trim() || HERO_BACKDROP_URL}
            alt="Splendora Cinema Grand Auditorium"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover opacity-35"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-cinema-dark-deep via-cinema-dark/85 to-cinema-dark-deep/70" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-8 py-14 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Poster Frame */}
            <div className="lg:col-span-5 flex justify-center lg:justify-start">
              <div className="w-full max-w-[340px] sm:max-w-[380px] aspect-[3/4] bg-cinema-dark border border-cinema-accent/70 p-2 shadow-2xl">
                <div className="w-full h-full border border-cinema-accent/30 overflow-hidden relative bg-cinema-dark-deep">
                  {!posterError && posterSrc ? (
                    <img
                      src={posterSrc}
                      alt={`${movie.title} Official Poster`}
                      referrerPolicy="no-referrer"
                      onError={() => setPosterError(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-cinema-primary-hover to-cinema-dark-deep">
                      <Film className="w-10 h-10 text-cinema-accent-light mb-3" />
                      <p className="font-display text-2xl text-cinema-accent-light tracking-wider">
                        {movie.title}
                      </p>
                      <p className="text-xs text-cinema-accent-light/80 mt-2">Poster awaiting upload</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Film Presentation */}
            <div className="lg:col-span-7 space-y-6">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.26em] text-cinema-accent-light">
                  {movie.releaseNote || 'Now Showing · Exclusive Engagement'}
                </p>
                <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-cinema-surface leading-[1.08] [text-wrap:balance]">
                  {movie.title || 'APNE BEECH'}
                </h1>
              </div>

              {/* Unboxed Metadata Typography */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-cinema-accent-light">
                {movieFacts.length > 0 ? (
                  movieFacts.map((item, idx) => (
                    <span key={item.label} className="inline-flex items-center gap-3">
                      {idx > 0 && <span aria-hidden="true" className="text-cinema-accent/50">·</span>}
                      <span>
                        <span className="text-cinema-accent-light/75">{item.label}:</span> {item.value}
                      </span>
                    </span>
                  ))
                ) : (
                  <span className="text-cinema-accent-light/85">
                    Language, genre, and runtime details will be updated shortly by cinema administration.
                  </span>
                )}
              </div>

              <div className="border-t border-b border-cinema-accent/30 py-5 space-y-3">
                <p className="text-base text-cinema-bg/90 leading-relaxed max-w-2xl">
                  {movie.description?.trim()
                    ? movie.description
                    : 'Synopsis and cast credits for APNE BEECH are awaiting official release notes from Splendora Cinema administration.'}
                </p>
                {movie.castAndCrew?.trim() && (
                  <p className="text-xs text-cinema-accent-light/85">
                    <span className="uppercase tracking-[0.14em] text-cinema-accent mr-2">Credits:</span>
                    {movie.castAndCrew}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                <button
                  type="button"
                  onClick={scrollToBooking}
                  className="px-8 py-4 bg-cinema-accent text-cinema-dark text-xs sm:text-sm font-bold uppercase tracking-[0.16em] hover:bg-cinema-accent-light transition-colors cursor-pointer whitespace-nowrap"
                >
                  Book Tickets
                </button>
                <a
                  href="#trailer"
                  className="inline-flex items-center gap-2 px-6 py-4 border border-cinema-accent/60 text-cinema-bg text-xs sm:text-sm font-semibold uppercase tracking-[0.14em] hover:bg-cinema-primary-hover/60 transition-colors whitespace-nowrap"
                >
                  <Play className="w-4 h-4 text-cinema-accent-light" />
                  Watch Trailer
                </a>
                <button
                  type="button"
                  onClick={() => setMyTicketsOpen(true)}
                  className="inline-flex items-center gap-2 px-5 py-4 text-cinema-accent-light text-xs sm:text-sm font-medium hover:underline cursor-pointer whitespace-nowrap"
                >
                  <Ticket className="w-4 h-4" />
                  My Digital Tickets
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* MAIN CAST & CREW SECTION */}
      <section id="cast" className="bg-cinema-bg py-14 border-b border-cinema-accent/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-cinema-accent/35 pb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-cinema-muted">
                Featured Ensemble
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-semibold text-cinema-primary mt-1">
                {movie.title || 'APNE BEECH'} — Main Cast & Credits
              </h2>
            </div>
            <p className="text-xs text-cinema-muted">
              Official principal cast & creative credits
            </p>
          </div>

          {castMembers.length === 0 ? (
            <div className="bg-cinema-surface border border-cinema-accent/50 p-8 text-center space-y-2">
              <p className="font-display text-lg text-cinema-primary">
                Cast & Portraits To Be Announced
              </p>
              <p className="text-xs text-cinema-muted max-w-md mx-auto">
                Main cast names and portrait photographs for {movie.title || 'APNE BEECH'} will appear here once added by Splendora Cinema administration.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5 sm:gap-6">
              {castMembers.map((member) => (
                <article
                  key={member.castId}
                  className="bg-cinema-surface border border-cinema-accent/60 flex flex-col overflow-hidden"
                >
                  <div className="aspect-[3/4] bg-cinema-dark-deep border-b border-cinema-accent/35 overflow-hidden relative">
                    {member.photoUrl ? (
                      <img
                        src={member.photoUrl}
                        alt={member.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover object-top"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-cinema-primary-hover to-cinema-dark-deep text-cinema-accent-light/80">
                        <User className="w-9 h-9 mb-1.5" />
                        <span className="text-[10px] uppercase tracking-[0.16em]">Portrait Pending</span>
                      </div>
                    )}
                  </div>
                  <div className="p-3.5 text-center space-y-0.5">
                    <h3 className="font-display text-base font-semibold text-cinema-primary leading-snug">
                      {member.name}
                    </h3>
                    {member.role && (
                      <p className="text-xs text-cinema-muted">{member.role}</p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* TRAILER SECTION */}
      <section id="trailer" className="bg-cinema-dark text-cinema-bg py-14 border-b border-cinema-accent/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-cinema-accent-light">Official Preview</p>
              <h2 className="font-display text-2xl sm:text-3xl font-semibold text-cinema-surface mt-1">
                {movie.title} — Theatrical Trailer
              </h2>
            </div>
            <p className="text-xs text-cinema-accent-light/80">Presented in Splendora Auditorium Projection</p>
          </div>

          <div className="aspect-video w-full bg-cinema-dark-deep border border-cinema-accent/50 overflow-hidden flex items-center justify-center">
            {trailer.type === 'youtube' ? (
              <iframe
                src={trailer.src}
                title={`${movie.title} Trailer`}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : trailer.type === 'video' ? (
              <video src={trailer.src} controls className="w-full h-full object-contain bg-black" />
            ) : (
              <div className="text-center px-6 py-12 max-w-md space-y-3">
                <div className="w-14 h-14 mx-auto border border-cinema-accent/50 flex items-center justify-center text-cinema-accent-light">
                  <Play className="w-6 h-6" />
                </div>
                <h3 className="font-display text-xl text-cinema-surface">Trailer To Be Added</h3>
                <p className="text-sm text-cinema-accent-light/75 leading-relaxed">
                  The official theatrical trailer for {movie.title} has not been uploaded yet. Administrators can attach a trailer URL or video from Movie Management.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* INTERACTIVE BOOKING ENGINE */}
      <section id="booking" ref={bookingSectionRef} className="py-16 bg-cinema-bg flex-1">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 space-y-10">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <p className="text-xs uppercase tracking-[0.24em] text-cinema-muted">
              Box Office Reservations
            </p>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold text-cinema-primary">
              Reserve Your Seats for {movie.title}
            </h2>
            <p className="text-sm text-cinema-text/85">
              Select your preferred screening date, showtime, and seats in our 36-seat royal auditorium.
            </p>
          </div>

          {openScreenings.length === 0 ? (
            <div className="bg-cinema-surface border border-cinema-accent/60 p-10 text-center space-y-2">
              <p className="font-display text-xl text-cinema-primary">No Open Screenings Published</p>
              <p className="text-sm text-cinema-muted">
                All upcoming showtimes are currently closed or awaiting publication by administration.
              </p>
            </div>
          ) : (
            <>
              {/* Step 1: Date & Showtime Bar */}
              <div className="bg-cinema-surface border border-cinema-accent/60 p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Dates */}
                  <div>
                    <label className="block text-xs uppercase tracking-[0.16em] text-cinema-muted font-semibold mb-3">
                      01. Choose Screening Date
                    </label>
                    <div className="flex flex-wrap gap-2.5">
                      {uniqueDates.map((d) => {
                        const active = d === selectedDate;
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => {
                              setSelectedDate(d);
                              const firstShow = openScreenings.find((s) => s.date === d);
                              if (firstShow) setSelectedScreeningId(firstShow.screeningId);
                              setSelectedSeats([]);
                              setStep('SELECT_SEATS');
                              setMocktailChoiceMade(false);
                            }}
                            className={`px-4 py-3 text-left border transition-colors cursor-pointer ${
                              active
                                ? 'bg-cinema-primary border-cinema-primary text-cinema-bg'
                                : 'bg-cinema-bg border-cinema-accent/50 text-cinema-text hover:border-cinema-primary'
                            }`}
                          >
                            <span className="flex items-center gap-2 text-xs font-semibold">
                              <Calendar className="w-3.5 h-3.5" />
                              {formatShowDate(d)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Shows for Selected Date */}
                  <div>
                    <label className="block text-xs uppercase tracking-[0.16em] text-cinema-muted font-semibold mb-3">
                      02. Choose Showtime ({showsOnSelectedDate.length} available)
                    </label>
                    <div className="flex flex-wrap gap-2.5">
                      {showsOnSelectedDate.map((show) => {
                        const active = show.screeningId === activeScreening?.screeningId;
                        const remaining = Math.max(0, show.seatCapacity - (show.bookedCount || 0));
                        return (
                          <button
                            key={show.screeningId}
                            type="button"
                            onClick={() => {
                              setSelectedScreeningId(show.screeningId);
                              setSelectedSeats([]);
                              setStep('SELECT_SEATS');
                              setMocktailChoiceMade(false);
                            }}
                            className={`px-4 py-2.5 text-left border transition-colors cursor-pointer min-w-[190px] ${
                              active
                                ? 'bg-cinema-primary border-cinema-primary text-cinema-bg'
                                : 'bg-cinema-bg border-cinema-accent/50 text-cinema-text hover:border-cinema-primary'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="flex items-center gap-1.5 text-xs font-semibold">
                                <Clock className="w-3.5 h-3.5" />
                                {formatShowTime(show.startTime, show.endTime)}
                              </span>
                              <span className="font-mono text-xs font-bold tabular-nums">
                                {getScreeningPriceRange(show).formatted}
                              </span>
                            </div>
                            <p
                              className={`text-[11px] mt-1 font-mono tabular-nums ${
                                active ? 'text-cinema-accent-light' : 'text-cinema-muted'
                              }`}
                            >
                              {show.screeningId} · {remaining}/{show.seatCapacity} seats
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Booking Progress Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-cinema-accent/40 pb-3 text-xs">
                <div className="flex flex-wrap items-center gap-5">
                  <button
                    type="button"
                    onClick={() => step !== 'SUBMITTED' && setStep('SELECT_SEATS')}
                    className={`font-semibold uppercase tracking-[0.14em] cursor-pointer ${
                      step === 'SELECT_SEATS' ? 'text-cinema-primary underline underline-offset-8' : 'text-cinema-muted'
                    }`}
                  >
                    1. Seat Selection
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      selectedSeats.length > 0 && step !== 'SUBMITTED' && setStep('ASSIGN_MOCKTAILS')
                    }
                    disabled={selectedSeats.length === 0}
                    className={`font-semibold uppercase tracking-[0.14em] cursor-pointer disabled:opacity-40 ${
                      step === 'ASSIGN_MOCKTAILS' ? 'text-cinema-primary underline underline-offset-8' : 'text-cinema-muted'
                    }`}
                  >
                    2. Seat-Wise Mocktails
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      selectedSeats.length > 0 && step !== 'SUBMITTED' && setStep('CHECKOUT')
                    }
                    disabled={selectedSeats.length === 0}
                    className={`font-semibold uppercase tracking-[0.14em] cursor-pointer disabled:opacity-40 ${
                      step === 'CHECKOUT' || step === 'SUBMITTED'
                        ? 'text-cinema-primary underline underline-offset-8'
                        : 'text-cinema-muted'
                    }`}
                  >
                    3. Review & Payment
                  </button>
                </div>

                {activeScreening && (
                  <p className="font-mono text-xs text-cinema-muted">
                    Row Pricing:{' '}
                    <strong className="text-cinema-primary">{activePriceRange.formatted}</strong> / seat
                  </p>
                )}
              </div>

              {bookingError && (
                <div className="bg-[#FEE2E2] border border-[#DC2626]/40 px-4 py-3 text-sm text-[#991B1B] flex items-start gap-2.5">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span>{bookingError}</span>
                </div>
              )}

              {/* STEP: SEAT SELECTION */}
              {step === 'SELECT_SEATS' && activeScreening && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  {/* 6x6 Auditorium Map */}
                  <div className="lg:col-span-8 bg-cinema-surface border border-cinema-accent/60 p-6 sm:p-8 space-y-8">
                    {/* Screen Indicator */}
                    <div className="text-center space-y-2">
                      <div className="mx-auto max-w-md h-2 bg-gradient-to-r from-transparent via-cinema-accent to-transparent" />
                      <p className="text-[11px] uppercase tracking-[0.3em] text-cinema-muted font-semibold">
                        Cinema Screen This Way
                      </p>
                    </div>

                    {/* 6x6 Grid */}
                    <div className="overflow-x-auto">
                      <div className="min-w-[340px] max-w-md mx-auto space-y-3">
                        {SEAT_ROWS.map((row) => {
                          const rowPrice = getSeatRowPrice(activeScreening, row);
                          return (
                          <div key={row} className="flex items-center justify-center gap-2 sm:gap-3">
                            <div className="w-12 shrink-0 text-right pr-1 font-mono leading-tight">
                              <span className="block text-xs font-bold text-cinema-text">{row}</span>
                              <span className="block text-[10px] font-semibold text-cinema-primary">
                                {formatINR(rowPrice)}
                              </span>
                            </div>
                            <div className="grid grid-cols-6 gap-2 sm:gap-3 flex-1">
                              {SEAT_COLS.map((col) => {
                                const seatNum = `${row}${col}`;
                                const seat = seatMap.get(seatNum);
                                const isSelected = selectedSeats.includes(seatNum);
                                const isBooked = seat?.status === 'BOOKED';
                                const isBlocked = seat?.status === 'BLOCKED';
                                const isHeld = isSeatHeldActive(seat);
                                const disabled = isBooked || isBlocked || isHeld;

                                let btnClass =
                                  'bg-cinema-bg border-cinema-accent/70 text-cinema-text hover:border-cinema-primary hover:bg-cinema-surface-alt';
                                if (isSelected) {
                                  btnClass =
                                    'bg-cinema-primary border-cinema-primary text-cinema-bg ring-2 ring-cinema-accent';
                                } else if (isBooked) {
                                  btnClass =
                                    'bg-cinema-dark border-cinema-dark text-cinema-accent-light/70 cursor-not-allowed opacity-70';
                                } else if (isHeld) {
                                  btnClass =
                                    'bg-[#FEF3C7] border-[#D97706] text-[#92400E] cursor-not-allowed';
                                } else if (isBlocked) {
                                  btnClass =
                                    'bg-[#E5E0D8] border-[#A89F91] text-[#78716C] cursor-not-allowed line-through';
                                }

                                return (
                                  <button
                                    key={seatNum}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => toggleSeat(seatNum)}
                                    title={
                                      isBooked
                                        ? `${seatNum} — Booked`
                                        : isBlocked
                                        ? `${seatNum} — Blocked by Admin`
                                        : isHeld
                                        ? `${seatNum} — Temporarily Reserved`
                                        : `${seatNum} — Available (${formatINR(rowPrice)})`
                                    }
                                    className={`h-11 sm:h-12 border font-mono text-xs font-semibold transition-colors flex items-center justify-center ${
                                      disabled ? '' : 'cursor-pointer'
                                    } ${btnClass}`}
                                  >
                                    {seatNum}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Legend */}
                    <div className="pt-4 border-t border-cinema-accent/30 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-cinema-text/85">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-4 h-4 bg-cinema-bg border border-cinema-accent" />
                        Available
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span className="w-4 h-4 bg-cinema-primary border border-cinema-accent" />
                        Selected
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span className="w-4 h-4 bg-[#FEF3C7] border border-[#D97706]" />
                        Temporarily Reserved
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span className="w-4 h-4 bg-cinema-dark" />
                        Booked
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span className="w-4 h-4 bg-[#E5E0D8] border border-[#A89F91]" />
                        Blocked by Admin
                      </span>
                    </div>
                  </div>

                  {/* Selection Summary Card */}
                  <div className="lg:col-span-4 bg-cinema-surface border border-cinema-accent/60 p-6 space-y-5">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-cinema-muted">Your Selection</p>
                      <h3 className="font-display text-2xl font-semibold text-cinema-primary mt-1">
                        {activeScreening.movieTitle}
                      </h3>
                      <p className="text-xs text-cinema-text/85 mt-1">
                        {formatShowDate(activeScreening.date)} · {formatShowTime(activeScreening.startTime, activeScreening.endTime)}
                      </p>
                    </div>

                    <div className="border-t border-b border-cinema-accent/30 py-4 space-y-2.5 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="text-cinema-muted">Selected Seats</span>
                        <span className="font-mono font-semibold text-cinema-text text-right">
                          {selectedSeats.length > 0
                            ? selectedSeats
                                .map((s) => `${s} (${formatINR(getSeatRowPrice(activeScreening, s))})`)
                                .join(', ')
                            : 'None'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-cinema-muted">Seat Count</span>
                        <span className="font-mono font-semibold tabular-nums">{selectedSeats.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-cinema-muted">Row Rates</span>
                        <span className="font-mono tabular-nums">{activePriceRange.formatted}</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-cinema-accent/20 text-base font-bold text-cinema-primary">
                        <span>Ticket Total</span>
                        <span className="font-mono tabular-nums">{formatINR(ticketSubtotal)}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleContinueFromSeats}
                      className="w-full py-3.5 px-5 bg-cinema-primary text-cinema-bg text-xs font-bold uppercase tracking-[0.14em] hover:bg-cinema-primary-hover transition-colors cursor-pointer"
                    >
                      Continue Booking
                    </button>
                  </div>
                </div>
              )}

              {/* STEP: SEAT-WISE MOCKTAIL ASSIGNMENT */}
              {step === 'ASSIGN_MOCKTAILS' && activeScreening && (
                <div className="bg-cinema-surface border border-cinema-accent/60 p-6 sm:p-8 space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cinema-accent/30 pb-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-cinema-muted">
                        Seat-Wise Refreshment Delivery
                      </p>
                      <h3 className="font-display text-2xl font-semibold text-cinema-primary mt-1">
                        Assign Mocktails to Your Seats
                      </h3>
                      <p className="text-sm text-cinema-text/85 mt-1">
                        Deliver the ordered mocktails directly to the assigned customer seats when the movie starts.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMocktailPopupOpen(true)}
                      className="px-4 py-2 border border-cinema-accent text-xs font-semibold uppercase tracking-[0.1em] text-cinema-primary hover:bg-cinema-bg cursor-pointer whitespace-nowrap"
                    >
                      Edit Drink Menu
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedSeats.map((seatNum) => (
                      <div
                        key={seatNum}
                        className="border border-cinema-accent/40 bg-cinema-bg p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between border-b border-cinema-accent/25 pb-2">
                          <span className="font-mono text-sm font-bold text-cinema-primary">
                            Seat {seatNum}
                          </span>
                          <Wine className="w-4 h-4 text-cinema-accent" />
                        </div>
                        {mocktails
                          .filter((m) => m.enabled)
                          .map((prod) => {
                            const existing = seatAssignments.find(
                              (a) => a.seatNumber === seatNum && a.productId === prod.productId
                            );
                            const qty = existing?.quantity || 0;
                            return (
                              <div
                                key={prod.productId}
                                className="flex items-center justify-between gap-2 text-xs"
                              >
                                <div>
                                  <p className="font-semibold text-cinema-text">{prod.name}</p>
                                  <p className="text-cinema-muted font-mono tabular-nums">
                                    {formatINR(prod.price)}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleAssignmentChange(seatNum, prod.productId, -1)
                                    }
                                    className="w-8 h-8 border border-cinema-accent/60 bg-cinema-surface font-bold hover:bg-cinema-surface-alt cursor-pointer"
                                  >
                                    −
                                  </button>
                                  <span className="w-5 text-center font-mono font-bold tabular-nums">
                                    {qty}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleAssignmentChange(seatNum, prod.productId, 1)
                                    }
                                    className="w-8 h-8 bg-cinema-primary text-cinema-bg font-bold hover:bg-cinema-primary-hover cursor-pointer"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-cinema-accent/30">
                    <div>
                      <span className="text-xs uppercase tracking-[0.12em] text-cinema-muted">
                        Updated Grand Total
                      </span>
                      <p className="font-mono text-2xl font-bold text-cinema-primary tabular-nums">
                        {formatINR(grandTotal)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setStep('SELECT_SEATS')}
                        className="px-5 py-3 border border-cinema-accent text-xs font-semibold uppercase tracking-[0.12em] cursor-pointer"
                      >
                        Back to Seats
                      </button>
                      <button
                        type="button"
                        onClick={() => setStep('CHECKOUT')}
                        className="px-7 py-3 bg-cinema-primary text-cinema-bg text-xs font-bold uppercase tracking-[0.14em] hover:bg-cinema-primary-hover cursor-pointer"
                      >
                        Review Final Bill
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP: CHECKOUT & BILLING */}
              {step === 'CHECKOUT' && activeScreening && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  {/* Order Review */}
                  <div className="lg:col-span-6 bg-cinema-surface border border-cinema-accent/60 p-6 space-y-5">
                    <h3 className="font-display text-2xl font-semibold text-cinema-primary">
                      Order & Billing Summary
                    </h3>
                    <div className="space-y-3 text-sm border-b border-cinema-accent/30 pb-4">
                      <div className="flex justify-between">
                        <span className="text-cinema-muted">Film</span>
                        <span className="font-semibold">{activeScreening.movieTitle}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-cinema-muted">Screening Date</span>
                        <span className="font-medium">{formatShowDate(activeScreening.date)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-cinema-muted">Show Time</span>
                        <span className="font-medium">
                          {formatShowTime(activeScreening.startTime, activeScreening.endTime)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-cinema-muted">Seats ({selectedSeats.length})</span>
                        <span className="font-mono font-semibold">{selectedSeats.join(', ')}</span>
                      </div>
                    </div>

                    <div className="space-y-2 text-sm border-b border-cinema-accent/30 pb-4">
                      <div className="flex justify-between">
                        <span>
                          Tickets ({selectedSeats.length} seat{selectedSeats.length === 1 ? '' : 's'})
                        </span>
                        <span className="font-mono font-semibold tabular-nums">
                          {formatINR(ticketSubtotal)}
                        </span>
                      </div>
                      {seatAssignments.length > 0 ? (
                        seatAssignments.map((a) => (
                          <div
                            key={`${a.seatNumber}_${a.productId}`}
                            className="flex justify-between text-xs text-cinema-text/85"
                          >
                            <span>
                              Seat {a.seatNumber} — {a.quantity}× {a.productName}
                            </span>
                            <span className="font-mono tabular-nums">
                              {formatINR(a.quantity * a.unitPrice)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="flex justify-between text-xs text-cinema-muted">
                          <span>Mocktail Refreshments</span>
                          <span>None</span>
                        </div>
                      )}
                      <div className="flex justify-between pt-2 font-medium">
                        <span>Mocktail Subtotal</span>
                        <span className="font-mono tabular-nums">{formatINR(mocktailSubtotal)}</span>
                      </div>
                    </div>

                    <div className="flex items-baseline justify-between">
                      <span className="font-display text-xl font-semibold text-cinema-text">
                        Grand Total
                      </span>
                      <span className="font-mono text-2xl font-bold text-cinema-primary tabular-nums">
                        {formatINR(grandTotal)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setStep('SELECT_SEATS')}
                      className="text-xs text-cinema-primary underline cursor-pointer"
                    >
                      Modify Seats or Mocktails
                    </button>
                  </div>

                  {/* Guest Info + Payment */}
                  <div className="lg:col-span-6 bg-cinema-surface border border-cinema-accent/60 p-6 space-y-5">
                    <h3 className="font-display text-2xl font-semibold text-cinema-primary">
                      Guest Details & Payment
                    </h3>

                    {!user ? (
                      <div className="bg-cinema-bg border border-cinema-accent p-5 space-y-3">
                        <p className="text-sm text-cinema-text font-medium">
                          Sign in with Google to lock your seats and issue your verified digital ticket.
                        </p>
                        <button
                          type="button"
                          onClick={() => void signInWithGoogle()}
                          disabled={signingIn}
                          className="w-full py-3 bg-cinema-primary text-cinema-bg text-xs font-bold uppercase tracking-[0.14em] hover:bg-cinema-primary-hover transition-colors cursor-pointer"
                        >
                          {signingIn ? 'Connecting Google Account...' : 'Sign in with Google'}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="bg-cinema-bg border border-cinema-accent/40 px-4 py-2.5 text-xs flex items-center justify-between">
                          <span>
                            Signed in as <strong>{user.email}</strong>
                          </span>
                          <ShieldCheck className="w-4 h-4 text-[#166534]" />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-cinema-text/85 mb-1">
                              Full Name
                            </label>
                            <input
                              type="text"
                              value={customerName}
                              onChange={(e) => setCustomerName(e.target.value)}
                              placeholder="Enter guest name"
                              className="w-full px-3 py-2.5 bg-cinema-bg border border-cinema-accent/60 text-sm focus:outline-none focus:border-cinema-primary"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-cinema-text/85 mb-1">
                              Mobile Number
                            </label>
                            <input
                              type="tel"
                              value={customerPhone}
                              onChange={(e) => setCustomerPhone(e.target.value)}
                              placeholder="10-digit mobile number"
                              className="w-full px-3 py-2.5 bg-cinema-bg border border-cinema-accent/60 text-sm focus:outline-none focus:border-cinema-primary"
                            />
                          </div>
                        </div>

                        {/* Payment Configuration Display */}
                        {!paymentSettings.isConfigured || paymentSettings.mode === 'UNCONFIGURED' ? (
                          <div className="bg-[#FEF3C7]/70 border border-[#D97706]/50 p-4 space-y-1.5">
                            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#92400E]">
                              Payment Settings: Not Configured Yet
                            </p>
                            <p className="text-xs text-[#78350F] leading-relaxed">
                              Cinema administration has not configured UPI or online gateway payment details yet. Once configured in the Admin Panel, you will see the official UPI ID and QR code here.
                            </p>
                          </div>
                        ) : paymentSettings.mode === 'MANUAL_UPI' ? (
                          <div className="border border-cinema-accent bg-cinema-bg p-4 space-y-4">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="text-xs uppercase tracking-[0.14em] text-cinema-muted font-semibold">
                                  Pay via Google Pay / BHIM UPI
                                </p>
                                <p className="text-sm font-semibold text-cinema-text mt-1">
                                  {paymentSettings.displayName || 'SPLENDORA CINEMA'}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                  <code className="font-mono text-sm font-bold text-cinema-primary">
                                    {paymentSettings.upiId}
                                  </code>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (paymentSettings.upiId) {
                                        void navigator.clipboard.writeText(paymentSettings.upiId);
                                        setCopiedUpi(true);
                                        setTimeout(() => setCopiedUpi(false), 2000);
                                      }
                                    }}
                                    className="p-1 text-cinema-primary hover:bg-cinema-surface-alt cursor-pointer"
                                    title="Copy UPI ID"
                                  >
                                    {copiedUpi ? (
                                      <Check className="w-3.5 h-3.5" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                              </div>
                              {paymentSettings.qrImageUrl && (
                                <img
                                  src={paymentSettings.qrImageUrl}
                                  alt="Cinema UPI QR Code"
                                  referrerPolicy="no-referrer"
                                  className="w-28 h-28 object-contain border border-cinema-accent bg-white p-1 shrink-0"
                                />
                              )}
                            </div>

                            {paymentSettings.instructions && (
                              <p className="text-xs text-cinema-text/85 leading-relaxed">
                                {paymentSettings.instructions}
                              </p>
                            )}

                            <div>
                              <label className="block text-xs font-semibold text-cinema-text mb-1">
                                UPI Transaction Reference / UTR Number
                              </label>
                              <input
                                type="text"
                                value={upiRef}
                                onChange={(e) => setUpiRef(e.target.value)}
                                placeholder="Enter 12-digit UTR / UPI reference after paying"
                                className="w-full px-3 py-2.5 bg-cinema-surface border border-cinema-accent font-mono text-sm focus:outline-none focus:border-cinema-primary"
                              />
                              <p className="text-[11px] text-cinema-muted mt-1">
                                Bookings enter Pending Verification until an administrator confirms the payment record.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="border border-cinema-accent bg-cinema-bg p-4 space-y-2">
                            <p className="text-xs font-bold uppercase tracking-[0.12em] text-cinema-primary">
                              {paymentSettings.providerName || 'Configured Payment Gateway'}
                            </p>
                            <p className="text-xs text-cinema-text/85">
                              Secure server-verified online payment checkout ({paymentSettings.testMode ? 'Test Mode' : 'Live'}).
                            </p>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => void handlePlaceBookingAndHold()}
                          disabled={
                            submitting ||
                            !paymentSettings.isConfigured ||
                            paymentSettings.mode === 'UNCONFIGURED'
                          }
                          className="w-full py-3.5 px-6 bg-cinema-primary text-cinema-bg text-xs font-bold uppercase tracking-[0.14em] hover:bg-cinema-primary-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {submitting
                            ? 'Submitting Reservation...'
                            : `Submit Booking · ${formatINR(grandTotal)}`}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* STEP: SUBMITTED */}
              {step === 'SUBMITTED' && submittedBookingId && (
                <div className="max-w-2xl mx-auto bg-cinema-surface border border-cinema-accent p-8 text-center space-y-5">
                  <div className="w-12 h-12 mx-auto bg-[#FEF3C7] border border-[#D97706] flex items-center justify-center text-[#92400E]">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-cinema-muted">
                      Reservation Submitted
                    </p>
                    <h3 className="font-display text-3xl font-semibold text-cinema-primary mt-1">
                      Booking {submittedBookingId} — Pending Verification
                    </h3>
                    <p className="text-sm text-cinema-text/85 mt-3 leading-relaxed">
                      Your seats ({selectedSeats.join(', ')}) are reserved and your UPI reference has been logged. As soon as Splendora Cinema administration verifies the payment, your official Digital QR Ticket will appear in <strong>My Tickets</strong>.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setMyTicketsOpen(true)}
                      className="px-6 py-3 bg-cinema-primary text-cinema-bg text-xs font-bold uppercase tracking-[0.14em] hover:bg-cinema-primary-hover cursor-pointer"
                    >
                      Open My Tickets
                    </button>
                    <button
                      type="button"
                      onClick={resetBookingFlow}
                      className="px-6 py-3 border border-cinema-accent text-xs font-semibold uppercase tracking-[0.12em] cursor-pointer"
                    >
                      Book Another Show
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* CONTACT & POLICIES */}
      <section id="contact" className="bg-cinema-surface-alt border-t border-cinema-accent/40 py-14">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 grid grid-cols-1 md:grid-cols-12 gap-10">
          <div className="md:col-span-5 space-y-4">
            <p className="text-xs uppercase tracking-[0.2em] text-cinema-muted">Box Office & Venue</p>
            <h2 className="font-display text-2xl font-semibold text-cinema-primary">
              {websiteSettings.cinemaName || 'SPLENDORA CINEMA'}
            </h2>
            <div className="space-y-3 text-sm text-cinema-text/85">
              <p className="flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-cinema-primary shrink-0 mt-1" />
                <span>
                  {websiteSettings.cinemaAddress?.trim() ||
                    'Cinema venue address to be updated by administration.'}
                </span>
              </p>
              <p className="flex items-center gap-2.5">
                <Phone className="w-4 h-4 text-cinema-primary shrink-0" />
                <span className="font-mono">
                  {websiteSettings.contactNumber?.trim() || 'Contact phone to be provided'}
                </span>
              </p>
              <p className="flex items-center gap-2.5">
                <Mail className="w-4 h-4 text-cinema-primary shrink-0" />
                <span>
                  {websiteSettings.contactEmail?.trim() || 'Contact email to be provided'}
                </span>
              </p>
            </div>
          </div>

          <div className="md:col-span-7 space-y-4">
            <p className="text-xs uppercase tracking-[0.2em] text-cinema-muted">
              Admission & Seating Policies
            </p>
            <p className="text-sm text-cinema-text/85 leading-relaxed">
              {websiteSettings.bookingPolicies}
            </p>
          </div>
        </div>
      </section>

      {/* QUIET FOOTER */}
      <footer className="bg-cinema-dark text-cinema-accent-light/85 border-t border-cinema-accent/30 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <p>{websiteSettings.footerText || 'SPLENDORA CINEMA'}</p>
          <div className="flex items-center gap-6">
            {websiteSettings.instagramUrl && (
              <a
                href={websiteSettings.instagramUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:text-cinema-accent-light"
              >
                Instagram
              </a>
            )}
            {websiteSettings.youtubeUrl && (
              <a
                href={websiteSettings.youtubeUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:text-cinema-accent-light"
              >
                YouTube
              </a>
            )}
            <Link to="/admin" className="text-cinema-accent-light hover:underline">
              Admin Portal
            </Link>
          </div>
        </div>
      </footer>

      <MocktailPopup
        open={mocktailPopupOpen}
        products={mocktails}
        onAddToBooking={handleAddMocktails}
        onSkip={handleSkipMocktails}
      />

      <MyTicketsModal open={myTicketsOpen} onClose={() => setMyTicketsOpen(false)} />
    </div>
  );
}
