export type SalesStatus = 'OPEN' | 'CLOSED' | 'CANCELLED' | 'COMPLETED';
export type SeatStatus = 'AVAILABLE' | 'HELD' | 'RESERVED' | 'BOOKED' | 'BLOCKED';
export type PaymentStatus = 'PENDING' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
export type BookingStatus = 'HOLD' | 'PENDING_VERIFICATION' | 'CONFIRMED' | 'CANCELLED';
export type TicketStatus = 'VALID' | 'USED' | 'CANCELLED';
export type DeliveryStatus = 'PENDING_PAYMENT' | 'PREPARING' | 'READY' | 'DELIVERED' | 'CANCELLED';
export type PaymentMode = 'UNCONFIGURED' | 'MANUAL_UPI' | 'AUTOMATIC_GATEWAY';
export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'STAFF';

export type SeatRow = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type RowPriceMap = Partial<Record<SeatRow, number>>;
export type DiscountType = 'NONE' | 'FLAT' | 'PERCENT';

export interface AdminPermissions {
  managePaymentSettings: boolean;
  manageShowTimings: boolean;
  addShows: boolean;
  removeShows: boolean;
  manageShowPosters: boolean;
  manageAccessFeatures: boolean;
  manageMovies: boolean;
  manageBookingsAndPayments: boolean;
  boxOfficeCounter: boolean;
  manageSeats: boolean;
  manageMocktails: boolean;
  ticketScanner: boolean;
  manageWebsiteSettings: boolean;
  viewReportsAndLogs: boolean;
  manageTheme: boolean;
  manageRowPricing: boolean;
  grantDiscountsAndComps: boolean;
  printTickets: boolean;
}

export const FULL_ADMIN_PERMISSIONS: AdminPermissions = {
  managePaymentSettings: true,
  manageShowTimings: true,
  addShows: true,
  removeShows: true,
  manageShowPosters: true,
  manageAccessFeatures: true,
  manageMovies: true,
  manageBookingsAndPayments: true,
  boxOfficeCounter: true,
  manageSeats: true,
  manageMocktails: true,
  ticketScanner: true,
  manageWebsiteSettings: true,
  viewReportsAndLogs: true,
  manageTheme: true,
  manageRowPricing: true,
  grantDiscountsAndComps: true,
  printTickets: true,
};

export interface AdminRecord {
  email: string;
  role: AdminRole;
  active: boolean;
  addedBy: string;
  permissions?: AdminPermissions;
  createdAt: string;
  updatedAt: string;
}

export interface MovieRecord {
  movieId: string;
  title: string;
  posterUrl?: string;
  trailerUrl?: string;
  description?: string;
  language?: string;
  genre?: string;
  duration?: string;
  castAndCrew?: string;
  certificate?: string;
  releaseNote?: string;
  active: boolean;
  createdAt?: string;
  updatedAt: string;
}

export interface CastMemberRecord {
  castId: string;
  movieId: string;
  name: string;
  role: string;
  photoUrl: string;
  order: number;
  createdAt?: string;
  updatedAt: string;
}

export interface ScreeningRecord {
  screeningId: string;
  movieId: string;
  movieTitle: string;
  posterUrl?: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  ticketPrice: number;
  rowPrices?: RowPriceMap;
  seatCapacity: number;
  bookedCount: number;
  salesStatus: SalesStatus;
  isPublished: boolean;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SeatRecord {
  seatDocId: string;
  screeningId: string;
  seatNumber: string;
  row: string;
  col: number;
  status: SeatStatus;
  heldByUid?: string | null;
  holdExpiresAt?: string | null;
  bookingId?: string | null;
  blockedReason?: string | null;
  updatedAt: string;
}

export interface MocktailProduct {
  productId: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MocktailCartItem {
  productId: string;
  productName: string;
  price: number;
  quantity: number;
}

export interface SeatDrinkAssignment {
  seatNumber: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface BookingRecord {
  bookingId: string;
  screeningId: string;
  movieTitle: string;
  date: string;
  startTime: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  seatNumbers: string[];
  ticketPrice: number;
  ticketCount: number;
  ticketSubtotal: number;
  mocktailSubtotal: number;
  discountType?: DiscountType;
  discountValue?: number;
  discountAmount?: number;
  discountReason?: string;
  complimentaryDrinks?: boolean;
  grandTotal: number;
  paymentStatus: PaymentStatus;
  bookingStatus: BookingStatus;
  upiTransactionRef?: string;
  paymentMethod?: string;
  adminNotes?: string;
  refundStatus?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRecord {
  paymentId: string;
  bookingId: string;
  screeningId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  method: string;
  status: 'PENDING' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | 'FAILED' | 'REFUNDED';
  transactionRef?: string;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  verifiedBy?: string;
  verifiedAt?: string | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TicketRecord {
  ticketId: string;
  bookingId: string;
  screeningId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  movieTitle: string;
  date: string;
  startTime: string;
  seatNumbers: string[];
  mocktailSummary: string;
  discountAmount?: number;
  discountReason?: string;
  complimentaryDrinks?: boolean;
  grandTotal: number;
  qrPayload: string;
  ticketStatus: TicketStatus;
  checkedInAt?: string | null;
  checkedInBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MocktailOrderRecord {
  orderId: string;
  bookingId: string;
  screeningId: string;
  customerId: string;
  customerName: string;
  date: string;
  startTime: string;
  items: MocktailCartItem[];
  subtotal: number;
  paymentStatus: string;
  deliveryStatus: DeliveryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MocktailAssignmentRecord {
  assignmentId: string;
  bookingId: string;
  screeningId: string;
  customerId: string;
  customerName: string;
  date: string;
  startTime: string;
  seatNumber: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  paymentStatus: string;
  deliveryStatus: DeliveryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RefundRecord {
  refundId: string;
  bookingId: string;
  screeningId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  reason: string;
  refundStatus: 'PENDING' | 'PROCESSED' | 'NOT_APPLICABLE';
  notificationStatus: 'PENDING' | 'SENT';
  processedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CinemaTheme {
  presetId: string;
  primary: string;
  primaryHover: string;
  dark: string;
  darkDeep: string;
  accent: string;
  accentLight: string;
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
}

export interface WebsiteSettings {
  cinemaName: string;
  logoUrl?: string;
  heroBannerUrl?: string;
  announcementText?: string;
  contactNumber?: string;
  contactEmail?: string;
  cinemaAddress?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  youtubeUrl?: string;
  bookingPolicies?: string;
  footerText?: string;
  theme?: CinemaTheme;
  updatedAt: string;
}

export interface PaymentSettingsPublic {
  isConfigured: boolean;
  mode: PaymentMode;
  upiId?: string;
  displayName?: string;
  qrImageUrl?: string;
  instructions?: string;
  providerName?: string;
  testMode: boolean;
  updatedAt: string;
}

export interface PaymentSettingsPrivate {
  gatewayKeyId?: string;
  gatewayKeySecret?: string;
  webhookSecret?: string;
  updatedBy: string;
  updatedAt: string;
}

export interface AuditLogRecord {
  logId: string;
  action: string;
  actorEmail: string;
  actorUid: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt: string;
}

export interface ScanTicketResponse {
  status: 'VALID' | 'ALREADY_USED' | 'INVALID_TICKET' | 'PAYMENT_PENDING' | 'CANCELLED';
  badge: string;
  message: string;
  ticket?: TicketRecord;
  booking?: BookingRecord;
}
