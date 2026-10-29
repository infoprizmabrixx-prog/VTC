import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Banknote,
  QrCode,
  CreditCard,
  Split,
  Printer,
  X,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { usePrinterStore } from '../../lib/printer/printer-store';

interface PaymentModalProps {
  isOpen: boolean;
  totalPaise: number;
  customerName?: string;
  customerPhone?: string;
  onClose: () => void;
  onComplete: (paymentData: {
    method: 'CASH' | 'UPI' | 'CARD' | 'SPLIT';
    payments: Array<{ method: string; amount_paise: number; reference?: string }>;
    tenderedPaise?: number;
    changePaise?: number;
    copies: 1 | 2;
  }) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  totalPaise,
  customerName,
  customerPhone,
  onClose,
  onComplete,
}) => {
  const { paperWidth, upiVpa, autoDrawerKick } = usePrinterStore();
  const [method, setMethod] = useState<'CASH' | 'UPI' | 'CARD' | 'SPLIT'>('CASH');
  const [tenderedRs, setTenderedRs] = useState<string>('');
  const [reference, setReference] = useState<string>('');
  const [cashPartRs, setCashPartRs] = useState<string>('');
  const [upiPartRs, setUpiPartRs] = useState<string>('');
  const [copies, setCopies] = useState<1 | 2>(1);

  if (!isOpen) return null;

  const totalRs = totalPaise / 100;
  const numTendered = parseFloat(tenderedRs) || 0;
  const changeRs = numTendered > totalRs ? numTendered - totalRs : 0;
  const shortRs = numTendered > 0 && numTendered < totalRs ? totalRs - numTendered : 0;

  // Split auto-calculation
  const handleCashPartChange = (val: string) => {
    setCashPartRs(val);
    const c = parseFloat(val) || 0;
    const remaining = Math.max(0, totalRs - c);
    setUpiPartRs(remaining > 0 ? remaining.toFixed(2) : '0');
  };

  const handleQuickTender = (rs: number) => {
    setTenderedRs(rs.toString());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let payments: Array<{ method: string; amount_paise: number; reference?: string }> = [];

    if (method === 'SPLIT') {
      const cash = Math.round((parseFloat(cashPartRs) || 0) * 100);
      const upi = Math.round((parseFloat(upiPartRs) || 0) * 100);
      if (cash + upi !== totalPaise) {
        alert('Split amounts must equal the grand total.');
        return;
      }
      if (cash > 0) payments.push({ method: 'CASH', amount_paise: cash });
      if (upi > 0) payments.push({ method: 'UPI', amount_paise: upi, reference });
    } else {
      payments.push({
        method,
        amount_paise: totalPaise,
        reference: reference.trim(),
      });
    }

    onComplete({
      method,
      payments,
      tenderedPaise: numTendered ? Math.round(numTendered * 100) : undefined,
      changePaise: changeRs ? Math.round(changeRs * 100) : 0,
      copies,
    });
  };

  // Dynamic UPI URL for customer phone scanning
  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=Vasavi%20Trading%20Company&am=${totalRs.toFixed(2)}&cu=INR&tn=Counter%20Bill`;
  // Online QR generator proxy URL for on-screen SVG/PNG
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiUrl)}`;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 15 }}
          className="glass-card-elevated max-w-lg w-full p-6 rounded-2xl border border-white/10 space-y-5 text-white"
        >
          {/* Header */}
          <div className="flex items-start justify-between pb-3 border-b border-white/10">
            <div>
              <span className="text-[10px] font-mono uppercase text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                Collect Counter Payment
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <h3 className="text-2xl font-extrabold text-white">
                  ₹{totalRs.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </h3>
                <span className="text-xs text-stone-400">Total Due</span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-stone-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Payment Method Selector Tabs */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { id: 'CASH', label: 'Cash', icon: Banknote },
              { id: 'UPI', label: 'UPI QR', icon: QrCode },
              { id: 'CARD', label: 'Card POS', icon: CreditCard },
              { id: 'SPLIT', label: 'Cash + UPI', icon: Split },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = method === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMethod(tab.id as any)}
                  className={`py-2.5 px-2 rounded-xl text-xs font-bold transition-all border flex flex-col items-center gap-1.5 ${
                    active
                      ? 'bg-amber-500 text-stone-950 border-amber-400 shadow-lg shadow-amber-500/20'
                      : 'bg-white/5 hover:bg-white/10 text-stone-300 border-white/10'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* CASH Payment Screen */}
            {method === 'CASH' && (
              <div className="space-y-3.5 bg-stone-950/70 p-4 rounded-xl border border-white/10">
                <div>
                  <label className="text-[11px] font-semibold text-stone-300">Cash Received from Customer (₹)</label>
                  <input
                    type="number"
                    step="any"
                    min={totalRs}
                    required
                    value={tenderedRs}
                    onChange={(e) => setTenderedRs(e.target.value)}
                    placeholder={`Min ₹${totalRs}`}
                    className="w-full text-lg font-mono p-2.5 rounded-xl bg-black/60 border border-white/20 focus:border-amber-400 focus:outline-none text-white text-center mt-1"
                  />
                </div>

                {/* Quick Tender Currency Notes */}
                <div className="space-y-1">
                  <span className="text-[10px] text-stone-400">Quick Tender:</span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleQuickTender(totalRs)}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold"
                    >
                      Exact (₹{totalRs})
                    </button>
                    {[100, 200, 500, 1000, 2000].map((note) => (
                      <button
                        key={note}
                        type="button"
                        onClick={() => handleQuickTender(note)}
                        className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/15 text-stone-200 border border-white/10 text-xs font-bold"
                      >
                        ₹{note}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Return Change Indicator */}
                {changeRs > 0 && (
                  <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-between">
                    <span className="text-xs font-semibold text-emerald-200">Give Back Change:</span>
                    <span className="text-xl font-extrabold text-emerald-400 font-tabular">
                      ₹{changeRs.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}

                {shortRs > 0 && (
                  <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
                    Short by ₹{shortRs.toFixed(2)}
                  </div>
                )}
              </div>
            )}

            {/* UPI Payment Screen */}
            {method === 'UPI' && (
              <div className="space-y-3 bg-stone-950/70 p-4 rounded-xl border border-white/10 flex flex-col items-center text-center">
                <span className="text-xs font-bold text-amber-300">Scan to Pay via Any UPI App</span>
                <p className="text-[11px] text-stone-400">PhonePe · Google Pay · Paytm · BHIM</p>

                {/* Dynamic QR Code Frame */}
                <div className="p-3 bg-white rounded-2xl shadow-xl mt-1">
                  <img
                    src={qrImgUrl}
                    alt="UPI Dynamic QR"
                    className="w-36 h-36 object-contain"
                  />
                </div>

                <span className="text-[10px] font-mono text-stone-400">
                  VPA: {upiVpa} · Amount: ₹{totalRs.toFixed(2)}
                </span>

                <div className="w-full text-left pt-2 border-t border-white/10">
                  <label className="text-[11px] font-semibold text-stone-300">UPI Ref / UTR # (Optional)</label>
                  <input
                    type="text"
                    maxLength={35}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="e.g. 439102918291"
                    className="w-full text-xs font-mono p-2 rounded-xl bg-black/60 border border-white/15 text-white mt-1"
                  />
                </div>
              </div>
            )}

            {/* CARD Payment Screen */}
            {method === 'CARD' && (
              <div className="space-y-3 bg-stone-950/70 p-4 rounded-xl border border-white/10">
                <div className="flex items-center gap-2 text-stone-300 text-xs">
                  <CreditCard className="w-4 h-4 text-amber-400" />
                  Swipe or Tap card on POS Terminal
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-stone-300">Card Approval Code / Ref</label>
                  <input
                    type="text"
                    maxLength={25}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="e.g. APPR-94819"
                    className="w-full text-xs font-mono p-2.5 rounded-xl bg-black/60 border border-white/15 text-white mt-1"
                  />
                </div>
              </div>
            )}

            {/* SPLIT Payment Screen */}
            {method === 'SPLIT' && (
              <div className="space-y-3 bg-stone-950/70 p-4 rounded-xl border border-white/10">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-stone-300">Cash Part (₹)</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      max={totalRs}
                      value={cashPartRs}
                      onChange={(e) => handleCashPartChange(e.target.value)}
                      placeholder="0.00"
                      className="w-full text-sm font-mono p-2 rounded-xl bg-black/60 border border-white/15 text-white mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-stone-300">UPI Part (₹)</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      max={totalRs}
                      value={upiPartRs}
                      onChange={(e) => setUpiPartRs(e.target.value)}
                      placeholder="0.00"
                      className="w-full text-sm font-mono p-2 rounded-xl bg-black/60 border border-white/15 text-amber-300 mt-1"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-stone-300">UPI Reference</label>
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="UPI Txn ID"
                    className="w-full text-xs font-mono p-2 rounded-xl bg-black/60 border border-white/15 text-white mt-1"
                  />
                </div>
              </div>
            )}

            {/* ATPOS Print Options (Number of Copies) */}
            <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs">
              <span className="text-stone-300 flex items-center gap-1.5">
                <Printer className="w-3.5 h-3.5 text-amber-400" /> ATPOS Receipt Copies:
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCopies(1)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border ${
                    copies === 1
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-white/5 text-stone-400 border-white/10'
                  }`}
                >
                  1 Copy (Customer)
                </button>
                <button
                  type="button"
                  onClick={() => setCopies(2)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border ${
                    copies === 2
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-white/5 text-stone-400 border-white/10'
                  }`}
                >
                  2 Copies (Office Tally)
                </button>
              </div>
            </div>

            {/* Submit Action Button */}
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-stone-300 font-bold text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={method === 'CASH' && shortRs > 0}
                className="flex-2 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-stone-950 font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                COMPLETE & PRINT BILL (₹{totalRs.toLocaleString('en-IN')})
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
