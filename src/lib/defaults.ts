import type {
  CinemaTheme,
  MocktailProduct,
  MovieRecord,
  PaymentSettingsPublic,
  RowPriceMap,
  ScreeningRecord,
  SeatRecord,
  WebsiteSettings,
} from '../types/cinema';

export const HERO_BACKDROP_URL = '/src/assets/images/hero_splendora_cinema_1794903609583.jpg';
export const DEFAULT_POSTER_URL = '/src/assets/images/poster_apne_beech_placeholder_1794903609262.jpg';
export const DEFAULT_KALAKHATTA_URL = '/src/assets/images/mocktail_kalakhatta_fizz_1794903611201.jpg';
export const DEFAULT_SHIKANJI_URL = '/src/assets/images/mocktail_masala_shikanji_1794903611282.jpg';

export const SEAT_ROWS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export const SEAT_COLS = [1, 2, 3, 4, 5, 6] as const;
export const DEFAULT_TICKET_PRICE = 20;
export const DEFAULT_ROW_PRICES: Record<(typeof SEAT_ROWS)[number], number> = {
  A: 20,
  B: 20,
  C: 20,
  D: 20,
  E: 30,
  F: 30,
};

export const DEFAULT_THEME: CinemaTheme = {
  presetId: 'royal-burgundy',
  primary: '#5B0E1D',
  primaryHover: '#721627',
  dark: '#24070D',
  darkDeep: '#1A0509',
  accent: '#C6A15B',
  accentLight: '#E6C782',
  bg: '#FAF5EB',
  surface: '#FFFDF9',
  surfaceAlt: '#F3EADA',
  text: '#2A1812',
  muted: '#6B4F43',
};

export const THEME_PRESETS: Array<{ name: string; tagline: string; theme: CinemaTheme }> = [
  {
    name: 'Royal Burgundy & Antique Gold',
    tagline: 'Signature Splendora velvet & gilded Art Deco heritage.',
    theme: DEFAULT_THEME,
  },
  {
    name: 'Midnight Sapphire & Champagne',
    tagline: 'Deep twilight navy with luminous champagne brass accents.',
    theme: {
      presetId: 'midnight-sapphire',
      primary: '#16294F',
      primaryHover: '#1F3A6E',
      dark: '#0B1426',
      darkDeep: '#060C18',
      accent: '#C9A86A',
      accentLight: '#EAD29C',
      bg: '#F4F6FA',
      surface: '#FCFDFE',
      surfaceAlt: '#E7ECF4',
      text: '#131C2E',
      muted: '#505E75',
    },
  },
  {
    name: 'Emerald Velvet & Burnished Brass',
    tagline: 'Regal emerald theatre drapes with warm ivory & antique gold.',
    theme: {
      presetId: 'emerald-velvet',
      primary: '#114232',
      primaryHover: '#195B45',
      dark: '#09241B',
      darkDeep: '#041610',
      accent: '#C59B43',
      accentLight: '#E6C97D',
      bg: '#F4F7F4',
      surface: '#FCFDFC',
      surfaceAlt: '#E4EDE7',
      text: '#13241D',
      muted: '#496357',
    },
  },
  {
    name: 'Obsidian Noir & Rose Gold',
    tagline: 'Charcoal marquee noir paired with soft copper-rose shimmer.',
    theme: {
      presetId: 'obsidian-rosegold',
      primary: '#2A2124',
      primaryHover: '#3E3035',
      dark: '#141012',
      darkDeep: '#0A0809',
      accent: '#C88D74',
      accentLight: '#E8B8A2',
      bg: '#F7F3F1',
      surface: '#FEFCFB',
      surfaceAlt: '#EDE3DF',
      text: '#1F1819',
      muted: '#69585A',
    },
  },
  {
    name: 'Imperial Plum & Pearl Ivory',
    tagline: 'Rich aubergine & champagne silk for gala screenings.',
    theme: {
      presetId: 'imperial-plum',
      primary: '#4A154B',
      primaryHover: '#631E64',
      dark: '#220823',
      darkDeep: '#140415',
      accent: '#C79E52',
      accentLight: '#E7CA88',
      bg: '#FAF5F9',
      surface: '#FFFCFE',
      surfaceAlt: '#F0E4EE',
      text: '#261425',
      muted: '#664B64',
    },
  },
];

export const DEFAULT_MOVIE: MovieRecord = {
  movieId: 'apne-beech',
  title: 'APNE BEECH',
  posterUrl: DEFAULT_POSTER_URL,
  trailerUrl: '',
  description: '',
  language: '',
  genre: '',
  duration: '',
  castAndCrew: '',
  certificate: '',
  releaseNote: 'Royal Premiere Engagement · December 2026',
  active: true,
  updatedAt: new Date().toISOString(),
};

