import { doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { ArrowDown, ArrowUp, Camera, Edit3, Plus, Trash2, Upload, User, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { compressImageFile } from '../../lib/imageUtils';
import type { CastMemberRecord, MovieRecord } from '../../types/cinema';

interface CastManagementPanelProps {
  movie: MovieRecord;
  castMembers: CastMemberRecord[];
}

export function CastManagementPanel({ movie, castMembers }: CastManagementPanelProps) {
  const { user, hasFeature } = useAuth();
  const canEditCast = hasFeature('manageMovies');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CastMemberRecord | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [order, setOrder] = useState('1');

  const [saving, setSaving] = useState(false);
  const [uploadingCardId, setUploadingCardId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const openAddModal = () => {
    setEditing(null);
    setName('');
    setRole('');
    setPhotoUrl('');
    const nextOrder =
      castMembers.length > 0
        ? Math.max(...castMembers.map((c) => c.order || 0)) + 1
        : 1;
    setOrder(String(nextOrder));
    setErrMsg(null);
    setModalOpen(true);
  };

  const openEditModal = (member: CastMemberRecord) => {
    setEditing(member);
    setName(member.name);
    setRole(member.role || '');
    setPhotoUrl(member.photoUrl || '');
    setOrder(String(member.order ?? 1));
    setErrMsg(null);
    setModalOpen(true);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrMsg(null);
    try {
      const compressed = await compressImageFile(file, 600, 0.82);
      if (compressed.length > 750000) {
        setErrMsg('Cast picture is too large after compression. Please choose a smaller image.');
        return;
      }
      setPhotoUrl(compressed);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Failed to process cast picture.');
    } finally {
      e.target.value = '';
    }
  };

  const handleDirectCardPhotoUpload = async (
    member: CastMemberRecord,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !user || !canEditCast) return;
    setErrMsg(null);
    setMsg(null);
    setUploadingCardId(member.castId);
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
      setUploadingCardId(null);
      e.target.value = '';
    }
  };

  const saveMember = async (keepAddingAnother = false) => {
    if (!user || !canEditCast) return;
    setErrMsg(null);
    setMsg(null);

    const cleanName = name.trim().slice(0, 150);
    const cleanRole = role.trim().slice(0, 150);
    const cleanPhoto = photoUrl.trim();
    const orderNum = Math.max(0, Math.min(10000, Math.floor(Number(order) || 0)));

    if (!cleanName) {
      setErrMsg('Cast member name is required.');
      return;
    }
    if (cleanPhoto.length > 800000) {
      setErrMsg('Cast picture exceeds 800KB limit.');
      return;
    }

    setSaving(true);
    try {
      const castId =
        editing?.castId ||
        `CST_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      const ref = doc(db, 'castMembers', castId);
      const existingSnap = await getDoc(ref);
      const batch = writeBatch(db);

      const createdAtValue =
        existingSnap.exists() && existingSnap.data().createdAt
          ? existingSnap.data().createdAt
          : serverTimestamp();

      batch.set(ref, {
        castId,
        movieId: movie.movieId || 'apne-beech',
        name: cleanName,
        role: cleanRole,
        photoUrl: cleanPhoto,
        order: orderNum,
        createdAt: createdAtValue,
        updatedAt: serverTimestamp(),
      });

      const logId = `LOG_${Date.now().toString(36).toUpperCase()}`;
      batch.set(doc(db, 'auditLogs', logId), {
        logId,
        action: editing ? 'EDIT_CAST_MEMBER' : 'ADD_CAST_MEMBER',
        actorEmail: user.email || '',
        actorUid: user.uid,
        targetType: 'castMember',
        targetId: castId,
        details: `${editing ? 'Updated' : 'Added'} cast & credits member "${cleanName}"${cleanRole ? ` (${cleanRole})` : ''}.`,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      if (keepAddingAnother && !editing) {
        setName('');
        setRole('');
        setPhotoUrl('');
        setOrder(String(orderNum + 1));
        setMsg(`${cleanName} saved to Main Cast & Credits. Ready for next member.`);
      } else {
        setModalOpen(false);
        setMsg(`${cleanName} saved to Main Cast & Credits and published live.`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save cast member.';
      setErrMsg(message);
      if (message.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.WRITE, 'castMembers');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveMember(false);
  };

  const handleDelete = async (member: CastMemberRecord) => {
    if (!user || !canEditCast) return;
    setErrMsg(null);
    setMsg(null);
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'castMembers', member.castId));
      const logId = `LOG_${Date.now().toString(36).toUpperCase()}`;
      batch.set(doc(db, 'auditLogs', logId), {
        logId,
        action: 'REMOVE_CAST_MEMBER',
        actorEmail: user.email || '',
        actorUid: user.uid,
        targetType: 'castMember',
        targetId: member.castId,
        details: `Removed cast member "${member.name}" from ${movie.title}.`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setMsg(`Removed ${member.name} from cast list.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove cast member.';
      setErrMsg(message);
      if (message.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.DELETE, `castMembers/${member.castId}`);
      }
    }
  };

  const handleSwapOrder = async (idx: number, direction: -1 | 1) => {
    if (!user || !canEditCast) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= castMembers.length) return;
    const a = castMembers[idx];
    const b = castMembers[targetIdx];

    setErrMsg(null);
    try {
      const [aSnap, bSnap] = await Promise.all([
        getDoc(doc(db, 'castMembers', a.castId)),
        getDoc(doc(db, 'castMembers', b.castId)),
      ]);
      const batch = writeBatch(db);
      const orderA = b.order ?? targetIdx + 1;
      const orderB = a.order ?? idx + 1;
      const resolvedA = orderA === orderB ? targetIdx + 1 : orderA;
      const resolvedB = orderA === orderB ? idx + 1 : orderB;

      batch.update(doc(db, 'castMembers', a.castId), {
        order: resolvedA,
        createdAt: aSnap.exists() && aSnap.data().createdAt ? aSnap.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'castMembers', b.castId), {
        order: resolvedB,
        createdAt: bSnap.exists() && bSnap.data().createdAt ? bSnap.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reorder cast.';
      setErrMsg(message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cinema-accent/40 pb-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-cinema-primary">
            Main Cast & Credits ({castMembers.length})
          </h2>
          <p className="text-sm text-cinema-muted">
            Add cast & crew members, upload or change portraits directly on each card, and display them live for {movie.title}.
          </p>
        </div>
        {canEditCast && (
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-cinema-primary text-cinema-bg text-xs font-bold uppercase tracking-[0.14em] hover:bg-cinema-primary-hover cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add Cast & Picture
          </button>
        )}
      </div>

      {!canEditCast && (
        <div className="bg-[#FEF3C7] border border-[#D97706] p-4 text-xs text-[#92400E]">
          Your account has read-only access here. Enable the Movie & Cast Management permission in Admin Management to edit cast portraits.
        </div>
      )}

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

      {castMembers.length === 0 ? (
        <div className="bg-cinema-surface border border-cinema-accent/60 p-10 text-center space-y-3">
          <div className="w-12 h-12 mx-auto border border-cinema-accent/50 flex items-center justify-center text-cinema-primary">
            <User className="w-6 h-6" />
          </div>
          <p className="font-display text-xl text-cinema-primary">No Cast Members Added Yet</p>
          <p className="text-xs text-cinema-muted max-w-md mx-auto">
            Click &ldquo;Add Cast & Picture&rdquo; to add actors, directors, or crew credits with their name, role, and portrait picture.
          </p>
          {canEditCast && (
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-cinema-primary text-cinema-bg text-xs font-bold uppercase tracking-[0.14em] hover:bg-cinema-primary-hover cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add First Cast Member & Picture
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {castMembers.map((member, idx) => (
            <div
              key={member.castId}
              className="bg-cinema-surface border border-cinema-accent/60 flex flex-col overflow-hidden"
            >
              <div className="aspect-[3/4] bg-cinema-dark-deep border-b border-cinema-accent/40 relative overflow-hidden group">
                {member.photoUrl ? (
                  <img
                    src={member.photoUrl}
                    alt={member.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover object-top"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-cinema-accent-light/80 p-4 text-center">
                    <User className="w-10 h-10 mb-2" />
                    <span className="text-[11px] uppercase tracking-[0.16em]">No Picture Added</span>
                  </div>
                )}
                <span className="absolute top-2 left-2 px-2 py-0.5 bg-cinema-dark-deep/85 border border-cinema-accent/60 font-mono text-[10px] text-cinema-accent-light">
                  #{member.order ?? idx + 1}
                </span>

                {canEditCast && (
                  <label className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-cinema-dark-deep/90 border border-cinema-accent/80 text-cinema-accent-light text-[11px] font-semibold hover:bg-cinema-primary cursor-pointer">
                    <Camera className="w-3.5 h-3.5" />
                    {uploadingCardId === member.castId
                      ? 'Uploading...'
                      : member.photoUrl
                      ? 'Change Picture'
                      : 'Add Picture'}
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploadingCardId === member.castId}
                      onChange={(e) => void handleDirectCardPhotoUpload(member, e)}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div>
                  <h3 className="font-display text-lg font-semibold text-cinema-primary leading-snug">
                    {member.name}
                  </h3>
                  <p className="text-xs text-cinema-muted mt-0.5">
                    {member.role || 'Main Cast'}
                  </p>
                </div>

                {canEditCast && (
                  <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-cinema-accent/30 text-xs">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => void handleSwapOrder(idx, -1)}
                        title="Move Earlier"
                        className="p-1.5 border border-cinema-accent/50 hover:bg-cinema-surface-alt disabled:opacity-35 cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === castMembers.length - 1}
                        onClick={() => void handleSwapOrder(idx, 1)}
                        title="Move Later"
                        className="p-1.5 border border-cinema-accent/50 hover:bg-cinema-surface-alt disabled:opacity-35 cursor-pointer"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditModal(member)}
                        className="px-2.5 py-1.5 border border-cinema-accent/60 text-cinema-text hover:bg-cinema-surface-alt inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(member)}
                        className="px-2.5 py-1.5 border border-[#DC2626]/40 text-[#991B1B] hover:bg-[#FEE2E2] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-cinema-dark-deep/80 overflow-y-auto">
          <div className="w-full max-w-lg bg-cinema-surface border border-cinema-accent p-6 space-y-4 shadow-2xl my-8">
            <div className="flex items-center justify-between border-b border-cinema-accent/30 pb-3">
              <h3 className="font-display text-xl font-semibold text-cinema-primary">
                {editing ? `Edit Cast & Picture (${editing.name})` : 'Add Cast Member & Picture'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-cinema-muted cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {errMsg && (
              <div className="bg-[#FEE2E2] border border-[#DC2626]/40 p-3 text-xs text-[#991B1B]">
                {errMsg}
              </div>
            )}

            <form onSubmit={(e) => void handleSave(e)} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-semibold mb-1">Actor / Artist Name *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full name"
                    className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Display Order</label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={order}
                    onChange={(e) => setOrder(e.target.value)}
                    className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1">Character / Credit Role (Optional)</label>
                <input
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="e.g. Lead Actor, Director, Producer, Character Name"
                  className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                />
              </div>

              <div className="border border-cinema-accent/50 bg-cinema-bg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-cinema-primary">
                    Cast & Credits Picture (Upload Photo or Paste URL)
                  </label>
                  {photoUrl && (
                    <button
                      type="button"
                      onClick={() => setPhotoUrl('')}
                      className="text-[11px] text-cinema-primary underline cursor-pointer"
                    >
                      Remove Picture
                    </button>
                  )}
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-20 h-24 shrink-0 border border-cinema-accent bg-cinema-dark-deep overflow-hidden flex items-center justify-center">
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        alt="Cast preview"
                        className="w-full h-full object-cover object-top"
                      />
                    ) : (
                      <User className="w-7 h-7 text-cinema-accent-light/70" />
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <label className="flex items-center justify-center gap-2 w-full px-3 py-2.5 border border-dashed border-cinema-primary/60 bg-cinema-surface text-cinema-primary font-semibold hover:bg-cinema-surface-alt cursor-pointer">
                      <Upload className="w-4 h-4" />
                      Upload Picture from Device
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => void handlePhotoUpload(e)}
                        className="hidden"
                      />
                    </label>
                    <input
                      type="text"
                      value={photoUrl}
                      onChange={(e) => setPhotoUrl(e.target.value)}
                      placeholder="Or paste an image URL (https://...)"
                      className="w-full px-3 py-2 bg-cinema-surface border border-cinema-accent/60"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2.5 pt-2 border-t border-cinema-accent/30">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 border border-cinema-accent cursor-pointer"
                >
                  Cancel
                </button>
                {!editing && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveMember(true)}
                    className="px-4 py-2 border border-cinema-primary text-cinema-primary font-bold uppercase tracking-[0.1em] hover:bg-cinema-surface-alt cursor-pointer"
                  >
                    {saving ? 'Saving...' : 'Save & Add Another'}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-cinema-primary text-cinema-bg font-bold uppercase tracking-[0.12em] hover:bg-cinema-primary-hover cursor-pointer"
                >
                  {saving ? 'Saving...' : editing ? 'Save Changes' : 'Save Cast Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
