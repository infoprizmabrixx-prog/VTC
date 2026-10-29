import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SlidersHorizontal, X, Plus, ShieldAlert, Sparkles } from 'lucide-react';
import { useCounterStore } from '../../lib/counter-store';

interface CustomBlendModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (customItem: {
    coffee_pct: number;
    weight_kg: number;
    rate_paise: number;
    name: string;
    override_rate_paise?: number;
    override_reason?: string;
  }) => void;
}

export const CustomBlendModal: React.FC<CustomBlendModalProps> = ({ isOpen, onClose, onAdd }) => {
  const { settings, stock } = useCounterStore();
  const [coffeePct, setCoffeePct] = useState<number>(80);
  const [grams, setGrams] = useState<number>(500);
  const [overrideRateRs, setOverrideRateRs] = useState<string>('');
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [showOverride, setShowOverride] = useState<boolean>(false);

  if (!isOpen) return null;

  const baseCoffeeRate = settings.custom_coffee_rate_paise / 100; // e.g. 520
  const baseChicoryRate = settings.custom_chicory_rate_paise / 100; // e.g. 160

  // Calculate standard blended rate per kg
  const standardRatePerKg = Math.round(
    (coffeePct / 100) * baseCoffeeRate + ((100 - coffeePct) / 100) * baseChicoryRate
  );

  const effectiveRatePerKg = overrideRateRs && parseFloat(overrideRateRs) > 0
    ? parseFloat(overrideRateRs)
    : standardRatePerKg;

  const currentTotal = Math.round((grams / 1000) * effectiveRatePerKg);

  const handleAdd = () => {
    if (grams <= 0) return;
    const name = coffeePct < 100
      ? `Custom ${coffeePct}/${100 - coffeePct} Ground Coffee`
      : 'Custom 100% Pure Coffee Powder';

    const customPayload: any = {
      coffee_pct: coffeePct,
      weight_kg: grams / 1000,
      rate_paise: Math.round(effectiveRatePerKg * 100),
      name: name + (overrideRateRs ? ' (Price Override)' : ''),
    };

    if (overrideRateRs && parseFloat(overrideRateRs) > 0) {
      customPayload.override_rate_paise = Math.round(parseFloat(overrideRateRs) * 100);
      customPayload.override_reason = overrideReason || 'Counter manager override';
    }

    onAdd(customPayload);
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 15 }}
          className="glass-card-elevated max-w-lg w-full p-6 rounded-2xl border border-white/10 space-y-5 text-white"
        >
          {/* Header */}
          <div className="flex items-start justify-between pb-3 border-b border-white/10">
            <div>
              <span className="text-[10px] font-mono uppercase text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                Fresh Roastery Custom Blend
              </span>
              <h3 className="text-base font-bold text-white mt-1">Custom Coffee : Chicory Ratio</h3>
              <p className="text-xs text-stone-400">
                Live ground blend · Pure Coffee: ₹{baseCoffeeRate}/kg · Chicory: ₹{baseChicoryRate}/kg
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-stone-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick Ratio Presets */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-stone-300">Popular Roastery Ratios</label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { p: 100, label: '100% Pure' },
                { p: 90, label: '90 : 10' },
                { p: 85, label: '85 : 15' },
                { p: 80, label: '80 : 20' },
                { p: 75, label: '75 : 25' },
                { p: 70, label: '70 : 30' },
                { p: 60, label: '60 : 40' },
                { p: 50, label: '50 : 50' },
              ].map(({ p, label }) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setCoffeePct(p)}
                  className={`py-2 px-1 rounded-xl text-xs font-bold transition-all border ${
                    coffeePct === p
                      ? 'bg-amber-500 text-stone-950 border-amber-400 shadow-md shadow-amber-500/20'
                      : 'bg-white/5 hover:bg-white/10 text-stone-300 border-white/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Interactive Ratio Slider & Blend Visualization */}
          <div className="bg-stone-950/80 p-4 rounded-xl border border-white/10 space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-amber-300">{coffeePct}% Roasted Coffee</span>
              <span className="font-bold text-stone-400">{100 - coffeePct}% French Chicory</span>
            </div>

            {/* Visual ratio bar */}
            <div className="w-full h-3 rounded-full overflow-hidden flex bg-stone-800">
              <div
                className="bg-gradient-to-r from-amber-500 to-amber-600 transition-all duration-300"
                style={{ width: `${coffeePct}%` }}
              />
              <div
                className="bg-stone-600 transition-all duration-300"
                style={{ width: `${100 - coffeePct}%` }}
              />
            </div>

            <input
              type="range"
              min="50"
              max="100"
              step="1"
              value={coffeePct}
              onChange={(e) => setCoffeePct(parseInt(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />

            <div className="flex justify-between items-center text-[11px] text-stone-400 pt-1 border-t border-white/5">
              <span>Standard Blend Rate:</span>
              <span className="text-amber-300 font-bold font-tabular text-sm">
                ₹{standardRatePerKg}/kg
              </span>
            </div>
          </div>

          {/* Weight Selection */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-stone-300">Weigh Quantity (Grams)</label>
              <div className="grid grid-cols-3 gap-1.5 mb-1.5">
                {[250, 500, 1000].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGrams(g)}
                    className={`py-1 text-[11px] font-bold rounded-lg border ${
                      grams === g
                        ? 'bg-white/20 border-white/40 text-white'
                        : 'bg-white/5 text-stone-400 border-white/10'
                    }`}
                  >
                    {g >= 1000 ? `${g / 1000}kg` : `${g}g`}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="1"
                value={grams || ''}
                onChange={(e) => setGrams(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full text-sm font-mono p-2.5 rounded-xl bg-black/40 border border-white/15 focus:border-amber-400 focus:outline-none text-white text-center"
              />
            </div>

            <div className="bg-stone-950/80 p-3 rounded-xl border border-white/10 flex flex-col justify-center text-right">
              <span className="text-[10px] font-mono uppercase text-stone-400">Total to Collect</span>
              <div className="text-2xl font-extrabold text-emerald-400 font-tabular">
                ₹{currentTotal.toLocaleString('en-IN')}
              </div>
              <span className="text-[10px] text-stone-500">
                {grams}g @ ₹{effectiveRatePerKg}/kg
              </span>
            </div>
          </div>

          {/* Optional Manager Price Override */}
          <div>
            <button
              type="button"
              onClick={() => setShowOverride(!showOverride)}
              className="text-xs text-amber-400/80 hover:text-amber-300 flex items-center gap-1 font-semibold"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {showOverride ? 'Hide Manager Price Override' : 'Manager Custom Rate Override?'}
            </button>

            {showOverride && (
              <div className="mt-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-stone-300">Custom Rate (₹/kg)</label>
                    <input
                      type="number"
                      step="1"
                      value={overrideRateRs}
                      onChange={(e) => setOverrideRateRs(e.target.value)}
                      placeholder={`e.g. ${standardRatePerKg - 20}`}
                      className="w-full text-xs font-mono p-2 rounded-lg bg-black/40 border border-white/15 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-stone-300">Reason</label>
                    <input
                      type="text"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder="e.g. Regular hotel client"
                      className="w-full text-xs p-2 rounded-lg bg-black/40 border border-white/15 text-white"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Stock Info & Action Buttons */}
          <div className="text-[11px] text-stone-400 flex justify-between">
            <span>Counter Ground Coffee: {stock.coffee_ground} kg</span>
            <span>Chicory: {stock.custom_chicory} kg</span>
          </div>

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
              <Plus className="w-4 h-4" /> Add Blend to Bill (₹{currentTotal.toLocaleString('en-IN')})
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
