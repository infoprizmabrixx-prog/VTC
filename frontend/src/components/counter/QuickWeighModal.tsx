import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Scale, X, Plus, Sparkles, Check } from 'lucide-react';
import { CounterItem } from '../../lib/counter-store';

interface QuickWeighModalProps {
  item: CounterItem | null;
  onClose: () => void;
  onAdd: (weightKg: number) => void;
}

export const QuickWeighModal: React.FC<QuickWeighModalProps> = ({ item, onClose, onAdd }) => {
  const [grams, setGrams] = useState<number>(500);
  const [rupees, setRupees] = useState<string>('');

  useEffect(() => {
    if (item) {
      setGrams(500);
      setRupees('');
    }
  }, [item]);

  if (!item) return null;

  const ratePerKg = item.price_per_kg_paise / 100;
  const currentTotal = Math.round((grams / 1000) * ratePerKg);

  const handlePreset = (g: number) => {
    setGrams(g);
    setRupees('');
  };

  const handleRupeesChange = (val: string) => {
    setRupees(val);
    const numRs = parseFloat(val);
    if (!isNaN(numRs) && numRs > 0 && ratePerKg > 0) {
      const targetGrams = Math.round((numRs / ratePerKg) * 1000);
      setGrams(targetGrams);
    }
  };

  const handleAdd = () => {
    if (grams <= 0) return;
    onAdd(grams / 1000);
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 15 }}
          className="glass-card-elevated max-w-md w-full p-6 rounded-2xl border border-white/10 space-y-5 text-white"
        >
          {/* Header */}
          <div className="flex items-start justify-between pb-3 border-b border-white/10">
            <div>
              <span className="text-[10px] font-mono uppercase text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                {item.kind === 'coffee_ground' ? 'Fresh Ground' : item.kind === 'coffee_beans' ? 'Whole Roasted Beans' : 'Stock Product'}
              </span>
              <h3 className="text-base font-bold text-white mt-1">{item.name}</h3>
              <p className="text-xs text-stone-400">
                ₹{ratePerKg.toLocaleString('en-IN')}/kg
                {item.coffee_pct ? ` · ${item.coffee_pct}% Coffee + ${100 - item.coffee_pct}% Chicory` : ''}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-stone-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Digital Scale Readout Display */}
          <div className="bg-stone-950/80 p-4 rounded-xl border border-white/10 flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 flex items-center gap-1">
                <Scale className="w-3.5 h-3.5 text-amber-400" /> Digital Weighing Scale
              </span>
              <div className="text-3xl font-extrabold text-amber-300 font-mono tracking-tight">
                {grams >= 1000 ? `${(grams / 1000).toFixed(3)} kg` : `${grams} g`}
              </div>
            </div>
            <div className="text-right space-y-0.5">
              <span className="text-[10px] font-mono uppercase text-stone-400">Computed Bill</span>
              <div className="text-2xl font-extrabold text-emerald-400 font-tabular">
                ₹{currentTotal.toLocaleString('en-IN')}
              </div>
            </div>
          </div>

          {/* Quick Presets Buttons */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-stone-300">Quick Weight Presets</label>
            <div className="grid grid-cols-4 gap-2">
              {[100, 250, 500, 1000, 2000, 5000].map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => handlePreset(g)}
                  className={`py-2 px-1 rounded-xl text-xs font-bold transition-all border ${
                    grams === g
                      ? 'bg-amber-500 text-stone-950 border-amber-400 shadow-md shadow-amber-500/20'
                      : 'bg-white/5 hover:bg-white/10 text-stone-300 border-white/10'
                  }`}
                >
                  {g >= 1000 ? `${g / 1000} kg` : `${g} g`}
                </button>
              ))}
            </div>
          </div>

          {/* Exact Scale Entry & Rupee Target Converter */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-stone-300">Scale Weight (Grams)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={grams || ''}
                onChange={(e) => {
                  setGrams(Math.max(0, parseInt(e.target.value) || 0));
                  setRupees('');
                }}
                className="w-full text-sm font-mono p-2.5 rounded-xl bg-black/40 border border-white/15 focus:border-amber-400 focus:outline-none text-white text-center"
                placeholder="500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-stone-300">Or Customer asks for (₹)</label>
              <input
                type="number"
                min="1"
                value={rupees}
                onChange={(e) => handleRupeesChange(e.target.value)}
                className="w-full text-sm font-mono p-2.5 rounded-xl bg-black/40 border border-white/15 focus:border-amber-400 focus:outline-none text-amber-300 text-center"
                placeholder="Target ₹"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2.5 pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-stone-300 font-bold text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={grams <= 0}
              className="flex-2 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-stone-950 font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> Add to Bill (₹{currentTotal.toLocaleString('en-IN')})
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
