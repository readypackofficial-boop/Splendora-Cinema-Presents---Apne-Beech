import { doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  CalendarPlus,
  Clock,
  Copy,
  Edit3,
  Eye,
  Image as ImageIcon,
  Layers,
  Plus,
  Tag,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  DEFAULT_POSTER_URL,
  DEFAULT_ROW_PRICES,
  DEFAULT_TICKET_PRICE,
  SEAT_COLS,
  SEAT_ROWS,
  formatINR,
  formatShowDate,
  formatShowTime,
  getScreeningPriceRange,
  getSeatRowPrice,
} from '../../lib/defaults';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { compressImageFile } from '../../lib/imageUtils';
import type { MovieRecord, RowPriceMap, SalesStatus, ScreeningRecord, SeatRow } from '../../types/cinema';

interface ShowManagementPanelProps {
  movie: MovieRecord;
  screenings: ScreeningRecord[];
  onViewSeats: (screeningId: string) => void;
  onViewBookings: (screeningId: string) => void;
}

function makeUniqueScreeningId(dateStr: string, indexOffset = 0): string {
  const datePart = dateStr.replace(/-/g, '');
  const ts = Date.now().toString(36).toUpperCase().slice(-4);
  const rnd = Math.random().toString(36).slice(2, 4).toUpperCase();
  const suffix = indexOffset > 0 ? String(indexOffset).padStart(2, '0') : '';
  return `SCR_${datePart}_${ts}${rnd}${suffix}`;
}

function buildRowPricesFromScreening(show?: ScreeningRecord | null): Record<SeatRow, number> {
  return {
    A: getSeatRowPrice(show, 'A'),
    B: getSeatRowPrice(show, 'B'),
    C: getSeatRowPrice(show, 'C'),
    D: getSeatRowPrice(show, 'D'),
    E: getSeatRowPrice(show, 'E'),
    F: getSeatRowPrice(show, 'F'),
  };
}

function formatRowPricesSummary(rowPrices: Record<SeatRow, number>): string {
  const aToDUniform =
    rowPrices.A === rowPrices.B && rowPrices.B === rowPrices.C && rowPrices.C === rowPrices.D;
  const eToFUniform = rowPrices.E === rowPrices.F;
  if (aToDUniform && eToFUniform && rowPrices.A !== rowPrices.E) {
    return `A–D ₹${rowPrices.A} · E–F ₹${rowPrices.E}`;
  }
  return SEAT_ROWS.map((r) => `${r}:₹${rowPrices[r]}`).join(' ');
}

function validateAndCleanRowPrices(raw: Record<SeatRow, string>): {
  ok: true;
  map: Record<SeatRow, number>;
  baseMin: number;
} | {
  ok: false;
  error: string;
} {
  const map = { ...DEFAULT_ROW_PRICES };
  for (const row of SEAT_ROWS) {
    const val = Number(raw[row]);
    if (Number.isNaN(val) || val < 0) {
      return { ok: false, error: `Row ${row} price must be ₹0 or higher.` };
    }
    map[row] = Math.round(val * 100) / 100;
  }
  const baseMin = Math.min(...SEAT_ROWS.map((r) => map[r]));
  return { ok: true, map, baseMin };
}

function toStringRowPrices(map: Record<SeatRow, number>): Record<SeatRow, string> {
  return {
    A: String(map.A),
    B: String(map.B),
    C: String(map.C),
    D: String(map.D),
    E: String(map.E),
    F: String(map.F),
  };
}

