import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Lock,
  Unlock,
  Banknote,
  Receipt,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Printer,
  ShieldAlert,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { atposDevice } from '../../lib/printer/atpos-device';

interface CashCloseViewProps {
  closeData: any;
  onRefresh: () => void;
}

export const CashCloseView: React.FC<CashCloseViewProps> = ({ closeData, onRefresh }) => {
  const today = closeData?.today || {};
  const closedToday = closeData?.closed_today;
  const historyCloses: any[] = closeData?.closes || [];

  const [countedRs, setCountedRs] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [registerModal, setRegisterModal] = useState<any | null>(null);

  const openingRs = today.opening_paise != null ? today.opening_paise / 100 : 0;
  const cashSalesRs = (today.cash_sales_paise || 0) / 100;
  const cashRefundsRs = (today.cash_refunds_paise || 0) / 100;
  const expectedRs = today.expected_paise != null ? today.expected_paise / 100 : openingRs + cashSalesRs - cashRefundsRs;

  const numCounted = parseFloat(countedRs) || 0;
  const diffRs = countedRs !== '' ? numCounted - expectedRs : 0;

  const handleSubmitClose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (countedRs === '') return;
    setIsSubmitting(true);

    try {
      const res = await axios.post('/api/v1/counter/cash-close', {
        counted_paise: Math.round(numCounted * 100),
        note: note.trim(),
      });
      if (res.data?.state === 'BALANCED') {
        toast.success('Cash matches! Shift closed and locked for today.');
      } else {
        toast('Shift closed with variance. Sent for manager review.', { icon: '⚠️' });
      }
      onRefresh();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Day close submission failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenRegister = async (closeId: number) => {
    try {
      const res = await axios.get(`/api/v1/counter/cash-close/${closeId}/register`);
      setRegisterModal(res.data);
    } catch (err: any) {
      toast.error('Could not load day register');
    }
  };

  const handleReopen = async (closeId: number) => {
    const reason = prompt('Please enter a reason to reopen today’s counter:');
    if (!reason || reason.trim().length < 5) {
      alert('Reason must be at least 5 characters.');
      return;
    }
    try {
      await axios.post(`/api/v1/counter/cash-close/${closeId}/reopen`, { reason: reason.trim() });
      toast.success('Counter reopened for selling');
      onRefresh();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Reopen failed');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left 5 Cols: Today's Cash Drawer Balance & Close Form */}
      <div className="lg:col-span-5 space-y-4">
        {closedToday ? (
          <div className="glass-card-elevated p-6 rounded-2xl border border-white/10 space-y-4">
            <div className="flex items-center gap-2.5 text-amber-400">
              <Lock className="w-5 h-5" />
              <h3 className="text-base font-bold text-white">Counter Closed for Today</h3>
            </div>
            <p className="text-xs text-stone-400">
              Today's shift was closed at {new Date(closedToday.created_at).toLocaleTimeString('en-IN')}.
              Selling is locked until tomorrow.
            </p>

            <div className="space-y-2 bg-stone-950/80 p-4 rounded-xl border border-white/10 text-xs">
              <div className="flex justify-between text-stone-400">
                <span>Shift Date:</span>
                <span className="font-bold text-white">{closedToday.shift_date}</span>
              </div>
              <div className="flex justify-between text-stone-400">
                <span>Bills Count:</span>
                <span className="font-bold text-white">{closedToday.bills}</span>
              </div>
              <div className="flex justify-between text-stone-400">
                <span>Total Billed:</span>
                <span className="font-bold text-amber-300 font-tabular">
                  ₹{((closedToday.total_paise || 0) / 100).toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between text-stone-400">
                <span>Cash Counted:</span>
                <span className="font-bold text-emerald-400 font-tabular">
                  ₹{((closedToday.counted_paise || 0) / 100).toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between text-stone-400 pt-1 border-t border-white/10">
                <span>Shift State:</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  {closedToday.state}
                </span>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => handleOpenRegister(closedToday.id)}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg"
              >
                <FileText className="w-4 h-4" /> View Day Register
              </button>
              <button
                type="button"
                onClick={() => handleReopen(closedToday.id)}
                className="py-2.5 px-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-semibold"
              >
                Reopen
              </button>
            </div>
          </div>
        ) : (
          <div className="glass-card-elevated p-6 rounded-2xl border border-white/10 space-y-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Banknote className="w-4 h-4 text-amber-400" />
                Close Today's Cash Drawer
              </h3>
              <p className="text-xs text-stone-400">Tally cash, lock shift, and generate day register</p>
            </div>

            {/* Calculations Breakdown */}
            <div className="space-y-2 bg-stone-950/80 p-4 rounded-xl border border-white/10 text-xs">
              <div className="flex justify-between text-stone-400">
                <span>Opening Cash Float:</span>
                <span className="font-tabular font-bold text-stone-200">
                  ₹{openingRs.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between text-stone-400">
                <span>+ Cash Sales Today:</span>
                <span className="font-tabular font-bold text-emerald-400">
                  + ₹{cashSalesRs.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between text-stone-400">
                <span>− Cash Refunds:</span>
                <span className="font-tabular font-bold text-rose-400">
                  − ₹{cashRefundsRs.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between text-sm font-extrabold text-white pt-2 border-t border-white/10">
                <span>Expected Drawer Cash:</span>
                <span className="font-tabular text-amber-300">
                  ₹{expectedRs.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* Cash Entry Form */}
            <form onSubmit={handleSubmitClose} className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-stone-300">
                  Counted Cash in Drawer (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={countedRs}
                  onChange={(e) => setCountedRs(e.target.value)}
                  placeholder={`Expected ₹${expectedRs}`}
                  className="w-full text-base font-mono p-2.5 rounded-xl bg-black/60 border border-white/20 focus:border-amber-400 focus:outline-none text-white mt-1"
                />
              </div>

              {countedRs !== '' && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                    diffRs === 0
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                      : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                  }`}
                >
                  <span className="font-semibold">
                    {diffRs === 0 ? '✓ Balanced' : diffRs > 0 ? '+ Excess Cash' : '− Cash Shortage'}:
                  </span>
                  <span className="font-extrabold font-tabular text-sm">
                    {diffRs > 0 ? '+' : ''}₹{diffRs.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}

              {diffRs !== 0 && countedRs !== '' && (
                <div>
                  <label className="text-[11px] font-semibold text-stone-300">
                    Variance Note (Required)
                  </label>
                  <textarea
                    required
                    minLength={5}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Explain discrepancy for audit..."
                    className="w-full text-xs p-2 rounded-xl bg-black/60 border border-white/15 text-white mt-1 resize-none"
                    rows={2}
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || countedRs === ''}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-stone-950 font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Lock className="w-4 h-4" />
                {isSubmitting ? 'Closing Day...' : 'SUBMIT & CLOSE SHIFT'}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Right 7 Cols: Past Closed Shifts & Day Register History */}
      <div className="lg:col-span-7 glass-card-elevated p-6 rounded-2xl border border-white/10 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            Previous Closed Shifts History
          </h3>
          <span className="text-xs text-stone-400">{historyCloses.length} Records</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-stone-400 uppercase tracking-wider font-semibold">
                <th className="py-2.5 px-3">Shift Date</th>
                <th className="py-2.5 px-3">Bills</th>
                <th className="py-2.5 px-3 text-right">Total Billed</th>
                <th className="py-2.5 px-3 text-right">Difference</th>
                <th className="py-2.5 px-3">Closed By</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3 text-right">Register</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {historyCloses.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-stone-500">
                    No closed shifts recorded yet.
                  </td>
                </tr>
              ) : (
                historyCloses.map((k) => {
                  const diffPaise = k.difference_paise || 0;
                  const diffRs = diffPaise / 100;
                  return (
                    <tr key={k.id} className="hover:bg-white/5 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-bold text-amber-300">
                        {k.shift_date}
                      </td>
                      <td className="py-2.5 px-3 text-stone-300">{k.bills || 0}</td>
                      <td className="py-2.5 px-3 text-right font-bold font-tabular text-white">
                        ₹{((k.total_paise || 0) / 100).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2.5 px-3 text-right font-tabular">
                        {diffPaise === 0 ? (
                          <span className="text-emerald-400 font-bold">₹0.00</span>
                        ) : (
                          <span className="text-rose-400 font-bold">
                            {diffRs > 0 ? '+' : ''}₹{diffRs.toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-stone-300">{k.submitted_by_name || 'Staff'}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            k.state === 'BALANCED'
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : k.state === 'REOPENED'
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              : 'bg-stone-800 text-stone-400'
                          }`}
                        >
                          {k.state}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenRegister(k.id)}
                          className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-stone-300 border border-white/10 text-[11px] font-semibold"
                        >
                          Register
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Day Register Modal Preview */}
      {registerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-card-elevated max-w-2xl w-full p-6 rounded-2xl border border-white/10 space-y-4 text-white"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-amber-400" />
                Counter Day Register · {registerModal.close?.shift_date}
              </h3>
              <button
                onClick={() => setRegisterModal(null)}
                className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-stone-400"
              >
                ✕
              </button>
            </div>

            <div className="bg-white text-stone-900 p-5 rounded-xl text-xs font-mono max-h-96 overflow-y-auto space-y-3">
              <div className="text-center border-b pb-2">
                <h4 className="font-bold text-sm">{registerModal.header?.company_name}</h4>
                <p className="text-[10px] text-stone-600">COUNTER DAY REGISTER</p>
                <p className="text-[10px]">
                  Closed by: {registerModal.close?.submitted_by_name} · Shift Date: {registerModal.close?.shift_date}
                </p>
              </div>

              <div className="flex justify-between font-bold text-xs pt-1">
                <span>Total Bills: {registerModal.register?.bill_count || 0}</span>
                <span>Total Revenue: ₹{((registerModal.register?.total_paise || 0) / 100).toLocaleString('en-IN')}</span>
              </div>

              <div className="border-t pt-2 space-y-1">
                <div className="flex justify-between">
                  <span>Cash Counted in Drawer:</span>
                  <span className="font-bold">
                    ₹{((registerModal.close?.counted_paise || 0) / 100).toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Difference:</span>
                  <span className="font-bold">
                    ₹{((registerModal.close?.difference_paise || 0) / 100).toLocaleString('en-IN')}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" /> Print A4 Day Register
              </button>
              <button
                type="button"
                onClick={() => setRegisterModal(null)}
                className="py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
