import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  DEFAULT_MOCKTAILS,
  DEFAULT_MOVIE,
  DEFAULT_PAYMENT_SETTINGS,
  DEFAULT_SCREENINGS,
  DEFAULT_WEBSITE_SETTINGS,
  buildDefaultSeatsForScreening,
} from '../lib/defaults';
import type {
  CastMemberRecord,
  MocktailProduct,
  MovieRecord,
  PaymentSettingsPublic,
  ScreeningRecord,
  SeatRecord,
  WebsiteSettings,
} from '../types/cinema';

export function useCinemaPublicData() {
  const [movie, setMovie] = useState<MovieRecord>(DEFAULT_MOVIE);
  const [castMembers, setCastMembers] = useState<CastMemberRecord[]>([]);
  const [screenings, setScreenings] = useState<ScreeningRecord[]>(DEFAULT_SCREENINGS);
  const [mocktails, setMocktails] = useState<MocktailProduct[]>(DEFAULT_MOCKTAILS);
  const [websiteSettings, setWebsiteSettings] = useState<WebsiteSettings>(DEFAULT_WEBSITE_SETTINGS);
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettingsPublic>(DEFAULT_PAYMENT_SETTINGS);
  const [isSeededInFirestore, setIsSeededInFirestore] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const unsubMovie = onSnapshot(
      doc(db, 'movies', 'apne-beech'),
      (snap) => {
        if (!mounted) return;
        if (snap.exists()) {
          setMovie(snap.data() as MovieRecord);
          setIsSeededInFirestore(true);
        }
        setLoading(false);
      },
      (err) => handleFirestoreError(err, OperationType.GET, 'movies/apne-beech')
    );

    const unsubCast = onSnapshot(
      collection(db, 'castMembers'),
      (snap) => {
        if (!mounted) return;
        const list = snap.docs
          .map((d) => d.data() as CastMemberRecord)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
        setCastMembers(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'castMembers')
    );

    const unsubScreenings = onSnapshot(
      collection(db, 'screenings'),
      (snap) => {
        if (!mounted) return;
        if (!snap.empty) {
          const list = snap.docs
            .map((d) => d.data() as ScreeningRecord)
            .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
          setScreenings(list);
          setIsSeededInFirestore(true);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'screenings')
    );

    const unsubMocktails = onSnapshot(
      collection(db, 'mocktailProducts'),
      (snap) => {
        if (!mounted) return;
        if (!snap.empty) {
          setMocktails(snap.docs.map((d) => d.data() as MocktailProduct));
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'mocktailProducts')
    );

    const unsubWebsite = onSnapshot(
      doc(db, 'websiteSettings', 'main'),
      (snap) => {
        if (!mounted) return;
        if (snap.exists()) {
          setWebsiteSettings(snap.data() as WebsiteSettings);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, 'websiteSettings/main')
    );

    const unsubPayment = onSnapshot(
      doc(db, 'paymentSettings', 'public'),
      (snap) => {
        if (!mounted) return;
        if (snap.exists()) {
          setPaymentSettings(snap.data() as PaymentSettingsPublic);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, 'paymentSettings/public')
    );

    return () => {
      mounted = false;
      unsubMovie();
      unsubCast();
      unsubScreenings();
      unsubMocktails();
      unsubWebsite();
      unsubPayment();
    };
  }, []);

  return {
    movie,
    castMembers,
    screenings,
    mocktails,
    websiteSettings,
    paymentSettings,
    isSeededInFirestore,
    loading,
  };
}

export function useScreeningSeats(screeningId: string | null) {
  const [seats, setSeats] = useState<SeatRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!screeningId) {
      setSeats([]);
      return;
    }
    setLoading(true);
    const q = query(collection(db, 'seats'), where('screeningId', '==', screeningId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setSeats(buildDefaultSeatsForScreening(screeningId));
        } else {
          const list = snap.docs
            .map((d) => d.data() as SeatRecord)
            .sort((a, b) => a.row.localeCompare(b.row) || a.col - b.col);
          setSeats(list);
        }
        setLoading(false);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `seats?screeningId=${screeningId}`)
    );
    return () => unsub();
  }, [screeningId]);

  return { seats, loading };
}
