import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Check, CheckCircle2, Palette, QrCode, RotateCcw, ShieldAlert, Upload, XCircle } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { applyCinemaThemeToDocument } from '../../hooks/useThemeSync';
import { DEFAULT_THEME, THEME_PRESETS, formatINR } from '../../lib/defaults';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { compressImageFile } from '../../lib/imageUtils';
import type {
  BookingRecord,
  CinemaTheme,
  PaymentMode,
  PaymentRecord,
  PaymentSettingsPrivate,
  PaymentSettingsPublic,
  WebsiteSettings,
} from '../../types/cinema';

export function PaymentManagementPanel({
  payments,
  bookings,
}: {
  payments: PaymentRecord[];
  bookings: BookingRecord[];
}) {
  const { getIdToken } = useAuth();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const bookingMap = new Map<string, BookingRecord>();
  for (const b of bookings) bookingMap.set(b.bookingId, b);

  const verifyPayment = async (p: PaymentRecord) => {
    setProcessingId(p.paymentId);
    setFeedback(null);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/admin/payments/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ bookingId: p.bookingId, paymentId: p.paymentId }),
      });
      const data = (await resp.json()) as { verified?: boolean; error?: string; ticket?: { ticketId: string } };
      if (!resp.ok) throw new Error(data.error || 'Verification failed');
      setFeedback(`Payment verified for ${p.bookingId}. Digital QR Ticket ${data.ticket?.ticketId || ''} issued.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Verification error');
    } finally {
      setProcessingId(null);
    }
  };

  const rejectPayment = async (p: PaymentRecord) => {
    setProcessingId(p.paymentId);
    setFeedback(null);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/admin/payments/reject', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookingId: p.bookingId,
          reason: 'UPI reference could not be reconciled against cinema account statement.',
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as { error?: string };
      if (!resp.ok) throw new Error(data.error || 'Reject failed');
      setFeedback(`Payment rejected for ${p.bookingId} and seats released.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Rejection error');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-cinema-accent/40 pb-4">
        <h2 className="font-display text-2xl font-semibold text-cinema-primary">
          Payment Management & Verification
        </h2>
        <p className="text-sm text-cinema-muted">
          Verify customer UPI transaction references against actual bank/UPI receipts before issuing valid QR tickets.
        </p>
      </div>

      {feedback && (
        <div className="bg-cinema-surface-alt border border-cinema-accent p-3 text-xs font-semibold text-cinema-text">
          {feedback}
        </div>
      )}

      <div className="bg-cinema-surface border border-cinema-accent/60 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-cinema-surface-alt border-b border-cinema-accent/40 text-cinema-primary uppercase">
            <tr>
              <th className="py-3 px-4">Booking ID</th>
              <th className="py-3 px-4">Customer</th>
              <th className="py-3 px-4">Method</th>
              <th className="py-3 px-4">UPI Ref / UTR</th>
              <th className="py-3 px-4 text-right">Amount</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cinema-accent/25">
            {payments.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-cinema-muted">
                  No payment records logged yet.
                </td>
              </tr>
            ) : (
              payments.map((p) => {
                const booking = bookingMap.get(p.bookingId);
                return (
                  <tr key={p.paymentId} className="hover:bg-cinema-bg/70">
                    <td className="py-3 px-4 font-mono font-semibold">{p.bookingId}</td>
                    <td className="py-3 px-4">
                      <p className="font-medium">{p.customerName}</p>
                      <p className="text-[11px] text-cinema-muted">{p.customerEmail}</p>
                    </td>
                    <td className="py-3 px-4 font-mono">{p.method}</td>
                    <td className="py-3 px-4 font-mono font-bold text-cinema-primary">
                      {p.transactionRef || booking?.upiTransactionRef || '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold tabular-nums">
                      {formatINR(p.amount)}
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold">
                      <span
                        className={
                          p.status === 'VERIFIED'
                            ? 'text-[#166534]'
                            : p.status === 'PENDING_VERIFICATION'
                            ? 'text-[#92400E]'
                            : 'text-[#991B1B]'
                        }
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {p.status === 'PENDING_VERIFICATION' || p.status === 'PENDING' ? (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={processingId === p.paymentId}
                            onClick={() => void verifyPayment(p)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#166534] text-white font-semibold hover:bg-[#14532D] cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Verify & Issue Ticket
                          </button>
                          <button
                            type="button"
                            disabled={processingId === p.paymentId}
                            onClick={() => void rejectPayment(p)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 border border-[#DC2626] text-[#991B1B] hover:bg-[#FEE2E2] cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-cinema-muted font-mono">
                          {p.verifiedBy ? `By ${p.verifiedBy}` : 'Processed'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PaymentSettingsPanel({
  publicSettings,
  privateSettings,
}: {
  publicSettings: PaymentSettingsPublic;
  privateSettings: PaymentSettingsPrivate | null;
}) {
  const { user, hasFeature } = useAuth();
  const canManagePayment = hasFeature('managePaymentSettings');

  const [mode, setMode] = useState<PaymentMode>(publicSettings.mode || 'UNCONFIGURED');
  const [upiId, setUpiId] = useState(publicSettings.upiId || '');
  const [displayName, setDisplayName] = useState(publicSettings.displayName || '');
  const [qrImageUrl, setQrImageUrl] = useState(publicSettings.qrImageUrl || '');
  const [instructions, setInstructions] = useState(publicSettings.instructions || '');
  const [providerName, setProviderName] = useState(publicSettings.providerName || '');
  const [testMode, setTestMode] = useState(publicSettings.testMode ?? true);
  const [gatewayKeyId, setGatewayKeyId] = useState(privateSettings?.gatewayKeyId || '');
  const [gatewayKeySecret, setGatewayKeySecret] = useState(privateSettings?.gatewayKeySecret || '');
  const [webhookSecret, setWebhookSecret] = useState(privateSettings?.webhookSecret || '');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setMode(publicSettings.mode || 'UNCONFIGURED');
    setUpiId(publicSettings.upiId || '');
    setDisplayName(publicSettings.displayName || '');
    setQrImageUrl(publicSettings.qrImageUrl || '');
    setInstructions(publicSettings.instructions || '');
    setProviderName(publicSettings.providerName || '');
    setTestMode(publicSettings.testMode ?? true);
  }, [publicSettings]);

  useEffect(() => {
    if (privateSettings) {
      setGatewayKeyId(privateSettings.gatewayKeyId || '');
      setGatewayKeySecret(privateSettings.gatewayKeySecret || '');
      setWebhookSecret(privateSettings.webhookSecret || '');
    }
  }, [privateSettings]);

  const handleQrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const compressed = await compressImageFile(file, 720, 0.85);
      setQrImageUrl(compressed);
      if (mode === 'UNCONFIGURED') {
        setMode('MANUAL_UPI');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to process QR image.');
    }
  };

  const handleGenerateQrFromUpi = async () => {
    const cleanUpi = upiId.trim();
    if (!cleanUpi) {
      setErrorMsg('Enter a UPI ID first to generate a QR code.');
      return;
    }
    setErrorMsg(null);
    const pn = encodeURIComponent(displayName.trim() || 'SPLENDORA CINEMA');
    const pa = encodeURIComponent(cleanUpi);
    const upiUri = `upi://pay?pa=${pa}&pn=${pn}&cu=INR`;
    const dataUrl = await QRCode.toDataURL(upiUri, { width: 420, margin: 2 });
    setQrImageUrl(dataUrl);
    if (mode === 'UNCONFIGURED') {
      setMode('MANUAL_UPI');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canManagePayment) return;
    setSaving(true);
    setSavedMsg(null);
    setErrorMsg(null);
    try {
      const effectiveMode: PaymentMode =
        mode === 'UNCONFIGURED' && (upiId.trim() || qrImageUrl.trim()) ? 'MANUAL_UPI' : mode;

      const isConfigured =
        effectiveMode === 'MANUAL_UPI'
          ? Boolean(upiId.trim() || qrImageUrl.trim())
          : effectiveMode === 'AUTOMATIC_GATEWAY'
          ? Boolean(providerName.trim() && gatewayKeyId.trim())
          : false;

      const batch = writeBatch(db);
      batch.set(doc(db, 'paymentSettings', 'public'), {
        isConfigured,
        mode: effectiveMode,
        upiId: upiId.trim(),
        displayName: displayName.trim(),
        qrImageUrl: qrImageUrl.trim(),
        instructions: instructions.trim(),
        providerName: providerName.trim(),
        testMode,
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'paymentSettings', 'private'), {
        gatewayKeyId: gatewayKeyId.trim(),
        gatewayKeySecret: gatewayKeySecret.trim(),
        webhookSecret: webhookSecret.trim(),
        updatedBy: user.email || '',
        updatedAt: serverTimestamp(),
      });

      const logId = `LOG_${Date.now().toString(36).toUpperCase()}`;
      batch.set(doc(db, 'auditLogs', logId), {
        logId,
        action: 'UPDATE_PAYMENT_SETTINGS',
        actorEmail: user.email || '',
        actorUid: user.uid,
        targetType: 'paymentSettings',
        targetId: 'public',
        details: `Updated payment configuration to mode=${effectiveMode}, isConfigured=${isConfigured}, upiId=${upiId.trim() || 'none'}.`,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      setMode(effectiveMode);
      setSavedMsg(
        isConfigured
          ? 'UPI ID, QR Code, and Payment Settings saved and live on customer checkout.'
          : 'Payment settings saved (currently NOT CONFIGURED).'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save payment settings.';
      setErrorMsg(msg);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.WRITE, 'paymentSettings');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="border-b border-cinema-accent/40 pb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-cinema-primary">Payment Settings</h2>
          <p className="text-sm text-cinema-muted">
            Add your Google Pay / BHIM UPI ID and QR code image, or configure gateway credentials.
          </p>
        </div>
        <span
          className={`font-mono text-xs font-bold px-3 py-1.5 border ${
            publicSettings.isConfigured
              ? 'border-[#16A34A] text-[#166534] bg-[#DCFCE7]'
              : 'border-[#D97706] text-[#92400E] bg-[#FEF3C7]'
          }`}
        >
          {publicSettings.isConfigured ? `CONFIGURED (${publicSettings.mode})` : 'NOT CONFIGURED'}
        </span>
      </div>

      {!canManagePayment && (
        <div className="bg-[#FEF3C7] border border-[#D97706]/50 p-4 text-xs text-[#92400E]">
          Your account currently has read-only access to Payment Settings. An administrator with Access Features permission can enable this permission.
        </div>
      )}

      {errorMsg && (
        <div className="bg-[#FEE2E2] border border-[#DC2626] p-3 text-xs font-semibold text-[#991B1B]">
          {errorMsg}
        </div>
      )}

      {savedMsg && (
        <div className="bg-[#DCFCE7] border border-[#16A34A] p-3 text-xs font-semibold text-[#14532D]">
          {savedMsg}
        </div>
      )}

      <form
        onSubmit={(e) => void handleSave(e)}
        className="bg-cinema-surface border border-cinema-accent/60 p-6 space-y-5 text-xs"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-semibold mb-1">Active Payment Mode</label>
            <select
              value={mode}
              disabled={!canManagePayment}
              onChange={(e) => setMode(e.target.value as PaymentMode)}
              className="w-full px-3 py-2.5 bg-cinema-bg border border-cinema-accent/60"
            >
              <option value="UNCONFIGURED">NOT CONFIGURED</option>
              <option value="MANUAL_UPI">MANUAL UPI (Google Pay / BHIM UPI)</option>
              <option value="AUTOMATIC_GATEWAY">AUTOMATIC GATEWAY (Server Verified)</option>
            </select>
          </div>
          <div className="flex items-end pb-2">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                disabled={!canManagePayment}
                checked={testMode}
                onChange={(e) => setTestMode(e.target.checked)}
              />
              <span>Test / Sandbox Configuration</span>
            </label>
          </div>
        </div>

        <div className="border-t border-cinema-accent/30 pt-4 space-y-4">
          <h3 className="font-display text-lg text-cinema-primary">Google Pay / BHIM UPI Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold mb-1">UPI ID (VPA)</label>
              <input
                type="text"
                disabled={!canManagePayment}
                value={upiId}
                onChange={(e) => {
                  setUpiId(e.target.value);
                  if (mode === 'UNCONFIGURED' && e.target.value.trim()) {
                    setMode('MANUAL_UPI');
                  }
                }}
                placeholder="e.g. yourname@okicici or yournumber@upi"
                className="w-full px-3 py-2.5 bg-cinema-bg border border-cinema-accent/60 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Payment Display Name</label>
              <input
                type="text"
                disabled={!canManagePayment}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. SPLENDORA CINEMA"
                className="w-full px-3 py-2.5 bg-cinema-bg border border-cinema-accent/60"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold mb-1">UPI QR Code Image (Upload, Paste URL, or Generate)</label>
            <div className="flex flex-wrap items-center gap-2.5">
              <input
                type="text"
                disabled={!canManagePayment}
                value={qrImageUrl}
                onChange={(e) => {
                  setQrImageUrl(e.target.value);
                  if (mode === 'UNCONFIGURED' && e.target.value.trim()) {
                    setMode('MANUAL_UPI');
                  }
                }}
                placeholder="Paste QR image URL, upload image, or generate from UPI ID"
                className="flex-1 min-w-[200px] px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
              />
              {canManagePayment && (
                <>
                  <label className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-cinema-accent hover:bg-cinema-bg cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    Upload QR
                    <input type="file" accept="image/*" onChange={(e) => void handleQrUpload(e)} className="hidden" />
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleGenerateQrFromUpi()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-cinema-primary text-cinema-primary hover:bg-cinema-bg cursor-pointer"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    Generate QR from UPI ID
                  </button>
                </>
              )}
            </div>
            {qrImageUrl && (
              <div className="mt-3 inline-block border border-cinema-accent bg-white p-2">
                <img
                  src={qrImageUrl}
                  alt="Configured UPI QR Preview"
                  referrerPolicy="no-referrer"
                  className="w-36 h-36 object-contain"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block font-semibold mb-1">Customer Payment Instructions</label>
            <textarea
              rows={2}
              disabled={!canManagePayment}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Scan QR via Google Pay or BHIM UPI and submit your 12-digit UTR number."
              className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
            />
          </div>
        </div>

        <div className="border-t border-cinema-accent/30 pt-4 space-y-4">
          <div className="flex items-start gap-2 text-cinema-muted">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-cinema-primary" />
            <p>
              Automatic Gateway Secrets below are stored strictly in admin-only Firestore (`paymentSettings/private`) and are never exposed to the public frontend.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold mb-1">Payment Provider Name</label>
              <input
                type="text"
                disabled={!canManagePayment}
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                placeholder="e.g. Razorpay / Cashfree / Stripe"
                className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Merchant Key ID</label>
              <input
                type="text"
                disabled={!canManagePayment}
                value={gatewayKeyId}
                onChange={(e) => setGatewayKeyId(e.target.value)}
                className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Merchant Key Secret</label>
              <input
                type="password"
                disabled={!canManagePayment}
                value={gatewayKeySecret}
                onChange={(e) => setGatewayKeySecret(e.target.value)}
                className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Webhook Signing Secret</label>
              <input
                type="password"
                disabled={!canManagePayment}
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 font-mono"
              />
            </div>
          </div>
        </div>

        {canManagePayment && (
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 bg-cinema-primary text-cinema-bg font-bold uppercase tracking-[0.14em] hover:bg-cinema-primary-hover cursor-pointer"
          >
            {saving ? 'Saving Configuration...' : 'Save Payment Settings'}
          </button>
        )}
      </form>
    </div>
  );
}

export function WebsiteSettingsPanel({ settings }: { settings: WebsiteSettings }) {
  const { user, hasFeature } = useAuth();
  const canManageWebsite = hasFeature('manageWebsiteSettings');
  const [form, setForm] = useState<WebsiteSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const compressed = await compressImageFile(file, 400, 0.85);
      if (compressed.length > 750000) {
        setErrorMsg('Logo image exceeds 750KB limit after compression.');
        return;
      }
      setForm((f) => ({ ...f, logoUrl: compressed }));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to process logo image.');
    } finally {
      e.target.value = '';
    }
  };

  const handleHeroUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const compressed = await compressImageFile(file, 1400, 0.82);
      if (compressed.length > 750000) {
        setErrorMsg('Hero backdrop exceeds 750KB limit after compression.');
        return;
      }
      setForm((f) => ({ ...f, heroBannerUrl: compressed }));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to process hero backdrop.');
    } finally {
      e.target.value = '';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canManageWebsite) return;
    setSaving(true);
    setSavedMsg(null);
    setErrorMsg(null);

    const cleanLogo = (form.logoUrl || '').trim();
    const cleanHero = (form.heroBannerUrl || '').trim();
    if (cleanLogo.length > 800000 || cleanHero.length > 800000) {
      setErrorMsg('Logo or Hero Backdrop exceeds 800KB Firestore document limit.');
      setSaving(false);
      return;
    }

    const activeTheme = form.theme || settings.theme;

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'websiteSettings', 'main'), {
        cinemaName: form.cinemaName.trim() || 'SPLENDORA CINEMA',
        logoUrl: cleanLogo,
        heroBannerUrl: cleanHero,
        announcementText: (form.announcementText || '').trim().slice(0, 300),
        contactNumber: (form.contactNumber || '').trim(),
        contactEmail: (form.contactEmail || '').trim(),
        cinemaAddress: (form.cinemaAddress || '').trim(),
        instagramUrl: (form.instagramUrl || '').trim(),
        facebookUrl: (form.facebookUrl || '').trim(),
        youtubeUrl: (form.youtubeUrl || '').trim(),
        bookingPolicies: (form.bookingPolicies || '').trim(),
        footerText: (form.footerText || '').trim(),
        ...(activeTheme ? { theme: activeTheme } : {}),
        updatedAt: serverTimestamp(),
      });
      const logId = `LOG_${Date.now().toString(36).toUpperCase()}`;
      batch.set(doc(db, 'auditLogs', logId), {
        logId,
        action: 'UPDATE_WEBSITE_SETTINGS',
        actorEmail: user.email || '',
        actorUid: user.uid,
        targetType: 'websiteSettings',
        targetId: 'main',
        details: `Updated website settings (${form.cinemaName}).`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setSavedMsg('Website settings, announcement ribbon, and hero backdrop synced live.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save website settings.';
      setErrorMsg(msg);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.WRITE, 'websiteSettings/main');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="border-b border-cinema-accent/40 pb-4">
        <h2 className="font-display text-2xl font-semibold text-cinema-primary">Website Settings</h2>
        <p className="text-sm text-cinema-muted">
          Edit cinema branding, hero backdrop, top announcement ribbon, venue contact details, social links, booking policies, and footer.
        </p>
      </div>

      {errorMsg && (
        <div className="bg-[#FEE2E2] border border-[#DC2626] p-3 text-xs font-semibold text-[#991B1B]">
          {errorMsg}
        </div>
      )}

      {savedMsg && (
        <div className="bg-[#DCFCE7] border border-[#16A34A] p-3 text-xs font-semibold text-[#14532D]">
          {savedMsg}
        </div>
      )}

      <form
        onSubmit={(e) => void handleSave(e)}
        className="bg-cinema-surface border border-cinema-accent/60 p-6 space-y-4 text-xs"
      >
        <div>
          <label className="block font-semibold mb-1">
            Homepage Announcement Ribbon (Optional, max 300 chars)
          </label>
          <input
            type="text"
            maxLength={300}
            disabled={!canManageWebsite}
            value={form.announcementText || ''}
            onChange={(e) => setForm({ ...form, announcementText: e.target.value })}
            placeholder="e.g. Royal Premiere Tickets Now Open for 25 & 26 December 2026"
            className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-semibold mb-1">Cinema Name</label>
            <input
              type="text"
              required
              disabled={!canManageWebsite}
              value={form.cinemaName}
              onChange={(e) => setForm({ ...form, cinemaName: e.target.value })}
              className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Cinema Logo URL or Upload</label>
            <div className="flex gap-2">
              <input
                type="text"
                disabled={!canManageWebsite}
                value={form.logoUrl || ''}
                onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                className="flex-1 px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
              />
              {canManageWebsite && (
                <label className="px-3 py-2 border border-cinema-accent cursor-pointer">
                  Upload
                  <input type="file" accept="image/*" onChange={(e) => void handleLogoUpload(e)} className="hidden" />
                </label>
              )}
            </div>
          </div>
        </div>

        <div className="border border-cinema-accent/50 bg-cinema-bg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <label className="font-semibold text-cinema-primary">
              Homepage Hero Backdrop Image (URL or Upload)
            </label>
            {form.heroBannerUrl && canManageWebsite && (
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, heroBannerUrl: '' }))}
                className="text-[11px] text-cinema-primary underline cursor-pointer"
              >
                Reset to Default Theatre
              </button>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 items-start">
            {form.heroBannerUrl && (
              <img
                src={form.heroBannerUrl}
                alt="Hero Backdrop Preview"
                className="w-28 h-16 object-cover border border-cinema-accent shrink-0"
              />
            )}
            <div className="flex-1 flex gap-2 w-full">
              <input
                type="text"
                disabled={!canManageWebsite}
                value={form.heroBannerUrl || ''}
                onChange={(e) => setForm({ ...form, heroBannerUrl: e.target.value })}
                placeholder="Paste widescreen image URL or upload auditorium backdrop"
                className="flex-1 px-3 py-2 bg-cinema-surface border border-cinema-accent/60"
              />
              {canManageWebsite && (
                <label className="px-3 py-2 border border-cinema-accent bg-cinema-surface cursor-pointer whitespace-nowrap">
                  Upload Backdrop
                  <input type="file" accept="image/*" onChange={(e) => void handleHeroUpload(e)} className="hidden" />
                </label>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-semibold mb-1">Contact Phone Number</label>
            <input
              type="text"
              disabled={!canManageWebsite}
              value={form.contactNumber || ''}
              onChange={(e) => setForm({ ...form, contactNumber: e.target.value })}
              className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Contact Email Address</label>
            <input
              type="email"
              disabled={!canManageWebsite}
              value={form.contactEmail || ''}
              onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
              className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
            />
          </div>
        </div>

        <div>
          <label className="block font-semibold mb-1">Cinema Venue Address</label>
          <textarea
            rows={2}
            disabled={!canManageWebsite}
            value={form.cinemaAddress || ''}
            onChange={(e) => setForm({ ...form, cinemaAddress: e.target.value })}
            className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block font-semibold mb-1">Instagram URL</label>
            <input
              type="text"
              disabled={!canManageWebsite}
              value={form.instagramUrl || ''}
              onChange={(e) => setForm({ ...form, instagramUrl: e.target.value })}
              className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Facebook URL</label>
            <input
              type="text"
              disabled={!canManageWebsite}
              value={form.facebookUrl || ''}
              onChange={(e) => setForm({ ...form, facebookUrl: e.target.value })}
              className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">YouTube URL</label>
            <input
              type="text"
              disabled={!canManageWebsite}
              value={form.youtubeUrl || ''}
              onChange={(e) => setForm({ ...form, youtubeUrl: e.target.value })}
              className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
            />
          </div>
        </div>

        <div>
          <label className="block font-semibold mb-1">Booking & Entry Policies</label>
          <textarea
            rows={3}
            disabled={!canManageWebsite}
            value={form.bookingPolicies || ''}
            onChange={(e) => setForm({ ...form, bookingPolicies: e.target.value })}
            className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
          />
        </div>

        <div>
          <label className="block font-semibold mb-1">Footer Text</label>
          <input
            type="text"
            disabled={!canManageWebsite}
            value={form.footerText || ''}
            onChange={(e) => setForm({ ...form, footerText: e.target.value })}
            className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
          />
        </div>

        {canManageWebsite && (
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 bg-cinema-primary text-cinema-bg font-bold uppercase tracking-[0.14em] hover:bg-cinema-primary-hover cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save Website Settings'}
          </button>
        )}
      </form>
    </div>
  );
}

const COLOR_FIELDS: Array<{ key: keyof Omit<CinemaTheme, 'presetId'>; label: string; hint: string }> = [
  { key: 'primary', label: 'Primary Brand Color', hint: 'Main buttons, headings & active tabs' },
  { key: 'primaryHover', label: 'Primary Hover / Active', hint: 'Button hover state & highlight' },
  { key: 'dark', label: 'Sidebar, Navbar & Footer', hint: 'Admin sidebar, public navbar & footer' },
  { key: 'darkDeep', label: 'Hero & Modal Backdrop', hint: 'Deep dark overlay & video canvas' },
  { key: 'accent', label: 'Gold / Metallic Accent', hint: 'Borders, dividers & primary hero CTA' },
  { key: 'accentLight', label: 'Accent Highlight', hint: 'Wordmark & subtle gold labels' },
  { key: 'bg', label: 'Page Background', hint: 'Public canvas & admin main background' },
  { key: 'surface', label: 'Card & Modal Surface', hint: 'Booking cards, tables & forms' },
  { key: 'surfaceAlt', label: 'Elevated Table / Section', hint: 'Table headers & contact section' },
  { key: 'text', label: 'Primary Body Text', hint: 'Readable dark body typography' },
  { key: 'muted', label: 'Muted Secondary Text', hint: 'Labels, captions & helper notes' },
];

export function ThemeCustomizationPanel({ settings }: { settings: WebsiteSettings }) {
  const { user, hasFeature } = useAuth();
  const canManageWebsite = hasFeature('manageWebsiteSettings');
  const canManageTheme = hasFeature('manageTheme') || canManageWebsite;

  const [draft, setDraft] = useState<CinemaTheme>(settings.theme || DEFAULT_THEME);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const saved = settings.theme || DEFAULT_THEME;
    setDraft(saved);
    applyCinemaThemeToDocument(saved);
  }, [settings.theme]);

  const handleSelectPreset = (presetTheme: CinemaTheme) => {
    setDraft(presetTheme);
    applyCinemaThemeToDocument(presetTheme);
    setSavedMsg(null);
    setErrorMsg(null);
  };

  const handleColorChange = (key: keyof Omit<CinemaTheme, 'presetId'>, value: string) => {
    const next: CinemaTheme = {
      ...draft,
      presetId: 'custom',
      [key]: value.toUpperCase(),
    };
    setDraft(next);
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
      applyCinemaThemeToDocument(next);
    }
  };

  const handleReset = () => {
    setDraft(DEFAULT_THEME);
    applyCinemaThemeToDocument(DEFAULT_THEME);
    setSavedMsg(null);
    setErrorMsg(null);
  };

  const handleSaveTheme = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canManageTheme) return;
    setErrorMsg(null);
    setSavedMsg(null);

    for (const f of COLOR_FIELDS) {
      if (!/^#[0-9A-Fa-f]{6}$/.test(draft[f.key])) {
        setErrorMsg(`Invalid hex color for "${f.label}". Use #RRGGBB format (e.g. #5B0E1D).`);
        return;
      }
    }

    setSaving(true);
    try {
      const batch = writeBatch(db);
      if (canManageWebsite) {
        batch.set(doc(db, 'websiteSettings', 'main'), {
          cinemaName: settings.cinemaName || 'SPLENDORA CINEMA',
          logoUrl: settings.logoUrl || '',
          heroBannerUrl: settings.heroBannerUrl || '',
          announcementText: settings.announcementText || '',
          contactNumber: settings.contactNumber || '',
          contactEmail: settings.contactEmail || '',
          cinemaAddress: settings.cinemaAddress || '',
          instagramUrl: settings.instagramUrl || '',
          facebookUrl: settings.facebookUrl || '',
          youtubeUrl: settings.youtubeUrl || '',
          bookingPolicies: settings.bookingPolicies || '',
          footerText: settings.footerText || '',
          theme: draft,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.update(doc(db, 'websiteSettings', 'main'), {
          theme: draft,
          updatedAt: serverTimestamp(),
        });
      }
      const logId = `LOG_${Date.now().toString(36).toUpperCase()}`;
      batch.set(doc(db, 'auditLogs', logId), {
        logId,
        action: 'UPDATE_CINEMA_THEME',
        actorEmail: user.email || '',
        actorUid: user.uid,
        targetType: 'websiteSettings',
        targetId: 'main',
        details: `Updated color theme preset="${draft.presetId}" (primary=${draft.primary}, dark=${draft.dark}, accent=${draft.accent}, bg=${draft.bg}) for both Web App and Admin Panel.`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      applyCinemaThemeToDocument(draft);
      setSavedMsg('Color theme saved and synchronized live across both Public Web App & Admin Panel.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save theme.';
      setErrorMsg(msg);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.WRITE, 'websiteSettings/main');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="border-b border-cinema-accent/40 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-cinema-primary flex items-center gap-2">
            <Palette className="w-6 h-6" />
            Theme & Colors (Web App + Admin Panel)
          </h2>
          <p className="text-sm text-cinema-muted">
            Select a luxury cinema preset or customize individual hex colors anytime. Previewed live and synced to both the public customer site and admin suite.
          </p>
        </div>
        {canManageTheme && (
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-cinema-accent text-xs font-semibold hover:bg-cinema-surface-alt cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Royal Default
          </button>
        )}
      </div>

      {!canManageTheme && (
        <div className="bg-[#FEF3C7] border border-[#D97706] p-4 text-xs text-[#92400E]">
          Your account currently has read-only access to Theme Settings. Enable Theme & Color Customization permission to customize colors.
        </div>
      )}

      {errorMsg && (
        <div className="bg-[#FEE2E2] border border-[#DC2626] p-3 text-xs font-semibold text-[#991B1B]">
          {errorMsg}
        </div>
      )}

      {savedMsg && (
        <div className="bg-[#DCFCE7] border border-[#16A34A] p-3 text-xs font-semibold text-[#14532D]">
          {savedMsg}
        </div>
      )}

      {/* Curated Cinema Presets */}
      <div className="bg-cinema-surface border border-cinema-accent/60 p-6 space-y-4">
        <h3 className="font-display text-lg font-semibold text-cinema-primary">
          Curated Royal Cinema Presets (Instant Preview)
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {THEME_PRESETS.map((preset) => {
            const active = draft.presetId === preset.theme.presetId;
            return (
              <button
                key={preset.theme.presetId}
                type="button"
                disabled={!canManageTheme}
                onClick={() => handleSelectPreset(preset.theme)}
                className={`text-left p-4 border transition-colors cursor-pointer space-y-2.5 ${
                  active
                    ? 'border-cinema-primary ring-2 ring-cinema-accent bg-cinema-bg'
                    : 'border-cinema-accent/45 bg-cinema-bg/60 hover:border-cinema-primary'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-semibold text-cinema-text">
                    {preset.name}
                  </span>
                  {active && <Check className="w-4 h-4 text-cinema-primary shrink-0" />}
                </div>
                <p className="text-[11px] text-cinema-muted leading-relaxed">{preset.tagline}</p>
                <div className="flex items-center gap-1.5 pt-1">
                  {[
                    preset.theme.primary,
                    preset.theme.dark,
                    preset.theme.accent,
                    preset.theme.bg,
                    preset.theme.text,
                  ].map((hex, i) => (
                    <span
                      key={i}
                      className="w-6 h-4 border border-black/20"
                      style={{ backgroundColor: hex }}
                      title={hex}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Hex Color Pickers */}
      <form
        onSubmit={(e) => void handleSaveTheme(e)}
        className="bg-cinema-surface border border-cinema-accent/60 p-6 space-y-5 text-xs"
      >
        <div className="flex items-center justify-between border-b border-cinema-accent/30 pb-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-cinema-primary">
              Custom Palette Controls
            </h3>
            <p className="text-cinema-muted">
              Fine-tune any token visually with the color picker or enter a 6-digit hex code.
            </p>
          </div>
          <span className="font-mono text-[11px] px-2.5 py-1 border border-cinema-accent/50 bg-cinema-bg">
            Active: {draft.presetId}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {COLOR_FIELDS.map((field) => (
            <div
              key={field.key}
              className="border border-cinema-accent/40 bg-cinema-bg p-3 space-y-2"
            >
              <div>
                <p className="font-semibold text-cinema-text">{field.label}</p>
                <p className="text-[11px] text-cinema-muted">{field.hint}</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  disabled={!canManageTheme}
                  value={/^#[0-9A-Fa-f]{6}$/.test(draft[field.key]) ? draft[field.key] : '#5B0E1D'}
                  onChange={(e) => handleColorChange(field.key, e.target.value)}
                  className="w-10 h-9 border border-cinema-accent/60 bg-transparent cursor-pointer shrink-0"
                />
                <input
                  type="text"
                  disabled={!canManageTheme}
                  value={draft[field.key]}
                  onChange={(e) => handleColorChange(field.key, e.target.value)}
                  maxLength={7}
                  className="flex-1 px-2.5 py-2 bg-cinema-surface border border-cinema-accent/60 font-mono uppercase"
                />
              </div>
            </div>
          ))}
        </div>

        {canManageTheme && (
          <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-cinema-accent/30">
            <p className="text-[11px] text-cinema-muted">
              Changes preview immediately on this screen. Click Save to publish to all visitors and admins.
            </p>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 bg-cinema-primary text-cinema-bg font-bold uppercase tracking-[0.14em] hover:bg-cinema-primary-hover cursor-pointer"
            >
              {saving ? 'Publishing Theme...' : 'Save Theme for Web App & Admin Panel'}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
