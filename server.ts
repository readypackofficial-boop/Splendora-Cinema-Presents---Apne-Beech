import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const firebaseConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8')) as {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
};

const PROJECT_ID = firebaseConfig.projectId;
const API_KEY = firebaseConfig.apiKey;
const DATABASE_ID = firebaseConfig.firestoreDatabaseId || '(default)';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

const BOOTSTRAP_ADMIN_EMAIL = 'mypersonaluse2013@gmail.com';
const SERVER_PEPPER =
  process.env.TICKET_SECRET && process.env.TICKET_SECRET.length >= 16
    ? process.env.TICKET_SECRET
    : crypto.createHash('sha256').update(`${API_KEY}:${PROJECT_ID}:splendora-ticket-pepper`).digest('hex');

const DEFAULT_POSTER_URL = '/src/assets/images/poster_apne_beech_placeholder_1794903609262.jpg';
const DEFAULT_KALAKHATTA_URL = '/src/assets/images/mocktail_kalakhatta_fizz_1794903611201.jpg';
const DEFAULT_SHIKANJI_URL = '/src/assets/images/mocktail_masala_shikanji_1794903611282.jpg';

// ---------------------- Rate Limiter ----------------------
const rateStore = new Map<string, { count: number; resetAt: number }>();

function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${req.path}:${ip}`;
    const now = Date.now();
    const current = rateStore.get(key);
    if (!current || now > current.resetAt) {
      rateStore.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (current.count >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    }
    current.count += 1;
    return next();
  };
}

// ---------------------- Auth Verification ----------------------
interface VerifiedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  idToken: string;
}

const FULL_PERMISSIONS: Record<string, boolean> = {
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

const DEFAULT_ROW_PRICES: Record<string, number> = {
  A: 20,
  B: 20,
  C: 20,
  D: 20,
  E: 30,
  F: 30,
};

function getSeatRowPrice(screeningData: Record<string, unknown>, seatNumberOrRow: string): number {
  const base = Number(screeningData.ticketPrice ?? 20);
  const rowKey = String(seatNumberOrRow || '').trim().charAt(0).toUpperCase();
  const rowPrices = screeningData.rowPrices as Record<string, unknown> | undefined;
  if (rowPrices && typeof rowPrices[rowKey] === 'number' && Number.isFinite(rowPrices[rowKey]) && Number(rowPrices[rowKey]) >= 0) {
    return Number(rowPrices[rowKey]);
  }
  if (!rowPrices && (rowKey === 'E' || rowKey === 'F') && base === 20) {
    return 30;
  }
  return Number.isFinite(base) && base >= 0 ? base : 20;
}

interface AuthedRequest extends Request {
  user?: VerifiedUser;
  adminRole?: string;
  adminPermissions?: Record<string, boolean>;
}

const tokenCache = new Map<string, { user: VerifiedUser; expiresAt: number }>();

async function verifyIdTokenWithFirebase(idToken: string): Promise<VerifiedUser> {
  const tokenHash = crypto.createHash('sha256').update(idToken).digest('hex');
  const cached = tokenCache.get(tokenHash);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });

  if (!resp.ok) {
    throw new Error('Invalid or expired authentication token');
  }

  const data = (await resp.json()) as {
    users?: Array<{
      localId: string;
      email?: string;
      emailVerified?: boolean;
      displayName?: string;
    }>;
  };

  const u = data.users?.[0];
  if (!u || !u.localId || !u.email) {
    throw new Error('Authenticated user record missing');
  }

  const verifiedUser: VerifiedUser = {
    uid: u.localId,
    email: u.email.toLowerCase(),
    emailVerified: Boolean(u.emailVerified),
    displayName: u.displayName || u.email.split('@')[0],
    idToken,
  };

  tokenCache.set(tokenHash, { user: verifiedUser, expiresAt: Date.now() + 30_000 });
  if (tokenCache.size > 500) {
    const firstKey = tokenCache.keys().next().value;
    if (firstKey) tokenCache.delete(firstKey);
  }
  return verifiedUser;
}

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const user = await verifyIdTokenWithFirebase(match[1]);
    if (!user.emailVerified) {
      return res.status(403).json({ error: 'Verified Google email is required.' });
    }
    req.user = user;
    return next();
  } catch (err) {
    return res.status(401).json({ error: err instanceof Error ? err.message : 'Unauthorized' });
  }
}

async function checkAdminRole(
  user: VerifiedUser
): Promise<{ isAdmin: boolean; role: string; permissions: Record<string, boolean> }> {
  if (!user.emailVerified) {
    return { isAdmin: false, role: 'NONE', permissions: {} };
  }
  if (user.email === BOOTSTRAP_ADMIN_EMAIL) {
    return { isAdmin: true, role: 'SUPER_ADMIN', permissions: { ...FULL_PERMISSIONS } };
  }
  const adminDoc = await fsGetDoc(`admins/${encodeURIComponent(user.email)}`, user.idToken);
  if (adminDoc && adminDoc.data.active === true) {
    const role = String(adminDoc.data.role || 'ADMIN');
    const rawPerms = adminDoc.data.permissions as Record<string, boolean> | undefined;
    const permissions = role === 'SUPER_ADMIN' || !rawPerms ? { ...FULL_PERMISSIONS } : { ...rawPerms };
    return { isAdmin: true, role, permissions };
  }
  return { isAdmin: false, role: 'NONE', permissions: {} };
}

async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  await requireAuth(req, res, async () => {
    if (!req.user) return;
    try {
      const { isAdmin, role, permissions } = await checkAdminRole(req.user);
      if (!isAdmin) {
        return res.status(403).json({
          error: 'Access Denied. This Google account is not an authorized Splendora Cinema administrator.',
        });
      }
      req.adminRole = role;
      req.adminPermissions = permissions;
      return next();
    } catch (err) {
      return res.status(403).json({ error: err instanceof Error ? err.message : 'Admin verification failed' });
    }
  });
}

function requireAdminFeature(feature: string) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    await requireAdmin(req, res, () => {
      if (req.adminRole === 'SUPER_ADMIN' || req.adminPermissions?.[feature] === true) {
        return next();
      }
      return res.status(403).json({
        error: `Permission denied: your admin account does not have the "${feature}" access feature enabled.`,
      });
    });
  };
}

function requireAnyAdminFeature(features: string[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    await requireAdmin(req, res, () => {
      if (
        req.adminRole === 'SUPER_ADMIN' ||
        features.some((f) => req.adminPermissions?.[f] === true)
      ) {
        return next();
      }
      return res.status(403).json({
        error: `Permission denied: requires one of (${features.join(', ')}) access features.`,
      });
    });
  };
}

// ---------------------- Firestore REST Helpers ----------------------
type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } };

function toFsValue(val: unknown): FsValue {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => toFsValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FsValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = toFsValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function parseTimestampMs(val: unknown): number {
  if (!val) return 0;
  if (val instanceof Date) return val.getTime();
  const parsed = Date.parse(String(val));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function fromFsValue(val: FsValue | undefined): unknown {
  if (!val) return undefined;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('timestampValue' in val) return new Date(val.timestampValue);
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map((v) => fromFsValue(v));
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      out[k] = fromFsValue(v);
    }
    return out;
  }
  return undefined;
}

function docName(docPath: string): string {
  return `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${docPath}`;
}

interface FsDocResult {
  name: string;
  updateTime: string;
  data: Record<string, unknown>;
}

async function fsGetDoc(docPath: string, idToken?: string): Promise<FsDocResult | null> {
  const headers: Record<string, string> = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const resp = await fetch(`${FS_BASE}/${docPath}`, { headers });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Firestore GET ${docPath} failed (${resp.status}): ${text}`);
  }
  const raw = (await resp.json()) as {
    name: string;
    updateTime: string;
    fields?: Record<string, FsValue>;
  };
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw.fields || {})) {
    data[k] = fromFsValue(v);
  }
  return { name: raw.name, updateTime: raw.updateTime, data };
}

async function fsListCollection(collectionPath: string, idToken?: string, pageSize = 200): Promise<FsDocResult[]> {
  const headers: Record<string, string> = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const resp = await fetch(`${FS_BASE}/${collectionPath}?pageSize=${pageSize}`, { headers });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Firestore LIST ${collectionPath} failed (${resp.status}): ${text}`);
  }
  const raw = (await resp.json()) as {
    documents?: Array<{
      name: string;
      updateTime: string;
      fields?: Record<string, FsValue>;
    }>;
  };
  return (raw.documents || []).map((doc) => {
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc.fields || {})) {
      data[k] = fromFsValue(v);
    }
    return { name: doc.name, updateTime: doc.updateTime, data };
  });
}

async function fsRunQuery(
  collectionId: string,
  field: string,
  value: unknown,
  idToken?: string
): Promise<FsDocResult[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents:runQuery`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId }],
          where: {
            fieldFilter: {
              field: { fieldPath: field },
              op: 'EQUAL',
              value: toFsValue(value),
            },
          },
        },
      }),
    }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Firestore query ${collectionId} failed (${resp.status}): ${text}`);
  }
  const rows = (await resp.json()) as Array<{
    document?: {
      name: string;
      updateTime: string;
      fields?: Record<string, FsValue>;
    };
  }>;
  const out: FsDocResult[] = [];
  for (const r of rows) {
    if (!r.document) continue;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.document.fields || {})) {
      data[k] = fromFsValue(v);
    }
    out.push({ name: r.document.name, updateTime: r.document.updateTime, data });
  }
  return out;
}

interface FsCommitWrite {
  docPath: string;
  data: Record<string, unknown>;
  serverTimeFields?: string[];
  preconditionUpdateTime?: string;
  preconditionExists?: boolean;
}

async function fsCommit(writes: FsCommitWrite[], idToken: string): Promise<void> {
  const formattedWrites = writes.map((w) => {
    const fields: Record<string, FsValue> = {};
    for (const [k, v] of Object.entries(w.data)) {
      if (v !== undefined && !(w.serverTimeFields || []).includes(k)) {
        fields[k] = toFsValue(v);
      }
    }
    const writeObj: Record<string, unknown> = {
      update: {
        name: docName(w.docPath),
        fields,
      },
    };
    if (w.serverTimeFields && w.serverTimeFields.length > 0) {
      writeObj.updateTransforms = w.serverTimeFields.map((fieldPath) => ({
        fieldPath,
        setToServerValue: 'REQUEST_TIME',
      }));
    }
    if (w.preconditionUpdateTime) {
      writeObj.currentDocument = { updateTime: w.preconditionUpdateTime };
    } else if (w.preconditionExists !== undefined) {
      writeObj.currentDocument = { exists: w.preconditionExists };
    }
    return writeObj;
  });

  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents:commit`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ writes: formattedWrites }),
    }
  );

  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`Firestore commit failed (${resp.status}): ${text}`) as Error & { status?: number };
    err.status = resp.status;
    throw err;
  }
}

