import { collection, deleteDoc, doc, getDoc, onSnapshot, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import {
  Activity,
  Armchair,
  Ban,
  BarChart3,
  Calendar,
  Camera,
  CreditCard,
  Crown,
  Download,
  Edit3,
  ExternalLink,
  Film,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  Palette,
  Plus,
  Printer,
  QrCode,
  RefreshCcw,
  Settings,
  Shield,
  Store,
  Ticket,
  Unlock,
  Upload,
  User,
  UserPlus,
  Users,
  Wine,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useCinemaPublicData, useScreeningSeats } from '../../hooks/useCinemaPublicData';
import { DEFAULT_POSTER_URL, SEAT_COLS, SEAT_ROWS, formatINR, formatShowDate, formatShowTime } from '../../lib/defaults';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { compressImageFile } from '../../lib/imageUtils';
import { FULL_ADMIN_PERMISSIONS } from '../../types/cinema';
import type {
  AdminPermissions,
  AdminRecord,
  AdminRole,
  AuditLogRecord,
  BookingRecord,
  CastMemberRecord,
  MocktailAssignmentRecord,
  MovieRecord,
  PaymentRecord,
  PaymentSettingsPrivate,
  RefundRecord,
  SeatRecord,
  TicketRecord,
} from '../../types/cinema';
import { AdminLogin } from '../AdminLogin';
import { PrintableTicketModal } from '../PrintableTicketModal';
import { BoxOfficeCounterPanel, TicketsDirectoryPanel } from './BoxOfficeAndTicketsPanels';
import { CastManagementPanel } from './CastManagementPanel';
import { MocktailManagementPanel, MocktailOrdersPanel } from './MocktailManagementAndOrders';
import {
  PaymentManagementPanel,
  PaymentSettingsPanel,
  ThemeCustomizationPanel,
  WebsiteSettingsPanel,
} from './PaymentsAndSettingsPanels';
import { ShowManagementPanel } from './ShowManagementPanel';
import { TicketScannerPanel } from './TicketScannerPanel';

type AdminSection =
  | 'DASHBOARD'
  | 'BOX_OFFICE'
  | 'MOVIE'
  | 'CAST'
  | 'SHOWS'
  | 'BOOKINGS'
  | 'TICKETS'
  | 'SEATS'
  | 'MOCKTAILS'
  | 'MOCKTAIL_ORDERS'
  | 'PAYMENTS'
  | 'PAYMENT_SETTINGS'
  | 'SCANNER'
  | 'REVENUE'
  | 'WEBSITE_SETTINGS'
  | 'THEME'
  | 'REFUNDS'
  | 'ADMINS'
  | 'LOGS';

const NAV_ITEMS: Array<{
  id: AdminSection;
  label: string;
  icon: typeof LayoutDashboard;
  anyFeature?: Array<keyof AdminPermissions>;
}> = [
  { id: 'DASHBOARD', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'BOX_OFFICE', label: 'Box Office Counter', icon: Store, anyFeature: ['boxOfficeCounter'] },
  { id: 'MOVIE', label: 'Movie Management', icon: Film, anyFeature: ['manageMovies', 'manageShowPosters'] },
  { id: 'CAST', label: 'Main Cast & Credits', icon: Users, anyFeature: ['manageMovies'] },
  {
    id: 'SHOWS',
    label: 'Show & Row Pricing',
    icon: Calendar,
    anyFeature: ['addShows', 'manageShowTimings', 'manageRowPricing', 'removeShows', 'manageShowPosters'],
  },
  {
    id: 'BOOKINGS',
    label: 'Booking Management',
    icon: Ticket,
    anyFeature: ['manageBookingsAndPayments', 'boxOfficeCounter'],
  },
  {
    id: 'TICKETS',
    label: 'Tickets & Print',
    icon: QrCode,
    anyFeature: ['ticketScanner', 'printTickets', 'manageBookingsAndPayments', 'boxOfficeCounter'],
  },
  {
    id: 'SEATS',
    label: 'Seat Management',
    icon: Armchair,
    anyFeature: ['manageSeats', 'manageBookingsAndPayments', 'manageShowTimings'],
  },
  { id: 'MOCKTAILS', label: 'Mocktail Management', icon: Wine, anyFeature: ['manageMocktails'] },
  { id: 'MOCKTAIL_ORDERS', label: 'Mocktail Orders', icon: Wine, anyFeature: ['manageMocktails'] },
  { id: 'PAYMENTS', label: 'Payment Management', icon: CreditCard, anyFeature: ['manageBookingsAndPayments'] },
  { id: 'PAYMENT_SETTINGS', label: 'Payment Settings', icon: Settings, anyFeature: ['managePaymentSettings'] },
  { id: 'SCANNER', label: 'Ticket Scanner', icon: QrCode, anyFeature: ['ticketScanner'] },
  {
    id: 'REVENUE',
    label: 'Revenue Reports',
    icon: BarChart3,
    anyFeature: ['viewReportsAndLogs', 'manageBookingsAndPayments'],
  },
  { id: 'WEBSITE_SETTINGS', label: 'Website Settings', icon: Globe, anyFeature: ['manageWebsiteSettings'] },
  { id: 'THEME', label: 'Theme & Colors', icon: Palette, anyFeature: ['manageTheme', 'manageWebsiteSettings'] },
  { id: 'REFUNDS', label: 'Cancellation & Refunds', icon: RefreshCcw, anyFeature: ['manageBookingsAndPayments', 'removeShows'] },
  { id: 'ADMINS', label: 'Admin Management', icon: Shield, anyFeature: ['manageAccessFeatures'] },
  { id: 'LOGS', label: 'Activity Log', icon: Activity, anyFeature: ['viewReportsAndLogs', 'manageAccessFeatures'] },
];

export function AdminDashboard() {
  const { user, isAdmin, isPremiumAdmin, adminRole, adminChecked, logout, getIdToken, hasFeature } =
    useAuth();
  const { movie, castMembers, screenings, mocktails, websiteSettings, paymentSettings } =
    useCinemaPublicData();

  const [section, setSection] = useState<AdminSection>('DASHBOARD');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Admin collections
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [assignments, setAssignments] = useState<MocktailAssignmentRecord[]>([]);
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [privatePaySettings, setPrivatePaySettings] = useState<PaymentSettingsPrivate | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);

  // Filters
  const [dashDateFilter, setDashDateFilter] = useState('ALL');
  const [dashShowFilter, setDashShowFilter] = useState('ALL');
  const [bookingSearch, setBookingSearch] = useState('');
  const [bookingShowFilter, setBookingShowFilter] = useState('ALL');
  const [bookingStatusFilter, setBookingStatusFilter] = useState('ALL');
  const [seatShowId, setSeatShowId] = useState<string>('');
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null);
  const [bookingActionMsg, setBookingActionMsg] = useState<string | null>(null);
  const [printBookingTicket, setPrintBookingTicket] = useState<TicketRecord | null>(null);

  // Auto-bootstrap initial Firestore data on authorized admin sign-in
  useEffect(() => {
    if (!user || !isAdmin || bootstrapped) return;
    let active = true;
    (async () => {
      try {
        const token = await getIdToken();
        if (!token || !active) return;
        await fetch('/api/admin/bootstrap', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (active) setBootstrapped(true);
      } catch (err) {
        console.error('Auto-bootstrap error:', err);
      }
    })();
    return () => {
      active = false;
    };
  }, [user, isAdmin, bootstrapped, getIdToken]);

  // Subscribe to admin Firestore collections only after admin verification passes
  useEffect(() => {
    if (!user || !isAdmin) return;

    const unsubs = [
      onSnapshot(
        collection(db, 'bookings'),
        (s) =>
          setBookings(
            s.docs
              .map((d) => d.data() as BookingRecord)
              .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          ),
        (err) => handleFirestoreError(err, OperationType.LIST, 'bookings')
      ),
      onSnapshot(
        collection(db, 'payments'),
        (s) =>
          setPayments(
            s.docs
              .map((d) => d.data() as PaymentRecord)
              .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          ),
        (err) => handleFirestoreError(err, OperationType.LIST, 'payments')
      ),
      onSnapshot(
        collection(db, 'tickets'),
        (s) => setTickets(s.docs.map((d) => d.data() as TicketRecord)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'tickets')
      ),
      onSnapshot(
        collection(db, 'mocktailAssignments'),
        (s) => setAssignments(s.docs.map((d) => d.data() as MocktailAssignmentRecord)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'mocktailAssignments')
      ),
      onSnapshot(
        collection(db, 'refunds'),
        (s) => setRefunds(s.docs.map((d) => d.data() as RefundRecord)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'refunds')
      ),
      onSnapshot(
        collection(db, 'admins'),
        (s) => setAdmins(s.docs.map((d) => d.data() as AdminRecord)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'admins')
      ),
      onSnapshot(
        collection(db, 'auditLogs'),
        (s) =>
          setAuditLogs(
            s.docs
              .map((d) => d.data() as AuditLogRecord)
              .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          ),
        (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
      ),
      onSnapshot(
        doc(db, 'paymentSettings', 'private'),
        (s) => {
          if (s.exists()) setPrivatePaySettings(s.data() as PaymentSettingsPrivate);
        },
        (err) => handleFirestoreError(err, OperationType.GET, 'paymentSettings/private')
      ),
    ];

    return () => unsubs.forEach((u) => u());
  }, [user, isAdmin]);

  useEffect(() => {
    if (!seatShowId && screenings.length > 0) {
      setSeatShowId(screenings[0].screeningId);
    }
  }, [screenings, seatShowId]);

  const { seats: activeSeats } = useScreeningSeats(seatShowId || null);

  if (!adminChecked || !user || !isAdmin) {
    return <AdminLogin />;
  }

  // Dashboard filtered metrics
  const filteredScreenings = screenings.filter((s) => {
    if (dashDateFilter !== 'ALL' && s.date !== dashDateFilter) return false;
    if (dashShowFilter !== 'ALL' && s.screeningId !== dashShowFilter) return false;
    return true;
  });

  const filteredScreeningIds = new Set(filteredScreenings.map((s) => s.screeningId));
  const filteredBookings = bookings.filter((b) => filteredScreeningIds.has(b.screeningId));
  const filteredTickets = tickets.filter((t) => filteredScreeningIds.has(t.screeningId));
  const filteredAssignments = assignments.filter((a) => filteredScreeningIds.has(a.screeningId));

  const verifiedBookings = filteredBookings.filter((b) => b.paymentStatus === 'VERIFIED');
  const totalTicketsSold = verifiedBookings.reduce((sum, b) => sum + b.ticketCount, 0);
  const totalVerifiedRevenue = verifiedBookings.reduce((sum, b) => sum + b.grandTotal, 0);
  const verifiedTicketRevenue = verifiedBookings.reduce((sum, b) => sum + b.ticketSubtotal, 0);
  const verifiedMocktailRevenue = verifiedBookings.reduce((sum, b) => sum + b.mocktailSubtotal, 0);

  const totalSeatCap = filteredScreenings
    .filter((s) => s.salesStatus !== 'CANCELLED')
    .reduce((sum, s) => sum + s.seatCapacity, 0);
  const bookedSeatSum = filteredScreenings
    .filter((s) => s.salesStatus !== 'CANCELLED')
    .reduce((sum, s) => sum + (s.bookedCount || 0), 0);

  const stats = [
    { label: 'Total Bookings', value: filteredBookings.length },
    { label: 'Tickets Sold (Verified)', value: totalTicketsSold },
    { label: 'Verified Revenue', value: formatINR(totalVerifiedRevenue) },
    { label: 'Total Shows', value: filteredScreenings.length },
    {
      label: 'Upcoming / Open Shows',
      value: filteredScreenings.filter((s) => s.salesStatus === 'OPEN').length,
    },
    {
      label: 'Completed Shows',
      value: filteredScreenings.filter((s) => s.salesStatus === 'COMPLETED').length,
    },
    {
      label: 'Cancelled Shows',
      value: filteredScreenings.filter((s) => s.salesStatus === 'CANCELLED').length,
    },
    { label: 'Available Seats', value: Math.max(0, totalSeatCap - bookedSeatSum) },
    { label: 'Booked Seats', value: bookedSeatSum },
    {
      label: 'Pending Payments',
      value: filteredBookings.filter(
        (b) => b.paymentStatus === 'PENDING' || b.paymentStatus === 'PENDING_VERIFICATION'
      ).length,
    },
    {
      label: 'Mocktail Orders',
      value: filteredAssignments.filter((a) => a.deliveryStatus !== 'CANCELLED').length,
    },
    { label: 'Mocktail Revenue', value: formatINR(verifiedMocktailRevenue) },
    {
      label: 'Tickets Checked In',
      value: filteredTickets.filter((t) => t.ticketStatus === 'USED').length,
    },
  ];

  // CSV Export
  const exportBookingsCsv = () => {
    const header = [
      'Booking ID',
      'Customer Name',
      'Phone',
      'Email',
      'Show ID',
      'Date',
      'Time',
      'Seats',
      'Qty',
      'Ticket Subtotal',
      'Mocktail Subtotal',
      'Grand Total',
      'Payment Status',
      'Booking Status',
      'Timestamp',
    ];
    const rows = bookings.map((b) => [
      b.bookingId,
      b.customerName,
      b.customerPhone,
      b.customerEmail,
      b.screeningId,
      b.date,
      b.startTime,
      b.seatNumbers.join(' '),
      b.ticketCount,
      b.ticketSubtotal,
      b.mocktailSubtotal,
      b.grandTotal,
      b.paymentStatus,
      b.bookingStatus,
      b.createdAt,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `splendora-bookings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCancelBooking = async (b: BookingRecord) => {
    setBookingActionMsg(null);
    setCancellingBookingId(b.bookingId);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/admin/bookings/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookingId: b.bookingId,
          reason: `Booking cancelled via Admin Suite (${user?.email || 'admin'}).`,
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as { error?: string };
      if (!resp.ok) throw new Error(data.error || 'Could not cancel booking.');
      setBookingActionMsg(
        `Booking ${b.bookingId} (${b.customerName}) cancelled and seats (${b.seatNumbers.join(', ')}) released.`
      );
    } catch (err) {
      setBookingActionMsg(err instanceof Error ? err.message : 'Failed to cancel booking.');
    } finally {
      setCancellingBookingId(null);
    }
  };

  const ticketByBookingId = new Map<string, TicketRecord>();
  for (const t of tickets) {
    ticketByBookingId.set(t.bookingId, t);
  }
  const canPrintAnyTicket =
    hasFeature('printTickets') || hasFeature('boxOfficeCounter') || hasFeature('ticketScanner');

  return (
    <>
    <div className="min-h-screen bg-cinema-bg text-cinema-text flex no-print">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-cinema-dark text-cinema-bg border-r border-cinema-accent/35 flex flex-col transition-transform lg:translate-x-0 lg:static ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-5 border-b border-cinema-accent/30 flex items-center justify-between">
          <div>
            <p className="font-display text-lg font-semibold tracking-wider text-cinema-accent-light">
              SPLENDORA
            </p>
            {isPremiumAdmin ? (
              <p className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 bg-cinema-accent text-cinema-dark text-[10px] font-bold uppercase tracking-[0.14em]">
                <Crown className="w-3 h-3" />
                Premium Admin
              </p>
            ) : (
              <p className="text-[11px] uppercase tracking-[0.18em] text-cinema-accent-light/85">
                Admin Suite · {adminRole}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 text-cinema-accent-light"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {NAV_ITEMS.filter(
            (item) => !item.anyFeature || item.anyFeature.some((f) => hasFeature(f))
          ).map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSection(item.id);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-xs font-medium text-left transition-colors cursor-pointer ${
                  active
                    ? 'bg-cinema-primary text-cinema-accent-light border-r-2 border-cinema-accent-light'
                    : 'text-cinema-accent-light/90 hover:bg-cinema-primary-hover/40'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-cinema-accent/30 space-y-2 text-xs">
          <p className="truncate font-mono text-[11px] text-cinema-accent-light/85">{user.email}</p>
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="flex-1 py-2 px-3 border border-cinema-accent/40 text-center text-cinema-accent-light hover:bg-cinema-primary-hover/40 inline-flex items-center justify-center gap-1"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Public Site
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="py-2 px-3 border border-cinema-accent/40 text-[#FCA5A5] hover:bg-cinema-primary-hover/40 inline-flex items-center gap-1 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-cinema-surface border-b border-cinema-accent/40 px-4 sm:px-8 flex items-center justify-between no-print">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 text-cinema-primary"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-xs uppercase tracking-[0.16em] text-cinema-muted font-semibold">
              {NAV_ITEMS.find((i) => i.id === section)?.label}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {hasFeature('boxOfficeCounter') && (
              <button
                type="button"
                onClick={() => setSection('BOX_OFFICE')}
                className="px-3 py-1.5 border border-cinema-primary text-cinema-primary font-semibold uppercase tracking-[0.1em] hover:bg-cinema-surface-alt cursor-pointer"
              >
                Box Office Counter
              </button>
            )}
            {hasFeature('ticketScanner') && (
              <button
                type="button"
                onClick={() => setSection('SCANNER')}
                className="px-3 py-1.5 bg-cinema-primary text-cinema-bg font-semibold uppercase tracking-[0.1em] hover:bg-cinema-primary-hover cursor-pointer"
              >
                Open Scanner
              </button>
            )}
          </div>
        </header>

        <main className="p-4 sm:p-8 flex-1 overflow-y-auto">
          {(() => {
            const activeNavItem = NAV_ITEMS.find((i) => i.id === section);
            const canView =
              !activeNavItem?.anyFeature || activeNavItem.anyFeature.some((f) => hasFeature(f));
            if (!canView) {
              return (
                <div className="bg-[#FEF3C7] border border-[#D97706] p-6 max-w-xl space-y-3 text-xs text-[#92400E]">
                  <h2 className="font-display text-xl font-semibold text-cinema-primary">
                    Access Feature Not Enabled
                  </h2>
                  <p>
                    Your administrator account does not currently have access to{' '}
                    <strong>{activeNavItem?.label || section}</strong>. Contact a Super Admin to
                    update your access features.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSection('DASHBOARD')}
                    className="px-4 py-2 bg-cinema-primary text-cinema-bg font-semibold uppercase tracking-[0.1em] cursor-pointer"
                  >
                    Return to Dashboard
                  </button>
                </div>
              );
            }
            return (
              <>
          {/* 1. DASHBOARD */}
          {section === 'DASHBOARD' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-cinema-accent/40 pb-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h1 className="font-display text-3xl font-semibold text-cinema-primary">
                      Executive Overview
                    </h1>
                    {isPremiumAdmin && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-cinema-primary text-cinema-accent-light border border-cinema-accent text-[11px] font-bold uppercase tracking-[0.14em]">
                        <Crown className="w-3.5 h-3.5" />
                        Premium Owner · Unconditional Suite Access
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-cinema-muted">
                    Live operations across SPLENDORA CINEMA — {movie.title}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <select
                    value={dashDateFilter}
                    onChange={(e) => setDashDateFilter(e.target.value)}
                    className="px-3 py-2 bg-cinema-surface border border-cinema-accent/60"
                  >
                    <option value="ALL">All Dates</option>
                    {Array.from(new Set(screenings.map((s) => s.date)))
                      .sort()
                      .map((d) => (
                        <option key={d} value={d}>
                          {formatShowDate(d)}
                        </option>
                      ))}
                  </select>
                  <select
                    value={dashShowFilter}
                    onChange={(e) => setDashShowFilter(e.target.value)}
                    className="px-3 py-2 bg-cinema-surface border border-cinema-accent/60"
                  >
                    <option value="ALL">All Shows</option>
                    {screenings.map((s) => (
                      <option key={s.screeningId} value={s.screeningId}>
                        {s.screeningId} ({s.date})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {stats.map((s) => (
                  <div
                    key={s.label}
                    className="bg-cinema-surface border border-cinema-accent/50 p-4 space-y-1"
                  >
                    <p className="text-[11px] uppercase tracking-[0.12em] text-cinema-muted">
                      {s.label}
                    </p>
                    <p className="font-mono text-2xl font-bold text-cinema-primary tabular-nums">
                      {s.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Executive Quick Actions */}
              <div className="bg-cinema-surface border border-cinema-accent/60 p-5 space-y-3">
                <h2 className="font-display text-lg font-semibold text-cinema-primary">
                  Quick Operations
                </h2>
                <div className="flex flex-wrap gap-2.5 text-xs">
                  {hasFeature('boxOfficeCounter') && (
                    <button
                      type="button"
                      onClick={() => setSection('BOX_OFFICE')}
                      className="px-4 py-2 bg-cinema-primary text-cinema-bg font-semibold uppercase tracking-[0.1em] hover:bg-cinema-primary-hover cursor-pointer"
                    >
                      Issue Walk-In Ticket
                    </button>
                  )}
                  {hasFeature('manageBookingsAndPayments') && (
                    <button
                      type="button"
                      onClick={() => setSection('PAYMENTS')}
                      className="px-4 py-2 border border-cinema-accent text-cinema-primary font-semibold hover:bg-cinema-surface-alt cursor-pointer"
                    >
                      Verify Pending Payments (
                      {
                        bookings.filter(
                          (b) =>
                            b.paymentStatus === 'PENDING' ||
                            b.paymentStatus === 'PENDING_VERIFICATION'
                        ).length
                      }
                      )
                    </button>
                  )}
                  {hasFeature('manageMovies') && (
                    <button
                      type="button"
                      onClick={() => setSection('CAST')}
                      className="px-4 py-2 border border-cinema-accent text-cinema-primary font-semibold hover:bg-cinema-surface-alt cursor-pointer"
                    >
                      Main Cast & Credits ({castMembers.length})
                    </button>
                  )}
                  {(hasFeature('manageShowTimings') || hasFeature('addShows') || hasFeature('manageRowPricing')) && (
                    <button
                      type="button"
                      onClick={() => setSection('SHOWS')}
                      className="px-4 py-2 border border-cinema-accent text-cinema-primary font-semibold hover:bg-cinema-surface-alt cursor-pointer"
                    >
                      Shows & Row Pricing
                    </button>
                  )}
                  {hasFeature('manageWebsiteSettings') && (
                    <button
                      type="button"
                      onClick={() => setSection('WEBSITE_SETTINGS')}
                      className="px-4 py-2 border border-cinema-accent text-cinema-primary font-semibold hover:bg-cinema-surface-alt cursor-pointer"
                    >
                      Website & Hero Backdrop
                    </button>
                  )}
                  {(hasFeature('manageTheme') || hasFeature('manageWebsiteSettings')) && (
                    <button
                      type="button"
                      onClick={() => setSection('THEME')}
                      className="px-4 py-2 border border-cinema-accent text-cinema-primary font-semibold hover:bg-cinema-surface-alt cursor-pointer"
                    >
                      Theme & Colors
                    </button>
                  )}
                  {canPrintAnyTicket && (
                    <button
                      type="button"
                      onClick={() => setSection('TICKETS')}
                      className="px-4 py-2 border border-cinema-accent text-cinema-primary font-semibold hover:bg-cinema-surface-alt cursor-pointer"
                    >
                      Print & Manage Tickets
                    </button>
                  )}
                  {hasFeature('ticketScanner') && (
                    <button
                      type="button"
                      onClick={() => setSection('SCANNER')}
                      className="px-4 py-2 border border-cinema-accent text-cinema-primary font-semibold hover:bg-cinema-surface-alt cursor-pointer"
                    >
                      Launch QR Scanner
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* BOX OFFICE COUNTER */}
          {section === 'BOX_OFFICE' && (
            <BoxOfficeCounterPanel screenings={screenings} mocktails={mocktails} bookings={bookings} />
          )}

          {/* 2. MOVIE MANAGEMENT */}
          {section === 'MOVIE' && (
            <MovieManagementSubpanel
              movie={movie}
              castMembers={castMembers}
              onOpenCastPanel={() => setSection('CAST')}
            />
          )}

          {/* MAIN CAST & CREDITS */}
          {section === 'CAST' && (
            <CastManagementPanel movie={movie} castMembers={castMembers} />
          )}

          {/* 3. SHOW MANAGEMENT */}
          {section === 'SHOWS' && (
            <ShowManagementPanel
              movie={movie}
              screenings={screenings}
              onViewSeats={(id) => {
                setSeatShowId(id);
                setSection('SEATS');
              }}
              onViewBookings={(id) => {
                setBookingShowFilter(id);
                setSection('BOOKINGS');
              }}
            />
          )}

          {/* 4. BOOKING MANAGEMENT */}
          {section === 'BOOKINGS' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cinema-accent/40 pb-4">
                <div>
                  <h2 className="font-display text-2xl font-semibold text-cinema-primary">
                    Booking Management
                  </h2>
                  <p className="text-sm text-cinema-muted">
                    Search, filter, and export all customer bookings.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={exportBookingsCsv}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-cinema-primary text-cinema-bg text-xs font-bold uppercase tracking-[0.12em] cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Export CSV
                </button>
              </div>

              {bookingActionMsg && (
                <div className="bg-cinema-surface-alt border border-cinema-accent p-3 text-xs font-semibold text-cinema-text">
                  {bookingActionMsg}
                </div>
              )}

              <div className="bg-cinema-surface border border-cinema-accent/60 p-4 flex flex-wrap gap-3 text-xs">
                <input
                  type="text"
                  value={bookingSearch}
                  onChange={(e) => setBookingSearch(e.target.value)}
                  placeholder="Search booking ID, customer name, email, phone..."
                  className="flex-1 min-w-[220px] px-3 py-2 bg-cinema-bg border border-cinema-accent/50"
                />
                <select
                  value={bookingShowFilter}
                  onChange={(e) => setBookingShowFilter(e.target.value)}
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
                  value={bookingStatusFilter}
                  onChange={(e) => setBookingStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-cinema-bg border border-cinema-accent/50"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="PENDING_VERIFICATION">PENDING VERIFICATION</option>
                  <option value="VERIFIED">VERIFIED</option>
                  <option value="FAILED">FAILED</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              </div>

              <div className="bg-cinema-surface border border-cinema-accent/60 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-cinema-surface-alt border-b border-cinema-accent/40 text-cinema-primary uppercase">
                    <tr>
                      <th className="py-3 px-3">Booking ID</th>
                      <th className="py-3 px-3">Customer</th>
                      <th className="py-3 px-3">Show</th>
                      <th className="py-3 px-3">Seats</th>
                      <th className="py-3 px-3 text-right">Tickets</th>
                      <th className="py-3 px-3 text-right">Mocktails</th>
                      <th className="py-3 px-3 text-right">Grand Total</th>
                      <th className="py-3 px-3">Payment</th>
                      <th className="py-3 px-3">Booking</th>
                      <th className="py-3 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cinema-accent/25">
                    {bookings
                      .filter((b) => {
                        if (bookingShowFilter !== 'ALL' && b.screeningId !== bookingShowFilter)
                          return false;
                        if (
                          bookingStatusFilter !== 'ALL' &&
                          b.paymentStatus !== bookingStatusFilter &&
                          b.bookingStatus !== bookingStatusFilter
                        )
                          return false;
                        const q = bookingSearch.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          b.bookingId.toLowerCase().includes(q) ||
                          b.customerName.toLowerCase().includes(q) ||
                          b.customerEmail.toLowerCase().includes(q) ||
                          b.customerPhone.toLowerCase().includes(q)
                        );
                      })
                      .map((b) => {
                        const linkedTicket = ticketByBookingId.get(b.bookingId);
                        return (
                        <tr key={b.bookingId} className="hover:bg-cinema-bg/70">
                          <td className="py-3 px-3 font-mono font-semibold">
                            <span>{b.bookingId}</span>
                            {b.complimentaryDrinks && (
                              <span className="block text-[10px] text-[#166534] font-sans font-semibold">
                                Comp Drinks
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <p className="font-semibold">{b.customerName}</p>
                            <p className="text-[11px] text-cinema-muted">
                              {b.customerPhone} · {b.customerEmail}
                            </p>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <p className="font-mono">{b.screeningId}</p>
                            <p className="text-[11px] text-cinema-muted">
                              {b.date} · {b.startTime || 'TBA'}
                            </p>
                          </td>
                          <td className="py-3 px-3 font-mono font-semibold">
                            {b.seatNumbers.join(', ')} ({b.ticketCount})
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            {formatINR(b.ticketSubtotal)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            {formatINR(b.mocktailSubtotal)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold tabular-nums">
                            <span>{formatINR(b.grandTotal)}</span>
                            {b.discountAmount && b.discountAmount > 0 ? (
                              <span className="block text-[10px] text-[#166534] font-normal">
                                -{formatINR(b.discountAmount)} off
                              </span>
                            ) : null}
                          </td>
                          <td className="py-3 px-3 font-mono">{b.paymentStatus}</td>
                          <td className="py-3 px-3 font-mono">{b.bookingStatus}</td>
                          <td className="py-3 px-3 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              {canPrintAnyTicket && linkedTicket && (
                                <button
                                  type="button"
                                  onClick={() => setPrintBookingTicket(linkedTicket)}
                                  className="px-2.5 py-1 border border-cinema-primary text-cinema-primary hover:bg-cinema-surface-alt inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                >
                                  <Printer className="w-3 h-3" />
                                  Print
                                </button>
                              )}
                              {b.bookingStatus !== 'CANCELLED' ? (
                                <button
                                  type="button"
                                  disabled={cancellingBookingId === b.bookingId}
                                  onClick={() => void handleCancelBooking(b)}
                                  className="px-2.5 py-1 border border-[#DC2626]/50 text-[#991B1B] hover:bg-[#FEE2E2] cursor-pointer whitespace-nowrap"
                                >
                                  {cancellingBookingId === b.bookingId ? 'Cancelling...' : 'Cancel'}
                                </button>
                              ) : (
                                <span className="text-cinema-muted font-mono">Cancelled</span>
                              )}
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TICKETS DIRECTORY */}
          {section === 'TICKETS' && (
            <TicketsDirectoryPanel tickets={tickets} screenings={screenings} />
          )}

          {/* 5. SEAT MANAGEMENT */}
          {section === 'SEATS' && (
            <SeatManagementSubpanel
              screenings={screenings}
              selectedShowId={seatShowId}
              onSelectShowId={setSeatShowId}
              seats={activeSeats}
            />
          )}

          {/* 6. MOCKTAIL MANAGEMENT */}
          {section === 'MOCKTAILS' && <MocktailManagementPanel products={mocktails} />}

          {/* 7. MOCKTAIL ORDERS */}
          {section === 'MOCKTAIL_ORDERS' && (
            <MocktailOrdersPanel assignments={assignments} screenings={screenings} />
          )}

          {/* 8. PAYMENT MANAGEMENT */}
          {section === 'PAYMENTS' && (
            <PaymentManagementPanel payments={payments} bookings={bookings} />
          )}

          {/* 9. PAYMENT SETTINGS */}
          {section === 'PAYMENT_SETTINGS' && (
            <PaymentSettingsPanel
              publicSettings={paymentSettings}
              privateSettings={privatePaySettings}
            />
          )}

          {/* 10. TICKET SCANNER */}
          {section === 'SCANNER' && <TicketScannerPanel />}

          {/* 11. REVENUE REPORTS */}
          {section === 'REVENUE' && (
            <div className="space-y-6">
              <div className="border-b border-cinema-accent/40 pb-4">
                <h2 className="font-display text-2xl font-semibold text-cinema-primary">
                  Revenue Reports (Verified Collections Only)
                </h2>
                <p className="text-sm text-cinema-muted">
                  Financial summary excluding pending, failed, or cancelled bookings.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-cinema-surface border border-cinema-accent/60 p-5">
                  <p className="text-xs uppercase tracking-[0.12em] text-cinema-muted">
                    Verified Ticket Revenue
                  </p>
                  <p className="font-mono text-2xl font-bold text-cinema-primary tabular-nums mt-1">
                    {formatINR(verifiedTicketRevenue)}
                  </p>
                </div>
                <div className="bg-cinema-surface border border-cinema-accent/60 p-5">
                  <p className="text-xs uppercase tracking-[0.12em] text-cinema-muted">
                    Verified Mocktail Revenue
                  </p>
                  <p className="font-mono text-2xl font-bold text-cinema-primary tabular-nums mt-1">
                    {formatINR(verifiedMocktailRevenue)}
                  </p>
                </div>
                <div className="bg-cinema-primary text-cinema-bg border border-cinema-accent p-5">
                  <p className="text-xs uppercase tracking-[0.12em] text-cinema-accent-light">
                    Total Collected Revenue
                  </p>
                  <p className="font-mono text-2xl font-bold tabular-nums mt-1">
                    {formatINR(totalVerifiedRevenue)}
                  </p>
                </div>
              </div>

              <div className="bg-cinema-surface border border-cinema-accent/60 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-cinema-surface-alt border-b border-cinema-accent/40 text-cinema-primary uppercase">
                    <tr>
                      <th className="py-3 px-4">Show ID</th>
                      <th className="py-3 px-4">Date & Time</th>
                      <th className="py-3 px-4 text-right">Occupancy</th>
                      <th className="py-3 px-4 text-right">Ticket Revenue</th>
                      <th className="py-3 px-4 text-right">Mocktail Revenue</th>
                      <th className="py-3 px-4 text-right">Verified Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cinema-accent/25">
                    {screenings.map((s) => {
                      const showVerified = bookings.filter(
                        (b) => b.screeningId === s.screeningId && b.paymentStatus === 'VERIFIED'
                      );
                      const tRev = showVerified.reduce((sum, b) => sum + b.ticketSubtotal, 0);
                      const mRev = showVerified.reduce((sum, b) => sum + b.mocktailSubtotal, 0);
                      const occ = Math.round(((s.bookedCount || 0) / s.seatCapacity) * 100);
                      return (
                        <tr key={s.screeningId}>
                          <td className="py-3 px-4 font-mono font-semibold">{s.screeningId}</td>
                          <td className="py-3 px-4">
                            {formatShowDate(s.date)} · {formatShowTime(s.startTime, s.endTime)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums">
                            {s.bookedCount || 0}/{s.seatCapacity} ({occ}%)
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums">
                            {formatINR(tRev)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums">
                            {formatINR(mRev)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-cinema-primary tabular-nums">
                            {formatINR(tRev + mRev)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 12. WEBSITE SETTINGS */}
          {section === 'WEBSITE_SETTINGS' && <WebsiteSettingsPanel settings={websiteSettings} />}

          {/* 12b. THEME & COLORS */}
          {section === 'THEME' && <ThemeCustomizationPanel settings={websiteSettings} />}

          {/* 13. CANCELLATION & REFUNDS */}
          {section === 'REFUNDS' && <RefundsSubpanel refunds={refunds} />}

          {/* 14. ADMIN MANAGEMENT */}
          {section === 'ADMINS' && <AdminManagementSubpanel admins={admins} />}

          {/* 15. ACTIVITY LOG */}
          {section === 'LOGS' && (
            <div className="space-y-6">
              <div className="border-b border-cinema-accent/40 pb-4">
                <h2 className="font-display text-2xl font-semibold text-cinema-primary">Activity Log</h2>
                <p className="text-sm text-cinema-muted">
                  Immutable chronological audit trail of administrative operations.
                </p>
              </div>
              <div className="bg-cinema-surface border border-cinema-accent/60 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-cinema-surface-alt border-b border-cinema-accent/40 text-cinema-primary uppercase">
                    <tr>
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4">Actor</th>
                      <th className="py-3 px-4">Target</th>
                      <th className="py-3 px-4">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cinema-accent/25">
                    {auditLogs.map((log) => (
                      <tr key={log.logId}>
                        <td className="py-3 px-4 font-mono font-semibold text-cinema-primary">
                          {log.action}
                        </td>
                        <td className="py-3 px-4 font-mono">{log.actorEmail}</td>
                        <td className="py-3 px-4 font-mono">
                          {log.targetType}:{log.targetId}
                        </td>
                        <td className="py-3 px-4">{log.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
              </>
            );
          })()}
        </main>
      </div>
    </div>
    <PrintableTicketModal
      ticket={printBookingTicket}
      onClose={() => setPrintBookingTicket(null)}
    />
    </>
  );
}

// ---------------- Subpanels ----------------

function MovieManagementSubpanel({
  movie,
  castMembers,
  onOpenCastPanel,
}: {
  movie: MovieRecord;
  castMembers: CastMemberRecord[];
  onOpenCastPanel: () => void;
}) {
  const { user, hasFeature } = useAuth();
  const canEditAllMovie = hasFeature('manageMovies');
  const canEditPoster = hasFeature('manageShowPosters') || canEditAllMovie;
  const [form, setForm] = useState<MovieRecord>(movie);
  const [saving, setSaving] = useState(false);
  const [uploadingCastId, setUploadingCastId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    setForm(movie);
  }, [movie]);

  const handlePosterUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrMsg(null);
    try {
      const compressed = await compressImageFile(file, 900, 0.82);
      if (compressed.length > 750000) {
        setErrMsg('Poster image is too large even after compression. Please use a smaller file.');
        return;
      }
      setForm((f) => ({ ...f, posterUrl: compressed }));
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Failed to process poster image.');
    } finally {
      e.target.value = '';
    }
  };

  const handleDirectCastPhotoUpload = async (
    member: CastMemberRecord,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !user || !canEditAllMovie) return;
    setErrMsg(null);
    setMsg(null);
    setUploadingCastId(member.castId);
    try {
      const compressed = await compressImageFile(file, 600, 0.82);
      if (compressed.length > 750000) {
        setErrMsg('Cast picture is too large after compression. Please choose a smaller image.');
        return;
      }
      const ref = doc(db, 'castMembers', member.castId);
      const existingSnap = await getDoc(ref);
      const batch = writeBatch(db);
      batch.set(ref, {
        castId: member.castId,
        movieId: member.movieId || movie.movieId || 'apne-beech',
        name: member.name,
        role: member.role || '',
        photoUrl: compressed,
        order: member.order ?? 1,
        createdAt:
          existingSnap.exists() && existingSnap.data().createdAt
            ? existingSnap.data().createdAt
            : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const logId = `LOG_${Date.now().toString(36).toUpperCase()}`;
      batch.set(doc(db, 'auditLogs', logId), {
        logId,
        action: 'UPDATE_CAST_PICTURE',
        actorEmail: user.email || '',
        actorUid: user.uid,
        targetType: 'castMember',
        targetId: member.castId,
        details: `Updated picture for cast & credits member "${member.name}".`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setMsg(`Picture updated for ${member.name} and published live.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload cast picture.';
      setErrMsg(message);
      if (message.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.WRITE, `castMembers/${member.castId}`);
      }
    } finally {
      setUploadingCastId(null);
      e.target.value = '';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canEditPoster) return;
    setSaving(true);
    setMsg(null);
    setErrMsg(null);
    try {
      const movieRef = doc(db, 'movies', movie.movieId);
      const existingSnap = await getDoc(movieRef);
      const batch = writeBatch(db);
      const existingCreatedAt = existingSnap.exists() ? existingSnap.data().createdAt : undefined;
      batch.set(movieRef, {
        movieId: movie.movieId,
        title: (canEditAllMovie ? form.title : movie.title).trim() || 'APNE BEECH',
        posterUrl: (form.posterUrl || '').trim(),
        trailerUrl: ((canEditAllMovie ? form.trailerUrl : movie.trailerUrl) || '').trim(),
        description: ((canEditAllMovie ? form.description : movie.description) || '').trim(),
        language: ((canEditAllMovie ? form.language : movie.language) || '').trim(),
        genre: ((canEditAllMovie ? form.genre : movie.genre) || '').trim(),
        duration: ((canEditAllMovie ? form.duration : movie.duration) || '').trim(),
        castAndCrew: ((canEditAllMovie ? form.castAndCrew : movie.castAndCrew) || '').trim(),
        certificate: ((canEditAllMovie ? form.certificate : movie.certificate) || '').trim(),
        releaseNote: ((canEditAllMovie ? form.releaseNote : movie.releaseNote) || '').trim(),
        active: canEditAllMovie ? form.active : movie.active,
        createdAt: existingCreatedAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const logId = `LOG_${Date.now().toString(36).toUpperCase()}`;
      batch.set(doc(db, 'auditLogs', logId), {
        logId,
        action: canEditAllMovie ? 'UPDATE_MOVIE_DETAILS' : 'UPDATE_MOVIE_POSTER',
        actorEmail: user.email || '',
        actorUid: user.uid,
        targetType: 'movie',
        targetId: movie.movieId,
        details: canEditAllMovie
          ? `Updated movie details for ${form.title}.`
          : `Updated official film poster for ${movie.title}.`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setMsg(
        canEditAllMovie
          ? 'Movie details updated and published live.'
          : 'Film poster updated and published live.'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save movie details.';
      setErrMsg(message);
      if (message.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.WRITE, `movies/${movie.movieId}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const previewPoster = (form.posterUrl || '').trim() || DEFAULT_POSTER_URL;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="border-b border-cinema-accent/40 pb-4">
        <h2 className="font-display text-2xl font-semibold text-cinema-primary">Movie Management</h2>
        <p className="text-sm text-cinema-muted">
          Update title, poster artwork, trailer video URL, description, language, genre, and runtime.
        </p>
      </div>
      {msg && (
        <div className="bg-[#DCFCE7] border border-[#16A34A] p-3 text-xs font-semibold text-[#14532D]">
          {msg}
        </div>
      )}
      {errMsg && (
        <div className="bg-[#FEE2E2] border border-[#DC2626] p-3 text-xs font-semibold text-[#991B1B]">
          {errMsg}
        </div>
      )}
      <form
        onSubmit={(e) => void handleSave(e)}
        className="bg-cinema-surface border border-cinema-accent/60 p-6 space-y-4 text-xs"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-semibold mb-1">Movie Title</label>
            <input
              type="text"
              required
              disabled={!canEditAllMovie}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Release Banner Note</label>
            <input
              type="text"
              disabled={!canEditAllMovie}
              value={form.releaseNote || ''}
              onChange={(e) => setForm({ ...form, releaseNote: e.target.value })}
              className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Language</label>
            <input
              type="text"
              disabled={!canEditAllMovie}
              value={form.language || ''}
              onChange={(e) => setForm({ ...form, language: e.target.value })}
              placeholder="e.g. Hindi"
              className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Genre</label>
            <input
              type="text"
              disabled={!canEditAllMovie}
              value={form.genre || ''}
              onChange={(e) => setForm({ ...form, genre: e.target.value })}
              placeholder="e.g. Drama"
              className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Duration</label>
            <input
              type="text"
              disabled={!canEditAllMovie}
              value={form.duration || ''}
              onChange={(e) => setForm({ ...form, duration: e.target.value })}
              placeholder="e.g. 2h 15m"
              className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Certification</label>
            <input
              type="text"
              disabled={!canEditAllMovie}
              value={form.certificate || ''}
              onChange={(e) => setForm({ ...form, certificate: e.target.value })}
              placeholder="e.g. U/A"
              className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 disabled:opacity-60"
            />
          </div>
        </div>

        <div className="border border-cinema-accent/50 bg-cinema-bg p-4 space-y-3">
          <label className="block font-semibold text-cinema-primary">
            Official Film Poster URL or Upload Image
          </label>
          <div className="flex gap-3 items-start">
            <div className="w-16 h-24 shrink-0 border border-cinema-accent bg-cinema-dark-deep overflow-hidden">
              <img
                src={previewPoster}
                alt="Film Poster Preview"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 flex gap-2">
              <input
                type="text"
                disabled={!canEditPoster}
                value={form.posterUrl || ''}
                onChange={(e) => setForm({ ...form, posterUrl: e.target.value })}
                className="flex-1 px-3 py-2 bg-cinema-surface border border-cinema-accent/60 disabled:opacity-60"
              />
              {canEditPoster && (
                <label className="inline-flex items-center gap-1.5 px-3 py-2 border border-cinema-accent bg-cinema-surface cursor-pointer whitespace-nowrap">
                  <Upload className="w-3.5 h-3.5" />
                  Upload
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => void handlePosterUpload(e)}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>
        </div>

        <div>
          <label className="block font-semibold mb-1">Trailer Video URL (YouTube or MP4)</label>
          <input
            type="text"
            disabled={!canEditAllMovie}
            value={form.trailerUrl || ''}
            onChange={(e) => setForm({ ...form, trailerUrl: e.target.value })}
            placeholder="https://www.youtube.com/watch?v=... or direct MP4 URL"
            className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 disabled:opacity-60"
          />
        </div>

        <div>
          <label className="block font-semibold mb-1">Synopsis / Description</label>
          <textarea
            rows={4}
            disabled={!canEditAllMovie}
            value={form.description || ''}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 disabled:opacity-60"
          />
        </div>

        <div>
          <label className="block font-semibold mb-1">Cast & Crew Credits</label>
          <input
            type="text"
            disabled={!canEditAllMovie}
            value={form.castAndCrew || ''}
            onChange={(e) => setForm({ ...form, castAndCrew: e.target.value })}
            className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 disabled:opacity-60"
          />
        </div>

        <div className="border border-cinema-accent/50 bg-cinema-bg p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-cinema-primary">
                Cast & Credits Pictures ({castMembers.length})
              </p>
              <p className="text-[11px] text-cinema-muted">
                Upload or update portrait pictures directly for cast members shown in Cast & Credits.
              </p>
            </div>
            {canEditAllMovie && (
              <button
                type="button"
                onClick={onOpenCastPanel}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cinema-primary text-cinema-bg font-semibold uppercase tracking-[0.1em] hover:bg-cinema-primary-hover cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Cast & Picture
              </button>
            )}
          </div>

          {castMembers.length === 0 ? (
            <div className="p-3 border border-dashed border-cinema-accent/60 bg-cinema-surface text-cinema-muted flex items-center justify-between gap-3">
              <span>No individual cast portraits added yet.</span>
              {canEditAllMovie && (
                <button
                  type="button"
                  onClick={onOpenCastPanel}
                  className="text-cinema-primary font-semibold underline cursor-pointer whitespace-nowrap"
                >
                  Open Cast & Credits
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {castMembers.map((member) => (
                <div
                  key={member.castId}
                  className="flex items-center gap-3 p-2.5 bg-cinema-surface border border-cinema-accent/40"
                >
                  <div className="w-11 h-14 shrink-0 border border-cinema-accent/60 bg-cinema-dark-deep overflow-hidden flex items-center justify-center">
                    {member.photoUrl ? (
                      <img
                        src={member.photoUrl}
                        alt={member.name}
                        className="w-full h-full object-cover object-top"
                      />
                    ) : (
                      <User className="w-4 h-4 text-cinema-accent-light/70" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-cinema-primary truncate">{member.name}</p>
                    <p className="text-[11px] text-cinema-muted truncate">
                      {member.role || 'Main Cast'}
                    </p>
                  </div>
                  {canEditAllMovie && (
                    <label className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-cinema-accent bg-cinema-bg text-cinema-primary font-semibold hover:bg-cinema-surface-alt cursor-pointer shrink-0">
                      <Camera className="w-3 h-3" />
                      {uploadingCastId === member.castId
                        ? 'Saving...'
                        : member.photoUrl
                        ? 'Change Picture'
                        : 'Add Picture'}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={uploadingCastId === member.castId}
                        onChange={(e) => void handleDirectCastPhotoUpload(member, e)}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={saving || !canEditPoster}
          className="px-6 py-3 bg-cinema-primary text-cinema-bg font-bold uppercase tracking-[0.14em] hover:bg-cinema-primary-hover cursor-pointer disabled:opacity-50"
        >
          {saving ? 'Saving...' : canEditAllMovie ? 'Save Movie Details' : 'Update Poster'}
        </button>
      </form>
    </div>
  );
}

function SeatManagementSubpanel({
  screenings,
  selectedShowId,
  onSelectShowId,
  seats,
}: {
  screenings: { screeningId: string; date: string; startTime: string }[];
  selectedShowId: string;
  onSelectShowId: (id: string) => void;
  seats: SeatRecord[];
}) {
  const { user, hasFeature } = useAuth();
  const canEditSeats = hasFeature('manageSeats') || hasFeature('manageBookingsAndPayments');
  const [msg, setMsg] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<string>('A');
  const [bulkBusy, setBulkBusy] = useState(false);

  const seatMap = useMemo(() => {
    const m = new Map<string, SeatRecord>();
    for (const s of seats) m.set(s.seatNumber, s);
    return m;
  }, [seats]);

  const toggleBlockSeat = async (seat: SeatRecord) => {
    if (!user || !canEditSeats) return;
    if (seat.status === 'BOOKED' || seat.status === 'RESERVED') {
      setMsg(`Seat ${seat.seatNumber} has an active booking (${seat.status}) and cannot be modified here.`);
      return;
    }
    setMsg(null);
    const nextStatus = seat.status === 'BLOCKED' ? 'AVAILABLE' : 'BLOCKED';
    try {
      await setDoc(
        doc(db, 'seats', seat.seatDocId),
        {
          ...seat,
          status: nextStatus,
          heldByUid: null,
          holdExpiresAt: null,
          bookingId: null,
          blockedReason: nextStatus === 'BLOCKED' ? 'Blocked by admin' : null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setMsg(`Seat ${seat.seatNumber} updated to ${nextStatus}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `seats/${seat.seatDocId}`);
    }
  };

  const handleBulkRowAction = async (targetStatus: 'BLOCKED' | 'AVAILABLE') => {
    if (!user || !canEditSeats || !selectedShowId) return;
    const rowSeats = seats.filter(
      (s) =>
        s.row === selectedRow &&
        (targetStatus === 'BLOCKED' ? s.status === 'AVAILABLE' : s.status === 'BLOCKED')
    );
    if (rowSeats.length === 0) {
      setMsg(`No eligible seats in Row ${selectedRow} to set to ${targetStatus}.`);
      return;
    }
    setBulkBusy(true);
    setMsg(null);
    try {
      const batch = writeBatch(db);
      for (const s of rowSeats) {
        batch.update(doc(db, 'seats', s.seatDocId), {
          status: targetStatus,
          heldByUid: null,
          holdExpiresAt: null,
          bookingId: null,
          blockedReason: targetStatus === 'BLOCKED' ? `Row ${selectedRow} blocked by admin` : null,
          updatedAt: serverTimestamp(),
        });
      }
      const logId = `LOG_${Date.now().toString(36).toUpperCase()}`;
      batch.set(doc(db, 'auditLogs', logId), {
        logId,
        action: targetStatus === 'BLOCKED' ? 'BULK_BLOCK_ROW' : 'BULK_UNBLOCK_ROW',
        actorEmail: user.email || '',
        actorUid: user.uid,
        targetType: 'screening',
        targetId: selectedShowId,
        details: `Set ${rowSeats.length} seat(s) in Row ${selectedRow} to ${targetStatus}.`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setMsg(`Updated ${rowSeats.length} seat(s) in Row ${selectedRow} to ${targetStatus}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'seats');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleUnblockAll = async () => {
    if (!user || !canEditSeats || !selectedShowId) return;
    const blocked = seats.filter((s) => s.status === 'BLOCKED');
    if (blocked.length === 0) {
      setMsg('No blocked seats on this screening.');
      return;
    }
    setBulkBusy(true);
    setMsg(null);
    try {
      const batch = writeBatch(db);
      for (const s of blocked) {
        batch.update(doc(db, 'seats', s.seatDocId), {
          status: 'AVAILABLE',
          heldByUid: null,
          holdExpiresAt: null,
          bookingId: null,
          blockedReason: null,
          updatedAt: serverTimestamp(),
        });
      }
      const logId = `LOG_${Date.now().toString(36).toUpperCase()}`;
      batch.set(doc(db, 'auditLogs', logId), {
        logId,
        action: 'UNBLOCK_ALL_SEATS',
        actorEmail: user.email || '',
        actorUid: user.uid,
        targetType: 'screening',
        targetId: selectedShowId,
        details: `Unblocked all ${blocked.length} blocked seat(s) on ${selectedShowId}.`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setMsg(`Unblocked all ${blocked.length} blocked seat(s).`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'seats');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleReleaseExpiredHolds = async () => {
    if (!user || !canEditSeats || !selectedShowId) return;
    const now = Date.now();
    const expired = seats.filter((s) => {
      if (s.status !== 'HELD') return false;
      const exp = s.holdExpiresAt ? Date.parse(s.holdExpiresAt) : 0;
      return !exp || exp < now;
    });
    if (expired.length === 0) {
      setMsg('No expired seat holds found on this screening.');
      return;
    }
    setBulkBusy(true);
    setMsg(null);
    try {
      const batch = writeBatch(db);
      for (const s of expired) {
        batch.update(doc(db, 'seats', s.seatDocId), {
          status: 'AVAILABLE',
          heldByUid: null,
          holdExpiresAt: null,
          bookingId: null,
          blockedReason: null,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      setMsg(`Released ${expired.length} expired seat hold(s) back to AVAILABLE.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'seats');
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cinema-accent/40 pb-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-cinema-primary">Seat Management</h2>
          <p className="text-sm text-cinema-muted">
            Click individual seats or use bulk row controls to block/unblock VIP seats or release expired holds.
          </p>
        </div>
        <select
          value={selectedShowId}
          onChange={(e) => onSelectShowId(e.target.value)}
          className="px-3 py-2 bg-cinema-surface border border-cinema-accent/60 text-xs"
        >
          {screenings.map((s) => (
            <option key={s.screeningId} value={s.screeningId}>
              {s.screeningId} · {s.date} ({s.startTime || 'TBA'})
            </option>
          ))}
        </select>
      </div>

      {canEditSeats && (
        <div className="bg-cinema-surface border border-cinema-accent/60 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-cinema-primary">Bulk Row Action:</span>
            <select
              value={selectedRow}
              onChange={(e) => setSelectedRow(e.target.value)}
              className="px-2.5 py-1.5 bg-cinema-bg border border-cinema-accent/60 font-mono"
            >
              {SEAT_ROWS.map((r) => (
                <option key={r} value={r}>
                  Row {r}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => void handleBulkRowAction('BLOCKED')}
              className="inline-flex items-center gap-1 px-3 py-1.5 border border-[#991B1B]/50 text-[#991B1B] hover:bg-[#FEE2E2] cursor-pointer"
            >
              <Ban className="w-3.5 h-3.5" />
              Block Row
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => void handleBulkRowAction('AVAILABLE')}
              className="inline-flex items-center gap-1 px-3 py-1.5 border border-cinema-accent text-cinema-primary hover:bg-cinema-surface-alt cursor-pointer"
            >
              <Unlock className="w-3.5 h-3.5" />
              Unblock Row
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => void handleUnblockAll()}
              className="px-3 py-1.5 border border-cinema-accent hover:bg-cinema-surface-alt cursor-pointer"
            >
              Unblock All Seats
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => void handleReleaseExpiredHolds()}
              className="px-3 py-1.5 border border-[#D97706] text-[#92400E] hover:bg-[#FEF3C7] cursor-pointer"
            >
              Release Expired Holds
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div className="bg-cinema-surface-alt border border-cinema-accent p-3 text-xs font-semibold">{msg}</div>
      )}

      <div className="bg-cinema-surface border border-cinema-accent/60 p-8 max-w-lg mx-auto space-y-6">
        <div className="text-center text-[11px] uppercase tracking-[0.25em] text-cinema-muted border-b border-cinema-accent/40 pb-2">
          Cinema Screen
        </div>
        <div className="space-y-3">
          {SEAT_ROWS.map((row) => (
            <div key={row} className="flex items-center gap-3">
              <span className="w-5 font-mono text-xs font-bold text-cinema-muted">{row}</span>
              <div className="grid grid-cols-6 gap-2.5 flex-1">
                {SEAT_COLS.map((col) => {
                  const num = `${row}${col}`;
                  const seat = seatMap.get(num);
                  if (!seat) return null;
                  const cls =
                    seat.status === 'BOOKED'
                      ? 'bg-cinema-dark text-cinema-accent-light/85 cursor-not-allowed'
                      : seat.status === 'RESERVED' || seat.status === 'HELD'
                      ? 'bg-[#FEF3C7] border-[#D97706] text-[#92400E] cursor-not-allowed'
                      : seat.status === 'BLOCKED'
                      ? 'bg-[#E5E0D8] border-[#991B1B] text-[#991B1B] line-through'
                      : 'bg-cinema-bg border-cinema-accent text-cinema-text hover:bg-cinema-surface-alt';
                  return (
                    <button
                      key={num}
                      type="button"
                      disabled={!canEditSeats}
                      onClick={() => void toggleBlockSeat(seat)}
                      title={`${num} — ${seat.status}`}
                      className={`h-11 border font-mono text-xs font-semibold cursor-pointer ${cls}`}
                    >
                      {num}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RefundsSubpanel({ refunds }: { refunds: RefundRecord[] }) {
  const { user } = useAuth();

  const updateRefund = async (
    r: RefundRecord,
    field: 'refundStatus' | 'notificationStatus',
    value: string
  ) => {
    if (!user) return;
    try {
      await setDoc(
        doc(db, 'refunds', r.refundId),
        { ...r, [field]: value, processedBy: user.email || '', updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `refunds/${r.refundId}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-cinema-accent/40 pb-4">
        <h2 className="font-display text-2xl font-semibold text-cinema-primary">
          Cancellation & Refunds
        </h2>
        <p className="text-sm text-cinema-muted">
          Track refunds and customer notifications from cancelled bookings or removed shows.
        </p>
      </div>
      <div className="bg-cinema-surface border border-cinema-accent/60 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-cinema-surface-alt border-b border-cinema-accent/40 text-cinema-primary uppercase">
            <tr>
              <th className="py-3 px-4">Booking / Show</th>
              <th className="py-3 px-4">Customer</th>
              <th className="py-3 px-4 text-right">Refund Amount</th>
              <th className="py-3 px-4">Reason</th>
              <th className="py-3 px-4">Refund Status</th>
              <th className="py-3 px-4">Notification</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cinema-accent/25">
            {refunds.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-cinema-muted">
                  No cancellations or refund records.
                </td>
              </tr>
            ) : (
              refunds.map((r) => (
                <tr key={r.refundId}>
                  <td className="py-3 px-4 font-mono">
                    {r.bookingId} · {r.screeningId}
                  </td>
                  <td className="py-3 px-4">
                    <p className="font-semibold">{r.customerName}</p>
                    <p className="text-[11px] text-cinema-muted">{r.customerEmail}</p>
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold tabular-nums">
                    {formatINR(r.amount)}
                  </td>
                  <td className="py-3 px-4">{r.reason}</td>
                  <td className="py-3 px-4">
                    <select
                      value={r.refundStatus}
                      onChange={(e) => void updateRefund(r, 'refundStatus', e.target.value)}
                      className="px-2 py-1 bg-cinema-bg border border-cinema-accent/60 font-mono"
                    >
                      <option value="PENDING">PENDING</option>
                      <option value="PROCESSED">PROCESSED</option>
                      <option value="NOT_APPLICABLE">NOT_APPLICABLE</option>
                    </select>
                  </td>
                  <td className="py-3 px-4">
                    <select
                      value={r.notificationStatus}
                      onChange={(e) => void updateRefund(r, 'notificationStatus', e.target.value)}
                      className="px-2 py-1 bg-cinema-bg border border-cinema-accent/60 font-mono"
                    >
                      <option value="PENDING">PENDING</option>
                      <option value="SENT">SENT</option>
                    </select>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PERMISSION_ITEMS: Array<{
  key: keyof AdminPermissions;
  label: string;
  description: string;
}> = [
  {
    key: 'managePaymentSettings',
    label: 'Add / Edit UPI ID & QR Code',
    description: 'Configure UPI ID, upload or generate payment QR code, and set payment mode.',
  },
  {
    key: 'manageShowTimings',
    label: 'Add / Edit Show Timings',
    description: 'Configure show dates, start/end times, ticket pricing, and sales status.',
  },
  {
    key: 'addShows',
    label: 'Add New Shows',
    description: 'Create new screening dates and initialize 6×6 seat inventories.',
  },
  {
    key: 'removeShows',
    label: 'Remove / Cancel Shows',
    description: 'Safely delete unbooked shows or cancel shows with refund generation.',
  },
  {
    key: 'manageShowPosters',
    label: 'Change Poster of Shows',
    description: 'Upload or update posters for individual shows and featured film display.',
  },
  {
    key: 'manageAccessFeatures',
    label: 'Update Access Features',
    description: 'Authorize or revoke admin emails and customize granular panel permissions.',
  },
  {
    key: 'manageMovies',
    label: 'Movie & Cast Management',
    description: 'Edit film details, trailer, synopsis, and unlimited main cast members with photos.',
  },
  {
    key: 'manageBookingsAndPayments',
    label: 'Bookings, Payments & Refunds',
    description: 'Verify UPI payments, cancel bookings, manage refunds, and view revenue.',
  },
  {
    key: 'boxOfficeCounter',
    label: 'Box Office Walk-In Counter',
    description: 'Issue walk-in Cash, Counter UPI, and Complimentary VIP tickets directly.',
  },
  {
    key: 'manageSeats',
    label: 'Seat Blocking & Inventory',
    description: 'Block/unblock auditorium seats or entire rows and release expired seat holds.',
  },
  {
    key: 'manageMocktails',
    label: 'Mocktails & Seat Orders',
    description: 'Manage mocktail beverage catalog and seat-wise delivery statuses.',
  },
  {
    key: 'ticketScanner',
    label: 'Ticket QR Scanner & Directory',
    description: 'Scan customer QR tickets, inspect issued passes, and manually check in/reset.',
  },
  {
    key: 'manageTheme',
    label: 'Change Theme & Colors Anytime',
    description: 'Customize presets or hex colors across both Web App & Admin Panel anytime.',
  },
  {
    key: 'manageRowPricing',
    label: 'Edit Row-Wise Ticket Prices',
    description: 'Change each row price (A–F) per show or in bulk anytime.',
  },
  {
    key: 'grantDiscountsAndComps',
    label: 'Grant Discounts & Complimentary Drinks',
    description: 'Apply flat/% discounts at Box Office and grant ₹0 complimentary mocktails.',
  },
  {
    key: 'printTickets',
    label: 'Print Counter & Verified Tickets',
    description: 'Print A5 passes or 80mm thermal receipts directly from Counter, Bookings & Tickets.',
  },
  {
    key: 'manageWebsiteSettings',
    label: 'Website Settings & Hero Backdrop',
    description: 'Edit cinema branding, hero backdrop, announcement ribbon, policies, and footer.',
  },
  {
    key: 'viewReportsAndLogs',
    label: 'Revenue Reports & Audit Logs',
    description: 'View verified financial revenue breakdowns and chronological activity audit logs.',
  },
];

const EMPTY_PERMISSIONS: AdminPermissions = {
  managePaymentSettings: false,
  manageShowTimings: false,
  addShows: false,
  removeShows: false,
  manageShowPosters: false,
  manageAccessFeatures: false,
  manageMovies: false,
  manageBookingsAndPayments: false,
  boxOfficeCounter: false,
  manageSeats: false,
  manageMocktails: false,
  ticketScanner: false,
  manageWebsiteSettings: false,
  viewReportsAndLogs: false,
  manageTheme: false,
  manageRowPricing: false,
  grantDiscountsAndComps: false,
  printTickets: false,
};

const STAFF_DEFAULT_PERMISSIONS: AdminPermissions = {
  ...EMPTY_PERMISSIONS,
  boxOfficeCounter: true,
  manageMocktails: true,
  ticketScanner: true,
  printTickets: true,
};

const LIMITED_ROLE_PRESETS: Array<{ label: string; role: AdminRole; perms: AdminPermissions }> = [
  {
    label: 'Box Office & Print Clerk',
    role: 'STAFF',
    perms: {
      ...EMPTY_PERMISSIONS,
      boxOfficeCounter: true,
      printTickets: true,
      ticketScanner: true,
    },
  },
  {
    label: 'Gate QR Scanner Only',
    role: 'STAFF',
    perms: {
      ...EMPTY_PERMISSIONS,
      ticketScanner: true,
      printTickets: true,
    },
  },
  {
    label: 'Show & Row Pricing Manager',
    role: 'ADMIN',
    perms: {
      ...EMPTY_PERMISSIONS,
      addShows: true,
      manageShowTimings: true,
      manageRowPricing: true,
      manageShowPosters: true,
    },
  },
  {
    label: 'Theme & Color Editor',
    role: 'ADMIN',
    perms: {
      ...EMPTY_PERMISSIONS,
      manageTheme: true,
    },
  },
  {
    label: 'Mocktail Bar & Comp Staff',
    role: 'STAFF',
    perms: {
      ...EMPTY_PERMISSIONS,
      manageMocktails: true,
      grantDiscountsAndComps: true,
    },
  },
];

function AdminManagementSubpanel({ admins }: { admins: AdminRecord[] }) {
  const { user, hasFeature } = useAuth();
  const canManageAccess = hasFeature('manageAccessFeatures');

  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<AdminRole>('ADMIN');
  const [newPermissions, setNewPermissions] = useState<AdminPermissions>({
    ...FULL_ADMIN_PERMISSIONS,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Edit existing admin access modal
  const [editingAdmin, setEditingAdmin] = useState<AdminRecord | null>(null);
  const [editRole, setEditRole] = useState<AdminRole>('ADMIN');
  const [editActive, setEditActive] = useState(true);
  const [editPermissions, setEditPermissions] = useState<AdminPermissions>({
    ...FULL_ADMIN_PERMISSIONS,
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const handleRoleChangeForNew = (role: AdminRole) => {
    setNewRole(role);
    setNewPermissions(role === 'STAFF' ? { ...STAFF_DEFAULT_PERMISSIONS } : { ...FULL_ADMIN_PERMISSIONS });
  };

  const openEditAccess = (admin: AdminRecord) => {
    setEditingAdmin(admin);
    setEditRole(admin.role === 'STAFF' ? 'STAFF' : 'ADMIN');
    setEditActive(admin.active);
    setEditPermissions({
      ...FULL_ADMIN_PERMISSIONS,
      ...(admin.permissions || {}),
    });
    setErrMsg(null);
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canManageAccess) return;
    const cleanEmail = newEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) return;
    setSaving(true);
    setMsg(null);
    setErrMsg(null);
    try {
      const adminRef = doc(db, 'admins', cleanEmail);
      const existingSnap = await getDoc(adminRef);
      const batch = writeBatch(db);
      batch.set(adminRef, {
        email: cleanEmail,
        role: newRole,
        active: true,
        addedBy: user.email || '',
        permissions: newPermissions,
        createdAt: existingSnap.exists() && existingSnap.data().createdAt ? existingSnap.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const logId = `LOG_${Date.now().toString(36).toUpperCase()}`;
      batch.set(doc(db, 'auditLogs', logId), {
        logId,
        action: 'ADD_ADMIN',
        actorEmail: user.email || '',
        actorUid: user.uid,
        targetType: 'admin',
        targetId: cleanEmail,
        details: `Granted ${newRole} access to ${cleanEmail} with ${
          Object.values(newPermissions).filter(Boolean).length
        }/${PERMISSION_ITEMS.length} access features.`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setNewEmail('');
      setMsg(`Authorized ${cleanEmail} (${newRole}) with selected access features.`);
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Failed to authorize admin.';
      setErrMsg(m);
      if (m.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.WRITE, `admins/${cleanEmail}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEditedAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !editingAdmin || !canManageAccess) return;
    setSavingEdit(true);
    setMsg(null);
    setErrMsg(null);
    try {
      const adminRef = doc(db, 'admins', editingAdmin.email);
      const existingSnap = await getDoc(adminRef);
      const batch = writeBatch(db);
      batch.set(adminRef, {
        email: editingAdmin.email,
        role: editRole,
        active: editActive,
        addedBy: editingAdmin.addedBy || user.email || '',
        permissions: editPermissions,
        createdAt:
          existingSnap.exists() && existingSnap.data().createdAt
            ? existingSnap.data().createdAt
            : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const enabledCount = Object.values(editPermissions).filter(Boolean).length;
      const logId = `LOG_${Date.now().toString(36).toUpperCase()}`;
      batch.set(doc(db, 'auditLogs', logId), {
        logId,
        action: 'UPDATE_ADMIN_ACCESS',
        actorEmail: user.email || '',
        actorUid: user.uid,
        targetType: 'admin',
        targetId: editingAdmin.email,
        details: `Updated access features for ${editingAdmin.email}: role=${editRole}, active=${editActive}, features=${enabledCount}/${PERMISSION_ITEMS.length}.`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setMsg(`Access features updated for ${editingAdmin.email}.`);
      setEditingAdmin(null);
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Failed to update access features.';
      setErrMsg(m);
      if (m.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.WRITE, `admins/${editingAdmin.email}`);
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRevoke = async (email: string) => {
    if (!user || !canManageAccess || email === 'mypersonaluse2013@gmail.com') return;
    setMsg(null);
    setErrMsg(null);
    try {
      await deleteDoc(doc(db, 'admins', email));
      const logId = `LOG_${Date.now().toString(36).toUpperCase()}`;
      await setDoc(doc(db, 'auditLogs', logId), {
        logId,
        action: 'REVOKE_ADMIN',
        actorEmail: user.email || '',
        actorUid: user.uid,
        targetType: 'admin',
        targetId: email,
        details: `Revoked administrator access for ${email}.`,
        createdAt: serverTimestamp(),
      });
      setMsg(`Revoked access for ${email}.`);
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Failed to revoke administrator.';
      setErrMsg(m);
      if (m.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.DELETE, `admins/${email}`);
      }
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="border-b border-cinema-accent/40 pb-4">
        <h2 className="font-display text-2xl font-semibold text-cinema-primary">
          Admin & Access Feature Management
        </h2>
        <p className="text-sm text-cinema-muted">
          Authorize Google administrator accounts and configure granular permissions (UPI ID, QR code, show timings, add/remove shows, show posters, and access features).
        </p>
      </div>

      {msg && (
        <div className="bg-[#DCFCE7] border border-[#16A34A] p-3 text-xs font-semibold text-[#14532D]">
          {msg}
        </div>
      )}
      {errMsg && (
        <div className="bg-[#FEE2E2] border border-[#DC2626] p-3 text-xs font-semibold text-[#991B1B]">
          {errMsg}
        </div>
      )}

      {canManageAccess ? (
        <form
          onSubmit={(e) => void handleAddAdmin(e)}
          className="bg-cinema-surface border border-cinema-accent/60 p-5 space-y-4 text-xs"
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="block font-semibold mb-1">Google Email Address</label>
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="staff@gmail.com"
                className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Role</label>
              <select
                value={newRole}
                onChange={(e) => handleRoleChangeForNew(e.target.value as AdminRole)}
                className="px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
              >
                <option value="ADMIN">ADMIN</option>
                <option value="STAFF">STAFF</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-cinema-primary text-cinema-bg font-bold uppercase tracking-[0.12em] cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              {saving ? 'Saving...' : 'Authorize Admin'}
            </button>
          </div>

          <div className="border-t border-cinema-accent/30 pt-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-cinema-primary uppercase tracking-[0.1em]">
                Granted Access Features ({Object.values(newPermissions).filter(Boolean).length}/
                {PERMISSION_ITEMS.length})
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setNewPermissions({ ...FULL_ADMIN_PERMISSIONS })}
                  className="px-2 py-0.5 border border-cinema-primary text-[11px] font-semibold text-cinema-primary hover:bg-cinema-surface-alt cursor-pointer"
                >
                  Full Admin
                </button>
                <button
                  type="button"
                  onClick={() => setNewPermissions({ ...STAFF_DEFAULT_PERMISSIONS })}
                  className="px-2 py-0.5 border border-cinema-accent text-[11px] text-cinema-muted hover:bg-cinema-surface-alt cursor-pointer"
                >
                  Minimal Staff
                </button>
                {LIMITED_ROLE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setNewRole(preset.role);
                      setNewPermissions({ ...preset.perms });
                    }}
                    className="px-2 py-0.5 border border-cinema-accent/60 bg-cinema-bg text-[11px] hover:border-cinema-primary cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {PERMISSION_ITEMS.map((perm) => (
                <label
                  key={perm.key}
                  className="flex items-start gap-2 p-2 border border-cinema-accent/35 bg-cinema-bg cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(newPermissions[perm.key])}
                    onChange={(e) =>
                      setNewPermissions((prev) => ({
                        ...prev,
                        [perm.key]: e.target.checked,
                      }))
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-semibold text-cinema-text">{perm.label}</span>
                    <span className="block text-[11px] text-cinema-muted">{perm.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </form>
      ) : (
        <div className="bg-[#FEF3C7] border border-[#D97706] p-4 text-xs text-[#92400E]">
          Your account can view authorized administrators, but only accounts with the Update Access Features permission can add, edit, or revoke admin access.
        </div>
      )}

      <div className="bg-cinema-surface border border-cinema-accent/60 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-cinema-surface-alt border-b border-cinema-accent/40 text-cinema-primary uppercase">
            <tr>
              <th className="py-3 px-4">Email</th>
              <th className="py-3 px-4">Role & Status</th>
              <th className="py-3 px-4">Enabled Features</th>
              <th className="py-3 px-4">Added By</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cinema-accent/25">
            {admins.map((a) => {
              const perms =
                a.role === 'SUPER_ADMIN' || !a.permissions
                  ? FULL_ADMIN_PERMISSIONS
                  : a.permissions;
              const enabledCount = PERMISSION_ITEMS.filter((p) => Boolean(perms[p.key])).length;
              return (
                <tr key={a.email}>
                  <td className="py-3 px-4 font-mono font-semibold">{a.email}</td>
                  <td className="py-3 px-4 font-mono">
                    {a.role}{' '}
                    <span className={a.active ? 'text-[#166534]' : 'text-[#991B1B]'}>
                      ({a.active ? 'Active' : 'Disabled'})
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-cinema-primary tabular-nums">
                    {a.role === 'SUPER_ADMIN'
                      ? `All (${PERMISSION_ITEMS.length}/${PERMISSION_ITEMS.length})`
                      : `${enabledCount}/${PERMISSION_ITEMS.length} features`}
                  </td>
                  <td className="py-3 px-4 font-mono text-cinema-muted">{a.addedBy}</td>
                  <td className="py-3 px-4 text-right">
                    {a.email === 'mypersonaluse2013@gmail.com' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-cinema-primary text-cinema-accent-light font-mono text-[11px] font-bold">
                        <Crown className="w-3 h-3" />
                        Premium Owner
                      </span>
                    ) : canManageAccess ? (
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditAccess(a)}
                          className="px-3 py-1 border border-cinema-accent text-cinema-primary hover:bg-cinema-surface-alt inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          Update Access
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRevoke(a.email)}
                          className="px-3 py-1 border border-[#DC2626] text-[#991B1B] hover:bg-[#FEE2E2] cursor-pointer"
                        >
                          Revoke
                        </button>
                      </div>
                    ) : (
                      <span className="text-cinema-muted font-mono">Read Only</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit Existing Admin Access Features Modal */}
      {editingAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-cinema-dark-deep/80 overflow-y-auto">
          <div className="w-full max-w-2xl bg-cinema-surface border border-cinema-accent p-6 space-y-4 shadow-2xl my-8">
            <div className="flex items-start justify-between gap-4 border-b border-cinema-accent/30 pb-3">
              <div>
                <h3 className="font-display text-xl font-semibold text-cinema-primary">
                  Update Access Features
                </h3>
                <p className="font-mono text-xs text-cinema-muted">{editingAdmin.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingAdmin(null)}
                className="p-1 text-cinema-muted cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveEditedAccess(e)} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold mb-1">Role</label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as AdminRole)}
                    className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                  >
                    <option value="ADMIN">ADMIN</option>
                    <option value="STAFF">STAFF</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 px-3 py-2 border border-cinema-accent/60 bg-cinema-bg w-full cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editActive}
                      onChange={(e) => setEditActive(e.target.checked)}
                    />
                    <span className="font-semibold">Account Active (can access /admin)</span>
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-cinema-primary uppercase tracking-[0.1em]">
                    Permitted Admin Features
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditPermissions({ ...FULL_ADMIN_PERMISSIONS })}
                      className="px-2 py-0.5 border border-cinema-primary text-[11px] text-cinema-primary font-semibold cursor-pointer"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditPermissions({ ...STAFF_DEFAULT_PERMISSIONS })}
                      className="px-2 py-0.5 border border-cinema-accent text-[11px] text-cinema-muted cursor-pointer"
                    >
                      Minimal Staff
                    </button>
                    {LIMITED_ROLE_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setEditRole(preset.role);
                          setEditPermissions({ ...preset.perms });
                        }}
                        className="px-2 py-0.5 border border-cinema-accent/60 bg-cinema-bg text-[11px] cursor-pointer"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[340px] overflow-y-auto pr-1">
                  {PERMISSION_ITEMS.map((perm) => (
                    <label
                      key={perm.key}
                      className="flex items-start gap-2 p-2.5 border border-cinema-accent/40 bg-cinema-bg cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(editPermissions[perm.key])}
                        onChange={(e) =>
                          setEditPermissions((prev) => ({
                            ...prev,
                            [perm.key]: e.target.checked,
                          }))
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block font-semibold text-cinema-text">{perm.label}</span>
                        <span className="block text-[11px] text-cinema-muted">{perm.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-cinema-accent/30">
                <button
                  type="button"
                  onClick={() => setEditingAdmin(null)}
                  className="px-4 py-2 border border-cinema-accent cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2 bg-cinema-primary text-cinema-bg font-bold uppercase tracking-[0.12em] cursor-pointer"
                >
                  {savingEdit ? 'Saving...' : 'Save Access Features'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
