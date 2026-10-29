import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CountUp from 'react-countup';
import {
  Receipt,
  Printer,
  Scale,
  Coffee,
  Search,
  Plus,
  Trash2,
  SlidersHorizontal,
  Banknote,
  Clock,
  User,
  Phone,
  RotateCcw,
  Sparkles,
  Lock,
  History,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Percent,
  Layers,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';
import axios from 'axios';
import toast, { Toaster } from 'react-hot-toast';

import { useCounterStore, CounterItem, CartLine } from '../../lib/counter-store';
import { usePrinterStore } from '../../lib/printer/printer-store';
import { QuickWeighModal } from './QuickWeighModal';
import { CustomBlendModal } from './CustomBlendModal';
import { DiscountModal } from './DiscountModal';
import { PaymentModal } from './PaymentModal';
import { AtposReceiptModal } from './AtposReceiptModal';
import { AtposPrinterSettingsModal } from './AtposPrinterSettingsModal';
import { TodayBillsView } from './TodayBillsView';
import { CashCloseView } from './CashCloseView';

// Fallback Authentic VTC Roastery Initial Catalog if Backend is offline
const INITIAL_COUNTER_ITEMS: CounterItem[] = [
  {
    id: 1,
    name: 'Royal Hotel Blend 70:30 (Strong Decoction)',
    kind: 'coffee_ground',
    coffee_pct: 70,
    price_per_kg_paise: 44000, // Rs 440/kg
    stock_kg: 28.5,
    active: true,
  },
  {
    id: 2,
    name: 'Imperial Commercial 80:20 (Medium Roast)',
    kind: 'coffee_ground',
    coffee_pct: 80,
    price_per_kg_paise: 48000, // Rs 480/kg
    stock_kg: 34.2,
    active: true,
  },
  {
    id: 3,
    name: 'Plantation A 100% Pure Filter Coffee',
    kind: 'coffee_ground',
    coffee_pct: 100,
    price_per_kg_paise: 56000, // Rs 560/kg
    stock_kg: 19.8,
    active: true,
  },
  {
    id: 4,
    name: 'Plantation Peaberry (Whole Roasted Beans)',
    kind: 'coffee_beans',
    coffee_pct: 100,
    price_per_kg_paise: 62000, // Rs 620/kg
    stock_kg: 22.0,
    active: true,
  },
  {
    id: 5,
    name: 'Robusta Cherry AB Roasted Beans',
    kind: 'coffee_beans',
    coffee_pct: 100,
    price_per_kg_paise: 38000, // Rs 380/kg
    stock_kg: 45.0,
    active: true,
  },
  {
    id: 6,
    name: 'French Roasted Chicory (Jamnagar A-Grade)',
    kind: 'product',
    coffee_pct: 0,
    price_per_kg_paise: 16000, // Rs 160/kg
    stock_kg: 18.2,
    active: true,
  },
  {
    id: 7,
    name: 'Retail 500g Fresh Aroma Valve Pouch',
    kind: 'product',
    coffee_pct: 80,
    price_per_kg_paise: 52000, // Rs 520/kg
    stock_kg: 16.0,
    active: true,
  },
  {
    id: 8,
    name: 'Highland Assam Orthodox Tea Dust',
    kind: 'product',
    coffee_pct: 0,
    price_per_kg_paise: 28000, // Rs 280/kg
    stock_kg: 14.5,
    active: true,
  },
];

export const CounterPOS: React.FC = () => {
  const {
    lines,
    discountPaise,
    discountReason,
    customerName,
    customerPhone,
    matchedCustomer,
    items,
    setSetupData,
    addLine,
    removeLine,
    updateLineWeight,
    clearCart,
    setDiscount,
    clearDiscount,
    setCustomer,
    setMatchedCustomer,
    applyPreviousOrder,
  } = useCounterStore();

  const {
    transport,
    status: printerStatus,
    deviceName: printerDeviceName,
    paperWidth,
    printBillData,
    kickDrawer,
  } = usePrinterStore();

  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'sell' | 'bills' | 'close' | 'printer'>('sell');

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Modal states
  const [weighItem, setWeighItem] = useState<CounterItem | null>(null);
  const [isCustomBlendOpen, setIsCustomBlendOpen] = useState(false);
  const [isDiscountOpen, setIsDiscountOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isPrinterSettingsOpen, setIsPrinterSettingsOpen] = useState(false);
  const [savedBillModal, setSavedBillModal] = useState<any | null>(null);
  const [lastChangeRs, setLastChangeRs] = useState<number | null>(null);

  // Backend Data
  const [salesData, setSalesData] = useState<any[]>([]);
  const [closeData, setCloseData] = useState<any>(null);
  const [isLoadingSetup, setIsLoadingSetup] = useState(true);

  // Load Setup from Backend API
  const fetchSetup = async () => {
    try {
      setIsLoadingSetup(true);
      const res = await axios.get('/api/v1/counter/setup');
      if (res.data) {
        setSetupData(res.data);
      }
    } catch {
      // Fallback demo setup if backend is not started
      setSetupData({
        items: INITIAL_COUNTER_ITEMS,
        incoming: [],
        stock: { coffee_ground: 28.5, coffee_beans: 42.0, custom_chicory: 18.2 },
        settings: {
          company_name: 'VASAVI TRADING COMPANY',
          company_address: 'Main Bazaar, Coffee Roasters & Wholesale Merchants',
          company_gstin: '37AAAAA0000A1Z5',
          discount_cap_pct: 10,
          custom_coffee_rate_paise: 52000,
          custom_chicory_rate_paise: 16000,
        },
      });
    } finally {
      setIsLoadingSetup(false);
    }
  };

  // Load Today's Sales
  const fetchSales = async () => {
    try {
      const res = await axios.get('/api/v1/counter/sales');
      if (res.data?.sales) {
        setSalesData(res.data.sales);
      }
    } catch {
      // Mock sales if offline
      setSalesData([
        {
          id: 101,
          bill_no: 'CTR-2610-001',
          created_at: new Date(Date.now() - 3600000).toISOString(),
          customer_name: 'Hotel Annapurna Grand',
          customer_phone: '9848012345',
          cashier: 'Venkatesh',
          methods: 'CASH',
          total_paise: 132000,
          subtotal_paise: 132000,
          discount_paise: 0,
          status: 'PAID',
          reprints: 0,
          lines: [{ item_name: 'Royal Hotel Blend 70:30', weight_kg: 3.0, rate_paise: 44000, amount_paise: 132000 }],
          payments: [{ method: 'CASH', amount_paise: 132000 }],
        },
      ]);
    }
  };

  // Load Cash Close Status
  const fetchCashClose = async () => {
    try {
      const res = await axios.get('/api/v1/counter/cash-close');
      setCloseData(res.data);
    } catch {
      setCloseData({
        today: {
          opening_paise: 200000,
          cash_sales_paise: 132000,
          cash_refunds_paise: 0,
          expected_paise: 332000,
        },
        closes: [],
      });
    }
  };

  useEffect(() => {
    fetchSetup();
    fetchSales();
    fetchCashClose();
  }, []);

  // Customer Phone Lookup
  useEffect(() => {
    const p = customerPhone.replace(/\D/g, '');
    if (p.length >= 10) {
      axios
        .get(`/api/v1/counter/customers?q=${p}`)
        .then((res) => {
          if (res.data?.customers && res.data.customers.length > 0) {
            const match = res.data.customers[0];
            setMatchedCustomer(match);
            if (!customerName && match.name) {
              setCustomer(match.name, customerPhone);
            }
          }
        })
        .catch(() => {
          // If offline and mock phone matches
          if (p === '9848012345') {
            setMatchedCustomer({
              id: 99,
              name: 'Hotel Annapurna Grand',
              phone: '9848012345',
              visits: 12,
              last_seen: new Date(Date.now() - 86400000).toISOString(),
              last_bill: {
                bill_no: 'CTR-2610-098',
                total_paise: 88000,
                lines: [{ item_name: 'Royal Hotel Blend 70:30', weight_kg: 2.0, rate_paise: 44000 }],
              },
            });
          }
        });
    } else {
      setMatchedCustomer(null);
    }
  }, [customerPhone]);

  // Catalog item filtering
  const displayItems = (items.length > 0 ? items : INITIAL_COUNTER_ITEMS).filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (selectedCategory === 'ground') return item.kind === 'coffee_ground';
    if (selectedCategory === 'beans') return item.kind === 'coffee_beans';
    if (selectedCategory === 'product') return item.kind === 'product';
    return true;
  });

  // Cart totals
  const subtotalPaise = lines.reduce((sum, l) => sum + l.amount_paise, 0);
  const totalPaise = Math.max(0, subtotalPaise - discountPaise);

  // Quick Add preset directly from tile
  const handleQuickAddKg = (item: CounterItem, kg: number) => {
    const amount_paise = Math.round(kg * item.price_per_kg_paise);
    addLine({
      item_id: item.id,
      name: item.name,
      weight_kg: kg,
      rate_paise: item.price_per_kg_paise,
      amount_paise,
    });
    toast.success(`Added ${kg >= 1 ? `${kg}kg` : `${kg * 1000}g`} of ${item.name}`);
  };

  // Complete Sale & Bill
  const handlePaymentComplete = async (paymentData: any) => {
    setIsPaymentOpen(false);

    const salePayload = {
      lines: lines.map((l) =>
        l.custom
          ? { custom: l.custom, weight_kg: l.weight_kg }
          : { item_id: l.item_id, weight_kg: l.weight_kg }
      ),
      discount_paise: discountPaise,
      discount_reason: discountReason,
      customer_name: customerName,
      customer_phone: customerPhone,
      payments: paymentData.payments,
    };

    try {
      const res = await axios.post('/api/v1/counter/sales', salePayload);
      const savedBill = res.data;

      // Clear Cart
      clearCart();
      setLastChangeRs(paymentData.changePaise ? paymentData.changePaise / 100 : null);
      setSavedBillModal(savedBill);

      // Trigger automatic ATPOS print
      await printBillData(savedBill, paymentData.copies);

      // Refresh sales
      fetchSales();
      fetchCashClose();
    } catch (err: any) {
      // Offline fallback: generate mock bill
      const mockBillNo = `CTR-${new Date().toISOString().slice(2, 7).replace('-', '')}-${Math.floor(100 + Math.random() * 900)}`;
      const mockBill = {
        id: Date.now(),
        bill_no: mockBillNo,
        created_at: new Date().toISOString(),
        cashier: 'Counter Staff',
        customer_name: customerName,
        customer_phone: customerPhone,
        lines: [...lines],
        subtotal_paise: subtotalPaise,
        discount_paise: discountPaise,
        discount_reason: discountReason,
        total_paise: totalPaise,
        payments: paymentData.payments,
        reprints: 0,
        header: {
          company_name: 'VASAVI TRADING COMPANY',
          company_address: 'Coffee Roasters & Wholesale Merchants, Main Bazaar',
          company_gstin: '37AAAAA0000A1Z5',
        },
      };

      clearCart();
      setLastChangeRs(paymentData.changePaise ? paymentData.changePaise / 100 : null);
      setSavedBillModal(mockBill);
      setSalesData((prev) => [mockBill, ...prev]);

      // Print via ATPOS
      await printBillData(mockBill, paymentData.copies);
      toast.success(`Bill ${mockBillNo} generated & sent to ATPOS!`);
    }
  };

  return (
    <div className="min-h-screen bg-[#080605] text-stone-100 flex flex-col font-sans ambient-glow-mesh selection:bg-amber-500/30 selection:text-amber-200">
      <Toaster position="top-right" toastOptions={{ style: { background: '#1c1917', color: '#fff' } }} />

      {/* =========================================================================
          TOP COUNTER HEADER: BRAND LOCKUP, IST CLOCK, CASHIER & ATPOS PRINTER PILL
          ========================================================================= */}
      <header className="sticky top-0 z-40 glass-header px-6 py-3 flex items-center justify-between">
        {/* Left: Brand Identity */}
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-stone-950 font-black text-sm shadow-lg shadow-amber-500/20">
            VTC
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tight text-white">VASAVI TRADING COMPANY</h1>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                Counter POS & Billing
              </span>
            </div>
            <p className="text-[11px] text-stone-400">Coffee Roasters & Merchants · Estd. 1965</p>
          </div>
        </div>

        {/* Center: Shift & Live IST Clock */}
        <div className="hidden md:flex items-center gap-5 text-xs text-stone-300">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-white">Shift Open</span>
          </div>
          <div className="flex items-center gap-1.5 text-stone-400">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-mono text-stone-200">{new Date().toLocaleTimeString('en-IN')}</span>
          </div>
        </div>

        {/* Right: ATPOS PRINTER CONNECTION STATUS PILL */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsPrinterSettingsOpen(true)}
            className={`px-3.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              printerStatus === 'connected'
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                : 'bg-amber-500/15 border-amber-500/30 text-amber-300 hover:bg-amber-500/25'
            }`}
          >
            <Printer className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {printerStatus === 'connected' ? `ATPOS (${transport.toUpperCase()})` : 'ATPOS Offline'}
            </span>
            <span
              className={`w-2 h-2 rounded-full ${
                printerStatus === 'connected' ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-amber-400 animate-ping'
              }`}
            />
          </button>

          <button
            type="button"
            onClick={() => kickDrawer()}
            title="Kick open Cash Drawer"
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-stone-300 hover:text-white border border-white/10 transition-colors"
          >
            <KeyRound className="w-4 h-4 text-amber-400" />
          </button>
        </div>
      </header>

      {/* =========================================================================
          SUB-NAV TABS: 1. EXPRESS POS (SELL), 2. TODAY'S BILLS, 3. DAY CLOSE, 4. ATPOS SETUP
          ========================================================================= */}
      <div className="px-6 pt-3 pb-1 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {[
            { id: 'sell', label: 'Express POS (Sell)', icon: Receipt },
            { id: 'bills', label: "Today's Bills & Reprints", icon: History },
            { id: 'close', label: 'Cash Drawer & Day Close', icon: Lock },
            { id: 'printer', label: 'ATPOS Printer Hub', icon: Printer },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border ${
                  active
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                    : 'bg-transparent text-stone-400 border-transparent hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === 'sell' && (
          <div className="text-xs text-stone-400 hidden sm:block">
            Counter Stock: <b className="text-white">28.5 kg</b> ground · <b className="text-white">42.0 kg</b> beans
          </div>
        )}
      </div>

      {/* =========================================================================
          MAIN WORKSPACE CANVAS
          ========================================================================= */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
        <AnimatePresence mode="wait">
          {/* TAB 1: EXPRESS POS SELLING VIEW */}
          {activeTab === 'sell' && (
            <motion.div
              key="sell-view"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-6"
            >
              {/* Left 7 Cols: Catalog, Quick Add Tiles & Custom Blend */}
              <div className="lg:col-span-7 space-y-4">
                {/* Search Bar & Category Filter Pills */}
                <div className="glass-card-elevated p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search coffee blend, beans, tea..."
                      className="text-xs pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white placeholder-stone-500 focus:outline-none focus:border-amber-400 w-full"
                    />
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                    {[
                      { id: 'all', label: 'All' },
                      { id: 'ground', label: 'Ground Blends' },
                      { id: 'beans', label: 'Roasted Beans' },
                      { id: 'product', label: 'Products & Tea' },
                    ].map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                          selectedCategory === cat.id
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-white/5 text-stone-400 border-white/5 hover:text-white'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Product Catalog Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 max-h-[640px] overflow-y-auto pr-1">
                  {/* Custom Ratio Blend Tile */}
                  <div
                    onClick={() => setIsCustomBlendOpen(true)}
                    className="glass-card-interactive p-4 rounded-2xl flex flex-col justify-between space-y-3 cursor-pointer group border-dashed border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-amber-400 uppercase font-bold flex items-center gap-1">
                          <SlidersHorizontal className="w-3 h-3" /> Custom Roastery Blend
                        </span>
                        <h4 className="text-sm font-bold text-white group-hover:text-amber-300 transition-colors mt-0.5">
                          Custom Ratio (80/20, 70/30, Any)
                        </h4>
                        <p className="text-[11px] text-stone-400">
                          Freshly ground on the spot to customer ratio
                        </p>
                      </div>
                      <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20">
                        Dynamic ₹
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-amber-500/20 text-[11px] text-amber-300 font-semibold">
                      <span>Click to choose Coffee/Chicory %</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </div>

                  {/* Standard Catalog Items */}
                  {displayItems.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setWeighItem(item)}
                      className="glass-card-interactive p-4 rounded-2xl flex flex-col justify-between space-y-3 cursor-pointer group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-[10px] font-mono text-stone-400 uppercase">
                            {item.kind === 'coffee_ground' ? 'Fresh Ground' : item.kind === 'coffee_beans' ? 'Beans' : 'Pack'}
                          </span>
                          <h4 className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors leading-tight mt-0.5">
                            {item.name}
                          </h4>
                          {item.coffee_pct ? (
                            <span className="text-[10px] text-stone-400">
                              {item.coffee_pct}% Coffee + {100 - item.coffee_pct}% Chicory
                            </span>
                          ) : null}
                        </div>
                        <span className="text-xs font-extrabold text-amber-300 font-tabular bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20 shrink-0">
                          ₹{(item.price_per_kg_paise / 100).toLocaleString('en-IN')}/kg
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-white/5">
                        <span className="text-[11px] text-emerald-400 font-medium">
                          Stock: {item.stock_kg} kg
                        </span>
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => handleQuickAddKg(item, 0.25)}
                            className="px-2 py-0.5 rounded-lg bg-white/5 hover:bg-amber-500 hover:text-stone-950 font-bold text-[10px] text-stone-300 transition-colors"
                          >
                            +250g
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickAddKg(item, 0.5)}
                            className="px-2 py-0.5 rounded-lg bg-white/5 hover:bg-amber-500 hover:text-stone-950 font-bold text-[10px] text-stone-300 transition-colors"
                          >
                            +500g
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickAddKg(item, 1.0)}
                            className="px-2 py-0.5 rounded-lg bg-white/10 hover:bg-amber-500 hover:text-stone-950 font-bold text-[10px] text-white transition-colors"
                          >
                            +1kg
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right 5 Cols: Active Bill & Cart */}
              <div className="lg:col-span-5 glass-card-elevated p-6 rounded-2xl flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-3 border-b border-white/10">
                    <div className="flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-amber-400" />
                      <h3 className="text-sm font-bold text-white">Active Counter Bill</h3>
                    </div>
                    {lines.length > 0 && (
                      <button
                        type="button"
                        onClick={() => clearCart()}
                        className="text-[11px] text-stone-400 hover:text-rose-400 transition-colors"
                      >
                        Clear Bill
                      </button>
                    )}
                  </div>

                  {/* Customer Information with Instant Phone Lookup */}
                  <div className="bg-stone-950/70 p-3.5 rounded-xl border border-white/10 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] uppercase font-bold text-stone-400">Phone (Optional)</label>
                        <input
                          type="tel"
                          value={customerPhone}
                          onChange={(e) => setCustomer(customerName, e.target.value)}
                          placeholder="Customer mobile #"
                          className="w-full text-xs font-mono p-2 rounded-lg bg-black/40 border border-white/10 text-white mt-0.5 focus:border-amber-400 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase font-bold text-stone-400">Customer Name</label>
                        <input
                          type="text"
                          value={customerName}
                          onChange={(e) => setCustomer(e.target.value, customerPhone)}
                          placeholder="e.g. Ramesh or Hotel"
                          className="w-full text-xs p-2 rounded-lg bg-black/40 border border-white/10 text-white mt-0.5 focus:border-amber-400 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Matched Customer Loyalty Banner */}
                    {matchedCustomer && (
                      <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs flex items-center justify-between">
                        <div>
                          <p className="font-bold text-amber-300">
                            ★ Regular Customer: {matchedCustomer.name}
                          </p>
                          <p className="text-[10px] text-stone-400">
                            Visit #{matchedCustomer.visits} · Last bought: {matchedCustomer.last_bill?.lines?.[0]?.item_name}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => applyPreviousOrder()}
                          className="px-2 py-1 rounded bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-[10px]"
                        >
                          Repeat Order
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Cart Item Rows */}
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {lines.length === 0 ? (
                      <div className="py-10 text-center text-stone-500 text-xs space-y-1">
                        <Scale className="w-7 h-7 mx-auto text-stone-600 mb-1" />
                        <p className="font-semibold text-stone-400">Bill is empty</p>
                        <p className="text-[11px]">Tap any item on the left to weigh and add.</p>
                      </div>
                    ) : (
                      lines.map((line) => {
                        const weightDisplay = line.weight_kg >= 1.0
                          ? `${line.weight_kg.toFixed(3)} kg`
                          : `${Math.round(line.weight_kg * 1000)} g`;
                        return (
                          <div
                            key={line.id}
                            className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-white/5 border border-white/5"
                          >
                            <div className="flex-1 pr-2">
                              <p className="font-semibold text-white leading-tight">{line.name}</p>
                              <p className="text-[10px] text-stone-400 font-tabular">
                                {weightDisplay} × ₹{(line.rate_paise / 100).toLocaleString('en-IN')}/kg
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-amber-300 font-tabular text-sm">
                                ₹{(line.amount_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeLine(line.id)}
                                className="p-1 rounded-md text-stone-500 hover:text-rose-400 hover:bg-white/5"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Totals & Complete Bill Action */}
                <div className="space-y-3 pt-3 border-t border-white/10">
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between text-stone-400">
                      <span>Subtotal</span>
                      <span className="font-tabular text-stone-200">
                        ₹{(subtotalPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    {discountPaise > 0 ? (
                      <div className="flex justify-between text-emerald-400">
                        <span>Discount ({discountReason})</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-tabular font-bold">
                            − ₹{(discountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                          <button
                            type="button"
                            onClick={() => clearDiscount()}
                            className="text-[10px] text-stone-500 hover:text-rose-400"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div className="flex justify-between items-baseline text-sm font-extrabold text-white pt-2 border-t border-white/10">
                      <div className="flex items-center gap-2">
                        <span>Total to Collect</span>
                        {lines.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setIsDiscountOpen(true)}
                            className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-0.5 font-normal underline"
                          >
                            <Percent className="w-2.5 h-2.5" /> Discount
                          </button>
                        )}
                      </div>
                      <div className="text-xl font-extrabold text-amber-300 font-tabular">
                        ₹
                        <CountUp
                          end={totalPaise / 100}
                          decimals={2}
                          duration={0.4}
                          separator=","
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={lines.length === 0}
                    onClick={() => setIsPaymentOpen(true)}
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-stone-950 font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    TAKE PAYMENT & PRINT BILL (₹{(totalPaise / 100).toLocaleString('en-IN')})
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 2: TODAY'S BILLS & REPRINTS */}
          {activeTab === 'bills' && (
            <motion.div
              key="bills-view"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <TodayBillsView
                sales={salesData}
                day={new Date().toISOString().slice(0, 10)}
                onSelectBill={(b) => setSavedBillModal(b)}
                onRefresh={() => fetchSales()}
              />
            </motion.div>
          )}

          {/* TAB 3: CASH CLOSE & REGISTER */}
          {activeTab === 'close' && (
            <motion.div
              key="close-view"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <CashCloseView closeData={closeData} onRefresh={() => fetchCashClose()} />
            </motion.div>
          )}

          {/* TAB 4: ATPOS PRINTER HARDWARE MANAGER */}
          {activeTab === 'printer' && (
            <motion.div
              key="printer-view"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <AtposPrinterSettingsModal isOpen={true} onClose={() => setActiveTab('sell')} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* =========================================================================
          INTERACTIVE POPUP MODALS
          ========================================================================= */}
      <QuickWeighModal
        item={weighItem}
        onClose={() => setWeighItem(null)}
        onAdd={(kg) => {
          if (weighItem) {
            handleQuickAddKg(weighItem, kg);
          }
        }}
      />

      <CustomBlendModal
        isOpen={isCustomBlendOpen}
        onClose={() => setIsCustomBlendOpen(false)}
        onAdd={(blend) => {
          addLine({
            name: blend.name,
            weight_kg: blend.weight_kg,
            rate_paise: blend.rate_paise,
            amount_paise: Math.round(blend.weight_kg * blend.rate_paise),
            custom: {
              coffee_pct: blend.coffee_pct,
              override_rate_paise: blend.override_rate_paise,
              override_reason: blend.override_reason,
            },
          });
          toast.success(`Custom blend added: ${blend.name}`);
        }}
      />

      <DiscountModal
        isOpen={isDiscountOpen}
        subtotalPaise={subtotalPaise}
        onClose={() => setIsDiscountOpen(false)}
        onApply={(paise, reason) => {
          setDiscount(paise, reason);
          toast.success(`Discount of ₹${(paise / 100).toFixed(2)} applied`);
        }}
      />

      <PaymentModal
        isOpen={isPaymentOpen}
        totalPaise={totalPaise}
        customerName={customerName}
        customerPhone={customerPhone}
        onClose={() => setIsPaymentOpen(false)}
        onComplete={handlePaymentComplete}
      />

      <AtposReceiptModal
        bill={savedBillModal}
        changeRs={lastChangeRs}
        onClose={() => {
          setSavedBillModal(null);
          setLastChangeRs(null);
        }}
      />

      <AtposPrinterSettingsModal
        isOpen={isPrinterSettingsOpen}
        onClose={() => setIsPrinterSettingsOpen(false)}
      />
    </div>
  );
};

export default CounterPOS;
