import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { Plus, Printer, Search, Trash2, Upload, Wine } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { formatINR, formatShowDate } from '../../lib/defaults';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { compressImageFile } from '../../lib/imageUtils';
import type {
  DeliveryStatus,
  MocktailAssignmentRecord,
  MocktailProduct,
  ScreeningRecord,
} from '../../types/cinema';

export function MocktailManagementPanel({ products }: { products: MocktailProduct[] }) {
  const { user } = useAuth();
  const [editing, setEditing] = useState<MocktailProduct | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('50');
  const [imageUrl, setImageUrl] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  const openAdd = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setPrice('50');
    setImageUrl('');
    setEnabled(true);
    setModalOpen(true);
  };

  const openEdit = (p: MocktailProduct) => {
    setEditing(p);
    setName(p.name);
    setDescription(p.description);
    setPrice(String(p.price));
    setImageUrl(p.imageUrl);
    setEnabled(p.enabled);
    setModalOpen(true);
  };

  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const compressed = await compressImageFile(file, 720, 0.82);
    setImageUrl(compressed);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !name.trim()) return;
    setSaving(true);
    try {
      const productId =
        editing?.productId ||
        name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') ||
        `drink-${Date.now()}`;

      const prodRef = doc(db, 'mocktailProducts', productId);
      const existingSnap = await getDoc(prodRef);
      const batch = writeBatch(db);
      batch.set(prodRef, {
        productId,
        name: name.trim(),
        description: description.trim(),
        price: Math.max(0, Number(price || 0)),
        imageUrl: imageUrl.trim(),
        enabled,
        createdAt: existingSnap.exists() ? existingSnap.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const logId = `LOG_${Date.now().toString(36).toUpperCase()}`;
      batch.set(doc(db, 'auditLogs', logId), {
        logId,
        action: editing ? 'UPDATE_MOCKTAIL' : 'ADD_MOCKTAIL',
        actorEmail: user.email || '',
        actorUid: user.uid,
        targetType: 'mocktailProduct',
        targetId: productId,
        details: `${editing ? 'Updated' : 'Added'} mocktail ${name} (₹${price}, enabled=${enabled}).`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'mocktailProducts');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (p: MocktailProduct) => {
    try {
      await setDoc(
        doc(db, 'mocktailProducts', p.productId),
        { ...p, enabled: !p.enabled, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `mocktailProducts/${p.productId}`);
    }
  };

  const handleDelete = async (p: MocktailProduct) => {
    try {
      await deleteDoc(doc(db, 'mocktailProducts', p.productId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `mocktailProducts/${p.productId}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cinema-accent/40 pb-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-cinema-primary">
            Mocktail Management
          </h2>
          <p className="text-sm text-cinema-muted">
            Manage in-seat mocktail offerings, descriptions, pricing, and imagery.
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-cinema-primary text-cinema-bg text-xs font-bold uppercase tracking-[0.12em] hover:bg-cinema-primary-hover cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Add Mocktail
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {products.map((p) => (
          <div key={p.productId} className="bg-cinema-surface border border-cinema-accent/60 flex flex-col">
            <div className="aspect-[4/3] bg-cinema-dark overflow-hidden">
              {p.imageUrl ? (
                <img
                  src={p.imageUrl}
                  alt={p.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-cinema-accent-light">
                  <Wine className="w-8 h-8" />
                </div>
              )}
            </div>
            <div className="p-4 flex-1 space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-display text-lg font-semibold text-cinema-text">{p.name}</h3>
                <span className="font-mono text-sm font-bold text-cinema-primary tabular-nums">
                  {formatINR(p.price)}
                </span>
              </div>
              <p className="text-xs text-cinema-muted">{p.description}</p>
              <p className="text-xs font-mono">
                Status:{' '}
                <strong className={p.enabled ? 'text-[#166534]' : 'text-[#991B1B]'}>
                  {p.enabled ? 'ENABLED' : 'DISABLED'}
                </strong>
              </p>
            </div>
            <div className="p-3 border-t border-cinema-accent/30 flex items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={() => openEdit(p)}
                className="px-3 py-1.5 border border-cinema-accent hover:bg-cinema-bg cursor-pointer"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void handleToggle(p)}
                className="px-3 py-1.5 border border-cinema-accent hover:bg-cinema-bg cursor-pointer"
              >
                {p.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(p)}
                className="p-1.5 text-[#991B1B] hover:bg-[#FEE2E2] cursor-pointer"
                title="Remove product"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-cinema-dark-deep/75">
          <div className="w-full max-w-md bg-cinema-surface border border-cinema-accent p-6 space-y-4">
            <h3 className="font-display text-xl font-semibold text-cinema-primary">
              {editing ? `Edit ${editing.name}` : 'Add New Mocktail'}
            </h3>
            <form onSubmit={(e) => void handleSave(e)} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Product Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Price (₹)</label>
                <input
                  type="number"
                  min={0}
                  required
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Description</label>
                <textarea
                  rows={2}
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Image URL or Upload</label>
                <input
                  type="text"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://... or upload below"
                  className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 mb-2"
                />
                <label className="inline-flex items-center gap-2 px-3 py-1.5 border border-cinema-accent cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  Upload Image
                  <input type="file" accept="image/*" onChange={handleImageFile} className="hidden" />
                </label>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                <span>Available for customer pre-order</span>
              </label>
              <div className="flex justify-end gap-2 pt-3 border-t border-cinema-accent/30">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 border border-cinema-accent cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-cinema-primary text-cinema-bg font-bold uppercase cursor-pointer hover:bg-cinema-primary-hover"
                >
                  {saving ? 'Saving...' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function MocktailOrdersPanel({
  assignments,
  screenings,
}: {
  assignments: MocktailAssignmentRecord[];
  screenings: ScreeningRecord[];
}) {
  const { user } = useAuth();
  const [searchText, setSearchText] = useState('');
  const [dateFilter, setDateFilter] = useState('ALL');
  const [showFilter, setShowFilter] = useState('ALL');
  const [sortBySeat, setSortBySeat] = useState(true);

  const uniqueDates = useMemo(
    () => Array.from(new Set(assignments.map((a) => a.date))).sort(),
    [assignments]
  );

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const list = assignments.filter((a) => {
      if (dateFilter !== 'ALL' && a.date !== dateFilter) return false;
      if (showFilter !== 'ALL' && a.screeningId !== showFilter) return false;
      if (!q) return true;
      return (
        a.bookingId.toLowerCase().includes(q) ||
        a.customerName.toLowerCase().includes(q) ||
        a.seatNumber.toLowerCase().includes(q) ||
        a.productName.toLowerCase().includes(q)
      );
    });
    if (sortBySeat) {
      return [...list].sort(
        (a, b) => a.date.localeCompare(b.date) || a.seatNumber.localeCompare(b.seatNumber)
      );
    }
    return list;
  }, [assignments, searchText, dateFilter, showFilter, sortBySeat]);

  const updateDeliveryStatus = async (a: MocktailAssignmentRecord, status: DeliveryStatus) => {
    if (!user) return;
    try {
      const batch = writeBatch(db);
      batch.set(
        doc(db, 'mocktailAssignments', a.assignmentId),
        { ...a, deliveryStatus: status, updatedAt: serverTimestamp() },
        { merge: true }
      );
      const logId = `LOG_${Date.now().toString(36).toUpperCase()}`;
      batch.set(doc(db, 'auditLogs', logId), {
        logId,
        action: 'UPDATE_MOCKTAIL_DELIVERY',
        actorEmail: user.email || '',
        actorUid: user.uid,
        targetType: 'mocktailAssignment',
        targetId: a.assignmentId,
        details: `Seat ${a.seatNumber} (${a.productName} ×${a.quantity}, Booking ${a.bookingId}) marked ${status}.`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `mocktailAssignments/${a.assignmentId}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cinema-accent/40 pb-4 no-print">
        <div>
          <h2 className="font-display text-2xl font-semibold text-cinema-primary">
            Mocktail Orders — In-Seat Delivery Sheet
          </h2>
          <p className="text-sm text-cinema-muted">
            Deliver ordered mocktails directly to the assigned customer seats when the movie starts.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2.5 border border-cinema-primary text-cinema-primary text-xs font-bold uppercase tracking-[0.12em] hover:bg-cinema-surface-alt cursor-pointer"
        >
          <Printer className="w-4 h-4" />
          Print Delivery Sheet
        </button>
      </div>

      {/* Filters */}
      <div className="bg-cinema-surface border border-cinema-accent/60 p-4 flex flex-wrap items-center gap-3 text-xs no-print">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-cinema-muted absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search booking ID, customer, seat, or mocktail..."
            className="w-full pl-9 pr-3 py-2 bg-cinema-bg border border-cinema-accent/50"
          />
        </div>
        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="px-3 py-2 bg-cinema-bg border border-cinema-accent/50"
        >
          <option value="ALL">All Dates</option>
          {uniqueDates.map((d) => (
            <option key={d} value={d}>
              {formatShowDate(d)}
            </option>
          ))}
        </select>
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
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={sortBySeat}
            onChange={(e) => setSortBySeat(e.target.checked)}
          />
          <span>Sort by Seat</span>
        </label>
      </div>

      <div className="bg-cinema-surface border border-cinema-accent/60 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-cinema-surface-alt border-b border-cinema-accent/40 text-cinema-primary uppercase">
            <tr>
              <th className="py-3 px-4">Booking ID</th>
              <th className="py-3 px-4">Customer</th>
              <th className="py-3 px-4">Show Date & Time</th>
              <th className="py-3 px-4">Seat</th>
              <th className="py-3 px-4">Mocktail</th>
              <th className="py-3 px-4 text-right">Qty</th>
              <th className="py-3 px-4">Payment</th>
              <th className="py-3 px-4">Delivery Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cinema-accent/25">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-cinema-muted">
                  No mocktail seat delivery records match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((a) => (
                <tr key={a.assignmentId} className="hover:bg-cinema-bg/70">
                  <td className="py-3 px-4 font-mono font-semibold">{a.bookingId}</td>
                  <td className="py-3 px-4 font-medium">{a.customerName}</td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {formatShowDate(a.date)} · {a.startTime || 'TBA'}
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-cinema-primary text-sm">
                    {a.seatNumber}
                  </td>
                  <td className="py-3 px-4 font-semibold">{a.productName}</td>
                  <td className="py-3 px-4 text-right font-mono font-bold tabular-nums">
                    {a.quantity}
                  </td>
                  <td className="py-3 px-4 font-mono">{a.paymentStatus}</td>
                  <td className="py-3 px-4">
                    <select
                      value={a.deliveryStatus}
                      onChange={(e) =>
                        void updateDeliveryStatus(a, e.target.value as DeliveryStatus)
                      }
                      className="px-2.5 py-1.5 bg-cinema-bg border border-cinema-accent/60 font-mono text-xs"
                    >
                      <option value="PENDING_PAYMENT">PENDING_PAYMENT</option>
                      <option value="PREPARING">Preparing</option>
                      <option value="READY">Ready for Delivery</option>
                      <option value="DELIVERED">Delivered</option>
                      <option value="CANCELLED">Cancelled</option>
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
