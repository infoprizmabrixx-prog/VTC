import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Printer, CheckCircle2, Share2, KeyRound, X, Sparkles } from 'lucide-react';
import { usePrinterStore } from '../../lib/printer/printer-store';
import { atposDevice } from '../../lib/printer/atpos-device';
import toast from 'react-hot-toast';

interface AtposReceiptModalProps {
  bill: any | null;
  changeRs?: number | null;
  onClose: () => void;
}

export const AtposReceiptModal: React.FC<AtposReceiptModalProps> = ({
  bill,
  changeRs,
  onClose,
}) => {
  const { printBillData, kickDrawer, paperWidth, upiVpa } = usePrinterStore();

  if (!bill) return null;

  const header = bill.header || {};
  const companyName = header.company_name || 'VASAVI TRADING COMPANY';
  const address = header.company_address || 'Coffee Roasters & Wholesale Merchants';
  const gstin = header.company_gstin || '';
  const billNo = bill.bill_no || 'CTR-NEW';
  const totalRs = ((bill.total_paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  const subtotalRs = ((bill.subtotal_paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  const discountRs = bill.discount_paise ? ((bill.discount_paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : null;

  const dateStr = bill.created_at
    ? new Date(bill.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })
    : new Date().toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });

  // Generate WhatsApp message string
  const handleWhatsApp = () => {
    const phone = bill.customer_phone ? bill.customer_phone.replace(/\D/g, '') : '';
    if (!phone) {
      toast.error('No customer phone recorded for this bill.');
      return;
    }
    const cleanPhone = phone.length === 10 ? '91' + phone : phone;
    let text = `*VASAVI TRADING COMPANY*\nTax Invoice: ${billNo}\nDate: ${dateStr}\n\n`;
    (bill.lines || []).forEach((l: any) => {
      const kg = l.weight_kg >= 1.0 ? `${l.weight_kg.toFixed(3)}kg` : `${Math.round(l.weight_kg * 1000)}g`;
      text += `• ${l.item_name} (${kg}) = ₹${(l.amount_paise / 100).toFixed(2)}\n`;
    });
    text += `\n*Total: ₹${totalRs}*\nPayment: ${(bill.payments || []).map((p: any) => p.method).join(', ')}\nThank you for choosing Vasavi Coffee!`;

    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handlePrintHardware = async (copies: 1 | 2) => {
    await printBillData(bill, copies);
  };

  const handleBrowserThermalPrint = () => {
    const el = document.getElementById('thermal-bill-container');
    if (el) {
      atposDevice.printThermalHtml(el.outerHTML);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 15 }}
          className="glass-card-elevated max-w-md w-full p-6 rounded-2xl border border-white/10 space-y-4 text-white"
        >
          {/* Header & Change Alert */}
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                <CheckCircle2 className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-white">Bill Saved #{billNo}</h3>
                <span className="text-[11px] text-stone-400">Ready for ATPOS Thermal Print</span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-stone-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Change Banner if Cash Sale */}
          {changeRs != null && changeRs > 0 && (
            <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-300">Cash Return Change:</span>
              <span className="text-xl font-extrabold text-emerald-400 font-tabular">
                ₹{changeRs.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {/* Authentic 80mm Thermal Receipt Visual Preview Slip */}
          <div
            id="thermal-bill-container"
            className="bg-white text-stone-900 rounded-xl p-5 shadow-2xl font-mono text-[11px] leading-tight space-y-2 border border-stone-300 select-text max-h-[380px] overflow-y-auto"
          >
            {/* Header */}
            <div className="text-center space-y-0.5 border-b border-dashed border-stone-400 pb-2">
              <h4 className="font-bold text-sm tracking-tight">{companyName}</h4>
              <p className="text-[10px] text-stone-600">{address}</p>
              {gstin && <p className="text-[10px] text-stone-600">GSTIN: {gstin}</p>}
              <p className="font-bold text-[10px] uppercase text-stone-700">Retail Tax Invoice</p>
              {bill.reprints > 0 && (
                <p className="font-bold text-[10px] text-rose-600">** DUPLICATE COPY #{bill.reprints} **</p>
              )}
            </div>

            {/* Bill Meta */}
            <div className="flex justify-between text-[10px] text-stone-700 pt-1">
              <span>Bill: {billNo}</span>
              <span>{dateStr}</span>
            </div>
            <div className="text-[10px] text-stone-600">
              <span>Cashier: {bill.cashier || 'Staff'}</span>
              {bill.customer_name && <span> | Cust: {bill.customer_name}</span>}
            </div>

            {/* Item Rows Table */}
            <div className="border-t border-b border-dashed border-stone-400 py-1.5 space-y-1">
              <div className="flex justify-between font-bold text-[10px] pb-1 border-b border-stone-200">
                <span className="w-1/2">Item Description</span>
                <span className="w-1/4 text-center">Qty x Rate</span>
                <span className="w-1/4 text-right">Amount</span>
              </div>
              {(bill.lines || []).map((l: any, idx: number) => {
                const kg = l.weight_kg >= 1.0 ? `${l.weight_kg.toFixed(3)}kg` : `${Math.round(l.weight_kg * 1000)}g`;
                const rate = (l.rate_paise / 100).toFixed(2);
                const amt = ((l.amount_paise || 0) / 100).toFixed(2);
                return (
                  <div key={idx} className="flex justify-between text-[10px]">
                    <span className="w-1/2 truncate font-semibold">{l.item_name}</span>
                    <span className="w-1/4 text-center text-stone-600">{kg}x{rate}</span>
                    <span className="w-1/4 text-right font-bold">₹{amt}</span>
                  </div>
                );
              })}
            </div>

            {/* Totals */}
            <div className="space-y-0.5 text-right text-[11px] pt-1">
              <div className="flex justify-between text-stone-600">
                <span>Subtotal:</span>
                <span>₹{subtotalRs}</span>
              </div>
              {discountRs && (
                <div className="flex justify-between text-stone-600">
                  <span>Discount ({bill.discount_reason}):</span>
                  <span>- ₹{discountRs}</span>
                </div>
              )}
              <div className="flex justify-between font-extrabold text-xs pt-1 border-t border-stone-300 text-stone-950">
                <span>NET TOTAL:</span>
                <span>₹{totalRs}</span>
              </div>
            </div>

            {/* Payments */}
            <div className="pt-1 border-t border-dashed border-stone-300 text-[10px]">
              <span className="font-bold">PAID VIA: </span>
              {(bill.payments || []).map((p: any) => `${p.method} (₹${(p.amount_paise / 100).toFixed(2)})`).join(', ')}
            </div>

            {/* Aroma Care Instructions & Footer */}
            <div className="text-center pt-2 text-[9px] text-stone-500 border-t border-dashed border-stone-400 space-y-0.5">
              <p className="font-semibold text-stone-700">Thank You! Visit Again.</p>
              <p>Store in an airtight container to preserve roast aroma.</p>
              <p>ESTD. 1965 · AUTHENTIC ROASTERS</p>
            </div>
          </div>

          {/* Action Buttons Grid */}
          <div className="space-y-2 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handlePrintHardware(1)}
                className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-stone-950 font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                🖨 Print 1 Copy (Customer)
              </button>
              <button
                type="button"
                onClick={() => handlePrintHardware(2)}
                className="py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-stone-100 font-bold text-xs border border-white/10 transition-all flex items-center justify-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                🖨 Customer + Office
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={handleBrowserThermalPrint}
                className="py-2 px-2 rounded-xl bg-white/5 hover:bg-white/10 text-stone-300 text-xs font-semibold border border-white/10 flex items-center justify-center gap-1"
              >
                Browser Print
              </button>
              <button
                type="button"
                onClick={() => kickDrawer()}
                className="py-2 px-2 rounded-xl bg-white/5 hover:bg-white/10 text-stone-300 text-xs font-semibold border border-white/10 flex items-center justify-center gap-1"
              >
                Kick Drawer
              </button>
              <button
                type="button"
                onClick={handleWhatsApp}
                className="py-2 px-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-semibold border border-emerald-500/30 flex items-center justify-center gap-1"
              >
                <Share2 className="w-3.5 h-3.5" /> WhatsApp
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 font-bold text-xs transition-colors"
            >
              Done & Ready for Next Customer →
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