export function ShowManagementPanel({
  movie,
  screenings,
  onViewSeats,
  onViewBookings,
}: ShowManagementPanelProps) {
  const { user, getIdToken, hasFeature } = useAuth();
  const canAddShows = hasFeature('addShows');
  const canEditTimings = hasFeature('manageShowTimings');
  const canEditRowPricing = hasFeature('manageRowPricing') || canEditTimings;
  const canEditShowPosters = hasFeature('manageShowPosters') || hasFeature('manageMovies');
  const canRemoveShows = hasFeature('removeShows');

  const [modalOpen, setModalOpen] = useState(false);
  const [posterOnlyMode, setPosterOnlyMode] = useState(false);
  const [editingShow, setEditingShow] = useState<ScreeningRecord | null>(null);

  // Single Show Form fields
  const [date, setDate] = useState('2026-12-25');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [ticketPrice, setTicketPrice] = useState(String(DEFAULT_TICKET_PRICE));
  const [rowPriceInputs, setRowPriceInputs] = useState<Record<SeatRow, string>>(
    toStringRowPrices(DEFAULT_ROW_PRICES)
  );
  const [seatCapacity, setSeatCapacity] = useState('36');
  const [salesStatus, setSalesStatus] = useState<SalesStatus>('OPEN');
  const [isPublished, setIsPublished] = useState(true);
  const [description, setDescription] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [alsoUpdateMoviePoster, setAlsoUpdateMoviePoster] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Dedicated Row-Wise Price Modal (usable by manageRowPricing-only admins too)
  const [rowPriceTarget, setRowPriceTarget] = useState<ScreeningRecord | null>(null);
  const [modalRowPrices, setModalRowPrices] = useState<Record<SeatRow, string>>(
    toStringRowPrices(DEFAULT_ROW_PRICES)
  );
  const [savingRowPrices, setSavingRowPrices] = useState(false);
  const [rowPriceError, setRowPriceError] = useState<string | null>(null);

  // Bulk Add Shows modal state
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkStartDate, setBulkStartDate] = useState('2026-12-27');
  const [bulkDays, setBulkDays] = useState('3');
  const [bulkSlots, setBulkSlots] = useState<Array<{ startTime: string; endTime: string }>>([
    { startTime: '', endTime: '' },
  ]);
  const [bulkRowPriceInputs, setBulkRowPriceInputs] = useState<Record<SeatRow, string>>(
    toStringRowPrices(DEFAULT_ROW_PRICES)
  );
  const [bulkCapacity, setBulkCapacity] = useState('36');
  const [bulkSalesStatus, setBulkSalesStatus] = useState<SalesStatus>('OPEN');
  const [bulkPublished, setBulkPublished] = useState(true);
  const [bulkDescription, setBulkDescription] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Bulk Price Update state (supports Row-Wise A-F or Uniform Flat Price)
  const [bulkUpdateMode, setBulkUpdateMode] = useState<'ROW_WISE' | 'FLAT'>('ROW_WISE');
  const [bulkUpdateRowPrices, setBulkUpdateRowPrices] = useState<Record<SeatRow, string>>(
    toStringRowPrices(DEFAULT_ROW_PRICES)
  );
  const [bulkUpdatePriceVal, setBulkUpdatePriceVal] = useState(String(DEFAULT_TICKET_PRICE));
  const [bulkPriceScope, setBulkPriceScope] = useState<'OPEN' | 'ACTIVE'>('ACTIVE');
  const [updatingPrices, setUpdatingPrices] = useState(false);

  // Safe Remove modal state
  const [removeTarget, setRemoveTarget] = useState<ScreeningRecord | null>(null);
  const [removeCheck, setRemoveCheck] = useState<{
    requiresCancellation: boolean;
    activeBookingsCount: number;
    verifiedPaidAmount: number;
    totalHistoricalBookings: number;
  } | null>(null);
  const [deleteIfEmpty, setDeleteIfEmpty] = useState(true);
  const [cancelReason, setCancelReason] = useState('');
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const openAddModal = () => {
    setEditingShow(null);
    setPosterOnlyMode(false);
    setDate('2026-12-25');
    setStartTime('');
    setEndTime('');
    setTicketPrice(String(DEFAULT_TICKET_PRICE));
    setRowPriceInputs(toStringRowPrices(DEFAULT_ROW_PRICES));
    setSeatCapacity('36');
    setSalesStatus('OPEN');
    setIsPublished(true);
    setDescription('');
    setPosterUrl('');
    setAlsoUpdateMoviePoster(false);
    setErrorMsg(null);
    setModalOpen(true);
  };

  const openEditModal = (show: ScreeningRecord, onlyPoster = false) => {
    setEditingShow(show);
    setPosterOnlyMode(onlyPoster || !canEditTimings);
    setDate(show.date);
    setStartTime(show.startTime || '');
    setEndTime(show.endTime || '');
    setTicketPrice(String(show.ticketPrice));
    setRowPriceInputs(toStringRowPrices(buildRowPricesFromScreening(show)));
    setSeatCapacity(String(show.seatCapacity));
    setSalesStatus(show.salesStatus);
    setIsPublished(show.isPublished);
    setDescription(show.description || '');
    setPosterUrl(show.posterUrl || '');
    setAlsoUpdateMoviePoster(false);
    setErrorMsg(null);
    setModalOpen(true);
  };

  const openDuplicateModal = (show: ScreeningRecord) => {
    setEditingShow(null);
    setPosterOnlyMode(false);
    setDate(show.date);
    setStartTime(show.startTime || '');
    setEndTime(show.endTime || '');
    setTicketPrice(String(show.ticketPrice));
    setRowPriceInputs(toStringRowPrices(buildRowPricesFromScreening(show)));
    setSeatCapacity(String(show.seatCapacity));
    setSalesStatus('OPEN');
    setIsPublished(show.isPublished);
    setDescription(show.description || '');
    setPosterUrl(show.posterUrl || '');
    setAlsoUpdateMoviePoster(false);
    setErrorMsg(null);
    setModalOpen(true);
  };

  const openRowPriceModal = (show: ScreeningRecord) => {
    setRowPriceTarget(show);
    setModalRowPrices(toStringRowPrices(buildRowPricesFromScreening(show)));
    setRowPriceError(null);
  };

  const openBulkModal = () => {
    setBulkStartDate(screenings[screenings.length - 1]?.date || '2026-12-27');
    setBulkDays('3');
    setBulkSlots([{ startTime: '', endTime: '' }]);
    setBulkRowPriceInputs(toStringRowPrices(DEFAULT_ROW_PRICES));
    setBulkCapacity('36');
    setBulkSalesStatus('OPEN');
    setBulkPublished(true);
    setBulkDescription('');
    setBulkError(null);
    setBulkModalOpen(true);
  };

  const handlePosterFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const compressed = await compressImageFile(file, 900, 0.82);
      if (compressed.length > 750000) {
        setErrorMsg('Poster image is still too large after compression. Please use a smaller image.');
        return;
      }
      setPosterUrl(compressed);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to process poster image.');
    } finally {
      e.target.value = '';
    }
  };

  const saveSingleShow = async (keepModalOpen: boolean) => {
    if (!user) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    let priceNum = Number(ticketPrice);
    let cleanedRowMap: RowPriceMap | undefined;
    const capNum = Math.floor(Number(seatCapacity));

    if (!posterOnlyMode) {
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        setErrorMsg('Valid show date (YYYY-MM-DD) is required.');
        return;
      }
      const rowRes = validateAndCleanRowPrices(rowPriceInputs);
      if (!rowRes.ok) {
        setErrorMsg(rowRes.error);
        return;
      }
      cleanedRowMap = rowRes.map;
      priceNum = rowRes.baseMin;

      if (Number.isNaN(capNum) || capNum < 1 || capNum > 36) {
        setErrorMsg('Seat capacity for this auditorium must be between 1 and 36.');
        return;
      }
      if (editingShow && capNum < (editingShow.bookedCount || 0)) {
        setErrorMsg(
          `Cannot reduce seat capacity below already booked count (${editingShow.bookedCount}).`
        );
        return;
      }
    }

    const cleanPosterUrl = posterUrl.trim();
    if (cleanPosterUrl.length > 800000) {
      setErrorMsg('Poster URL / image exceeds size limit (800KB). Please use a smaller image or URL.');
      return;
    }

    setSaving(true);
    try {
      const screeningId = editingShow?.screeningId || makeUniqueScreeningId(date);

      const existingRef = doc(db, 'screenings', screeningId);
      const existingSnap = await getDoc(existingRef);
      const batch = writeBatch(db);

      if (existingSnap.exists()) {
        const existingData = existingSnap.data();
        if (posterOnlyMode) {
          batch.update(existingRef, {
            posterUrl: cleanPosterUrl,
            createdAt: existingData.createdAt,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.update(existingRef, {
            movieId: movie.movieId,
            movieTitle: movie.title,
            ...(canEditShowPosters ? { posterUrl: cleanPosterUrl } : {}),
            date,
            startTime: startTime.trim(),
            endTime: endTime.trim(),
            ticketPrice: priceNum,
            rowPrices: cleanedRowMap,
            seatCapacity: capNum,
            salesStatus,
            isPublished,
            description: description.trim(),
            createdAt: existingData.createdAt,
            updatedAt: serverTimestamp(),
          });
        }
      } else {
        batch.set(existingRef, {
          screeningId,
          movieId: movie.movieId,
          movieTitle: movie.title,
          ...(canEditShowPosters && cleanPosterUrl ? { posterUrl: cleanPosterUrl } : {}),
          date,
          startTime: startTime.trim(),
          endTime: endTime.trim(),
          ticketPrice: priceNum,
          rowPrices: cleanedRowMap || { ...DEFAULT_ROW_PRICES },
          seatCapacity: capNum,
          bookedCount: 0,
          salesStatus,
          isPublished,
          description: description.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        let count = 0;
        for (const row of SEAT_ROWS) {
          for (const col of SEAT_COLS) {
            if (count >= capNum) break;
            const seatNumber = `${row}${col}`;
            const seatDocId = `${screeningId}_${seatNumber}`;
            batch.set(doc(db, 'seats', seatDocId), {
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
              updatedAt: serverTimestamp(),
            });
            count += 1;
          }
        }
      }

      if (canEditShowPosters && alsoUpdateMoviePoster && cleanPosterUrl) {
        const movieRef = doc(db, 'movies', movie.movieId);
        const movieSnap = await getDoc(movieRef);
        batch.set(movieRef, {
          movieId: movie.movieId,
          title: movie.title || 'APNE BEECH',
          posterUrl: cleanPosterUrl,
          trailerUrl: movie.trailerUrl || '',
          description: movie.description || '',
          language: movie.language || '',
          genre: movie.genre || '',
          duration: movie.duration || '',
          castAndCrew: movie.castAndCrew || '',
          certificate: movie.certificate || '',
          releaseNote: movie.releaseNote || '',
          active: movie.active,
          createdAt:
            movieSnap.exists() && movieSnap.data().createdAt
              ? movieSnap.data().createdAt
              : serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const logId = `LOG_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
      batch.set(doc(db, 'auditLogs', logId), {
        logId,
        action: posterOnlyMode
          ? 'CHANGE_SHOW_POSTER'
          : existingSnap.exists()
          ? 'EDIT_SHOW'
          : 'ADD_SHOW',
        actorEmail: user.email || '',
        actorUid: user.uid,
        targetType: 'screening',
        targetId: screeningId,
        details: posterOnlyMode
          ? `Updated poster for show ${screeningId}${alsoUpdateMoviePoster ? ' and main film poster' : ''}.`
          : `${existingSnap.exists() ? 'Updated' : 'Created'} show ${screeningId} on ${date} (${startTime || 'TBA'} - ${endTime || 'TBA'}) with rows ${cleanedRowMap ? formatRowPricesSummary(cleanedRowMap as Record<SeatRow, number>) : `₹${priceNum}`}.`,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      setSuccessMsg(
        posterOnlyMode
          ? `Poster for show ${screeningId} updated and published live.`
          : `Show ${screeningId} (${formatShowDate(date)} · ${startTime || 'Timing TBA'}) saved and synced live.`
      );
      if (keepModalOpen && !editingShow && !posterOnlyMode) {
        setStartTime('');
        setEndTime('');
        setDescription('');
      } else {
        setModalOpen(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save show.';
      setErrorMsg(msg);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.WRITE, 'screenings');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveShow = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveSingleShow(false);
  };

  const handleSaveRowPricesOnly = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !rowPriceTarget || !canEditRowPricing) return;
    setRowPriceError(null);
    const res = validateAndCleanRowPrices(modalRowPrices);
    if (!res.ok) {
      setRowPriceError(res.error);
      return;
    }

    setSavingRowPrices(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'screenings', rowPriceTarget.screeningId), {
        rowPrices: res.map,
        ticketPrice: res.baseMin,
        updatedAt: serverTimestamp(),
      });
      const logId = `LOG_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
      batch.set(doc(db, 'auditLogs', logId), {
        logId,
        action: 'UPDATE_ROW_PRICES',
        actorEmail: user.email || '',
        actorUid: user.uid,
        targetType: 'screening',
        targetId: rowPriceTarget.screeningId,
        details: `Updated row prices on ${rowPriceTarget.screeningId}: ${formatRowPricesSummary(res.map)}.`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setSuccessMsg(
        `Row prices updated for ${rowPriceTarget.screeningId}: ${formatRowPricesSummary(res.map)}.`
      );
      setRowPriceTarget(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update row prices.';
      setRowPriceError(msg);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.UPDATE, `screenings/${rowPriceTarget.screeningId}`);
      }
    } finally {
      setSavingRowPrices(false);
    }
  };

  const handleBulkCreateShows = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canAddShows) return;
    setBulkError(null);
    setSuccessMsg(null);

    if (!bulkStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(bulkStartDate)) {
      setBulkError('Please enter a valid start date.');
      return;
    }
    const daysNum = Math.floor(Number(bulkDays));
    if (Number.isNaN(daysNum) || daysNum < 1 || daysNum > 30) {
      setBulkError('Number of days must be between 1 and 30 per bulk batch.');
      return;
    }
    const rowRes = validateAndCleanRowPrices(bulkRowPriceInputs);
    if (!rowRes.ok) {
      setBulkError(rowRes.error);
      return;
    }
    const capNum = Math.floor(Number(bulkCapacity));
    if (Number.isNaN(capNum) || capNum < 1 || capNum > 36) {
      setBulkError('Seat capacity must be between 1 and 36.');
      return;
    }
    if (bulkSlots.length === 0) {
      setBulkError('Add at least one show slot.');
      return;
    }

    const itemsToCreate: Array<{ date: string; startTime: string; endTime: string; screeningId: string }> = [];
    const [startY, startM, startD] = bulkStartDate.split('-').map(Number);
    let idxCounter = 1;
    for (let dayOffset = 0; dayOffset < daysNum; dayOffset++) {
      const dt = new Date(Date.UTC(startY, startM - 1, startD + dayOffset));
      const dateStr = dt.toISOString().slice(0, 10);
      for (const slot of bulkSlots) {
        itemsToCreate.push({
          date: dateStr,
          startTime: slot.startTime.trim(),
          endTime: slot.endTime.trim(),
          screeningId: makeUniqueScreeningId(dateStr, idxCounter++),
        });
      }
    }

    setBulkSaving(true);
    try {
      const CHUNK_SIZE = 10;
      for (let i = 0; i < itemsToCreate.length; i += CHUNK_SIZE) {
        const chunk = itemsToCreate.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.set(doc(db, 'screenings', item.screeningId), {
            screeningId: item.screeningId,
            movieId: movie.movieId,
            movieTitle: movie.title,
            date: item.date,
            startTime: item.startTime,
            endTime: item.endTime,
            ticketPrice: rowRes.baseMin,
            rowPrices: rowRes.map,
            seatCapacity: capNum,
            bookedCount: 0,
            salesStatus: bulkSalesStatus,
            isPublished: bulkPublished,
            description: bulkDescription.trim(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          let count = 0;
          for (const row of SEAT_ROWS) {
            for (const col of SEAT_COLS) {
              if (count >= capNum) break;
              const seatNumber = `${row}${col}`;
              const seatDocId = `${item.screeningId}_${seatNumber}`;
              batch.set(doc(db, 'seats', seatDocId), {
                seatDocId,
                screeningId: item.screeningId,
                seatNumber,
                row,
                col,
                status: 'AVAILABLE',
                heldByUid: null,
                holdExpiresAt: null,
                bookingId: null,
                blockedReason: null,
                updatedAt: serverTimestamp(),
              });
              count += 1;
            }
          }
        }
        const logId = `LOG_${Date.now().toString(36).toUpperCase()}_${i}`;
        batch.set(doc(db, 'auditLogs', logId), {
          logId,
          action: 'BULK_ADD_SHOWS',
          actorEmail: user.email || '',
          actorUid: user.uid,
          targetType: 'screenings',
          targetId: chunk.map((c) => c.screeningId).join(',').slice(0, 120),
          details: `Bulk-created ${chunk.length} show(s) starting ${bulkStartDate} (${formatRowPricesSummary(rowRes.map)}).`,
          createdAt: serverTimestamp(),
        });
        await batch.commit();
      }

      setBulkModalOpen(false);
      setSuccessMsg(
        `Created ${itemsToCreate.length} new shows across ${daysNum} day(s) (${formatRowPricesSummary(rowRes.map)}), complete with 6×6 seat maps.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bulk creation failed.';
      setBulkError(msg);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.WRITE, 'screenings');
      }
    } finally {
      setBulkSaving(false);
    }
  };

  const handleBulkPriceUpdate = async (overrideRowMap?: Record<SeatRow, number>) => {
    if (!user || !canEditRowPricing) return;

    let nextRowMap: Record<SeatRow, number>;
    let nextBasePrice: number;

    if (overrideRowMap) {
      nextRowMap = overrideRowMap;
      nextBasePrice = Math.min(...SEAT_ROWS.map((r) => nextRowMap[r]));
    } else if (bulkUpdateMode === 'FLAT') {
      const priceNum = Number(bulkUpdatePriceVal);
      if (Number.isNaN(priceNum) || priceNum < 0) {
        setErrorMsg('Enter a valid non-negative price for bulk price update.');
        return;
      }
      const rounded = Math.round(priceNum * 100) / 100;
      nextRowMap = {
        A: rounded,
        B: rounded,
        C: rounded,
        D: rounded,
        E: rounded,
        F: rounded,
      };
      nextBasePrice = rounded;
    } else {
      const rowRes = validateAndCleanRowPrices(bulkUpdateRowPrices);
      if (!rowRes.ok) {
        setErrorMsg(rowRes.error);
        return;
      }
      nextRowMap = rowRes.map;
      nextBasePrice = rowRes.baseMin;
    }

    const targets = screenings.filter((s) =>
      bulkPriceScope === 'OPEN' ? s.salesStatus === 'OPEN' : s.salesStatus !== 'CANCELLED'
    );
    if (targets.length === 0) {
      setSuccessMsg('No matching shows to update ticket prices.');
      return;
    }

    setUpdatingPrices(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const CHUNK = 200;
      for (let i = 0; i < targets.length; i += CHUNK) {
        const chunk = targets.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        for (const s of chunk) {
          batch.update(doc(db, 'screenings', s.screeningId), {
            rowPrices: nextRowMap,
            ticketPrice: nextBasePrice,
            updatedAt: serverTimestamp(),
          });
        }
        const logId = `LOG_${Date.now().toString(36).toUpperCase()}_${i}`;
        batch.set(doc(db, 'auditLogs', logId), {
          logId,
          action: 'BULK_UPDATE_ROW_PRICES',
          actorEmail: user.email || '',
          actorUid: user.uid,
          targetType: 'screenings',
          targetId: bulkPriceScope,
          details: `Updated row pricing (${formatRowPricesSummary(nextRowMap)}) across ${chunk.length} ${bulkPriceScope} show(s).`,
          createdAt: serverTimestamp(),
        });
        await batch.commit();
      }
      setSuccessMsg(
        `Updated ticket prices (${formatRowPricesSummary(nextRowMap)}) across ${targets.length} show(s).`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update ticket prices.';
      setErrorMsg(msg);
    } finally {
      setUpdatingPrices(false);
    }
  };

  const initiateSafeRemove = async (show: ScreeningRecord) => {
    setRemoveTarget(show);
    setCancelReason('');
    setRemoveError(null);
    setDeleteIfEmpty(true);
    setRemoving(true);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/admin/shows/safe-remove', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          screeningId: show.screeningId,
          confirmCancellation: false,
        }),
      });
      const data = (await resp.json()) as {
        requiresCancellation?: boolean;
        activeBookingsCount?: number;
        verifiedPaidAmount?: number;
        totalHistoricalBookings?: number;
        error?: string;
      };
      if (!resp.ok) {
        throw new Error(data.error || 'Could not inspect show bookings.');
      }
      setRemoveCheck({
        requiresCancellation: Boolean(data.requiresCancellation),
        activeBookingsCount: data.activeBookingsCount || 0,
        verifiedPaidAmount: data.verifiedPaidAmount || 0,
        totalHistoricalBookings: data.totalHistoricalBookings || 0,
      });
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : 'Failed to check show bookings.');
    } finally {
      setRemoving(false);
    }
  };

  const confirmSafeRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/admin/shows/safe-remove', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          screeningId: removeTarget.screeningId,
          confirmCancellation: true,
          deleteIfEmpty: removeCheck?.totalHistoricalBookings === 0 ? deleteIfEmpty : false,
          reason: cancelReason.trim() || 'Show cancelled and removed from public schedule.',
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as { error?: string; deletedEmpty?: boolean };
      if (!resp.ok) {
        throw new Error(data.error || 'Failed to remove show.');
      }
      setSuccessMsg(
        data.deletedEmpty
          ? `Unbooked show ${removeTarget.screeningId} removed from schedule.`
          : `Show ${removeTarget.screeningId} safely cancelled and unpublished while preserving booking history.`
      );
      setRemoveTarget(null);
      setRemoveCheck(null);
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : 'Failed to remove show.');
    } finally {
      setRemoving(false);
    }
  };

  const effectivePreviewPoster = posterUrl.trim() || movie.posterUrl || DEFAULT_POSTER_URL;
  const totalBulkCount = Math.max(0, Math.floor(Number(bulkDays) || 0)) * bulkSlots.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cinema-accent/40 pb-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-cinema-primary">
            Show & Row-Pricing Management ({screenings.length})
          </h2>
          <p className="text-sm text-cinema-muted">
            Schedule shows, update timings & posters, and adjust row-wise ticket pricing anytime (default: Rows A–D ₹20 · Rows E–F ₹30).
          </p>
        </div>
        {canAddShows ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openBulkModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-cinema-primary text-cinema-primary text-xs font-bold uppercase tracking-[0.12em] hover:bg-cinema-surface-alt cursor-pointer whitespace-nowrap"
            >
              <Layers className="w-4 h-4" />
              Bulk Add Shows
            </button>
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-cinema-primary text-cinema-bg text-xs font-bold uppercase tracking-[0.14em] hover:bg-cinema-primary-hover cursor-pointer whitespace-nowrap"
            >
              <CalendarPlus className="w-4 h-4" />
              Add New Show
            </button>
          </div>
        ) : (
          <span className="text-xs font-mono text-cinema-muted border border-cinema-accent/50 px-3 py-2">
            {canEditRowPricing ? 'Row Pricing Mode Active' : 'View Mode'}
          </span>
        )}
      </div>

      {/* Bulk Row-Wise & Flat Ticket Price Control Bar */}
      {canEditRowPricing && (
        <div className="bg-cinema-surface border border-cinema-accent/60 p-4 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-cinema-primary" />
              <span className="font-semibold text-cinema-primary">
                Bulk Ticket & Row-Wise Pricing Control:
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setBulkUpdateMode('ROW_WISE')}
                className={`px-2.5 py-1 border font-semibold cursor-pointer ${
                  bulkUpdateMode === 'ROW_WISE'
                    ? 'bg-cinema-primary text-cinema-bg border-cinema-primary'
                    : 'bg-cinema-bg border-cinema-accent/60'
                }`}
              >
                Row-Wise (A–F)
              </button>
              <button
                type="button"
                onClick={() => setBulkUpdateMode('FLAT')}
                className={`px-2.5 py-1 border font-semibold cursor-pointer ${
                  bulkUpdateMode === 'FLAT'
                    ? 'bg-cinema-primary text-cinema-bg border-cinema-primary'
                    : 'bg-cinema-bg border-cinema-accent/60'
                }`}
              >
                Uniform Flat Price
              </button>
              <button
                type="button"
                disabled={updatingPrices}
                onClick={() => {
                  setBulkUpdateMode('ROW_WISE');
                  setBulkUpdateRowPrices(toStringRowPrices(DEFAULT_ROW_PRICES));
                  void handleBulkPriceUpdate({ ...DEFAULT_ROW_PRICES });
                }}
                className="px-2.5 py-1 border border-cinema-primary text-cinema-primary font-semibold hover:bg-cinema-surface-alt cursor-pointer"
              >
                Apply Default (A–D ₹20 · E–F ₹30)
              </button>
            </div>
          </div>

          {bulkUpdateMode === 'ROW_WISE' ? (
            <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 flex-1">
                {SEAT_ROWS.map((row) => (
                  <div key={row} className="bg-cinema-bg border border-cinema-accent/50 px-2 py-1.5">
                    <label className="block text-[10px] font-bold uppercase text-cinema-muted">
                      Row {row} (₹)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={bulkUpdateRowPrices[row]}
                      onChange={(e) =>
                        setBulkUpdateRowPrices((prev) => ({ ...prev, [row]: e.target.value }))
                      }
                      className="w-full bg-transparent font-mono font-bold text-cinema-primary focus:outline-none"
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={bulkPriceScope}
                  onChange={(e) => setBulkPriceScope(e.target.value as 'OPEN' | 'ACTIVE')}
                  className="px-2.5 py-2 bg-cinema-bg border border-cinema-accent/60"
                >
                  <option value="ACTIVE">All Non-Cancelled Shows</option>
                  <option value="OPEN">OPEN Shows Only</option>
                </select>
                <button
                  type="button"
                  disabled={updatingPrices}
                  onClick={() => void handleBulkPriceUpdate()}
                  className="px-4 py-2 bg-cinema-primary text-cinema-bg font-bold uppercase tracking-[0.1em] hover:bg-cinema-primary-hover cursor-pointer disabled:opacity-50"
                >
                  {updatingPrices ? 'Updating...' : 'Apply Row Prices'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <label className="text-cinema-muted">Uniform Price All Rows (₹):</label>
              <input
                type="number"
                min={0}
                value={bulkUpdatePriceVal}
                onChange={(e) => setBulkUpdatePriceVal(e.target.value)}
                className="w-24 px-2.5 py-1.5 bg-cinema-bg border border-cinema-accent/60 font-mono font-bold"
              />
              <select
                value={bulkPriceScope}
                onChange={(e) => setBulkPriceScope(e.target.value as 'OPEN' | 'ACTIVE')}
                className="px-2.5 py-1.5 bg-cinema-bg border border-cinema-accent/60"
              >
                <option value="ACTIVE">All Non-Cancelled Shows</option>
                <option value="OPEN">OPEN Shows Only</option>
              </select>
              <button
                type="button"
                disabled={updatingPrices}
                onClick={() => void handleBulkPriceUpdate()}
                className="px-4 py-1.5 bg-cinema-primary text-cinema-bg font-bold uppercase tracking-[0.1em] hover:bg-cinema-primary-hover cursor-pointer disabled:opacity-50"
              >
                {updatingPrices ? 'Updating...' : 'Apply Flat Price'}
              </button>
            </div>
          )}
        </div>
      )}

      {successMsg && (
        <div className="bg-[#DCFCE7] border border-[#16A34A] p-3 text-xs font-semibold text-[#14532D]">
          {successMsg}
        </div>
      )}

      {errorMsg && !modalOpen && (
        <div className="bg-[#FEE2E2] border border-[#DC2626] p-3 text-xs font-semibold text-[#991B1B]">
          {errorMsg}
        </div>
      )}

      {/* Show Management Table */}
      <div className="bg-cinema-surface border border-cinema-accent/60 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-cinema-surface-alt border-b border-cinema-accent/40 text-cinema-primary uppercase tracking-[0.08em]">
            <tr>
              <th className="py-3 px-4">Poster</th>
              <th className="py-3 px-4">Show ID</th>
              <th className="py-3 px-4">Movie</th>
              <th className="py-3 px-4">Date</th>
              <th className="py-3 px-4">Start Time</th>
              <th className="py-3 px-4">End Time</th>
              <th className="py-3 px-4 text-right">Row Prices</th>
              <th className="py-3 px-4 text-right">Booked</th>
              <th className="py-3 px-4 text-right">Available</th>
              <th className="py-3 px-4">Sales Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cinema-accent/25">
            {screenings.map((show) => {
              const available = Math.max(0, show.seatCapacity - (show.bookedCount || 0));
              const rowPoster = show.posterUrl || movie.posterUrl || DEFAULT_POSTER_URL;
              const rowPrices = buildRowPricesFromScreening(show);
              const priceRange = getScreeningPriceRange(show);
              return (
                <tr key={show.screeningId} className="hover:bg-cinema-bg/70">
                  <td className="py-2.5 px-4">
                    <div className="w-10 h-14 border border-cinema-accent/60 bg-cinema-dark-deep overflow-hidden">
                      <img
                        src={rowPoster}
                        alt={`${show.screeningId} poster`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono font-semibold text-cinema-text">
                    {show.screeningId}
                  </td>
                  <td className="py-3 px-4 font-medium">{show.movieTitle}</td>
                  <td className="py-3 px-4 whitespace-nowrap">{formatShowDate(show.date)}</td>
                  <td className="py-3 px-4 font-mono">
                    {show.startTime || <span className="text-[#92400E]">Not configured</span>}
                  </td>
                  <td className="py-3 px-4 font-mono">{show.endTime || '—'}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">
                    <span className="font-bold text-cinema-primary">{priceRange.formatted}</span>
                    <span className="block text-[10px] text-cinema-muted whitespace-nowrap">
                      {formatRowPricesSummary(rowPrices)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">
                    {show.bookedCount || 0}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">{available}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`font-mono font-semibold ${
                        show.salesStatus === 'OPEN'
                          ? 'text-[#166534]'
                          : show.salesStatus === 'CANCELLED'
                          ? 'text-[#991B1B]'
                          : 'text-cinema-muted'
                      }`}
                    >
                      {show.salesStatus}
                      {!show.isPublished ? ' (Hidden)' : ''}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      {canEditRowPricing && show.salesStatus !== 'CANCELLED' && (
                        <button
                          type="button"
                          onClick={() => openRowPriceModal(show)}
                          title="Edit Row Prices (A–F)"
                          className="px-2.5 py-1.5 border border-cinema-primary text-cinema-primary hover:bg-cinema-surface-alt inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <Tag className="w-3.5 h-3.5" />
                          Row Prices
                        </button>
                      )}
                      {canEditShowPosters && (
                        <button
                          type="button"
                          onClick={() => openEditModal(show, true)}
                          title="Change Show Poster"
                          className="px-2.5 py-1.5 border border-cinema-accent/60 text-cinema-primary hover:bg-cinema-surface-alt inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                          Poster
                        </button>
                      )}
                      {canEditTimings && (
                        <button
                          type="button"
                          onClick={() => openEditModal(show, false)}
                          title="Edit Show & Timings"
                          className="px-2.5 py-1.5 border border-cinema-accent/60 text-cinema-text hover:bg-cinema-surface-alt inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          {!show.startTime ? (
                            <>
                              <Clock className="w-3.5 h-3.5 text-cinema-primary" />
                              Set Timings
                            </>
                          ) : (
                            <>
                              <Edit3 className="w-3.5 h-3.5" />
                              Edit
                            </>
                          )}
                        </button>
                      )}
                      {canAddShows && (
                        <button
                          type="button"
                          onClick={() => openDuplicateModal(show)}
                          title="Duplicate Show"
                          className="px-2.5 py-1.5 border border-cinema-accent/60 text-cinema-text hover:bg-cinema-surface-alt inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Duplicate
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onViewSeats(show.screeningId)}
                        title="View Seats"
                        className="px-2.5 py-1.5 border border-cinema-accent/60 text-cinema-primary hover:bg-cinema-surface-alt inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Seats
                      </button>
                      <button
                        type="button"
                        onClick={() => onViewBookings(show.screeningId)}
                        title="View Bookings"
                        className="px-2.5 py-1.5 border border-cinema-accent/60 text-cinema-primary hover:bg-cinema-surface-alt inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Users className="w-3.5 h-3.5" />
                        Bookings
                      </button>
                      {canRemoveShows && (
                        <button
                          type="button"
                          onClick={() => void initiateSafeRemove(show)}
                          title="Remove Show Safely"
                          className="px-2.5 py-1.5 border border-[#DC2626]/40 text-[#991B1B] hover:bg-[#FEE2E2] inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Remove
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Dedicated Per-Show Row Pricing Modal */}
      {rowPriceTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-cinema-dark-deep/80 overflow-y-auto">
          <div className="w-full max-w-lg bg-cinema-surface border border-cinema-accent p-6 space-y-4 shadow-2xl my-8">
            <div className="flex items-start justify-between gap-4 border-b border-cinema-accent/30 pb-3">
              <div>
                <h3 className="font-display text-xl font-semibold text-cinema-primary">
                  Row-Wise Ticket Pricing — {rowPriceTarget.screeningId}
                </h3>
                <p className="text-xs text-cinema-muted">
                  {formatShowDate(rowPriceTarget.date)} ·{' '}
                  {formatShowTime(rowPriceTarget.startTime, rowPriceTarget.endTime)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRowPriceTarget(null)}
                className="p-1 text-cinema-muted cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {rowPriceError && (
              <div className="bg-[#FEE2E2] border border-[#DC2626]/40 p-3 text-xs text-[#991B1B]">
                {rowPriceError}
              </div>
            )}

            <form onSubmit={(e) => void handleSaveRowPricesOnly(e)} className="space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-cinema-primary">Configure Each Row (₹)</span>
                <button
                  type="button"
                  onClick={() => setModalRowPrices(toStringRowPrices(DEFAULT_ROW_PRICES))}
                  className="text-[11px] text-cinema-primary underline cursor-pointer"
                >
                  Reset Default (A–D ₹20, E–F ₹30)
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {SEAT_ROWS.map((row) => (
                  <div key={row} className="bg-cinema-bg border border-cinema-accent/50 p-3 space-y-1">
                    <label className="block font-mono font-bold text-cinema-primary">
                      Row {row} {row === 'E' || row === 'F' ? '(Rear / Balcony)' : ''}
                    </label>
                    <input
                      type="number"
                      min={0}
                      required
                      value={modalRowPrices[row]}
                      onChange={(e) =>
                        setModalRowPrices((prev) => ({ ...prev, [row]: e.target.value }))
                      }
                      className="w-full px-2.5 py-1.5 bg-cinema-surface border border-cinema-accent/60 font-mono font-bold"
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-cinema-accent/30">
                <button
                  type="button"
                  onClick={() => setRowPriceTarget(null)}
                  className="px-4 py-2 border border-cinema-accent cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingRowPrices}
                  className="px-5 py-2 bg-cinema-primary text-cinema-bg font-bold uppercase tracking-[0.12em] hover:bg-cinema-primary-hover cursor-pointer"
                >
                  {savingRowPrices ? 'Saving...' : 'Save Row Prices'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Single Show Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-cinema-dark-deep/75 overflow-y-auto">
          <div className="w-full max-w-lg bg-cinema-surface border border-cinema-accent p-6 space-y-4 shadow-2xl my-8">
            <h3 className="font-display text-xl font-semibold text-cinema-primary">
              {posterOnlyMode && editingShow
                ? `Change Show Poster (${editingShow.screeningId})`
                : editingShow
                ? `Edit Show & Timings (${editingShow.screeningId})`
                : 'Add New Show'}
            </h3>

            {errorMsg && (
              <div className="bg-[#FEE2E2] border border-[#DC2626]/40 p-3 text-xs text-[#991B1B]">
                {errorMsg}
              </div>
            )}

            <form onSubmit={(e) => void handleSaveShow(e)} className="space-y-4 text-xs">
              {!posterOnlyMode && (
                <>
                  <div>
                    <label className="block font-semibold mb-1">Movie</label>
                    <input
                      type="text"
                      disabled
                      value={movie.title}
                      className="w-full px-3 py-2 bg-cinema-surface-alt border border-cinema-accent/40 text-cinema-text"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Show Date</label>
                      <input
                        type="date"
                        required
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Start Time</label>
                      <input
                        type="text"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        placeholder="e.g. 06:30 PM"
                        className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">End Time</label>
                      <input
                        type="text"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        placeholder="e.g. 09:00 PM"
                        className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                      />
                    </div>
                  </div>

                  {/* Row-Wise Ticket Pricing A–F */}
                  <div className="border border-cinema-accent/50 bg-cinema-bg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-cinema-primary">
                        Row-Wise Ticket Prices (₹)
                      </span>
                      <button
                        type="button"
                        onClick={() => setRowPriceInputs(toStringRowPrices(DEFAULT_ROW_PRICES))}
                        className="text-[11px] text-cinema-primary underline cursor-pointer"
                      >
                        Default (A–D ₹20, E–F ₹30)
                      </button>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {SEAT_ROWS.map((row) => (
                        <div key={row}>
                          <label className="block font-mono text-[11px] font-semibold mb-0.5">
                            Row {row}
                          </label>
                          <input
                            type="number"
                            min={0}
                            required
                            value={rowPriceInputs[row]}
                            onChange={(e) =>
                              setRowPriceInputs((prev) => ({ ...prev, [row]: e.target.value }))
                            }
                            className="w-full px-2 py-1.5 bg-cinema-surface border border-cinema-accent/60 font-mono font-bold"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Seat Capacity</label>
                      <input
                        type="number"
                        min={1}
                        max={36}
                        required
                        value={seatCapacity}
                        onChange={(e) => setSeatCapacity(e.target.value)}
                        className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Sales Status</label>
                      <select
                        value={salesStatus}
                        onChange={(e) => setSalesStatus(e.target.value as SalesStatus)}
                        className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                      >
                        <option value="OPEN">OPEN</option>
                        <option value="CLOSED">CLOSED</option>
                        <option value="COMPLETED">COMPLETED</option>
                        <option value="CANCELLED">CANCELLED</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">Optional Show Description</label>
                    <textarea
                      rows={2}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Optional premiere note or auditorium details"
                      className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                    />
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPublished}
                      onChange={(e) => setIsPublished(e.target.checked)}
                    />
                    <span>Publish show to customer website (visible when sales are OPEN)</span>
                  </label>
                </>
              )}

              {canEditShowPosters && (
                <div className="border border-cinema-accent/50 bg-cinema-bg p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <label className="font-semibold text-cinema-primary">
                      Show Poster Image (URL or Upload)
                    </label>
                    {posterUrl && (
                      <button
                        type="button"
                        onClick={() => setPosterUrl('')}
                        className="text-[11px] text-cinema-primary underline cursor-pointer"
                      >
                        Reset to Film Default
                      </button>
                    )}
                  </div>
                  <div className="flex gap-3 items-start">
                    <div className="w-16 h-24 shrink-0 border border-cinema-accent bg-cinema-dark-deep overflow-hidden">
                      <img
                        src={effectivePreviewPoster}
                        alt="Show Poster Preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={posterUrl}
                          onChange={(e) => setPosterUrl(e.target.value)}
                          placeholder="Paste image URL or upload poster file"
                          className="flex-1 px-3 py-2 bg-cinema-surface border border-cinema-accent/60"
                        />
                        <label className="inline-flex items-center gap-1.5 px-3 py-2 border border-cinema-accent bg-cinema-surface cursor-pointer whitespace-nowrap">
                          <Upload className="w-3.5 h-3.5" />
                          Upload
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => void handlePosterFileUpload(e)}
                            className="hidden"
                          />
                        </label>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer text-[11px] text-cinema-text">
                        <input
                          type="checkbox"
                          checked={alsoUpdateMoviePoster}
                          onChange={(e) => setAlsoUpdateMoviePoster(e.target.checked)}
                        />
                        <span>Also update the main homepage poster for {movie.title}</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-cinema-accent/30">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 border border-cinema-accent cursor-pointer"
                >
                  Cancel
                </button>
                {!editingShow && !posterOnlyMode && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveSingleShow(true)}
                    className="px-4 py-2 border border-cinema-primary text-cinema-primary font-bold uppercase tracking-[0.1em] hover:bg-cinema-surface-alt cursor-pointer"
                  >
                    Save & Add Another
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-cinema-primary text-cinema-bg font-bold uppercase tracking-[0.12em] hover:bg-cinema-primary-hover cursor-pointer"
                >
                  {saving
                    ? 'Saving...'
                    : posterOnlyMode
                    ? 'Update Poster'
                    : editingShow
                    ? 'Save Changes'
                    : 'Create Show'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Add Unlimited Shows Modal */}
      {bulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-cinema-dark-deep/80 overflow-y-auto">
          <div className="w-full max-w-xl bg-cinema-surface border border-cinema-accent p-6 space-y-4 shadow-2xl my-8">
            <div className="flex items-center justify-between border-b border-cinema-accent/30 pb-3">
              <div>
                <h3 className="font-display text-xl font-semibold text-cinema-primary">
                  Bulk Add Multiple Shows
                </h3>
                <p className="text-xs text-cinema-muted">
                  Schedule as many shows as you need across multiple dates & showtime slots in one action.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBulkModalOpen(false)}
                className="p-1 text-cinema-muted cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {bulkError && (
              <div className="bg-[#FEE2E2] border border-[#DC2626]/40 p-3 text-xs text-[#991B1B]">
                {bulkError}
              </div>
            )}

            <form onSubmit={(e) => void handleBulkCreateShows(e)} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Start Date</label>
                  <input
                    type="date"
                    required
                    value={bulkStartDate}
                    onChange={(e) => setBulkStartDate(e.target.value)}
                    className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Number of Consecutive Days (1–30)</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    required
                    value={bulkDays}
                    onChange={(e) => setBulkDays(e.target.value)}
                    className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 font-mono"
                  />
                </div>
              </div>

              <div className="border border-cinema-accent/40 bg-cinema-bg p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-cinema-primary">
                    Showtime Slots Per Day ({bulkSlots.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setBulkSlots((prev) => [...prev, { startTime: '', endTime: '' }])
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 border border-cinema-primary text-cinema-primary font-semibold hover:bg-cinema-surface-alt cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Time Slot
                  </button>
                </div>

                {bulkSlots.map((slot, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <span className="col-span-2 font-mono text-[11px] text-cinema-muted">
                      Show #{idx + 1}
                    </span>
                    <input
                      type="text"
                      value={slot.startTime}
                      onChange={(e) => {
                        const val = e.target.value;
                        setBulkSlots((prev) =>
                          prev.map((s, i) => (i === idx ? { ...s, startTime: val } : s))
                        );
                      }}
                      placeholder="Start (e.g. 03:00 PM)"
                      className="col-span-4 px-2.5 py-1.5 bg-cinema-surface border border-cinema-accent/60"
                    />
                    <input
                      type="text"
                      value={slot.endTime}
                      onChange={(e) => {
                        const val = e.target.value;
                        setBulkSlots((prev) =>
                          prev.map((s, i) => (i === idx ? { ...s, endTime: val } : s))
                        );
                      }}
                      placeholder="End (e.g. 05:30 PM)"
                      className="col-span-4 px-2.5 py-1.5 bg-cinema-surface border border-cinema-accent/60"
                    />
                    <div className="col-span-2 text-right">
                      {bulkSlots.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setBulkSlots((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="p-1.5 text-[#991B1B] hover:bg-[#FEE2E2] cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border border-cinema-accent/40 bg-cinema-bg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-cinema-primary">Row-Wise Prices (₹)</span>
                  <button
                    type="button"
                    onClick={() => setBulkRowPriceInputs(toStringRowPrices(DEFAULT_ROW_PRICES))}
                    className="text-[11px] text-cinema-primary underline cursor-pointer"
                  >
                    Default (A–D ₹20, E–F ₹30)
                  </button>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {SEAT_ROWS.map((row) => (
                    <div key={row}>
                      <label className="block font-mono text-[11px] font-semibold mb-0.5">
                        Row {row}
                      </label>
                      <input
                        type="number"
                        min={0}
                        required
                        value={bulkRowPriceInputs[row]}
                        onChange={(e) =>
                          setBulkRowPriceInputs((prev) => ({ ...prev, [row]: e.target.value }))
                        }
                        className="w-full px-2 py-1.5 bg-cinema-surface border border-cinema-accent/60 font-mono font-bold"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Seat Capacity</label>
                  <input
                    type="number"
                    min={1}
                    max={36}
                    required
                    value={bulkCapacity}
                    onChange={(e) => setBulkCapacity(e.target.value)}
                    className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Initial Sales Status</label>
                  <select
                    value={bulkSalesStatus}
                    onChange={(e) => setBulkSalesStatus(e.target.value as SalesStatus)}
                    className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                  >
                    <option value="OPEN">OPEN</option>
                    <option value="CLOSED">CLOSED</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1">Optional Note for All Created Shows</label>
                <input
                  type="text"
                  value={bulkDescription}
                  onChange={(e) => setBulkDescription(e.target.value)}
                  placeholder="Optional auditorium or premiere note"
                  className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bulkPublished}
                  onChange={(e) => setBulkPublished(e.target.checked)}
                />
                <span>Publish all generated shows live to public website</span>
              </label>

              <div className="bg-cinema-surface-alt border border-cinema-accent/40 p-3 flex items-center justify-between">
                <span>Shows to be created (with 36 seats each):</span>
                <span className="font-mono font-bold text-cinema-primary text-sm">
                  {totalBulkCount} show{totalBulkCount === 1 ? '' : 's'}
                </span>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-cinema-accent/30">
                <button
                  type="button"
                  onClick={() => setBulkModalOpen(false)}
                  className="px-4 py-2 border border-cinema-accent cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bulkSaving || totalBulkCount === 0}
                  className="px-5 py-2 bg-cinema-primary text-cinema-bg font-bold uppercase tracking-[0.12em] hover:bg-cinema-primary-hover cursor-pointer disabled:opacity-50"
                >
                  {bulkSaving ? 'Creating Shows...' : `Create ${totalBulkCount} Shows`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Controlled Safe Removal Confirmation Modal */}
      {removeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-cinema-dark-deep/80">
          <div className="w-full max-w-md bg-cinema-surface border border-[#DC2626]/60 p-6 space-y-4 shadow-2xl">
            <h3 className="font-display text-xl font-semibold text-[#991B1B]">
              Remove Show {removeTarget.screeningId}
            </h3>
            <p className="text-xs text-cinema-text">
              {formatShowDate(removeTarget.date)} ·{' '}
              {formatShowTime(removeTarget.startTime, removeTarget.endTime)}
            </p>

            {removeError && (
              <div className="bg-[#FEE2E2] border border-[#DC2626]/40 p-3 text-xs text-[#991B1B]">
                {removeError}
              </div>
            )}

            {removeCheck ? (
              <div className="space-y-3 text-xs">
                {removeCheck.requiresCancellation ? (
                  <div className="bg-[#FEF3C7] border border-[#D97706]/50 p-3 text-[#78350F] space-y-1">
                    <p className="font-bold">
                      Existing Active Bookings Detected: {removeCheck.activeBookingsCount}
                    </p>
                    <p>
                      Verified Paid Total: <strong>{formatINR(removeCheck.verifiedPaidAmount)}</strong>.
                      Confirming will preserve all historical booking & payment records, mark active bookings as CANCELLED, and generate refund & customer notification records.
                    </p>
                  </div>
                ) : removeCheck.totalHistoricalBookings === 0 ? (
                  <div className="space-y-2">
                    <p className="text-cinema-text">
                      This show has zero bookings. Choose how to remove it:
                    </p>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={deleteIfEmpty}
                        onChange={() => setDeleteIfEmpty(true)}
                      />
                      <span>Permanently delete unbooked show & seats from schedule</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={!deleteIfEmpty}
                        onChange={() => setDeleteIfEmpty(false)}
                      />
                      <span>Mark as CANCELLED and retain in historical table</span>
                    </label>
                  </div>
                ) : (
                  <p className="text-cinema-text">
                    Historical bookings exist ({removeCheck.totalHistoricalBookings} already cancelled). Show will be marked CANCELLED and unpublished while preserving records.
                  </p>
                )}

                {(!deleteIfEmpty || removeCheck.totalHistoricalBookings > 0) && (
                  <div>
                    <label className="block font-semibold mb-1">Cancellation / Audit Reason</label>
                    <input
                      type="text"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="Reason for show removal or cancellation"
                      className="w-full px-3 py-2 bg-cinema-bg border border-cinema-accent/60"
                    />
                  </div>
                )}
              </div>
            ) : !removeError ? (
              <p className="text-xs text-cinema-muted">Checking existing bookings...</p>
            ) : null}

            <div className="flex justify-end gap-3 pt-2 border-t border-cinema-accent/30 text-xs">
              <button
                type="button"
                onClick={() => {
                  setRemoveTarget(null);
                  setRemoveCheck(null);
                  setRemoveError(null);
                }}
                className="px-4 py-2 border border-cinema-accent cursor-pointer"
              >
                Keep Show
              </button>
              <button
                type="button"
                disabled={removing || !removeCheck}
                onClick={() => void confirmSafeRemove()}
                className="px-4 py-2 bg-[#991B1B] text-white font-bold uppercase tracking-[0.1em] cursor-pointer disabled:opacity-50"
              >
                {removing ? 'Processing...' : 'Confirm Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
