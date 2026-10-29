import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Percent, X, Check } from 'lucide-react';
import { useCounterStore } from '../../lib/counter-store';

interface DiscountModalProps {
  isOpen: boolean;
  subtotalPaise: number;
  onClose: () => void;
  onApply: (discountPaise: number, reason: string) => void;
}

export const DiscountModal: React.FC<DiscountModalProps> = ({
  isOpen,
  subtotalPaise,
  onClose,
  onApply,
}) => {
  const { settings } = useCounterStore();
  const [discountRs, setDiscountRs] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const subtotalRs = subtotalPaise / 100;
  const maxCapPct = settings.discount_cap_pct || 10;
  const maxDiscountRs = Math.floor((subtotalRs * maxCapPct) / 100);

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(discountRs);
    if (isNaN(amount) || amount <= 0) {
      setError('Please enter a valid discount amount.');
      return;
    }
    if (amount > maxDiscountRs) {
      setError(`Discount cannot exceed ${maxCapPct}% (Max: ₹${maxDiscountRs}).`);
      return;
    }
    if (reason.trim().length < 3) {
      setError('Please provide a reason (minimum 3 characters).');
      return;
    }

    onApply(Math.round(amount * 100), reason.trim());
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 15 }}
          className="glass-card-elevated max-w-sm w-full p-6 rounded-2xl border border-white/10 space-y-4 text-white"
        >
          <div className="flex items-start justify-between pb-3 border-b border-white/10">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-1.5">
                <Percent className="w-4 h-4 text-amber-400" /> Apply Counter Discount
              </h3>
              <p className="text-xs text-stone-400">
                Max allowed: {maxCapPct}% of subtotal (Up to ₹{maxDiscountRs})
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-stone-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleApply} className="space-y-3.5">
            <div>
              <label className="text-[11px] font-semibold text-stone-300">Discount Amount (₹)</label>
              <input
                type="number"
                min="1"
                max={maxDiscountRs}
                step="1"
                required
                value={discountRs}
                onChange={(e) => {
                  setDiscountRs(e.target.value);
                  setError(null);
                }}
                placeholder={`Max ₹${maxDiscountRs}`}
                className="w-full text-sm font-mono p-2.5 rounded-xl bg-black/40 border border-white/15 focus:border-amber-400 focus:outline-none text-white mt-1"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-stone-300">Reason for Discount</label>
              <input
                type="text"
                required
                minLength={3}
                maxLength={60}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. Regular Wholesale Client / Owner Approved"
                className="w-full text-xs p-2.5 rounded-xl bg-black/40 border border-white/15 focus:border-amber-400 focus:outline-none text-white mt-1"
              />
            </div>

            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 p-2 rounded-lg border border-rose-500/20">
                {error}
              </p>
            )}

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-stone-300 font-bold text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs flex items-center justify-center gap-1"
              >
                <Check className="w-3.5 h-3.5" /> Apply Discount
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