export const DEFAULT_SCREENINGS: ScreeningRecord[] = [
  {
    screeningId: 'SCR_20261225_01',
    movieId: 'apne-beech',
    movieTitle: 'APNE BEECH',
    date: '2026-12-25',
    startTime: '',
    endTime: '',
    ticketPrice: DEFAULT_TICKET_PRICE,
    rowPrices: { ...DEFAULT_ROW_PRICES },
    seatCapacity: 36,
    bookedCount: 0,
    salesStatus: 'OPEN',
    isPublished: true,
    description: 'Opening Night Screening — Timing to be configured by administration.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    screeningId: 'SCR_20261226_01',
    movieId: 'apne-beech',
    movieTitle: 'APNE BEECH',
    date: '2026-12-26',
    startTime: '',
    endTime: '',
    ticketPrice: DEFAULT_TICKET_PRICE,
    rowPrices: { ...DEFAULT_ROW_PRICES },
    seatCapacity: 36,
    bookedCount: 0,
    salesStatus: 'OPEN',
    isPublished: true,
    description: 'Second Day Screening — Timing to be configured by administration.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const DEFAULT_MOCKTAILS: MocktailProduct[] = [
  {
    productId: 'kalakhatta-fizz',
    name: 'Kalakhatta Fizz',
    description: 'A refreshing kala khatta-inspired fizzy mocktail.',
    price: 50,
    imageUrl: DEFAULT_KALAKHATTA_URL,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    productId: 'masala-shikanji',
    name: 'Masala Shikanji',
    description: 'A refreshing traditional masala shikanji.',
    price: 30,
    imageUrl: DEFAULT_SHIKANJI_URL,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const DEFAULT_WEBSITE_SETTINGS: WebsiteSettings = {
  cinemaName: 'SPLENDORA CINEMA',
  logoUrl: '',
  heroBannerUrl: '',
  announcementText: '',
  contactNumber: '',
  contactEmail: '',
  cinemaAddress: '',
  instagramUrl: '',
  facebookUrl: '',
  youtubeUrl: '',
  bookingPolicies:
    'Please arrive 20 minutes prior to showtime. Valid digital QR tickets are verified at the auditorium entrance. Ordered mocktails are delivered directly to your assigned seat when the film begins.',
  footerText: 'SPLENDORA CINEMA — Royal Vintage Cinema Experience',
  theme: DEFAULT_THEME,
  updatedAt: new Date().toISOString(),
};

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettingsPublic = {
  isConfigured: false,
  mode: 'UNCONFIGURED',
  upiId: '',
  displayName: '',
  qrImageUrl: '',
  instructions: '',
  providerName: '',
  testMode: true,
  updatedAt: new Date().toISOString(),
};

export function buildDefaultSeatsForScreening(screeningId: string): SeatRecord[] {
  const seats: SeatRecord[] = [];
  const now = new Date().toISOString();
  for (const row of SEAT_ROWS) {
    for (const col of SEAT_COLS) {
      const seatNumber = `${row}${col}`;
      seats.push({
        seatDocId: `${screeningId}_${seatNumber}`,
        screeningId,
        seatNumber,
        row,
        col,
        status: 'AVAILABLE',
        heldByUid: null,
        holdExpiresAt: null,
        bookingId: null,
        blockedReason: null,
        updatedAt: now,
      });
    }
  }
  return seats;
}

export function formatINR(amount: number): string {
  return `₹${Number(amount || 0).toLocaleString('en-IN')}`;
}

export function getSeatRowPrice(
  screening: Pick<ScreeningRecord, 'ticketPrice' | 'rowPrices'> | null | undefined,
  seatNumberOrRow: string
): number {
  const base = Number(screening?.ticketPrice ?? DEFAULT_TICKET_PRICE);
  const rowKey = String(seatNumberOrRow || '')
    .trim()
    .charAt(0)
    .toUpperCase() as keyof RowPriceMap;
  const custom = screening?.rowPrices?.[rowKey];
  if (typeof custom === 'number' && Number.isFinite(custom) && custom >= 0) {
    return custom;
  }
  if (!screening?.rowPrices && (rowKey === 'E' || rowKey === 'F') && base === DEFAULT_TICKET_PRICE) {
    return 30;
  }
  return Number.isFinite(base) && base >= 0 ? base : DEFAULT_TICKET_PRICE;
}

export function getScreeningPriceRange(
  screening: Pick<ScreeningRecord, 'ticketPrice' | 'rowPrices'> | null | undefined
): { min: number; max: number; hasCustomRows: boolean; formatted: string } {
  const prices = SEAT_ROWS.map((r) => getSeatRowPrice(screening, r));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const hasCustomRows = Boolean(
    screening?.rowPrices && Object.keys(screening.rowPrices).length > 0 && min !== max
  );
  const formatted = min === max ? formatINR(min) : `${formatINR(min)}–${formatINR(max)}`;
  return { min, max, hasCustomRows, formatted };
}

export function formatShowDate(dateStr: string): string {
  if (!dateStr) return 'Date TBA';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatShowTime(startTime?: string, endTime?: string): string {
  if (!startTime || !startTime.trim()) return 'Timing Not Configured Yet';
  if (endTime && endTime.trim()) return `${startTime} – ${endTime}`;
  return startTime;
}

export function getEmbedTrailerUrl(url?: string): { type: 'youtube' | 'video' | 'none'; src: string } {
  if (!url || !url.trim()) return { type: 'none', src: '' };
  const clean = url.trim();
  const ytMatch = clean.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  if (ytMatch) {
    return { type: 'youtube', src: `https://www.youtube.com/embed/${ytMatch[1]}?rel=0` };
  }
  return { type: 'video', src: clean };
}
