import { Lock, LogOut, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function AdminLogin() {
  const {
    user,
    authReady,
    adminChecked,
    adminError,
    authError,
    signInWithGoogle,
    signingIn,
    logout,
  } = useAuth();

  const handleSwitchAccount = async () => {
    await logout();
    await signInWithGoogle();
  };

  return (
    <div className="min-h-screen bg-cinema-dark-deep text-cinema-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-cinema-dark border border-cinema-accent/70 p-8 shadow-2xl space-y-6 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cinema-accent/30 via-cinema-accent-light to-cinema-accent/30" />

        <div className="text-center space-y-2 border-b border-cinema-accent/30 pb-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 border border-cinema-accent/40 bg-cinema-dark-deep/80 text-[10px] uppercase tracking-[0.26em] text-cinema-accent-light mb-1">
            <Lock className="w-3 h-3" />
            Administration Suite
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-wider text-cinema-surface">
            SPLENDORA CINEMA
          </h1>
          <p className="text-xs text-cinema-accent-light/85">
            APNE BEECH · Box Office, Screening &amp; Security Portal
          </p>
        </div>

        {!authReady ? (
          <div className="py-8 text-center space-y-2">
            <div className="w-6 h-6 mx-auto border-2 border-cinema-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-cinema-accent-light/85">
              Initializing secure session...
            </p>
          </div>
        ) : !user ? (
          <div className="space-y-4">
            <div className="bg-cinema-dark-deep/70 border border-cinema-accent/30 p-4 text-xs text-cinema-bg/90 leading-relaxed flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-cinema-accent-light shrink-0 mt-0.5" />
              <span>
                Sign in with the authorized administrator Google account (
                <span className="font-mono text-cinema-accent-light">mypersonaluse2013@gmail.com</span>
                ). Access is verified on the server before granting administrative privileges.
              </span>
            </div>

            {authError && (
              <div className="bg-[#460D17] border border-[#EF4444]/60 p-3 text-xs text-[#FEE2E2] flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-[#FCA5A5] shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              disabled={signingIn}
              className="w-full py-3.5 px-5 bg-cinema-accent text-cinema-dark text-xs font-bold uppercase tracking-[0.16em] hover:bg-cinema-accent-light transition-colors cursor-pointer disabled:opacity-60 inline-flex items-center justify-center gap-3"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              <span>{signingIn ? 'Verifying with Google...' : 'Sign in with Google'}</span>
            </button>
          </div>
        ) : !adminChecked ? (
          <div className="py-8 text-center space-y-2">
            <div className="w-6 h-6 mx-auto border-2 border-cinema-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-cinema-accent-light/85">
              Verifying administrator credentials...
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-[#460D17] border border-[#EF4444]/60 p-4 space-y-2">
              <div className="flex items-center gap-2 text-[#FCA5A5] text-sm font-semibold">
                <ShieldAlert className="w-5 h-5 shrink-0" />
                <span>Access Denied</span>
              </div>
              <p className="text-xs text-[#FEE2E2] leading-relaxed">
                {adminError ||
                  'Your Google account is not authorized to access the Splendora Cinema admin panel.'}
              </p>
              <p className="font-mono text-xs text-cinema-accent-light pt-1 break-all">
                Signed in as: {user.email}
              </p>
            </div>

            {authError && (
              <div className="bg-[#460D17] border border-[#EF4444]/60 p-3 text-xs text-[#FEE2E2]">
                {authError}
              </div>
            )}

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => void handleSwitchAccount()}
                disabled={signingIn}
                className="w-full py-3 px-4 bg-cinema-accent text-cinema-dark text-xs font-bold uppercase tracking-[0.14em] hover:bg-cinema-accent-light transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className="w-4 h-4" />
                {signingIn ? 'Switching Account...' : 'Switch Google Account'}
              </button>

              <button
                type="button"
                onClick={() => void logout()}
                className="w-full py-2.5 px-4 border border-cinema-accent/60 text-cinema-accent-light text-xs font-semibold uppercase tracking-[0.14em] hover:bg-cinema-primary-hover/60 transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-cinema-accent/25 text-center">
          <Link to="/" className="text-xs text-cinema-accent-light/85 hover:text-cinema-accent-light underline">
            Return to Public Cinema Website
          </Link>
        </div>
      </div>
    </div>
  );
}
