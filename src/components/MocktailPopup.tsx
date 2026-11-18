import { Minus, Plus, Wine, X } from 'lucide-react';
import { useState } from 'react';
import type { MocktailCartItem, MocktailProduct } from '../types/cinema';
import { formatINR } from '../lib/defaults';

interface MocktailPopupProps {
  open: boolean;
  products: MocktailProduct[];
  initialQuantities?: Record<string, number>;
  onAddToBooking: (items: MocktailCartItem[]) => void;
  onSkip: () => void;
}

export function MocktailPopup({
  open,
  products,
  initialQuantities = {},
  onAddToBooking,
  onSkip,
}: MocktailPopupProps) {
  const enabledProducts = products.filter((p) => p.enabled);
  const [quantities, setQuantities] = useState<Record<string, number>>(initialQuantities);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  if (!open) return null;

  const updateQty = (productId: string, delta: number) => {
    setQuantities((prev) => {
      const next = Math.max(0, Math.min(20, (prev[productId] || 0) + delta));
      return { ...prev, [productId]: next };
    });
  };

  const subtotal = enabledProducts.reduce(
    (sum, p) => sum + p.price * (quantities[p.productId] || 0),
    0
  );

  const totalCount = enabledProducts.reduce((sum, p) => sum + (quantities[p.productId] || 0), 0);

  const handleConfirm = () => {
    const items: MocktailCartItem[] = enabledProducts
      .filter((p) => (quantities[p.productId] || 0) > 0)
      .map((p) => ({
        productId: p.productId,
        productName: p.name,
        price: p.price,
        quantity: quantities[p.productId] || 0,
      }));
    if (items.length === 0) {
      onSkip();
    } else {
      onAddToBooking(items);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-cinema-dark-deep/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mocktail-popup-heading"
    >
      <div className="relative w-full max-w-2xl bg-cinema-surface border border-cinema-accent shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="bg-cinema-primary px-6 py-5 border-b border-cinema-accent/50 flex items-start justify-between gap-4 text-cinema-bg">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-cinema-accent-light mb-1">
              In-Seat Lounge Service
            </p>
            <h2
              id="mocktail-popup-heading"
              className="font-display text-xl sm:text-2xl font-semibold tracking-wide text-cinema-surface"
            >
              MAKE YOUR MOVIE EXPERIENCE MORE REFRESHING!
            </h2>
            <p className="text-sm text-cinema-bg/90 mt-1">
              Enjoy refreshing mocktails delivered directly to your seat when the movie starts!
            </p>
          </div>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Close refreshments popup"
            className="p-2 text-cinema-accent-light hover:bg-cinema-primary-hover transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Product List */}
        <div className="p-6 overflow-y-auto space-y-4">
          {enabledProducts.length === 0 ? (
            <p className="text-sm text-cinema-muted text-center py-6">
              No mocktails are currently available for pre-order.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {enabledProducts.map((product) => {
                const qty = quantities[product.productId] || 0;
                return (
                  <div
                    key={product.productId}
                    className={`border transition-colors flex flex-col justify-between bg-cinema-bg ${
                      qty > 0 ? 'border-cinema-primary ring-1 ring-cinema-primary/30' : 'border-cinema-accent/40'
                    }`}
                  >
                    <div>
                      <div className="aspect-[4/3] w-full bg-cinema-dark overflow-hidden relative">
                        {!imgErrors[product.productId] && product.imageUrl ? (
                          <img
                            src={product.imageUrl}
                            alt={product.name}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setImgErrors((prev) => ({ ...prev, [product.productId]: true }))
                            }
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-cinema-primary-hover to-cinema-dark text-cinema-accent-light p-4">
                            <Wine className="w-8 h-8 mb-2 opacity-80" />
                            <span className="font-display text-sm">{product.name}</span>
                          </div>
                        )}
                      </div>
                      <div className="p-4">
                        <div className="flex items-baseline justify-between gap-2">
                          <h3 className="font-display text-lg font-semibold text-cinema-text">
                            {product.name}
                          </h3>
                          <span className="font-mono text-sm font-semibold text-cinema-primary tabular-nums shrink-0">
                            {formatINR(product.price)}
                          </span>
                        </div>
                        <p className="text-xs text-cinema-muted mt-1.5 leading-relaxed">
                          {product.description}
                        </p>
                      </div>
                    </div>

                    <div className="px-4 pb-4 pt-2 flex items-center justify-between border-t border-cinema-accent/25">
                      <span className="text-xs font-medium text-cinema-muted">Quantity</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateQty(product.productId, -1)}
                          aria-label={`Decrease ${product.name}`}
                          className="w-9 h-9 flex items-center justify-center border border-cinema-accent/60 bg-cinema-surface text-cinema-text hover:bg-cinema-surface-alt transition-colors cursor-pointer"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <span className="w-7 text-center font-mono text-sm font-semibold tabular-nums">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQty(product.productId, 1)}
                          aria-label={`Increase ${product.name}`}
                          className="w-9 h-9 flex items-center justify-center border border-cinema-primary bg-cinema-primary text-cinema-bg hover:bg-cinema-primary-hover transition-colors cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="bg-cinema-surface-alt px-6 py-4 border-t border-cinema-accent/40 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-cinema-muted">
              Refreshments Subtotal ({totalCount} {totalCount === 1 ? 'drink' : 'drinks'})
            </p>
            <p className="font-mono text-lg font-bold text-cinema-primary tabular-nums">
              {formatINR(subtotal)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onSkip}
              className="px-5 py-2.5 border border-cinema-muted/50 text-cinema-text text-xs font-semibold uppercase tracking-[0.12em] hover:bg-cinema-accent-light/30 transition-colors cursor-pointer whitespace-nowrap"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="px-6 py-2.5 bg-cinema-primary text-cinema-bg text-xs font-bold uppercase tracking-[0.12em] hover:bg-cinema-primary-hover transition-colors cursor-pointer whitespace-nowrap"
            >
              Add to Booking
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
