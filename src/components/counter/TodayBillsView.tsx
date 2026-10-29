import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Receipt,
  Search,
  Printer,
  RotateCcw,
  Calendar,
  Share2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  User,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';

interface TodayBillsViewProps {
  sales: any[];
  day: string;
  onSelectBill: (bill: any) => void;
  onRefresh: () => void;
}

export const TodayBillsView: React.FC<TodayBillsViewProps> = ({
  sales,
  day,
  onSelectBill,
  onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [selectedDay, setSelectedDay] = useState(day);
  const [refundModal, setRefundModal] = useState<any | null>(null);
  const [refundAmountRs, setRefundAmountRs] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundMethod, setRefundMethod] = useState('CASH');

  // Filter bills
  const filteredSales = sales.filter((s) => {
    const q = search.toLowerCase();
    const billNo = (s.bill_no || '').toLowerCase();
    const cust = (s.customer_name || '').toLowerCase();
    const phone = (s.customer_phone || '').toLowerCase();
    return billNo.includes(q) || cust.includes(q) || phone.includes(q);
  });

  const totalRevenuePaise = filteredSales.reduce((sum, s) => sum + (s.total_paise || 0), 0);

  const handleRefundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundModal) return;
    const amountPaise = Math.round(parseFloat(refundAmountRs) * 100);

    try {
      await axios.post(`/api/v1/counter/sales/${refundModal.id}/refunds`, {
        amount_paise: amountPaise,
        method: refundMethod,
        reason: refundReason,
      });
      toast.success('Refund request submitted for approval');
      setRefundModal(null);
      onRefresh();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Refund request failed');
    }
  };

  return (
    <div className="space-y-4">
      {/* Search & Day Filter Toolbar */}
      <div className="glass-card-elevated p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Bill #, Customer, Phone..."
              className="text-xs pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white placeholder-stone-500 focus:outline-none focus:border-amber-400 w-64"
            />
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs text-stone-300">
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
            <span>Date: {day}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[10px] uppercase font-mono text-stone-400">Bills Total</span>
            <div className="text-sm font-extrabold text-amber-300 font-tabular">
              {filteredSales.length} bills · ₹{(totalRevenuePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </div>

      {/* Bills Table */}
      <div className="glass-card-elevated rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-stone-400 uppercase tracking-wider font-semibold bg-white/[0.02]">
                <th className="py-3 px-4">Bill No</th>
                <th className="py-3 px-4">Time</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Cashier</th>
                <th className="py-3 px-4">Paid Via</th>
                <th className="py-3 px-4 text-right">Total Amount</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-medium">
              {filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-stone-500">
                    No counter bills found for this shift.
                  </td>
                </tr>
              ) : (
                filteredSales.map((s) => {
                  const timeStr = s.created_at
                    ? new Date(s.created_at).toLocaleTimeString('en-IN', { timeStyle: 'short' })
                    : '--:--';
                  const totalFormatted = ((s.total_paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
                  return (
                    <tr key={s.id} className="hover:bg-white/5 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-amber-300">
                        {s.bill_no}
                        {s.reprints > 0 && (
                          <span className="ml-1.5 text-[10px] text-stone-400">
                            (Reprint x{s.reprints})
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-stone-400 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-stone-500" />
                        {timeStr}
                      </td>
                      <td className="py-3 px-4 text-white">
                        {s.customer_name || <span className="text-stone-500">Walk-in</span>}
                        {s.customer_phone && (
                          <div className="text-[10px] text-stone-400">{s.customer_phone}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-stone-300">{s.cashier || 'Cashier'}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-stone-300 font-mono">
                          {s.methods || 'CASH'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-white text-right font-tabular">
                        ₹{totalFormatted}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            s.status === 'PAID'
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : s.status === 'REFUNDED'
                              ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                              : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelectBill(s)}
                          className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-semibold transition-colors inline-flex items-center gap-1"
                        >
                          <Printer className="w-3 h-3" /> View / Reprint
                        </button>
                        {s.status !== 'REFUNDED' && (
                          <button
                            type="button"
                            onClick={() => {
                              setRefundModal(s);
                              setRefundAmountRs((s.total_paise / 100).toString());
                            }}
                            className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-stone-400 hover:text-stone-200 border border-white/10 text-[11px] font-semibold transition-colors inline-flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" /> Refund
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Refund Request Modal Dialog */}
      {refundModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-card-elevated max-w-sm w-full p-6 rounded-2xl border border-white/10 space-y-4 text-white"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-amber-400" />
                Request Refund for {refundModal.bill_no}
              </h3>
            </div>

            <form onSubmit={handleRefundSubmit} className="space-y-3">
              <div>
                <label className="text-[11px] text-stone-300">Refund Amount (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  max={refundModal.total_paise / 100}
                  required
                  value={refundAmountRs}
                  onChange={(e) => setRefundAmountRs(e.target.value)}
                  className="w-full text-xs font-mono p-2.5 rounded-xl bg-black/40 border border-white/15 text-white mt-1"
                />
              </div>

              <div>
                <label className="text-[11px] text-stone-300">Payment Return Method</label>
                <select
                  value={refundMethod}
                  onChange={(e) => setRefundMethod(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-xl bg-stone-900 border border-white/15 text-white mt-1"
                >
                  <option value="CASH">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="CARD">Card</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-stone-300">Reason</label>
                <textarea
                  required
                  minLength={5}
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="e.g. Customer returned sealed bag due to duplicate purchase"
                  className="w-full text-xs p-2 rounded-xl bg-black/40 border border-white/15 text-white mt-1 resize-none"
                  rows={2}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRefundModal(null)}
                  className="flex-1 py-2.5 rounded-xl bg-white/5 text-stone-300 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-stone-950 text-xs font-bold"
                >
                  Submit Refund
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
