import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { FULL_ADMIN_PERMISSIONS, type AdminPermissions } from '../types/cinema';

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  isAdmin: boolean;
  isPremiumAdmin: boolean;
  adminRole: string;
  adminPermissions: AdminPermissions;
  adminChecked: boolean;
  adminError: string | null;
  authError: string | null;
  signingIn: boolean;
  hasFeature: (feature: keyof AdminPermissions) => boolean;
  signInWithGoogle: () => Promise<User | null>;
  clearAuthError: () => void;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
  refreshAdminStatus: () => Promise<boolean>;
}

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

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function formatFirebaseAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google sign-in was cancelled before completing.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Sign-in popup was blocked by your browser. Please allow popups for this site and try again.';
  }
  if (code === 'auth/unauthorized-domain') {
    return 'This domain is not authorized for Google Sign-In in Firebase Authentication.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error during Google Sign-In. Please check your connection and try again.';
  }
  return err instanceof Error ? err.message : 'Google authentication failed. Please try again.';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPremiumAdmin, setIsPremiumAdmin] = useState(false);
  const [adminRole, setAdminRole] = useState('NONE');
  const [adminPermissions, setAdminPermissions] = useState<AdminPermissions>(EMPTY_PERMISSIONS);
  const [adminChecked, setAdminChecked] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const verifyAdminWithServer = useCallback(async (currentUser: User | null): Promise<boolean> => {
    if (!currentUser) {
      setIsAdmin(false);
      setIsPremiumAdmin(false);
      setAdminRole('NONE');
      setAdminPermissions(EMPTY_PERMISSIONS);
      setAdminError(null);
      setAdminChecked(true);
      return false;
    }
    try {
      const token = await currentUser.getIdToken(true);
      const resp = await fetch('/api/admin/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          authorized: boolean;
          role: string;
          isPremiumAdmin?: boolean;
          permissions?: Partial<AdminPermissions>;
        };
        const role = data.role || 'ADMIN';
        setIsAdmin(Boolean(data.authorized));
        setIsPremiumAdmin(
          Boolean(data.isPremiumAdmin) ||
            currentUser.email?.toLowerCase() === 'mypersonaluse2013@gmail.com'
        );
        setAdminRole(role);
        setAdminPermissions(
          role === 'SUPER_ADMIN'
            ? FULL_ADMIN_PERMISSIONS
            : { ...FULL_ADMIN_PERMISSIONS, ...(data.permissions || {}) }
        );
        setAdminError(null);
        setAdminChecked(true);
        return Boolean(data.authorized);
      } else {
        const err = (await resp.json().catch(() => ({}))) as { error?: string };
        setIsAdmin(false);
        setIsPremiumAdmin(false);
        setAdminRole('NONE');
        setAdminPermissions(EMPTY_PERMISSIONS);
        setAdminError(err.error || 'Access Denied. Unauthorized Google account.');
        setAdminChecked(true);
        return false;
      }
    } catch {
      setIsAdmin(false);
      setIsPremiumAdmin(false);
      setAdminRole('NONE');
      setAdminPermissions(EMPTY_PERMISSIONS);
      setAdminError('Could not verify administrator status with server.');
      setAdminChecked(true);
      return false;
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        setAdminChecked(false);
        await verifyAdminWithServer(nextUser);
      } else {
        setIsAdmin(false);
        setIsPremiumAdmin(false);
        setAdminRole('NONE');
        setAdminPermissions(EMPTY_PERMISSIONS);
        setAdminError(null);
        setAdminChecked(true);
      }
    });
    return () => unsub();
  }, [verifyAdminWithServer]);

  const signInWithGoogle = useCallback(async (): Promise<User | null> => {
    setSigningIn(true);
    setAuthError(null);
    setAdminError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      setAdminChecked(false);
      await verifyAdminWithServer(result.user);
      return result.user;
    } catch (err) {
      setAuthError(formatFirebaseAuthError(err));
      return null;
    } finally {
      setSigningIn(false);
    }
  }, [verifyAdminWithServer]);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
    setIsAdmin(false);
    setIsPremiumAdmin(false);
    setAdminRole('NONE');
    setAdminPermissions(EMPTY_PERMISSIONS);
    setAdminError(null);
    setAuthError(null);
  }, []);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken();
  }, []);

  const refreshAdminStatus = useCallback(async () => {
    return verifyAdminWithServer(auth.currentUser);
  }, [verifyAdminWithServer]);

  const hasFeature = useCallback(
    (feature: keyof AdminPermissions) => {
      if (!isAdmin) return false;
      if (adminRole === 'SUPER_ADMIN') return true;
      return Boolean(adminPermissions[feature]);
    },
    [isAdmin, adminRole, adminPermissions]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        isAdmin,
        isPremiumAdmin,
        adminRole,
        adminPermissions,
        adminChecked,
        adminError,
        authError,
        signingIn,
        hasFeature,
        signInWithGoogle,
        clearAuthError,
        logout,
        getIdToken,
        refreshAdminStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
