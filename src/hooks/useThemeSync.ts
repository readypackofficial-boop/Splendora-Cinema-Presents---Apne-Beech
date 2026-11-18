import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect } from 'react';
import { DEFAULT_THEME } from '../lib/defaults';
import { db } from '../lib/firebase';
import type { CinemaTheme, WebsiteSettings } from '../types/cinema';

export function applyCinemaThemeToDocument(theme?: Partial<CinemaTheme> | null) {
  if (typeof document === 'undefined') return;
  const resolved: CinemaTheme = {
    ...DEFAULT_THEME,
    ...(theme || {}),
  };
  const root = document.documentElement;
  root.style.setProperty('--cinema-primary', resolved.primary);
  root.style.setProperty('--cinema-primary-hover', resolved.primaryHover);
  root.style.setProperty('--cinema-dark', resolved.dark);
  root.style.setProperty('--cinema-dark-deep', resolved.darkDeep);
  root.style.setProperty('--cinema-accent', resolved.accent);
  root.style.setProperty('--cinema-accent-light', resolved.accentLight);
  root.style.setProperty('--cinema-bg', resolved.bg);
  root.style.setProperty('--cinema-surface', resolved.surface);
  root.style.setProperty('--cinema-surface-alt', resolved.surfaceAlt);
  root.style.setProperty('--cinema-text', resolved.text);
  root.style.setProperty('--cinema-muted', resolved.muted);
}

export function useThemeSync() {
  useEffect(() => {
    applyCinemaThemeToDocument(DEFAULT_THEME);
    const unsub = onSnapshot(
      doc(db, 'websiteSettings', 'main'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as WebsiteSettings;
          applyCinemaThemeToDocument(data.theme || DEFAULT_THEME);
        } else {
          applyCinemaThemeToDocument(DEFAULT_THEME);
        }
      },
      () => {
        applyCinemaThemeToDocument(DEFAULT_THEME);
      }
    );
    return () => unsub();
  }, []);
}