function buildSeatLayoutWrites(screeningId: string): FsCommitWrite[] {
  const rows = ['A', 'B', 'C', 'D', 'E', 'F'];
  const writes: FsCommitWrite[] = [];
  for (const row of rows) {
    for (let col = 1; col <= 6; col++) {
      const seatNumber = `${row}${col}`;
      const seatDocId = `${screeningId}_${seatNumber}`;
      writes.push({
        docPath: `seats/${seatDocId}`,
        data: {
          seatDocId,
          screeningId,
          seatNumber,
          row,
          col,
          status: 'AVAILABLE',
          heldByUid: null,
          holdExpiresAt: null,
          bookingId: null,
          blockedReason: null,
        },
        serverTimeFields: ['updatedAt'],
        preconditionExists: false,
      });
    }
  }
  return writes;
}

function generateId(prefix: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}${ts}${rnd}`;
}

function hashVerificationToken(rawToken: string): string {
  return crypto.createHash('sha256').update(`${rawToken}:${SERVER_PEPPER}`).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length === 0 || bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

async function createAuditLogWrite(
  action: string,
  user: VerifiedUser,
  targetType: string,
  targetId: string,
  details: string
): Promise<FsCommitWrite> {
  const logId = generateId('LOG_');
  return {
    docPath: `auditLogs/${logId}`,
    data: {
      logId,
      action,
      actorEmail: user.email,
      actorUid: user.uid,
      targetType,
      targetId,
      details: details.slice(0, 950),
    },
    serverTimeFields: ['createdAt'],
  };
}

// ---------------------- Express App ----------------------
const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'splendora-cinema', timestamp: new Date().toISOString() });
});

// Verify admin session on server
app.post('/api/admin/session', rateLimit(30, 60_000), requireAuth, async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const { isAdmin, role, permissions } = await checkAdminRole(user);
    if (!isAdmin) {
      return res.status(403).json({
        authorized: false,
        email: user.email,
        error: 'Access Denied. Your Google account is not on the authorized Splendora Cinema admin allowlist.',
      });
    }
    return res.json({
      authorized: true,
      email: user.email,
      uid: user.uid,
      role,
      permissions,
      isBootstrap: user.email === BOOTSTRAP_ADMIN_EMAIL,
      isPremiumAdmin: user.email === BOOTSTRAP_ADMIN_EMAIL,
      accountTier: user.email === BOOTSTRAP_ADMIN_EMAIL ? 'PREMIUM_OWNER' : role,
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Session check failed' });
  }
});

// Bootstrap initial Splendora Cinema data idempotently on first admin sign-in
app.post('/api/admin/bootstrap', requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const initDoc = await fsGetDoc('system/initialized', user.idToken);
    if (initDoc) {
      const priceSentinel = await fsGetDoc('system/price_default_20', user.idToken);
      if (!priceSentinel) {
        const migrationWrites: FsCommitWrite[] = [];
        let migratedCount = 0;
        for (const seedId of ['SCR_20261225_01', 'SCR_20261226_01']) {
          const sDoc = await fsGetDoc(`screenings/${seedId}`, user.idToken);
          if (
            sDoc &&
            Number(sDoc.data.bookedCount || 0) === 0 &&
            Number(sDoc.data.ticketPrice) === 100
          ) {
            migrationWrites.push({
              docPath: `screenings/${seedId}`,
              data: {
                ...sDoc.data,
                ticketPrice: 20,
              },
              serverTimeFields: ['updatedAt'],
              preconditionUpdateTime: sDoc.updateTime,
            });
            migratedCount += 1;
          }
        }
        migrationWrites.push({
          docPath: 'system/price_default_20',
          data: {
            initialized: true,
            initializedBy: user.email,
          },
          serverTimeFields: ['initializedAt'],
        });
        if (migratedCount > 0) {
          migrationWrites.push(
            await createAuditLogWrite(
              'DEFAULT_PRICE_20_MIGRATION',
              user,
              'screenings',
              'SCR_20261225_01,SCR_20261226_01',
              `Updated ${migratedCount} unbooked initial show(s) to default ticket price ₹20.`
            )
          );
        }
        await fsCommit(migrationWrites, user.idToken);
      }

      const rowPriceSentinel = await fsGetDoc('system/row_prices_ef30', user.idToken);
      if (!rowPriceSentinel) {
        const allScreenings = await fsListCollection('screenings', user.idToken);
        const rowWrites: FsCommitWrite[] = [];
        let updatedRowCount = 0;
        for (const sDoc of allScreenings) {
          if (!sDoc.data.rowPrices && Number(sDoc.data.ticketPrice ?? 20) === 20) {
            rowWrites.push({
              docPath: `screenings/${sDoc.data.screeningId}`,
              data: {
                ...sDoc.data,
                rowPrices: { ...DEFAULT_ROW_PRICES },
              },
              serverTimeFields: ['updatedAt'],
              preconditionUpdateTime: sDoc.updateTime,
            });
            updatedRowCount += 1;
          }
        }
        rowWrites.push({
          docPath: 'system/row_prices_ef30',
          data: {
            initialized: true,
            initializedBy: user.email,
          },
          serverTimeFields: ['initializedAt'],
        });
        if (updatedRowCount > 0) {
          rowWrites.push(
            await createAuditLogWrite(
              'ROW_PRICES_EF30_MIGRATION',
              user,
              'screenings',
              'ALL',
              `Configured default row pricing (Rows A–D ₹20, Rows E–F ₹30) across ${updatedRowCount} show(s).`
            )
          );
        }
        await fsCommit(rowWrites, user.idToken);
      }

      return res.json({ alreadyInitialized: true });
    }

    const writes: FsCommitWrite[] = [
      {
        docPath: `admins/${encodeURIComponent(BOOTSTRAP_ADMIN_EMAIL)}`,
        data: {
          email: BOOTSTRAP_ADMIN_EMAIL,
          role: 'SUPER_ADMIN',
          active: true,
          addedBy: 'SYSTEM_BOOTSTRAP',
          permissions: FULL_PERMISSIONS,
        },
        serverTimeFields: ['createdAt', 'updatedAt'],
      },
      {
        docPath: 'movies/apne-beech',
        data: {
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
        },
        serverTimeFields: ['createdAt', 'updatedAt'],
      },
      {
        docPath: 'screenings/SCR_20261225_01',
        data: {
          screeningId: 'SCR_20261225_01',
          movieId: 'apne-beech',
          movieTitle: 'APNE BEECH',
          date: '2026-12-25',
          startTime: '',
          endTime: '',
          ticketPrice: 20,
          rowPrices: { ...DEFAULT_ROW_PRICES },
          seatCapacity: 36,
          bookedCount: 0,
          salesStatus: 'OPEN',
          isPublished: true,
          description: 'Opening Night Screening — Timing to be configured by administration.',
        },
        serverTimeFields: ['createdAt', 'updatedAt'],
      },
      {
        docPath: 'screenings/SCR_20261226_01',
        data: {
          screeningId: 'SCR_20261226_01',
          movieId: 'apne-beech',
          movieTitle: 'APNE BEECH',
          date: '2026-12-26',
          startTime: '',
          endTime: '',
          ticketPrice: 20,
          rowPrices: { ...DEFAULT_ROW_PRICES },
          seatCapacity: 36,
          bookedCount: 0,
          salesStatus: 'OPEN',
          isPublished: true,
          description: 'Second Day Screening — Timing to be configured by administration.',
        },
        serverTimeFields: ['createdAt', 'updatedAt'],
      },
      {
        docPath: 'mocktailProducts/kalakhatta-fizz',
        data: {
          productId: 'kalakhatta-fizz',
          name: 'Kalakhatta Fizz',
          description: 'A refreshing kala khatta-inspired fizzy mocktail.',
          price: 50,
          imageUrl: DEFAULT_KALAKHATTA_URL,
          enabled: true,
        },
        serverTimeFields: ['createdAt', 'updatedAt'],
      },
      {
        docPath: 'mocktailProducts/masala-shikanji',
        data: {
          productId: 'masala-shikanji',
          name: 'Masala Shikanji',
          description: 'A refreshing traditional masala shikanji.',
          price: 30,
          imageUrl: DEFAULT_SHIKANJI_URL,
          enabled: true,
        },
        serverTimeFields: ['createdAt', 'updatedAt'],
      },
      {
        docPath: 'websiteSettings/main',
        data: {
          cinemaName: 'SPLENDORA CINEMA',
          logoUrl: '',
          contactNumber: '',
          contactEmail: '',
          cinemaAddress: '',
          instagramUrl: '',
          facebookUrl: '',
          youtubeUrl: '',
          bookingPolicies:
            'Please arrive 20 minutes prior to showtime. Valid digital QR tickets are verified at the auditorium entrance. Ordered mocktails are delivered directly to your assigned seat when the film begins.',
          footerText: 'SPLENDORA CINEMA — Royal Vintage Cinema Experience',
        },
        serverTimeFields: ['updatedAt'],
      },
      {
        docPath: 'paymentSettings/public',
        data: {
          isConfigured: false,
          mode: 'UNCONFIGURED',
          upiId: '',
          displayName: '',
          qrImageUrl: '',
          instructions: '',
          providerName: '',
          testMode: true,
        },
        serverTimeFields: ['updatedAt'],
      },
      {
        docPath: 'system/initialized',
        data: {
          initialized: true,
          initializedBy: user.email,
        },
        serverTimeFields: ['initializedAt'],
      },
      {
        docPath: 'system/price_default_20',
        data: {
          initialized: true,
          initializedBy: user.email,
        },
        serverTimeFields: ['initializedAt'],
      },
      {
        docPath: 'system/row_prices_ef30',
        data: {
          initialized: true,
          initializedBy: user.email,
        },
        serverTimeFields: ['initializedAt'],
      },
      await createAuditLogWrite(
        'SYSTEM_BOOTSTRAP',
        user,
        'system',
        'initialized',
        'Initialized Splendora Cinema catalog, 2 initial shows (Dec 25 & Dec 26 2026, Rows A-D ₹20 / Rows E-F ₹30), 72 seats, and mocktails.'
      ),
    ];

    // Add 36 seats for each of the 2 initial shows
    const seats1 = buildSeatLayoutWrites('SCR_20261225_01');
    const seats2 = buildSeatLayoutWrites('SCR_20261226_01');

    // Firestore commit supports max 500 writes; total here is ~83 writes -> single atomic commit!
    await fsCommit([...writes, ...seats1, ...seats2], user.idToken);

    return res.json({ initialized: true });
  } catch (err) {
    console.error('Bootstrap error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Bootstrap failed' });
  }
});

// ---------------------- Customer Booking Endpoints ----------------------

// Place temporary 10-minute seat hold atomically
app.post('/api/bookings/hold', rateLimit(40, 60_000), requireAuth, async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const { screeningId, seatNumbers } = req.body as {
      screeningId?: string;
      seatNumbers?: string[];
    };

    if (!screeningId || !Array.isArray(seatNumbers) || seatNumbers.length === 0 || seatNumbers.length > 36) {
      return res.status(400).json({ error: 'Valid screeningId and 1–36 seatNumbers are required.' });
    }

    const screening = await fsGetDoc(`screenings/${screeningId}`, user.idToken);
    if (!screening) {
      return res.status(404).json({ error: 'Screening not found.' });
    }
    if (screening.data.salesStatus !== 'OPEN' || screening.data.isPublished !== true) {
      return res.status(400).json({ error: 'Ticket sales are not currently open for this show.' });
    }

    const nowMs = Date.now();
    const holdExpiresAt = new Date(nowMs + 10 * 60_000);
    const writes: FsCommitWrite[] = [];

    for (const rawSeat of seatNumbers) {
      const seatNum = String(rawSeat).trim().toUpperCase();
      if (!/^[A-Z][0-9]{1,2}$/.test(seatNum)) {
        return res.status(400).json({ error: `Invalid seat number: ${seatNum}` });
      }
      const seatDocId = `${screeningId}_${seatNum}`;
      const seatDoc = await fsGetDoc(`seats/${seatDocId}`, user.idToken);
      if (!seatDoc) {
        return res.status(404).json({ error: `Seat ${seatNum} does not exist for this show.` });
      }

      const status = String(seatDoc.data.status || 'AVAILABLE');
      const heldByUid = seatDoc.data.heldByUid as string | null;
      const existingExp = parseTimestampMs(seatDoc.data.holdExpiresAt);

      const canHold =
        status === 'AVAILABLE' ||
        (status === 'HELD' && heldByUid === user.uid) ||
        (status === 'HELD' && existingExp > 0 && existingExp < nowMs);

      if (!canHold) {
        return res.status(409).json({
          error: `Seat ${seatNum} is no longer available (currently ${status}). Please choose another seat.`,
        });
      }

      writes.push({
        docPath: `seats/${seatDocId}`,
        data: {
          ...seatDoc.data,
          status: 'HELD',
          heldByUid: user.uid,
          holdExpiresAt,
          bookingId: null,
        },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: seatDoc.updateTime,
      });
    }

    await fsCommit(writes, user.idToken);
    return res.json({ held: true, holdExpiresAt: holdExpiresAt.toISOString(), seatNumbers });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 400 || status === 409) {
      return res.status(409).json({ error: 'One or more seats were just selected by another guest. Please refresh seats.' });
    }
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to hold seats' });
  }
});

// Release temporary hold
app.post('/api/bookings/release-hold', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const { screeningId, seatNumbers } = req.body as {
      screeningId?: string;
      seatNumbers?: string[];
    };
    if (!screeningId || !Array.isArray(seatNumbers) || seatNumbers.length === 0) {
      return res.status(400).json({ error: 'screeningId and seatNumbers required.' });
    }
    const writes: FsCommitWrite[] = [];
    for (const seat of seatNumbers) {
      const seatDocId = `${screeningId}_${String(seat).trim().toUpperCase()}`;
      const seatDoc = await fsGetDoc(`seats/${seatDocId}`, user.idToken);
      if (seatDoc && seatDoc.data.status === 'HELD' && seatDoc.data.heldByUid === user.uid) {
        writes.push({
          docPath: `seats/${seatDocId}`,
          data: {
            ...seatDoc.data,
            status: 'AVAILABLE',
            heldByUid: null,
            holdExpiresAt: null,
            bookingId: null,
          },
          serverTimeFields: ['updatedAt'],
          preconditionUpdateTime: seatDoc.updateTime,
        });
      }
    }
    if (writes.length > 0) {
      await fsCommit(writes, user.idToken);
    }
    return res.json({ released: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Release failed' });
  }
});

// Authoritative server-validated booking creation + UPI submission
app.post('/api/bookings/create', rateLimit(20, 60_000), requireAuth, async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const {
      screeningId,
      seatNumbers,
      customerName,
      customerPhone,
      mocktailAssignments = [],
      upiTransactionRef,
      paymentMethod = 'MANUAL_UPI',
    } = req.body as {
      screeningId?: string;
      seatNumbers?: string[];
      customerName?: string;
      customerPhone?: string;
      mocktailAssignments?: Array<{ seatNumber: string; productId: string; quantity: number }>;
      upiTransactionRef?: string;
      paymentMethod?: string;
    };

    if (!screeningId || !Array.isArray(seatNumbers) || seatNumbers.length === 0 || seatNumbers.length > 36) {
      return res.status(400).json({ error: 'Invalid screening or seat selection.' });
    }
    const cleanName = (customerName || user.displayName || '').trim().slice(0, 150);
    const cleanPhone = (customerPhone || '').trim().slice(0, 30);
    if (!cleanName) {
      return res.status(400).json({ error: 'Customer name is required.' });
    }
    if (!cleanPhone || cleanPhone.length < 7) {
      return res.status(400).json({ error: 'Valid phone number is required.' });
    }

    // Check payment configuration
    const paySettings = await fsGetDoc('paymentSettings/public', user.idToken);
    if (!paySettings || paySettings.data.isConfigured !== true || paySettings.data.mode === 'UNCONFIGURED') {
      return res.status(400).json({
        error: 'Payment settings are not configured yet by cinema administration. Booking checkout will open once payment details are configured.',
      });
    }

    const screening = await fsGetDoc(`screenings/${screeningId}`, user.idToken);
    if (!screening || screening.data.salesStatus !== 'OPEN' || screening.data.isPublished !== true) {
      return res.status(400).json({ error: 'Selected screening is not open for booking.' });
    }

    // Authoritative ticket price from Firestore
    const ticketPrice = Number(screening.data.ticketPrice ?? 20);
    const uniqueSeats = Array.from(new Set(seatNumbers.map((s) => String(s).trim().toUpperCase())));

    // Authoritative mocktail prices from Firestore
    const productDocs = await fsListCollection('mocktailProducts', user.idToken);
    const productMap = new Map<string, { name: string; price: number; enabled: boolean }>();
    for (const p of productDocs) {
      productMap.set(String(p.data.productId), {
        name: String(p.data.name),
        price: Number(p.data.price),
        enabled: Boolean(p.data.enabled),
      });
    }

    // Validate seats & prepare atomic writes
    const nowMs = Date.now();
    const bookingId = generateId('SC');
    const paymentId = generateId('PAY_');
    const isUpiRefSubmitted = Boolean(upiTransactionRef && upiTransactionRef.trim().length >= 4);
    const cleanRef = (upiTransactionRef || '').trim().slice(0, 120);

    const seatWrites: FsCommitWrite[] = [];
    for (const seatNum of uniqueSeats) {
      const seatDocId = `${screeningId}_${seatNum}`;
      const seatDoc = await fsGetDoc(`seats/${seatDocId}`, user.idToken);
      if (!seatDoc) {
        return res.status(404).json({ error: `Seat ${seatNum} not found.` });
      }
      const st = String(seatDoc.data.status);
      const heldByUid = seatDoc.data.heldByUid as string | null;
      const exp = parseTimestampMs(seatDoc.data.holdExpiresAt);
      const availableForUser =
        st === 'AVAILABLE' ||
        (st === 'HELD' && heldByUid === user.uid) ||
        (st === 'HELD' && exp > 0 && exp < nowMs);
      if (!availableForUser) {
        return res.status(409).json({ error: `Seat ${seatNum} is no longer available (${st}).` });
      }
      seatWrites.push({
        docPath: `seats/${seatDocId}`,
        data: {
          ...seatDoc.data,
          status: isUpiRefSubmitted ? 'RESERVED' : 'HELD',
          heldByUid: user.uid,
          holdExpiresAt: isUpiRefSubmitted ? null : new Date(nowMs + 10 * 60_000),
          bookingId,
        },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: seatDoc.updateTime,
      });
    }

    // Validate mocktail assignments & compute authoritative subtotal
    let mocktailSubtotal = 0;
    const itemSummaryMap = new Map<string, { productId: string; productName: string; price: number; quantity: number }>();
    const assignmentWrites: FsCommitWrite[] = [];
    const paymentStatus = isUpiRefSubmitted ? 'PENDING_VERIFICATION' : 'PENDING';
    const bookingStatus = isUpiRefSubmitted ? 'PENDING_VERIFICATION' : 'HOLD';

    for (const item of mocktailAssignments) {
      const qty = Math.floor(Number(item.quantity || 0));
      if (qty <= 0) continue;
      if (qty > 20) {
        return res.status(400).json({ error: 'Mocktail quantity per seat cannot exceed 20.' });
      }
      const seatNum = String(item.seatNumber || '').trim().toUpperCase();
      if (!uniqueSeats.includes(seatNum)) {
        return res.status(400).json({ error: `Mocktail assignment seat ${seatNum} must be in your selected seats.` });
      }
      const prod = productMap.get(String(item.productId));
      if (!prod || !prod.enabled) {
        return res.status(400).json({ error: `Mocktail product ${item.productId} is unavailable.` });
      }
      mocktailSubtotal += prod.price * qty;

      const existingSummary = itemSummaryMap.get(item.productId);
      if (existingSummary) {
        existingSummary.quantity += qty;
      } else {
        itemSummaryMap.set(item.productId, {
          productId: item.productId,
          productName: prod.name,
          price: prod.price,
          quantity: qty,
        });
      }

      const assignmentId = generateId('MA_');
      assignmentWrites.push({
        docPath: `mocktailAssignments/${assignmentId}`,
        data: {
          assignmentId,
          bookingId,
          screeningId,
          customerId: user.uid,
          customerName: cleanName,
          date: String(screening.data.date),
          startTime: String(screening.data.startTime || 'TBA'),
          seatNumber: seatNum,
          productId: item.productId,
          productName: prod.name,
          quantity: qty,
          unitPrice: prod.price,
          paymentStatus,
          deliveryStatus: 'PENDING_PAYMENT',
        },
        serverTimeFields: ['createdAt', 'updatedAt'],
      });
    }

    const ticketCount = uniqueSeats.length;
    const ticketSubtotal = uniqueSeats.reduce(
      (sum, seatNum) => sum + getSeatRowPrice(screening.data, seatNum),
      0
    );
    const effectiveTicketPrice = Math.round((ticketSubtotal / ticketCount) * 100) / 100;
    const grandTotal = ticketSubtotal + mocktailSubtotal;

    const bookingData = {
      bookingId,
      screeningId,
      movieTitle: String(screening.data.movieTitle || 'APNE BEECH'),
      date: String(screening.data.date),
      startTime: String(screening.data.startTime || 'To Be Announced'),
      customerId: user.uid,
      customerName: cleanName,
      customerEmail: user.email,
      customerPhone: cleanPhone,
      seatNumbers: uniqueSeats,
      ticketPrice: effectiveTicketPrice,
      ticketCount,
      ticketSubtotal,
      mocktailSubtotal,
      grandTotal,
      paymentStatus,
      bookingStatus,
      upiTransactionRef: cleanRef,
      paymentMethod,
    };

    const paymentData = {
      paymentId,
      bookingId,
      screeningId,
      customerId: user.uid,
      customerName: cleanName,
      customerEmail: user.email,
      amount: grandTotal,
      method: paymentMethod,
      status: paymentStatus,
      transactionRef: cleanRef,
      notes: isUpiRefSubmitted ? 'Customer submitted UPI reference. Awaiting admin verification.' : 'Awaiting payment.',
    };

    const allWrites: FsCommitWrite[] = [
      {
        docPath: `bookings/${bookingId}`,
        data: bookingData,
        serverTimeFields: ['createdAt', 'updatedAt'],
        preconditionExists: false,
      },
      {
        docPath: `payments/${paymentId}`,
        data: paymentData,
        serverTimeFields: ['createdAt', 'updatedAt'],
        preconditionExists: false,
      },
      ...seatWrites,
      ...assignmentWrites,
    ];

    if (assignmentWrites.length > 0) {
      const orderId = generateId('MO_');
      allWrites.push({
        docPath: `mocktailOrders/${orderId}`,
        data: {
          orderId,
          bookingId,
          screeningId,
          customerId: user.uid,
          customerName: cleanName,
          date: String(screening.data.date),
          startTime: String(screening.data.startTime || 'To Be Announced'),
          items: Array.from(itemSummaryMap.values()),
          subtotal: mocktailSubtotal,
          paymentStatus,
          deliveryStatus: 'PENDING_PAYMENT',
        },
        serverTimeFields: ['createdAt', 'updatedAt'],
      });
    }

    await fsCommit(allWrites, user.idToken);

    return res.status(201).json({
      bookingId,
      paymentId,
      ticketSubtotal,
      mocktailSubtotal,
      grandTotal,
      paymentStatus,
      bookingStatus,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 400 || status === 409) {
      return res.status(409).json({ error: 'Seat conflict detected during booking. Please review seat availability.' });
    }
    console.error('Create booking error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Booking creation failed' });
  }
});

// Submit UPI Transaction Reference for an existing HOLD booking
app.post('/api/bookings/submit-upi', rateLimit(20, 60_000), requireAuth, async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const { bookingId, upiTransactionRef } = req.body as {
      bookingId?: string;
      upiTransactionRef?: string;
    };
    const cleanRef = (upiTransactionRef || '').trim().slice(0, 120);
    if (!bookingId || cleanRef.length < 4) {
      return res.status(400).json({ error: 'Valid bookingId and UPI Transaction Reference (UTR) are required.' });
    }

    const booking = await fsGetDoc(`bookings/${bookingId}`, user.idToken);
    if (!booking || booking.data.customerId !== user.uid) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    if (booking.data.paymentStatus === 'VERIFIED') {
      return res.status(400).json({ error: 'Booking is already verified.' });
    }

    const payments = await fsRunQuery('payments', 'bookingId', bookingId, user.idToken);
    const writes: FsCommitWrite[] = [
      {
        docPath: `bookings/${bookingId}`,
        data: {
          ...booking.data,
          upiTransactionRef: cleanRef,
          paymentMethod: 'MANUAL_UPI',
          paymentStatus: 'PENDING_VERIFICATION',
          bookingStatus: 'PENDING_VERIFICATION',
        },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: booking.updateTime,
      },
    ];

    for (const p of payments) {
      writes.push({
        docPath: `payments/${p.data.paymentId}`,
        data: {
          ...p.data,
          transactionRef: cleanRef,
          status: 'PENDING_VERIFICATION',
        },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: p.updateTime,
      });
    }

    const seats = (booking.data.seatNumbers as string[]) || [];
    const screeningId = String(booking.data.screeningId);
    for (const s of seats) {
      const seatDocId = `${screeningId}_${s}`;
      const seatDoc = await fsGetDoc(`seats/${seatDocId}`, user.idToken);
      if (seatDoc && (seatDoc.data.heldByUid === user.uid || seatDoc.data.status === 'AVAILABLE')) {
        writes.push({
          docPath: `seats/${seatDocId}`,
          data: {
            ...seatDoc.data,
            status: 'RESERVED',
            heldByUid: user.uid,
            holdExpiresAt: null,
            bookingId,
          },
          serverTimeFields: ['updatedAt'],
          preconditionUpdateTime: seatDoc.updateTime,
        });
      }
    }

    await fsCommit(writes, user.idToken);
    return res.json({ submitted: true, paymentStatus: 'PENDING_VERIFICATION' });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to submit UPI reference' });
  }
});

// ---------------------- Automatic Payment Gateway Endpoints (Prepared Architecture) ----------------------
app.post('/api/payments/create-order', rateLimit(20, 60_000), requireAuth, async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const { bookingId } = req.body as { bookingId?: string };
    if (!bookingId) return res.status(400).json({ error: 'bookingId required' });

    const paySettings = await fsGetDoc('paymentSettings/public', user.idToken);
    if (!paySettings || paySettings.data.mode !== 'AUTOMATIC_GATEWAY') {
      return res.status(400).json({
        error: 'Automatic payment gateway is not configured yet. Please use configured UPI method or contact cinema administration.',
      });
    }

    const booking = await fsGetDoc(`bookings/${bookingId}`, user.idToken);
    if (!booking || booking.data.customerId !== user.uid) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    // Server creates a gateway order ID (ready for provider API integration such as Razorpay/Stripe)
    const gatewayOrderId = `ORD_${bookingId}_${Date.now()}`;
    return res.json({
      gatewayOrderId,
      amountPaise: Math.round(Number(booking.data.grandTotal) * 100),
      currency: 'INR',
      providerName: paySettings.data.providerName || 'Configured Gateway',
      testMode: Boolean(paySettings.data.testMode),
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Order creation failed' });
  }
});

app.post('/api/payments/verify-signature', rateLimit(20, 60_000), requireAuth, async (req: AuthedRequest, res) => {
  const { gatewayOrderId, gatewayPaymentId, gatewaySignature } = req.body as {
    gatewayOrderId?: string;
    gatewayPaymentId?: string;
    gatewaySignature?: string;
  };
  if (!gatewayOrderId || !gatewayPaymentId || !gatewaySignature) {
    return res.status(400).json({ error: 'Missing payment signature fields.' });
  }
  return res.status(400).json({
    error: 'Live payment gateway verification requires merchant API secret activation by an authorized administrator.',
  });
});

app.post('/api/payments/webhook', rateLimit(60, 60_000), (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  if (!signature || typeof signature !== 'string') {
    return res.status(401).json({ error: 'Missing webhook signature.' });
  }
  return res.status(400).json({ error: 'Gateway webhook secret not active yet.' });
});

// ---------------------- Admin Payment Verification & Ticket Issuance ----------------------
app.post('/api/admin/payments/verify', rateLimit(60, 60_000), requireAdminFeature('manageBookingsAndPayments'), async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const { bookingId, paymentId, notes } = req.body as {
      bookingId?: string;
      paymentId?: string;
      notes?: string;
    };
    if (!bookingId) return res.status(400).json({ error: 'bookingId is required.' });

    const booking = await fsGetDoc(`bookings/${bookingId}`, user.idToken);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    // Prevent duplicate verification & duplicate ticket issuance
    const existingTickets = await fsRunQuery('tickets', 'bookingId', bookingId, user.idToken);
    if (booking.data.paymentStatus === 'VERIFIED' && existingTickets.length > 0) {
      return res.json({
        alreadyVerified: true,
        ticket: existingTickets[0].data,
      });
    }

    const screeningId = String(booking.data.screeningId);
    const screening = await fsGetDoc(`screenings/${screeningId}`, user.idToken);
    if (!screening) return res.status(404).json({ error: 'Screening not found.' });

    const payments = paymentId
      ? [await fsGetDoc(`payments/${paymentId}`, user.idToken)].filter((x): x is FsDocResult => Boolean(x))
      : await fsRunQuery('payments', 'bookingId', bookingId, user.idToken);

    const mocktailOrders = await fsRunQuery('mocktailOrders', 'bookingId', bookingId, user.idToken);
    const mocktailAssignments = await fsRunQuery('mocktailAssignments', 'bookingId', bookingId, user.idToken);

    // Format mocktail summary for ticket
    const summaryParts: string[] = [];
    for (const a of mocktailAssignments) {
      summaryParts.push(`${a.data.seatNumber}: ${a.data.quantity}× ${a.data.productName}`);
    }
    const mocktailSummary = summaryParts.length > 0 ? summaryParts.join(' · ') : 'None';

    // Generate cryptographically unpredictable QR verification token on server
    const ticketId = generateId('TKT_');
    const rawToken = crypto.randomBytes(24).toString('hex');
    const secureTokenHash = hashVerificationToken(rawToken);
    const qrPayload = `SP1.${ticketId}.${rawToken}`;

    const seatNumbers = (booking.data.seatNumbers as string[]) || [];
    const writes: FsCommitWrite[] = [];

    // Update booking
    writes.push({
      docPath: `bookings/${bookingId}`,
      data: {
        ...booking.data,
        paymentStatus: 'VERIFIED',
        bookingStatus: 'CONFIRMED',
        adminNotes: (notes || 'Payment verified by administrator.').slice(0, 480),
      },
      serverTimeFields: ['updatedAt'],
      preconditionUpdateTime: booking.updateTime,
    });

    // Update payment(s)
    for (const p of payments) {
      writes.push({
        docPath: `payments/${p.data.paymentId}`,
        data: {
          ...p.data,
          status: 'VERIFIED',
          verifiedBy: user.email,
          notes: (notes || 'Verified against UPI/bank statement.').slice(0, 480),
        },
        serverTimeFields: ['verifiedAt', 'updatedAt'],
        preconditionUpdateTime: p.updateTime,
      });
    }

    // Lock seats as BOOKED
    let newlyBookedCount = 0;
    for (const seatNum of seatNumbers) {
      const seatDocId = `${screeningId}_${seatNum}`;
      const seatDoc = await fsGetDoc(`seats/${seatDocId}`, user.idToken);
      if (seatDoc) {
        if (seatDoc.data.status !== 'BOOKED') newlyBookedCount += 1;
        writes.push({
          docPath: `seats/${seatDocId}`,
          data: {
            ...seatDoc.data,
            status: 'BOOKED',
            heldByUid: booking.data.customerId,
            holdExpiresAt: null,
            bookingId,
          },
          serverTimeFields: ['updatedAt'],
          preconditionUpdateTime: seatDoc.updateTime,
        });
      }
    }

    // Increment bookedCount on screening
    writes.push({
      docPath: `screenings/${screeningId}`,
      data: {
        ...screening.data,
        bookedCount: Number(screening.data.bookedCount || 0) + newlyBookedCount,
      },
      serverTimeFields: ['updatedAt'],
      preconditionUpdateTime: screening.updateTime,
    });

    // Update mocktail orders & assignments to PREPARING
    for (const mo of mocktailOrders) {
      writes.push({
        docPath: `mocktailOrders/${mo.data.orderId}`,
        data: {
          ...mo.data,
          paymentStatus: 'VERIFIED',
          deliveryStatus: 'PREPARING',
        },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: mo.updateTime,
      });
    }
    for (const ma of mocktailAssignments) {
      writes.push({
        docPath: `mocktailAssignments/${ma.data.assignmentId}`,
        data: {
          ...ma.data,
          paymentStatus: 'VERIFIED',
          deliveryStatus: 'PREPARING',
        },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: ma.updateTime,
      });
    }

    // Create verified digital ticket + admin-only security hash
    const ticketData = {
      ticketId,
      bookingId,
      screeningId,
      customerId: String(booking.data.customerId),
      customerName: String(booking.data.customerName),
      customerEmail: String(booking.data.customerEmail),
      movieTitle: String(booking.data.movieTitle),
      date: String(booking.data.date),
      startTime: String(booking.data.startTime),
      seatNumbers,
      mocktailSummary,
      grandTotal: Number(booking.data.grandTotal),
      qrPayload,
      ticketStatus: 'VALID',
      checkedInAt: null,
      checkedInBy: null,
    };

    writes.push({
      docPath: `tickets/${ticketId}`,
      data: ticketData,
      serverTimeFields: ['createdAt', 'updatedAt'],
      preconditionExists: false,
    });

    writes.push({
      docPath: `tickets/${ticketId}/security/hash`,
      data: {
        secureTokenHash,
        ticketId,
      },
      serverTimeFields: ['createdAt'],
      preconditionExists: false,
    });

    writes.push(
      await createAuditLogWrite(
        'VERIFY_PAYMENT_AND_ISSUE_TICKET',
        user,
        'booking',
        bookingId,
        `Verified ₹${booking.data.grandTotal} payment and issued QR ticket ${ticketId} for seats ${seatNumbers.join(', ')}.`
      )
    );

    await fsCommit(writes, user.idToken);
    return res.json({ verified: true, ticket: ticketData });
  } catch (err) {
    console.error('Payment verify error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Verification failed' });
  }
});

app.post('/api/admin/payments/reject', requireAdminFeature('manageBookingsAndPayments'), async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const { bookingId, reason } = req.body as { bookingId?: string; reason?: string };
    if (!bookingId) return res.status(400).json({ error: 'bookingId required.' });

    const booking = await fsGetDoc(`bookings/${bookingId}`, user.idToken);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    const payments = await fsRunQuery('payments', 'bookingId', bookingId, user.idToken);
    const mocktailOrders = await fsRunQuery('mocktailOrders', 'bookingId', bookingId, user.idToken);
    const mocktailAssignments = await fsRunQuery('mocktailAssignments', 'bookingId', bookingId, user.idToken);

    const writes: FsCommitWrite[] = [
      {
        docPath: `bookings/${bookingId}`,
        data: {
          ...booking.data,
          paymentStatus: 'FAILED',
          bookingStatus: 'CANCELLED',
          adminNotes: (reason || 'Payment reference could not be verified.').slice(0, 480),
        },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: booking.updateTime,
      },
    ];

    for (const p of payments) {
      writes.push({
        docPath: `payments/${p.data.paymentId}`,
        data: {
          ...p.data,
          status: 'REJECTED',
          verifiedBy: user.email,
          notes: (reason || 'Rejected by administrator.').slice(0, 480),
        },
        serverTimeFields: ['verifiedAt', 'updatedAt'],
        preconditionUpdateTime: p.updateTime,
      });
    }

    const screeningId = String(booking.data.screeningId);
    for (const seatNum of (booking.data.seatNumbers as string[]) || []) {
      const seatDoc = await fsGetDoc(`seats/${screeningId}_${seatNum}`, user.idToken);
      if (seatDoc && seatDoc.data.bookingId === bookingId && seatDoc.data.status !== 'BOOKED') {
        writes.push({
          docPath: `seats/${screeningId}_${seatNum}`,
          data: {
            ...seatDoc.data,
            status: 'AVAILABLE',
            heldByUid: null,
            holdExpiresAt: null,
            bookingId: null,
          },
          serverTimeFields: ['updatedAt'],
          preconditionUpdateTime: seatDoc.updateTime,
        });
      }
    }

    for (const mo of mocktailOrders) {
      writes.push({
        docPath: `mocktailOrders/${mo.data.orderId}`,
        data: { ...mo.data, paymentStatus: 'FAILED', deliveryStatus: 'CANCELLED' },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: mo.updateTime,
      });
    }
    for (const ma of mocktailAssignments) {
      writes.push({
        docPath: `mocktailAssignments/${ma.data.assignmentId}`,
        data: { ...ma.data, paymentStatus: 'FAILED', deliveryStatus: 'CANCELLED' },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: ma.updateTime,
      });
    }

    writes.push(
      await createAuditLogWrite(
        'REJECT_PAYMENT',
        user,
        'booking',
        bookingId,
        `Rejected payment for booking ${bookingId}. Reason: ${reason || 'Unverified reference'}`
      )
    );

    await fsCommit(writes, user.idToken);
    return res.json({ rejected: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Reject failed' });
  }
});

// ---------------------- Admin Ticket Scanner & Atomic Check-In ----------------------
app.post('/api/admin/tickets/scan', rateLimit(120, 60_000), requireAdminFeature('ticketScanner'), async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const { qrPayload, manualId } = req.body as { qrPayload?: string; manualId?: string };

    let targetTicketId = '';
    let rawToken = '';

    if (qrPayload && qrPayload.trim()) {
      const parts = qrPayload.trim().split('.');
      if (parts.length !== 3 || parts[0] !== 'SP1' || !parts[1] || !parts[2]) {
        return res.json({
          status: 'INVALID_TICKET',
          badge: 'INVALID TICKET',
          message: 'The QR token does not exist or is not genuine.',
        });
      }
      targetTicketId = parts[1];
      rawToken = parts[2];
    } else if (manualId && manualId.trim()) {
      const clean = manualId.trim();
      if (clean.startsWith('SP1.')) {
        const parts = clean.split('.');
        if (parts.length === 3) {
          targetTicketId = parts[1];
          rawToken = parts[2];
        }
      } else if (clean.startsWith('TKT_')) {
        targetTicketId = clean;
      } else if (clean.startsWith('SC')) {
        // Lookup by Booking ID
        const byBooking = await fsRunQuery('tickets', 'bookingId', clean, user.idToken);
        if (byBooking.length === 0) {
          const bookingDoc = await fsGetDoc(`bookings/${clean}`, user.idToken);
          if (bookingDoc && bookingDoc.data.paymentStatus !== 'VERIFIED') {
            return res.json({
              status: bookingDoc.data.bookingStatus === 'CANCELLED' ? 'CANCELLED' : 'PAYMENT_PENDING',
              badge: bookingDoc.data.bookingStatus === 'CANCELLED' ? 'CANCELLED' : 'PAYMENT PENDING',
              message:
                bookingDoc.data.bookingStatus === 'CANCELLED'
                  ? 'This booking has been cancelled.'
                  : 'Payment has not been verified yet.',
              booking: bookingDoc.data,
            });
          }
          return res.json({
            status: 'INVALID_TICKET',
            badge: 'INVALID TICKET',
            message: 'No valid digital ticket found for this Booking ID.',
          });
        }
        targetTicketId = String(byBooking[0].data.ticketId);
      } else {
        targetTicketId = clean;
      }
    } else {
      return res.status(400).json({ error: 'Please scan a QR code or enter a Ticket / Booking ID.' });
    }

    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(targetTicketId)) {
      return res.json({
        status: 'INVALID_TICKET',
        badge: 'INVALID TICKET',
        message: 'Invalid ticket identifier format.',
      });
    }

    const ticketDoc = await fsGetDoc(`tickets/${targetTicketId}`, user.idToken);
    if (!ticketDoc) {
      return res.json({
        status: 'INVALID_TICKET',
        badge: 'INVALID TICKET',
        message: 'The QR token does not exist or is not genuine.',
      });
    }

    // If scanned via QR payload, verify cryptographic token hash against admin-only subcollection!
    if (qrPayload && qrPayload.trim()) {
      const secDoc = await fsGetDoc(`tickets/${targetTicketId}/security/hash`, user.idToken);
      if (!secDoc || !secDoc.data.secureTokenHash) {
        return res.json({
          status: 'INVALID_TICKET',
          badge: 'INVALID TICKET',
          message: 'Ticket cryptographic record is missing.',
        });
      }
      const computedHash = hashVerificationToken(rawToken);
      if (!safeEqualHex(computedHash, String(secDoc.data.secureTokenHash))) {
        return res.json({
          status: 'INVALID_TICKET',
          badge: 'INVALID TICKET',
          message: 'Forged or invalid QR signature detected.',
        });
      }
    }

    const bookingDoc = await fsGetDoc(`bookings/${String(ticketDoc.data.bookingId)}`, user.idToken);
    const ticketStatus = String(ticketDoc.data.ticketStatus);
    const paymentStatus = String(bookingDoc?.data.paymentStatus || 'PENDING');
    const bookingStatus = String(bookingDoc?.data.bookingStatus || 'HOLD');

    if (ticketStatus === 'CANCELLED' || bookingStatus === 'CANCELLED') {
      return res.json({
        status: 'CANCELLED',
        badge: 'CANCELLED',
        message: 'This ticket has been cancelled and is not valid for entry.',
        ticket: ticketDoc.data,
        booking: bookingDoc?.data,
      });
    }

    if (paymentStatus !== 'VERIFIED') {
      return res.json({
        status: 'PAYMENT_PENDING',
        badge: 'PAYMENT PENDING',
        message: 'Payment has not been verified yet.',
        ticket: ticketDoc.data,
        booking: bookingDoc?.data,
      });
    }

    if (ticketStatus === 'USED') {
      return res.json({
        status: 'ALREADY_USED',
        badge: 'ALREADY USED',
        message: 'ALREADY USED — ENTRY NOT ALLOWED',
        ticket: ticketDoc.data,
        booking: bookingDoc?.data,
      });
    }

    return res.json({
      status: 'VALID',
      badge: 'VALID — VERIFIED',
      message: 'TICKET VERIFIED SUCCESSFULLY',
      ticket: ticketDoc.data,
      booking: bookingDoc?.data,
    });
  } catch (err) {
    console.error('Scan error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Ticket scan failed' });
  }
});

// Atomic check-in preventing duplicate entry under concurrent scanners
app.post('/api/admin/tickets/check-in', rateLimit(120, 60_000), requireAdminFeature('ticketScanner'), async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const { ticketId, qrPayload } = req.body as { ticketId?: string; qrPayload?: string };
    if (!ticketId || !/^[a-zA-Z0-9_-]{1,128}$/.test(ticketId)) {
      return res.status(400).json({ error: 'Valid ticketId is required.' });
    }

    if (qrPayload) {
      const parts = qrPayload.trim().split('.');
      const secDoc = await fsGetDoc(`tickets/${ticketId}/security/hash`, user.idToken);
      if (
        parts.length !== 3 ||
        parts[0] !== 'SP1' ||
        parts[1] !== ticketId ||
        !secDoc ||
        !safeEqualHex(hashVerificationToken(parts[2]), String(secDoc.data.secureTokenHash))
      ) {
        return res.status(400).json({ status: 'INVALID_TICKET', error: 'Invalid QR verification token.' });
      }
    }

    const ticketDoc = await fsGetDoc(`tickets/${ticketId}`, user.idToken);
    if (!ticketDoc) {
      return res.status(404).json({ status: 'INVALID_TICKET', error: 'Ticket does not exist.' });
    }

    if (ticketDoc.data.ticketStatus === 'USED') {
      return res.status(409).json({
        status: 'ALREADY_USED',
        error: 'ALREADY USED — ENTRY NOT ALLOWED',
        ticket: ticketDoc.data,
      });
    }

    if (ticketDoc.data.ticketStatus === 'CANCELLED') {
      return res.status(400).json({ status: 'CANCELLED', error: 'This ticket has been cancelled.' });
    }

    const bookingDoc = await fsGetDoc(`bookings/${String(ticketDoc.data.bookingId)}`, user.idToken);
    if (!bookingDoc || bookingDoc.data.paymentStatus !== 'VERIFIED') {
      return res.status(400).json({ status: 'PAYMENT_PENDING', error: 'Payment has not been verified.' });
    }

    // Atomic commit guarded by preconditionUpdateTime!
    await fsCommit(
      [
        {
          docPath: `tickets/${ticketId}`,
          data: {
            ...ticketDoc.data,
            ticketStatus: 'USED',
            checkedInBy: user.email,
          },
          serverTimeFields: ['checkedInAt', 'updatedAt'],
          preconditionUpdateTime: ticketDoc.updateTime,
        },
        await createAuditLogWrite(
          'TICKET_CHECK_IN',
          user,
          'ticket',
          ticketId,
          `Checked in ticket ${ticketId} (${ticketDoc.data.customerName}) for screening ${ticketDoc.data.screeningId}, seats ${(ticketDoc.data.seatNumbers as string[]).join(', ')}.`
        ),
      ],
      user.idToken
    );

    const updated = await fsGetDoc(`tickets/${ticketId}`, user.idToken);
    return res.json({
      checkedIn: true,
      status: 'USED',
      message: 'Entry confirmed. Ticket marked as USED.',
      ticket: updated?.data,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 400 || status === 409) {
      return res.status(409).json({
        status: 'ALREADY_USED',
        error: 'ALREADY USED — ENTRY NOT ALLOWED (Concurrent check-in blocked).',
      });
    }
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Check-in failed' });
  }
});

// Admin Box Office Walk-in / VIP instant ticket issuance (with Row Pricing, Discounts & Complimentary Drinks)
app.post('/api/admin/bookings/walk-in', rateLimit(60, 60_000), requireAdminFeature('boxOfficeCounter'), async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const {
      screeningId,
      seatNumbers,
      customerName,
      customerEmail,
      customerPhone,
      paymentMethod,
      referenceCode,
      notes,
      mocktailAssignments: rawAssignments,
      discountType: rawDiscountType,
      discountValue: rawDiscountValue,
      discountReason: rawDiscountReason,
      complimentaryDrinks: rawCompDrinks,
    } = req.body as {
      screeningId?: string;
      seatNumbers?: string[];
      customerName?: string;
      customerEmail?: string;
      customerPhone?: string;
      paymentMethod?: string;
      referenceCode?: string;
      notes?: string;
      mocktailAssignments?: Array<{ seatNumber: string; productId: string; quantity: number }>;
      discountType?: 'NONE' | 'FLAT' | 'PERCENT';
      discountValue?: number;
      discountReason?: string;
      complimentaryDrinks?: boolean;
    };

    if (!screeningId || !Array.isArray(seatNumbers) || seatNumbers.length === 0) {
      return res.status(400).json({ error: 'screeningId and at least one seat are required.' });
    }
    const cleanName = (customerName || '').trim();
    if (!cleanName) {
      return res.status(400).json({ error: 'Guest / Customer name is required.' });
    }
    const cleanSeats = Array.from(new Set(seatNumbers.map((s) => String(s).trim().toUpperCase()))).sort();
    if (cleanSeats.length > 36) {
      return res.status(400).json({ error: 'Maximum 36 seats per booking.' });
    }

    const allowedMethod =
      paymentMethod === 'COUNTER_UPI' || paymentMethod === 'COMPLIMENTARY_VIP'
        ? paymentMethod
        : 'COUNTER_CASH';

    const requestedDiscountType: 'NONE' | 'FLAT' | 'PERCENT' =
      rawDiscountType === 'FLAT' || rawDiscountType === 'PERCENT' ? rawDiscountType : 'NONE';
    const requestedDiscountVal = Number(rawDiscountValue || 0);
    const hasCustomDiscount = requestedDiscountType !== 'NONE' && requestedDiscountVal > 0;
    const requestedCompDrinks = Boolean(rawCompDrinks);

    if (
      allowedMethod !== 'COMPLIMENTARY_VIP' &&
      (hasCustomDiscount || requestedCompDrinks) &&
      req.adminRole !== 'SUPER_ADMIN' &&
      req.adminPermissions?.grantDiscountsAndComps !== true
    ) {
      return res.status(403).json({
        error: 'Permission denied: your account does not have Grant Discounts & Complimentary Drinks enabled.',
      });
    }

    const screening = await fsGetDoc(`screenings/${screeningId}`, user.idToken);
    if (!screening) return res.status(404).json({ error: 'Screening not found.' });
    if (screening.data.salesStatus === 'CANCELLED' || screening.data.salesStatus === 'COMPLETED') {
      return res.status(400).json({ error: `Screening is ${screening.data.salesStatus} and cannot accept bookings.` });
    }

    // Verify all requested seats are available
    const seatDocs: FsDocResult[] = [];
    const nowMs = Date.now();
    for (const seatNum of cleanSeats) {
      const sDoc = await fsGetDoc(`seats/${screeningId}_${seatNum}`, user.idToken);
      if (!sDoc) {
        return res.status(400).json({ error: `Seat ${seatNum} does not exist on screening ${screeningId}.` });
      }
      const status = String(sDoc.data.status);
      const holdExp = parseTimestampMs(sDoc.data.holdExpiresAt);
      const isAvailable =
        status === 'AVAILABLE' || (status === 'HELD' && (!holdExp || holdExp < nowMs));
      if (!isAvailable) {
        return res.status(409).json({ error: `Seat ${seatNum} is currently ${status} and unavailable.` });
      }
      seatDocs.push(sDoc);
    }

    const isComplimentary = allowedMethod === 'COMPLIMENTARY_VIP';
    const ticketSubtotal = isComplimentary
      ? 0
      : cleanSeats.reduce((sum, s) => sum + getSeatRowPrice(screening.data, s), 0);
    const avgTicketPrice =
      cleanSeats.length > 0 ? Math.round((ticketSubtotal / cleanSeats.length) * 100) / 100 : 0;

    // Resolve optional mocktail items from authoritative Firestore catalog
    const productCache = new Map<string, { name: string; price: number }>();
    let mocktailSubtotal = 0;
    const validAssignments: Array<{
      seatNumber: string;
      productId: string;
      productName: string;
      quantity: number;
      unitPrice: number;
    }> = [];

    const isCompDrinks = isComplimentary || requestedCompDrinks;

    if (Array.isArray(rawAssignments)) {
      for (const item of rawAssignments) {
        const qty = Math.floor(Number(item.quantity || 0));
        if (qty <= 0 || qty > 20 || !cleanSeats.includes(item.seatNumber)) continue;
        let prod = productCache.get(item.productId);
        if (!prod) {
          const pDoc = await fsGetDoc(`mocktailProducts/${item.productId}`, user.idToken);
          if (!pDoc) continue;
          prod = {
            name: String(pDoc.data.name || 'Mocktail'),
            price: Number(pDoc.data.price || 0),
          };
          productCache.set(item.productId, prod);
        }
        const unitPrice = isCompDrinks ? 0 : prod.price;
        mocktailSubtotal += unitPrice * qty;
        validAssignments.push({
          seatNumber: item.seatNumber,
          productId: item.productId,
          productName: prod.name,
          quantity: qty,
          unitPrice,
        });
      }
    }

    const rawTotalBeforeDiscount = ticketSubtotal + mocktailSubtotal;
    let finalDiscountType: 'NONE' | 'FLAT' | 'PERCENT' = 'NONE';
    let finalDiscountValue = 0;
    let discountAmount = 0;

    if (!isComplimentary && hasCustomDiscount) {
      if (requestedDiscountType === 'FLAT') {
        finalDiscountType = 'FLAT';
        finalDiscountValue = Math.max(0, Math.round(requestedDiscountVal * 100) / 100);
        discountAmount = Math.min(rawTotalBeforeDiscount, finalDiscountValue);
      } else if (requestedDiscountType === 'PERCENT') {
        finalDiscountType = 'PERCENT';
        finalDiscountValue = Math.min(100, Math.max(0, Math.round(requestedDiscountVal * 100) / 100));
        discountAmount = Math.min(
          rawTotalBeforeDiscount,
          Math.round(((rawTotalBeforeDiscount * finalDiscountValue) / 100) * 100) / 100
        );
      }
    }

    const cleanDiscountReason = (rawDiscountReason || '').trim().slice(0, 190);
    const grandTotal = Math.max(0, Math.round((rawTotalBeforeDiscount - discountAmount) * 100) / 100);
    const bookingId = generateId('BKG_');
    const paymentId = generateId('PAY_');
    const ticketId = generateId('TKT_');
    const rawToken = crypto.randomBytes(24).toString('hex');
    const secureTokenHash = hashVerificationToken(rawToken);
    const qrPayload = `SP1.${ticketId}.${rawToken}`;
    const cleanEmail = (customerEmail || '').trim().toLowerCase() || user.email;
    const cleanPhone = (customerPhone || '').trim().slice(0, 30);
    const cleanRef = (referenceCode || allowedMethod).trim().slice(0, 110);
    const cleanNotes = (
      notes ||
      `Box office counter (${allowedMethod})${discountAmount > 0 ? `, Discount ₹${discountAmount}` : ''}${isCompDrinks && validAssignments.length > 0 ? ', Complimentary Drinks' : ''} issued by ${user.email}.`
    ).slice(0, 480);

    const summaryParts = validAssignments.map((a) => `${a.seatNumber}: ${a.quantity}× ${a.productName}`);
    const mocktailSummary =
      summaryParts.length > 0
        ? `${summaryParts.join(' · ')}${isCompDrinks ? ' (Complimentary ₹0)' : ''}`
        : 'None';

    const writes: FsCommitWrite[] = [];

    const bookingData = {
      bookingId,
      screeningId,
      movieTitle: String(screening.data.movieTitle || 'APNE BEECH'),
      date: String(screening.data.date),
      startTime: String(screening.data.startTime || ''),
      customerId: user.uid,
      customerName: cleanName.slice(0, 145),
      customerEmail: cleanEmail.slice(0, 195),
      customerPhone: cleanPhone,
      seatNumbers: cleanSeats,
      ticketPrice: avgTicketPrice,
      ticketCount: cleanSeats.length,
      ticketSubtotal,
      mocktailSubtotal,
      discountType: finalDiscountType,
      discountValue: finalDiscountValue,
      discountAmount,
      ...(cleanDiscountReason ? { discountReason: cleanDiscountReason } : {}),
      complimentaryDrinks: isCompDrinks && validAssignments.length > 0,
      grandTotal,
      paymentStatus: 'VERIFIED',
      bookingStatus: 'CONFIRMED',
      upiTransactionRef: cleanRef,
      paymentMethod: allowedMethod,
      adminNotes: cleanNotes,
    };

    writes.push({
      docPath: `bookings/${bookingId}`,
      data: bookingData,
      serverTimeFields: ['createdAt', 'updatedAt'],
      preconditionExists: false,
    });

    writes.push({
      docPath: `payments/${paymentId}`,
      data: {
        paymentId,
        bookingId,
        screeningId,
        customerId: user.uid,
        customerName: cleanName.slice(0, 145),
        customerEmail: cleanEmail.slice(0, 195),
        amount: grandTotal,
        method: allowedMethod,
        status: 'VERIFIED',
        transactionRef: cleanRef,
        verifiedBy: user.email,
        notes: cleanNotes,
      },
      serverTimeFields: ['verifiedAt', 'createdAt', 'updatedAt'],
      preconditionExists: false,
    });

    for (const sDoc of seatDocs) {
      writes.push({
        docPath: `seats/${sDoc.data.seatDocId}`,
        data: {
          ...sDoc.data,
          status: 'BOOKED',
          heldByUid: user.uid,
          holdExpiresAt: null,
          bookingId,
        },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: sDoc.updateTime,
      });
    }

    writes.push({
      docPath: `screenings/${screeningId}`,
      data: {
        ...screening.data,
        bookedCount: Number(screening.data.bookedCount || 0) + cleanSeats.length,
      },
      serverTimeFields: ['updatedAt'],
      preconditionUpdateTime: screening.updateTime,
    });

    if (validAssignments.length > 0) {
      const orderId = generateId('ORD_');
      const grouped = new Map<string, { productId: string; productName: string; price: number; quantity: number }>();
      for (const a of validAssignments) {
        const cur = grouped.get(a.productId);
        if (cur) cur.quantity += a.quantity;
        else {
          grouped.set(a.productId, {
            productId: a.productId,
            productName: a.productName,
            price: a.unitPrice,
            quantity: a.quantity,
          });
        }
      }
      writes.push({
        docPath: `mocktailOrders/${orderId}`,
        data: {
          orderId,
          bookingId,
          screeningId,
          customerId: user.uid,
          customerName: cleanName.slice(0, 145),
          date: String(screening.data.date),
          startTime: String(screening.data.startTime || ''),
          items: Array.from(grouped.values()),
          subtotal: mocktailSubtotal,
          paymentStatus: 'VERIFIED',
          deliveryStatus: 'PREPARING',
        },
        serverTimeFields: ['createdAt', 'updatedAt'],
        preconditionExists: false,
      });

      for (const a of validAssignments) {
        const assignmentId = generateId('ASG_');
        writes.push({
          docPath: `mocktailAssignments/${assignmentId}`,
          data: {
            assignmentId,
            bookingId,
            screeningId,
            customerId: user.uid,
            customerName: cleanName.slice(0, 145),
            date: String(screening.data.date),
            startTime: String(screening.data.startTime || ''),
            seatNumber: a.seatNumber,
            productId: a.productId,
            productName: a.productName,
            quantity: a.quantity,
            unitPrice: a.unitPrice,
            paymentStatus: 'VERIFIED',
            deliveryStatus: 'PREPARING',
          },
          serverTimeFields: ['createdAt', 'updatedAt'],
          preconditionExists: false,
        });
      }
    }

    const ticketData = {
      ticketId,
      bookingId,
      screeningId,
      customerId: user.uid,
      customerName: cleanName.slice(0, 145),
      customerEmail: cleanEmail.slice(0, 195),
      movieTitle: String(screening.data.movieTitle || 'APNE BEECH'),
      date: String(screening.data.date),
      startTime: String(screening.data.startTime || ''),
      seatNumbers: cleanSeats,
      mocktailSummary,
      ...(discountAmount > 0 ? { discountAmount } : {}),
      ...(cleanDiscountReason ? { discountReason: cleanDiscountReason } : {}),
      ...(isCompDrinks && validAssignments.length > 0 ? { complimentaryDrinks: true } : {}),
      grandTotal,
      qrPayload,
      ticketStatus: 'VALID',
      checkedInAt: null,
      checkedInBy: null,
    };

    writes.push({
      docPath: `tickets/${ticketId}`,
      data: ticketData,
      serverTimeFields: ['createdAt', 'updatedAt'],
      preconditionExists: false,
    });

    writes.push({
      docPath: `tickets/${ticketId}/security/hash`,
      data: { secureTokenHash, ticketId },
      serverTimeFields: ['createdAt'],
      preconditionExists: false,
    });

    writes.push(
      await createAuditLogWrite(
        'ADMIN_WALKIN_BOOKING',
        user,
        'booking',
        bookingId,
        `Issued box-office ${allowedMethod} ticket ${ticketId} for ${cleanName} (${cleanSeats.join(', ')}, ₹${grandTotal}${discountAmount > 0 ? `, discount -₹${discountAmount}` : ''}${isCompDrinks && validAssignments.length > 0 ? ', complimentary drinks' : ''}).`
      )
    );

    await fsCommit(writes, user.idToken);
    return res.json({ created: true, booking: bookingData, ticket: ticketData });
  } catch (err) {
    console.error('Walk-in booking error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Walk-in booking failed' });
  }
});

// Admin Grant Complimentary Drinks (₹0) to any existing non-cancelled booking
app.post(
  '/api/admin/bookings/grant-complimentary-drinks',
  rateLimit(60, 60_000),
  requireAnyAdminFeature(['grantDiscountsAndComps', 'manageMocktails', 'boxOfficeCounter']),
  async (req: AuthedRequest, res) => {
    try {
      const user = req.user!;
      const { bookingId, items, notes } = req.body as {
        bookingId?: string;
        items?: Array<{ seatNumber?: string; productId: string; quantity: number }>;
        notes?: string;
      };

      if (!bookingId || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'bookingId and at least one complimentary drink item are required.' });
      }

      const booking = await fsGetDoc(`bookings/${bookingId}`, user.idToken);
      if (!booking) return res.status(404).json({ error: 'Booking not found.' });
      if (booking.data.bookingStatus === 'CANCELLED') {
        return res.status(400).json({ error: 'Cannot add complimentary drinks to a cancelled booking.' });
      }

      const seatNumbers = (booking.data.seatNumbers as string[]) || [];
      const defaultSeat = seatNumbers[0] || 'A1';

      const productCache = new Map<string, { name: string }>();
      const validItems: Array<{ seatNumber: string; productId: string; productName: string; quantity: number }> = [];
      for (const item of items) {
        const qty = Math.floor(Number(item.quantity || 0));
        if (qty <= 0 || qty > 20 || !item.productId) continue;
        let prod = productCache.get(item.productId);
        if (!prod) {
          const pDoc = await fsGetDoc(`mocktailProducts/${item.productId}`, user.idToken);
          if (!pDoc) continue;
          prod = { name: String(pDoc.data.name || 'Mocktail') };
          productCache.set(item.productId, prod);
        }
        const chosenSeat =
          item.seatNumber && seatNumbers.includes(item.seatNumber) ? item.seatNumber : defaultSeat;
        validItems.push({
          seatNumber: chosenSeat,
          productId: item.productId,
          productName: prod.name,
          quantity: qty,
        });
      }

      if (validItems.length === 0) {
        return res.status(400).json({ error: 'No valid mocktail items were provided.' });
      }

      const writes: FsCommitWrite[] = [];
      const orderId = generateId('ORD_');
      const grouped = new Map<string, { productId: string; productName: string; price: number; quantity: number }>();
      for (const vi of validItems) {
        const cur = grouped.get(vi.productId);
        if (cur) cur.quantity += vi.quantity;
        else grouped.set(vi.productId, { productId: vi.productId, productName: vi.productName, price: 0, quantity: vi.quantity });

        const assignmentId = generateId('ASG_');
        writes.push({
          docPath: `mocktailAssignments/${assignmentId}`,
          data: {
            assignmentId,
            bookingId,
            screeningId: String(booking.data.screeningId),
            customerId: String(booking.data.customerId),
            customerName: String(booking.data.customerName),
            date: String(booking.data.date),
            startTime: String(booking.data.startTime || ''),
            seatNumber: vi.seatNumber,
            productId: vi.productId,
            productName: vi.productName,
            quantity: vi.quantity,
            unitPrice: 0,
            paymentStatus: 'VERIFIED',
            deliveryStatus: 'PREPARING',
          },
          serverTimeFields: ['createdAt', 'updatedAt'],
          preconditionExists: false,
        });
      }

      writes.push({
        docPath: `mocktailOrders/${orderId}`,
        data: {
          orderId,
          bookingId,
          screeningId: String(booking.data.screeningId),
          customerId: String(booking.data.customerId),
          customerName: String(booking.data.customerName),
          date: String(booking.data.date),
          startTime: String(booking.data.startTime || ''),
          items: Array.from(grouped.values()),
          subtotal: 0,
          paymentStatus: 'VERIFIED',
          deliveryStatus: 'PREPARING',
        },
        serverTimeFields: ['createdAt', 'updatedAt'],
        preconditionExists: false,
      });

      const compLabel = validItems.map((i) => `${i.seatNumber}: ${i.quantity}× ${i.productName} (Comp)`).join(' · ');
      const existingNotes = String(booking.data.adminNotes || '').trim();
      const extraNote = (notes || `Complimentary drinks granted by ${user.email}: ${compLabel}`).slice(0, 200);
      writes.push({
        docPath: `bookings/${bookingId}`,
        data: {
          ...booking.data,
          complimentaryDrinks: true,
          adminNotes: existingNotes ? `${existingNotes} | ${extraNote}`.slice(0, 480) : extraNote,
        },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: booking.updateTime,
      });

      const tickets = await fsRunQuery('tickets', 'bookingId', bookingId, user.idToken);
      for (const t of tickets) {
        const curSum = String(t.data.mocktailSummary || 'None');
        const nextSum =
          curSum === 'None' || !curSum ? compLabel : `${curSum} · ${compLabel}`.slice(0, 950);
        writes.push({
          docPath: `tickets/${t.data.ticketId}`,
          data: {
            ...t.data,
            mocktailSummary: nextSum,
            complimentaryDrinks: true,
          },
          serverTimeFields: ['updatedAt'],
          preconditionUpdateTime: t.updateTime,
        });
      }

      writes.push(
        await createAuditLogWrite(
          'GRANT_COMPLIMENTARY_DRINKS',
          user,
          'booking',
          bookingId,
          `Granted complimentary drinks (${compLabel}) to ${booking.data.customerName} (${bookingId}).`
        )
      );

      await fsCommit(writes, user.idToken);
      return res.json({ granted: true, bookingId, summary: compLabel });
    } catch (err) {
      console.error('Grant complimentary drinks error:', err);
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to grant complimentary drinks' });
    }
  }
);

// Admin Cancel Booking & Release Seats
app.post('/api/admin/bookings/cancel', rateLimit(60, 60_000), requireAnyAdminFeature(['manageBookingsAndPayments', 'boxOfficeCounter']), async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const { bookingId, reason } = req.body as { bookingId?: string; reason?: string };
    if (!bookingId) return res.status(400).json({ error: 'bookingId is required.' });

    const booking = await fsGetDoc(`bookings/${bookingId}`, user.idToken);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.data.bookingStatus === 'CANCELLED') {
      return res.status(400).json({ error: 'Booking is already cancelled.' });
    }

    const screeningId = String(booking.data.screeningId);
    const screening = await fsGetDoc(`screenings/${screeningId}`, user.idToken);
    const seatNumbers = (booking.data.seatNumbers as string[]) || [];
    const isPaid = booking.data.paymentStatus === 'VERIFIED' && Number(booking.data.grandTotal || 0) > 0;
    const cancelReason = (reason || `Booking cancelled by administrator ${user.email}.`).slice(0, 480);

    const writes: FsCommitWrite[] = [
      {
        docPath: `bookings/${bookingId}`,
        data: {
          ...booking.data,
          bookingStatus: 'CANCELLED',
          refundStatus: isPaid ? 'PENDING' : 'NOT_APPLICABLE',
          adminNotes: cancelReason,
        },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: booking.updateTime,
      },
    ];

    let releasedBookedCount = 0;
    for (const seatNum of seatNumbers) {
      const sDoc = await fsGetDoc(`seats/${screeningId}_${seatNum}`, user.idToken);
      if (sDoc && sDoc.data.bookingId === bookingId) {
        if (sDoc.data.status === 'BOOKED') releasedBookedCount += 1;
        writes.push({
          docPath: `seats/${sDoc.data.seatDocId}`,
          data: {
            ...sDoc.data,
            status: 'AVAILABLE',
            heldByUid: null,
            holdExpiresAt: null,
            bookingId: null,
          },
          serverTimeFields: ['updatedAt'],
          preconditionUpdateTime: sDoc.updateTime,
        });
      }
    }

    if (screening && releasedBookedCount > 0) {
      writes.push({
        docPath: `screenings/${screeningId}`,
        data: {
          ...screening.data,
          bookedCount: Math.max(0, Number(screening.data.bookedCount || 0) - releasedBookedCount),
        },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: screening.updateTime,
      });
    }

    const tickets = await fsRunQuery('tickets', 'bookingId', bookingId, user.idToken);
    for (const t of tickets) {
      writes.push({
        docPath: `tickets/${t.data.ticketId}`,
        data: { ...t.data, ticketStatus: 'CANCELLED' },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: t.updateTime,
      });
    }

    const orders = await fsRunQuery('mocktailOrders', 'bookingId', bookingId, user.idToken);
    for (const mo of orders) {
      writes.push({
        docPath: `mocktailOrders/${mo.data.orderId}`,
        data: { ...mo.data, deliveryStatus: 'CANCELLED' },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: mo.updateTime,
      });
    }

    const assignments = await fsRunQuery('mocktailAssignments', 'bookingId', bookingId, user.idToken);
    for (const ma of assignments) {
      writes.push({
        docPath: `mocktailAssignments/${ma.data.assignmentId}`,
        data: { ...ma.data, deliveryStatus: 'CANCELLED' },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: ma.updateTime,
      });
    }

    const refundId = generateId('REF_');
    writes.push({
      docPath: `refunds/${refundId}`,
      data: {
        refundId,
        bookingId,
        screeningId,
        customerId: String(booking.data.customerId),
        customerName: String(booking.data.customerName),
        customerEmail: String(booking.data.customerEmail),
        amount: isPaid ? Number(booking.data.grandTotal || 0) : 0,
        reason: cancelReason,
        refundStatus: isPaid ? 'PENDING' : 'NOT_APPLICABLE',
        notificationStatus: 'PENDING',
        processedBy: user.email,
      },
      serverTimeFields: ['createdAt', 'updatedAt'],
    });

    writes.push(
      await createAuditLogWrite(
        'ADMIN_CANCEL_BOOKING',
        user,
        'booking',
        bookingId,
        `Cancelled booking ${bookingId} and released seats ${seatNumbers.join(', ')}. Reason: ${cancelReason}`
      )
    );

    await fsCommit(writes, user.idToken);
    return res.json({ cancelled: true, releasedSeats: seatNumbers });
  } catch (err) {
    console.error('Cancel booking error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to cancel booking' });
  }
});

// Admin manual ticket check-in / reset status override
app.post('/api/admin/tickets/override-status', rateLimit(60, 60_000), requireAdminFeature('ticketScanner'), async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const { ticketId, nextStatus } = req.body as { ticketId?: string; nextStatus?: 'VALID' | 'USED' };
    if (!ticketId || (nextStatus !== 'VALID' && nextStatus !== 'USED')) {
      return res.status(400).json({ error: 'ticketId and nextStatus (VALID | USED) are required.' });
    }
    const ticketDoc = await fsGetDoc(`tickets/${ticketId}`, user.idToken);
    if (!ticketDoc) return res.status(404).json({ error: 'Ticket not found.' });
    if (ticketDoc.data.ticketStatus === 'CANCELLED') {
      return res.status(400).json({ error: 'Cancelled tickets cannot be checked in.' });
    }

    const writes: FsCommitWrite[] = [
      {
        docPath: `tickets/${ticketId}`,
        data: {
          ...ticketDoc.data,
          ticketStatus: nextStatus,
          ...(nextStatus === 'VALID' ? { checkedInAt: null, checkedInBy: null } : { checkedInBy: user.email }),
        },
        serverTimeFields: nextStatus === 'USED' ? ['checkedInAt', 'updatedAt'] : ['updatedAt'],
        preconditionUpdateTime: ticketDoc.updateTime,
      },
      await createAuditLogWrite(
        'ADMIN_TICKET_STATUS_OVERRIDE',
        user,
        'ticket',
        ticketId,
        `Set ticket ${ticketId} status to ${nextStatus}.`
      ),
    ];
    await fsCommit(writes, user.idToken);
    return res.json({ updated: true, ticketId, ticketStatus: nextStatus });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Ticket status update failed' });
  }
});

// Controlled safe removal of a show (never silently deletes historical booking/payment records)
app.post('/api/admin/shows/safe-remove', requireAdminFeature('removeShows'), async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const { screeningId, confirmCancellation, reason, deleteIfEmpty } = req.body as {
      screeningId?: string;
      confirmCancellation?: boolean;
      reason?: string;
      deleteIfEmpty?: boolean;
    };
    if (!screeningId) return res.status(400).json({ error: 'screeningId required.' });

    const screening = await fsGetDoc(`screenings/${screeningId}`, user.idToken);
    if (!screening) return res.status(404).json({ error: 'Screening not found.' });

    const bookings = await fsRunQuery('bookings', 'screeningId', screeningId, user.idToken);
    const activeBookings = bookings.filter((b) => b.data.bookingStatus !== 'CANCELLED');

    if (activeBookings.length > 0 && !confirmCancellation) {
      const paidAmount = activeBookings
        .filter((b) => b.data.paymentStatus === 'VERIFIED')
        .reduce((sum, b) => sum + Number(b.data.grandTotal || 0), 0);
      return res.json({
        requiresCancellation: true,
        activeBookingsCount: activeBookings.length,
        verifiedPaidAmount: paidAmount,
        totalHistoricalBookings: bookings.length,
      });
    }

    // If zero historical bookings exist and admin requested clean removal, delete screening + its seats
    if (bookings.length === 0 && deleteIfEmpty && confirmCancellation) {
      const seatDocs = await fsRunQuery('seats', 'screeningId', screeningId, user.idToken);
      const deleteWrites = [
        { delete: docName(`screenings/${screeningId}`) },
        ...seatDocs.map((s) => ({ delete: s.name })),
      ];
      const auditWrite = await createAuditLogWrite(
        'DELETE_EMPTY_SHOW',
        user,
        'screening',
        screeningId,
        `Removed unbooked screening ${screeningId} (${screening.data.date}) and its ${seatDocs.length} seats.`
      );
      const auditFields: Record<string, FsValue> = {};
      for (const [k, v] of Object.entries(auditWrite.data)) {
        if (v !== undefined) auditFields[k] = toFsValue(v);
      }
      const resp = await fetch(
        `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents:commit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${user.idToken}`,
          },
          body: JSON.stringify({
            writes: [
              ...deleteWrites,
              {
                update: { name: docName(auditWrite.docPath), fields: auditFields },
                updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              },
            ],
          }),
        }
      );
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Delete show commit failed: ${text}`);
      }
      return res.json({ removed: true, deletedEmpty: true, preservedBookings: 0, cancelledActive: 0 });
    }

    const writes: FsCommitWrite[] = [
      {
        docPath: `screenings/${screeningId}`,
        data: {
          ...screening.data,
          salesStatus: 'CANCELLED',
          isPublished: false,
        },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: screening.updateTime,
      },
    ];

    const cancelReason = (reason || 'Show cancelled and removed from public schedule by administration.').slice(0, 480);

    for (const b of activeBookings) {
      const bId = String(b.data.bookingId);
      const isPaid = b.data.paymentStatus === 'VERIFIED';
      writes.push({
        docPath: `bookings/${bId}`,
        data: {
          ...b.data,
          bookingStatus: 'CANCELLED',
          refundStatus: isPaid ? 'PENDING' : 'NOT_APPLICABLE',
          adminNotes: cancelReason,
        },
        serverTimeFields: ['updatedAt'],
        preconditionUpdateTime: b.updateTime,
      });

      const refundId = generateId('REF_');
      writes.push({
        docPath: `refunds/${refundId}`,
        data: {
          refundId,
          bookingId: bId,
          screeningId,
          customerId: String(b.data.customerId),
          customerName: String(b.data.customerName),
          customerEmail: String(b.data.customerEmail),
          amount: isPaid ? Number(b.data.grandTotal) : 0,
          reason: cancelReason,
          refundStatus: isPaid ? 'PENDING' : 'NOT_APPLICABLE',
          notificationStatus: 'PENDING',
          processedBy: user.email,
        },
        serverTimeFields: ['createdAt', 'updatedAt'],
      });

      const tickets = await fsRunQuery('tickets', 'bookingId', bId, user.idToken);
      for (const t of tickets) {
        writes.push({
          docPath: `tickets/${t.data.ticketId}`,
          data: { ...t.data, ticketStatus: 'CANCELLED' },
          serverTimeFields: ['updatedAt'],
          preconditionUpdateTime: t.updateTime,
        });
      }

      const orders = await fsRunQuery('mocktailOrders', 'bookingId', bId, user.idToken);
      for (const mo of orders) {
        writes.push({
          docPath: `mocktailOrders/${mo.data.orderId}`,
          data: { ...mo.data, deliveryStatus: 'CANCELLED' },
          serverTimeFields: ['updatedAt'],
          preconditionUpdateTime: mo.updateTime,
        });
      }

      const assignments = await fsRunQuery('mocktailAssignments', 'bookingId', bId, user.idToken);
      for (const ma of assignments) {
        writes.push({
          docPath: `mocktailAssignments/${ma.data.assignmentId}`,
          data: { ...ma.data, deliveryStatus: 'CANCELLED' },
          serverTimeFields: ['updatedAt'],
          preconditionUpdateTime: ma.updateTime,
        });
      }
    }

    writes.push(
      await createAuditLogWrite(
        'SAFE_REMOVE_SHOW',
        user,
        'screening',
        screeningId,
        `Cancelled and unpublished screening ${screeningId} (${screening.data.date}). Preserved ${bookings.length} historical booking(s); initiated ${activeBookings.length} cancellation/refund record(s).`
      )
    );

    await fsCommit(writes, user.idToken);
    return res.json({ removed: true, preservedBookings: bookings.length, cancelledActive: activeBookings.length });
  } catch (err) {
    console.error('Safe remove show error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to remove show safely' });
  }
});

// ---------------------- Vite / Static Serving ----------------------
async function startServer() {
  const PORT = 3000;
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      return res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SPLENDORA CINEMA server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
