import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

interface NavbarProps {
  cinemaName: string;
  logoUrl?: string;
  onBookClick: () => void;
  onMyTicketsClick: () => void;
}

export function Navbar({ cinemaName, logoUrl, onBookClick, onMyTicketsClick }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-cinema-dark/95 backdrop-blur-md border-b border-cinema-accent/35 text-cinema-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <a
          href="#top"
          className="flex items-center gap-3 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-cinema-accent"
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={cinemaName}
              referrerPolicy="no-referrer"
              className="h-8 w-8 object-contain border border-cinema-accent/40"
            />
          ) : null}
          <span className="font-display text-lg sm:text-xl font-semibold tracking-[0.14em] text-cinema-accent-light uppercase">
            {cinemaName || 'SPLENDORA CINEMA'}
          </span>
        </a>

        {/* Zone 2: 4–5 Clean Single-Line Nav Links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-cinema-bg/90">
          <a
            href="#featured-film"
            className="hover:text-cinema-accent-light transition-colors whitespace-nowrap shrink-0 py-1 border-b border-transparent hover:border-cinema-accent"
          >
            The Film
          </a>
          <a
            href="#trailer"
            className="hover:text-cinema-accent-light transition-colors whitespace-nowrap shrink-0 py-1 border-b border-transparent hover:border-cinema-accent"
          >
            Trailer
          </a>
          <a
            href="#booking"
            className="hover:text-cinema-accent-light transition-colors whitespace-nowrap shrink-0 py-1 border-b border-transparent hover:border-cinema-accent"
          >
            Showtimes
          </a>
          <button
            type="button"
            onClick={onMyTicketsClick}
            className="hover:text-cinema-accent-light transition-colors whitespace-nowrap shrink-0 py-1 border-b border-transparent hover:border-cinema-accent cursor-pointer"
          >
            My Tickets
          </button>
          <a
            href="#contact"
            className="hover:text-cinema-accent-light transition-colors whitespace-nowrap shrink-0 py-1 border-b border-transparent hover:border-cinema-accent"
          >
            Contact
          </a>
        </nav>

        {/* Zone 3: 1 Primary CTA */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onBookClick}
            className="hidden sm:inline-flex items-center justify-center px-5 py-2.5 bg-cinema-accent text-cinema-dark text-xs font-bold tracking-[0.12em] uppercase hover:bg-cinema-accent-light transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Book Tickets
          </button>
          <button
            type="button"
            aria-label="Toggle Menu"
            onClick={() => setMobileOpen((v) => !v)}
            className="md:hidden p-2 text-cinema-accent-light hover:bg-cinema-primary-hover transition-colors cursor-pointer"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-cinema-accent/25 bg-cinema-dark px-4 py-4 space-y-3">
          <a
            href="#featured-film"
            onClick={() => setMobileOpen(false)}
            className="block py-2 text-sm text-cinema-bg/90 hover:text-cinema-accent-light"
          >
            The Film
          </a>
          <a
            href="#trailer"
            onClick={() => setMobileOpen(false)}
            className="block py-2 text-sm text-cinema-bg/90 hover:text-cinema-accent-light"
          >
            Trailer
          </a>
          <a
            href="#booking"
            onClick={() => setMobileOpen(false)}
            className="block py-2 text-sm text-cinema-bg/90 hover:text-cinema-accent-light"
          >
            Showtimes
          </a>
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false);
              onMyTicketsClick();
            }}
            className="block w-full text-left py-2 text-sm text-cinema-bg/90 hover:text-cinema-accent-light cursor-pointer"
          >
            My Tickets
          </button>
          <a
            href="#contact"
            onClick={() => setMobileOpen(false)}
            className="block py-2 text-sm text-cinema-bg/90 hover:text-cinema-accent-light"
          >
            Contact
          </a>
          <div className="pt-2 flex items-center justify-between gap-3 border-t border-cinema-accent/20">
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                onBookClick();
              }}
              className="flex-1 py-2.5 px-4 bg-cinema-accent text-cinema-dark text-xs font-bold tracking-[0.12em] uppercase cursor-pointer"
            >
              Book Tickets
            </button>
            <Link
              to="/admin"
              className="py-2.5 px-4 border border-cinema-accent/40 text-xs text-cinema-accent-light"
            >
              Admin
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
