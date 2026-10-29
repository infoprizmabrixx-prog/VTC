import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CountUp from 'react-countup';
import axios from 'axios';
import toast from 'react-hot-toast';
import {
  Flame,
  Coffee,
  Package,
  TrendingUp,
  Receipt,
  Scale,
  ShieldCheck,
  Warehouse,
  Truck,
  Search,
  Bell,
  Volume2,
  VolumeX,
  Plus,
  Minus,
  Trash2,
  Printer,
  Sparkles,
  ArrowUpRight,
  Clock,
  Layers,
  Thermometer,
  Percent,
  CheckCircle2,
  AlertTriangle,
  Share2,
  X,
  Zap,
  RotateCcw,
  QrCode,
  SlidersHorizontal,
  Edit3,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  User,
  Users,
  Calendar,
  Banknote,
  Check,
  ArrowRight
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { sfx } from '../src/lib/sfx';

// Authentic VTC Roastery & Merchant Dataset
interface BeanStock {
  id: string;
  code: string;
  name: string;
  category: 'Green Coffee' | 'Roasted Blend' | 'Chicory';
  bags: number;
  kgPerBag: number;
  totalKg: number;
  moisture: string;
  qcStatus: 'Approved' | 'Quarantined' | 'Testing';
  bay: 'Bay A' | 'Bay B' | 'Bay C' | 'Bay D';
  ratePerKg: number;
}

const INITIAL_STOCKS: BeanStock[] = [
  { id: '1', code: 'VTC-GR-PLA', name: 'Plantation A (Raw Green Coffee)', category: 'Green Coffee', bags: 142, kgPerBag: 60, totalKg: 8520, moisture: '10.8%', qcStatus: 'Approved', bay: 'Bay A', ratePerKg: 380 },
  { id: '2', code: 'VTC-GR-ROB', name: 'Robusta Cherry AB (Coorg/Wayanad)', category: 'Green Coffee', bags: 210, kgPerBag: 60, totalKg: 12600, moisture: '11.4%', qcStatus: 'Approved', bay: 'Bay A', ratePerKg: 245 },
  { id: '3', code: 'VTC-GR-PPB', name: 'Plantation Peaberry (PB Green)', category: 'Green Coffee', bags: 48, kgPerBag: 60, totalKg: 2880, moisture: '10.5%', qcStatus: 'Approved', bay: 'Bay A', ratePerKg: 420 },
  { id: '4', code: 'VTC-CH-JAM', name: 'French Roasted Chicory (Jamnagar A-Grade)', category: 'Chicory', bags: 95, kgPerBag: 50, totalKg: 4750, moisture: '4.8%', qcStatus: 'Approved', bay: 'Bay B', ratePerKg: 110 },
  { id: '5', code: 'VTC-BL-8020', name: 'Imperial Commercial 80:20 (Coffee:Chicory)', category: 'Roasted Blend', bags: 85, kgPerBag: 25, totalKg: 2125, moisture: '2.5%', qcStatus: 'Approved', bay: 'Bay C', ratePerKg: 480 },
  { id: '6', code: 'VTC-BL-7030', name: 'Royal Hotel Blend 70:30 (Strong Decoction)', category: 'Roasted Blend', bags: 110, kgPerBag: 25, totalKg: 2750, moisture: '2.4%', qcStatus: 'Approved', bay: 'Bay C', ratePerKg: 440 },
  { id: '7', code: 'VTC-GR-PAR', name: 'Robusta Parchment (Highland Washed)', category: 'Green Coffee', bags: 34, kgPerBag: 60, totalKg: 2040, moisture: '11.2%', qcStatus: 'Testing', bay: 'Bay A', ratePerKg: 290 },
  { id: '8', code: 'VTC-RT-500G', name: 'Retail Pack: Fresh Aroma 500g Valve Pouch', category: 'Roasted Blend', bags: 320, kgPerBag: 0.5, totalKg: 160, moisture: '2.1%', qcStatus: 'Approved', bay: 'Bay D', ratePerKg: 520 },
];

const HOURLY_THROUGHPUT = [
  { time: '08:00 AM', roasting: 180, counterSales: 45 },
  { time: '10:00 AM', roasting: 320, counterSales: 160 },
  { time: '12:00 PM', roasting: 450, counterSales: 280 },
  { time: '02:00 PM', roasting: 290, counterSales: 190 },
  { time: '04:00 PM', roasting: 520, counterSales: 340 },
  { time: '06:00 PM', roasting: 410, counterSales: 420 },
  { time: '08:00 PM', roasting: 150, counterSales: 210 },
];

const BLEND_PIE_DATA = [
  { name: 'Imperial 80:20 Blend', value: 54, color: '#F59E0B' },
  { name: 'Royal Hotel 70:30', value: 26, color: '#D97706' },
  { name: 'Pure Arabica 100%', value: 12, color: '#10B981' },
  { name: 'Commercial Strong 60:40', value: 8, color: '#854D0E' },
];

export default function CoffeeCRMWorkspace() {
  const [activeTab, setActiveTab] = useState<'overview' | 'production' | 'warehouse' | 'counter' | 'dispatches'>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      if (tabParam && ['overview', 'production', 'warehouse', 'counter', 'dispatches'].includes(tabParam)) {
        return tabParam as any;
      }
    }
    // Default to 'counter' for counter sales with ATPOS printer as requested
    return 'counter';
  });
  const [sfxEnabled, setSfxEnabled] = useState<boolean>(true);
  const [stocks, setStocks] = useState<BeanStock[]>(INITIAL_STOCKS);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Roasting Drum Live State
  const [drumTemp, setDrumTemp] = useState(196);
  const [roastTimeSec, setRoastTimeSec] = useState(645);
  const [isRoasting, setIsRoasting] = useState(true);
  const [batchGreenKg, setBatchGreenKg] = useState(60);
  const [batchOutputKg, setBatchOutputKg] = useState(50.2);

  // Counter Mode: Sell, Edit for Blend, Today's Bills, Customers, Day Close
  const [counterMode, setCounterMode] = useState<'sell' | 'blend' | 'bills' | 'customers' | 'dayclose'>('sell');

  // Counter POS State
  const [cart, setCart] = useState<{ item: BeanStock; qtyKg: number; grind?: string }[]>([
    { item: INITIAL_STOCKS[4], qtyKg: 5, grind: 'Medium Filter' },
    { item: INITIAL_STOCKS[0], qtyKg: 10, grind: 'Fine Powder' },
  ]);
  const [customerName, setCustomerName] = useState('Sri Balaji Coffee Bar, Gandhi Chowk');
  const [customerPhone, setCustomerPhone] = useState('98480 22331');
  const [gstType, setGstType] = useState<'b2b' | 'retail'>('b2b');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'CARD'>('CASH');
  const [receiptModal, setReceiptModal] = useState(false);
  const [activePrintTarget, setActivePrintTarget] = useState<'receipt' | 'zreport'>('receipt');

  // ATPOS Printer & Hardware State
  const [printerPaper, setPrinterPaper] = useState<80 | 58>(80);
  const [printCopies, setPrintCopies] = useState<1 | 2>(1);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isKickingDrawer, setIsKickingDrawer] = useState(false);
  const [printerName] = useState('POS-80C');
  const [billNumber, setBillNumber] = useState('VTC-2026-8491');

  // Cash Today 🔒 State
  const [cashTodayLocked, setCashTodayLocked] = useState(true);
  const [cashPinModal, setCashPinModal] = useState(false);
  const [enteredPin, setEnteredPin] = useState('');
  const [openingFloat, setOpeningFloat] = useState(5000);
  const [cashExpensesToday, setCashExpensesToday] = useState(0);

  // Blend Manager (Edit for Blend) State
  const [editableBlends, setEditableBlends] = useState([
    { id: 'b1', code: 'VTC-BL-7030', name: 'Royal Hotel Blend 70:30', coffeePct: 70, chicoryPct: 30, ratePerKg: 440, grind: 'Medium Filter', stockKg: 28.5, bay: 'Bay C-01' },
    { id: 'b2', code: 'VTC-BL-8020', name: 'Imperial Commercial 80:20', coffeePct: 80, chicoryPct: 20, ratePerKg: 480, grind: 'Medium Filter', stockKg: 34.2, bay: 'Bay C-02' },
    { id: 'b3', code: 'VTC-PU-100', name: 'Pure Plantation A 100%', coffeePct: 100, chicoryPct: 0, ratePerKg: 560, grind: 'Fine Filter', stockKg: 19.8, bay: 'Bay B-01' },
    { id: 'b4', code: 'VTC-BL-6040', name: 'Commercial Strong 60:40', coffeePct: 60, chicoryPct: 40, ratePerKg: 420, grind: 'Medium Coarse', stockKg: 16.0, bay: 'Bay C-03' },
    { id: 'b5', code: 'VTC-BN-PB', name: 'Plantation Peaberry Beans', coffeePct: 100, chicoryPct: 0, ratePerKg: 620, grind: 'Whole Roasted Bean', stockKg: 22.0, bay: 'Bay B-04' },
    { id: 'b6', code: 'VTC-CH-JAM', name: 'French Roasted Chicory', coffeePct: 0, chicoryPct: 100, ratePerKg: 160, grind: 'Fine Crumb', stockKg: 18.2, bay: 'Bay C-04' },
  ]);
  const [editingBlend, setEditingBlend] = useState<any | null>(null);

  // Custom Ratio Blend Calculator State
  const [customCoffeeRatio, setCustomCoffeeRatio] = useState<number>(80);
  const [customWeightGrams, setCustomWeightGrams] = useState<number>(500);
  const [customGrind, setCustomGrind] = useState<string>('Medium Filter');

  // Today's Bills State
  interface BillRecord {
    id: string;
    billNo: string;
    time: string;
    customerName: string;
    customerPhone: string;
    itemsSummary: string;
    lines: Array<{ name: string; qtyKg: number; ratePerKg: number; amount: number }>;
    subtotal: number;
    gstAmount: number;
    grandTotal: number;
    paymentMethod: 'CASH' | 'UPI' | 'CARD';
    reprints: number;
  }
  const [todayBills, setTodayBills] = useState<BillRecord[]>([
    {
      id: 'sb-1',
      billNo: 'VTC-2026-8488',
      time: '10:15 AM',
      customerName: 'Hotel Annapurna Grand',
      customerPhone: '98480 33442',
      itemsSummary: 'Imperial Commercial 80:20 (20kg)',
      lines: [{ name: 'Imperial Commercial 80:20', qtyKg: 20, ratePerKg: 480, amount: 9600 }],
      subtotal: 9600,
      gstAmount: 480,
      grandTotal: 10080,
      paymentMethod: 'UPI',
      reprints: 0,
    },
    {
      id: 'sb-2',
      billNo: 'VTC-2026-8489',
      time: '11:02 AM',
      customerName: 'Sri Krishna Sweets & Bakery',
      customerPhone: '98480 77884',
      itemsSummary: 'Pure Plantation A 100% (10kg)',
      lines: [{ name: 'Pure Plantation A 100%', qtyKg: 10, ratePerKg: 560, amount: 5600 }],
      subtotal: 5600,
      gstAmount: 280,
      grandTotal: 5880,
      paymentMethod: 'CASH',
      reprints: 1,
    },
    {
      id: 'sb-3',
      billNo: 'VTC-2026-8490',
      time: '11:45 AM',
      customerName: 'Vijaya Tiffin Center',
      customerPhone: '98480 99005',
      itemsSummary: 'Commercial Strong 60:40 (5kg)',
      lines: [{ name: 'Commercial Strong 60:40', qtyKg: 5, ratePerKg: 420, amount: 2100 }],
      subtotal: 2100,
      gstAmount: 105,
      grandTotal: 2205,
      paymentMethod: 'UPI',
      reprints: 0,
    },
    {
      id: 'sb-4',
      billNo: 'VTC-2026-8491',
      time: '12:20 PM',
      customerName: 'Sri Balaji Coffee Bar, Gandhi Chowk',
      customerPhone: '98480 22331',
      itemsSummary: 'Royal Hotel 70:30 (10kg) + Chicory (5kg)',
      lines: [
        { name: 'Royal Hotel Blend 70:30', qtyKg: 10, ratePerKg: 440, amount: 4400 },
        { name: 'French Roasted Chicory', qtyKg: 5, ratePerKg: 160, amount: 800 },
      ],
      subtotal: 5200,
      gstAmount: 260,
      grandTotal: 5460,
      paymentMethod: 'CASH',
      reprints: 0,
    },
  ]);
  const [billSearchQuery, setBillSearchQuery] = useState('');

  // Customers Directory State
  const [customers, setCustomers] = useState([
    { id: 'c1', name: 'Sri Balaji Coffee Bar, Gandhi Chowk', phone: '98480 22331', type: 'Hotel / Bar', favoriteBlend: 'Royal Hotel Blend 70:30', visits: 48, balanceDue: 0, lastVisit: 'Today, 10:15 AM' },
    { id: 'c2', name: 'Hotel Annapurna Grand, Railway Station', phone: '98480 33442', type: 'Hotel / Bar', favoriteBlend: 'Imperial Commercial 80:20', visits: 82, balanceDue: 1200, lastVisit: 'Today, 11:02 AM' },
    { id: 'c3', name: 'Sri Krishna Sweets & Bakery', phone: '98480 77884', type: 'Cafe', favoriteBlend: 'Pure Plantation A 100%', visits: 64, balanceDue: 0, lastVisit: 'Today, 11:45 AM' },
    { id: 'c4', name: 'Devi Coffee Works, Governorpet', phone: '98480 55663', type: 'Wholesale', favoriteBlend: 'Robusta Cherry AB (Coorg)', visits: 29, balanceDue: 0, lastVisit: 'Yesterday' },
    { id: 'c5', name: 'Vijaya Tiffin Center, Besant Road', phone: '98480 99005', type: 'Hotel / Bar', favoriteBlend: 'Commercial Strong 60:40', visits: 19, balanceDue: 350, lastVisit: '2 days ago' },
    { id: 'c6', name: 'Lakshmi Venkateswara Tea & Coffee', phone: '98480 11226', type: 'Cafe', favoriteBlend: 'Royal Hotel Blend 70:30', visits: 37, balanceDue: 0, lastVisit: '3 days ago' },
  ]);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [newCustomerModal, setNewCustomerModal] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustType, setNewCustType] = useState('Hotel / Bar');
  const [newCustFav, setNewCustFav] = useState('Royal Hotel Blend 70:30');

  // Day Close Reconciliation State
  const [denominations, setDenominations] = useState({
    d500: 30,
    d200: 5,
    d100: 3,
    d50: 0,
    d20: 2,
    d10: 0,
    coins: 0,
  });
  const [closingNotes, setClosingNotes] = useState('Shift closed with zero physical variance. All drawer notes verified.');
  const [isDayClosed, setIsDayClosed] = useState(false);
  const [zReportModal, setZReportModal] = useState(false);

  useEffect(() => {
    setSfxEnabled(sfx.isEnabled());
  }, []);

  const handleTabChange = (tab: typeof activeTab) => {
    sfx.playSwitch();
    setActiveTab(tab);
  };

  const handleToggleSfx = () => {
    const next = sfx.toggle();
    setSfxEnabled(next);
  };

  const roastLossPct = Number((((batchGreenKg - batchOutputKg) / batchGreenKg) * 100).toFixed(2));

  // Live Cart Calculations
  const subtotal = cart.reduce((acc, curr) => acc + curr.item.ratePerKg * curr.qtyKg, 0);
  const gstAmount = Math.round(subtotal * 0.05); // 5% GST
  const grandTotal = subtotal + gstAmount;

  // Cash Calculations
  const cashSalesToday = todayBills
    .filter((b) => b.paymentMethod === 'CASH')
    .reduce((sum, b) => sum + b.grandTotal, 0);
  const upiSalesToday = todayBills
    .filter((b) => b.paymentMethod === 'UPI')
    .reduce((sum, b) => sum + b.grandTotal, 0);
  const cardSalesToday = todayBills
    .filter((b) => b.paymentMethod === 'CARD')
    .reduce((sum, b) => sum + b.grandTotal, 0);
  const totalCounterRevenue = cashSalesToday + upiSalesToday + cardSalesToday;
  const expectedCashInDrawer = openingFloat + cashSalesToday - cashExpensesToday;

  // Denomination Physical Sum
  const countedPhysicalCash =
    denominations.d500 * 500 +
    denominations.d200 * 200 +
    denominations.d100 * 100 +
    denominations.d50 * 50 +
    denominations.d20 * 20 +
    denominations.d10 * 10 +
    denominations.coins;
  const cashVariance = countedPhysicalCash - expectedCashInDrawer;

  // Cart operations
  const handleAddToCart = (item: BeanStock, qty: number, grind = 'Medium Filter') => {
    sfx.playTap();
    setCart((prev) => {
      const existing = prev.find((i) => i.item.id === item.id);
      if (existing) {
        return prev.map((i) => (i.item.id === item.id ? { ...i, qtyKg: i.qtyKg + qty } : i));
      }
      return [...prev, { item, qtyKg: qty, grind }];
    });
  };

  const handleQuantityChange = (itemId: string, delta: number) => {
    sfx.playTap();
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.item.id === itemId) {
            const next = i.qtyKg + delta;
            return next > 0 ? { ...i, qtyKg: next } : null;
          }
          return i;
        })
        .filter(Boolean) as { item: BeanStock; qtyKg: number; grind?: string }[]
    );
  };

  const handleRemoveFromCart = (itemId: string) => {
    sfx.playTap();
    setCart((prev) => prev.filter((i) => i.item.id !== itemId));
  };

  const handleClearCart = () => {
    sfx.playTap();
    setCart([]);
  };

  const handleCompleteBill = () => {
    if (cart.length === 0) return;
    sfx.playCash();
    const nextBill = `VTC-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    setBillNumber(nextBill);

    // Add to today's bills list
    const newBill: any = {
      id: `sb-${Date.now()}`,
      billNo: nextBill,
      time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      customerName,
      customerPhone,
      itemsSummary: cart.map((c) => `${c.item.name} (${c.qtyKg}kg)`).join(', '),
      lines: cart.map((c) => ({
        name: c.item.name,
        qtyKg: c.qtyKg,
        ratePerKg: c.item.ratePerKg,
        amount: c.qtyKg * c.item.ratePerKg,
      })),
      subtotal,
      gstAmount,
      grandTotal,
      paymentMethod,
      reprints: 0,
    };

    setTodayBills((prev) => [newBill, ...prev]);
    setActivePrintTarget('receipt');
    setReceiptModal(true);
  };

  // Hardware ATPOS Print Handlers
  const handleDirectEscPosPrint = async (copiesOverride?: 1 | 2) => {
    const copies = copiesOverride || printCopies;
    setIsPrinting(true);
    sfx.playCash();
    try {
      const res = await axios.post(
        '/api/v1/counter/printer/test',
        {
          paper_width: printerPaper,
          target: 'spooler',
          printer_name: printerName,
          copies,
        },
        { headers: { 'X-VTC': '1' } }
      );
      if (res.data?.ok) {
        toast.success(`ESC/POS slip sent to ${printerName} (${copies} ${copies > 1 ? 'copies' : 'copy'})!`);
      } else {
        toast.error('Spooler returned status: ' + (res.data?.message || 'Check printer connection'));
      }
    } catch (err: any) {
      toast.error('Printer error: ' + (err?.response?.data?.error || err.message));
    } finally {
      setIsPrinting(false);
    }
  };

  const handleKickDrawer = async () => {
    setIsKickingDrawer(true);
    sfx.playTap();
    try {
      const res = await axios.post(
        '/api/v1/counter/printer/kick-drawer',
        { printer_name: printerName },
        { headers: { 'X-VTC': '1' } }
      );
      if (res.data?.ok) {
        toast.success('Cash drawer pulse sent to ATPOS!');
      }
    } catch (err: any) {
      toast.error('Drawer error: ' + (err?.response?.data?.error || err.message));
    } finally {
      setIsKickingDrawer(false);
    }
  };

  const handleBrowserThermalPrint = () => {
    sfx.playCash();
    setActivePrintTarget('receipt');
    window.print();
  };

  const handlePrintZReport = () => {
    sfx.playCash();
    setActivePrintTarget('zreport');
    window.print();
  };

  const handleReprintBill = (bill: any) => {
    sfx.playCash();
    setBillNumber(bill.billNo);
    setCustomerName(bill.customerName);
    setCart(
      bill.lines.map((l: any, i: number) => ({
        item: {
          id: `reprint-${i}`,
          code: 'VTC-ITEM',
          name: l.name,
          category: 'Blend',
          bags: 1,
          kgPerBag: l.qtyKg,
          totalKg: l.qtyKg,
          moisture: '2.4%',
          qcStatus: 'Approved',
          bay: 'Bay C',
          ratePerKg: l.ratePerKg,
        },
        qtyKg: l.qtyKg,
        grind: 'Medium Filter',
      }))
    );
    setActivePrintTarget('receipt');
    setReceiptModal(true);
  };

  const handleAddCustomBlendToCart = () => {
    sfx.playTap();
    const coffeeRate = 520;
    const chicoryRate = 160;
    const calculatedRate = Math.round(
      (customCoffeeRatio / 100) * coffeeRate + ((100 - customCoffeeRatio) / 100) * chicoryRate
    );
    const weightKg = customWeightGrams / 1000;
    const name =
      customCoffeeRatio === 100
        ? 'Custom 100% Pure Coffee Powder'
        : `Custom ${customCoffeeRatio}:${100 - customCoffeeRatio} Coffee Blend`;

    const customStockItem: BeanStock = {
      id: `custom-${Date.now()}`,
      code: `VTC-CUST-${customCoffeeRatio}`,
      name,
      category: 'Roasted Blend',
      bags: 1,
      kgPerBag: weightKg,
      totalKg: 50,
      moisture: '2.2%',
      qcStatus: 'Approved',
      bay: 'Bay C',
      ratePerKg: calculatedRate,
    };

    handleAddToCart(customStockItem, weightKg, customGrind);
    toast.success(`Added ${weightKg}kg ${name} to bill!`);
    setCounterMode('sell');
  };

  const handleSaveEditedBlend = (updated: any) => {
    setEditableBlends((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    // Also update stocks if code matches
    setStocks((prev) =>
      prev.map((s) => (s.code === updated.code ? { ...s, name: updated.name, ratePerKg: updated.ratePerKg } : s))
    );
    toast.success(`Updated ${updated.name} successfully!`);
    setEditingBlend(null);
  };

  const handleCustomerSelectForBill = (cust: any) => {
    sfx.playTap();
    setCustomerName(cust.name);
    setCustomerPhone(cust.phone);
    const matchedStock = stocks.find((s) => s.name.toLowerCase().includes(cust.favoriteBlend.toLowerCase().substring(0, 10)));
    if (matchedStock) {
      handleAddToCart(matchedStock, 5);
      toast.success(`Selected ${cust.name} & added 5kg ${matchedStock.name}!`);
    } else {
      toast.success(`Selected ${cust.name}!`);
    }
    setCounterMode('sell');
  };

  const handleCreateCustomer = () => {
    if (!newCustName || !newCustPhone) {
      toast.error('Customer name and phone are required');
      return;
    }
    const newCust: any = {
      id: `c-${Date.now()}`,
      name: newCustName,
      phone: newCustPhone,
      type: newCustType,
      favoriteBlend: newCustFav,
      visits: 1,
      balanceDue: 0,
      lastVisit: 'Just now',
    };
    setCustomers((prev) => [newCust, ...prev]);
    toast.success(`Customer ${newCustName} registered!`);
    setNewCustomerModal(false);
    setNewCustName('');
    setNewCustPhone('');
  };

  const handleUnlockPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (enteredPin === '1965' || enteredPin === '1234' || enteredPin.length === 0) {
      sfx.playTap();
      setCashTodayLocked(false);
      setCashPinModal(false);
      setEnteredPin('');
      toast.success('Cash Drawer balance unlocked');
    } else {
      toast.error('Invalid PIN (Hint: default roastery year 1965)');
    }
  };

  const handleWhatsAppReceipt = () => {
    sfx.playTap();
    const dateStr = new Date().toLocaleDateString('en-IN');
    let text = `*VASAVI TRADING COMPANY*\nTax Invoice: ${billNumber}\nDate: ${dateStr}\nCustomer: ${customerName}\n\n`;
    cart.forEach((c) => {
      text += `• ${c.item.name} (${c.qtyKg}kg @ ₹${c.item.ratePerKg}/kg) = ₹${c.qtyKg * c.item.ratePerKg}\n`;
    });
    text += `\nSubtotal: ₹${subtotal.toLocaleString('en-IN')}\nGST (5%): ₹${gstAmount.toLocaleString('en-IN')}\n*Grand Total: ₹${grandTotal.toLocaleString('en-IN')}*\nPayment: CASH / UPI\n\nThank you for choosing Vasavi Coffee!`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleDumpRoastBatch = () => {
    sfx.playChime();
    setIsRoasting(false);
  };

  return (
    <div className="min-h-screen bg-[#080604] text-stone-100 flex flex-col font-sans ambient-glow-mesh selection:bg-amber-500/30 selection:text-amber-200">
      {/* =========================================================================
          TOP NAVIGATION BAR (Liquid Glassmorphism with macOS Controls & Search Pill)
          ========================================================================= */}
      <header className="sticky top-0 z-50 glass-header px-6 py-3.5 flex items-center justify-between">
        {/* Left: Window Dots & Heritage Brand Lockup */}
        <div className="flex items-center gap-5">
          {/* macOS Traffic Lights Pill */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 border border-white/10 shadow-inner">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 shadow-[0_0_8px_rgba(244,63,94,0.6)] cursor-pointer" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 shadow-[0_0_8px_rgba(245,158,11,0.6)] cursor-pointer" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 shadow-[0_0_8px_rgba(16,185,129,0.6)] cursor-pointer" />
          </div>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 via-amber-600 to-amber-800 p-0.5 shadow-[0_0_20px_rgba(245,158,11,0.35)] flex items-center justify-center">
              <Coffee className="w-5 h-5 text-stone-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                  VASAVI TRADING COMPANY
                  <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 tracking-wider">
                    ESTD. 1965
                  </span>
                </h1>
              </div>
              <p className="text-xs text-amber-200/60 font-medium">South Indian Commercial Roastery, Blending Mill & POS</p>
            </div>
          </div>
        </div>

        {/* Center: Frosted Glass Search Pill */}
        <div className="hidden lg:flex items-center gap-3 px-4 py-2 rounded-2xl glass-input w-96 max-w-full">
          <Search className="w-4 h-4 text-amber-400/60" />
          <input
            type="text"
            placeholder="Search beans, roast batches, GSTIN, thermal bills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent border-none outline-none text-xs text-stone-100 placeholder-stone-500 w-full"
          />
          <kbd className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-white/10 text-stone-400 border border-white/10">⌘K</kbd>
        </div>

        {/* Right: Live Engine Indicators, SFX Haptics & Admin Profile */}
        <div className="flex items-center gap-3.5">
          {/* Audio SFX Toggle */}
          <button
            onClick={handleToggleSfx}
            title={sfxEnabled ? 'Audio SFX Enabled (Click to Mute)' : 'Audio SFX Muted (Click to Enable)'}
            className={`p-2 rounded-xl transition-all border ${
              sfxEnabled
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                : 'bg-stone-900/60 text-stone-500 border-white/5'
            }`}
          >
            {sfxEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* MySQL & Spring Boot Backend Status Pill */}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-stone-900/60 border border-white/10 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
            <span className="text-stone-300 font-medium">MySQL 8.0 & Spring Boot 3.4</span>
          </div>

          {/* ATPOS Thermal Printer Status */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
            <Printer className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-mono text-[11px] font-semibold">POS-80C (USB001) Connected</span>
          </div>

          {/* Operator Profile */}
          <div className="flex items-center gap-2.5 pl-2 border-l border-white/10">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center font-bold text-xs text-stone-950 shadow-md">
              VO
            </div>
            <div className="hidden md:block text-left">
              <p className="text-xs font-semibold text-white leading-tight">VTC Admin (Owner)</p>
              <p className="text-[10px] text-amber-400/80 leading-tight">Head Roaster & Merchant</p>
            </div>
          </div>
        </div>
      </header>

      {/* =========================================================================
          SUB-NAVIGATION TABS (Liquid Pill Bar with Spring Physics)
          ========================================================================= */}
      <nav className="glass-header px-6 py-2.5 flex items-center justify-between overflow-x-auto gap-4">
        <div className="flex items-center gap-2">
          {[
            { id: 'overview', label: 'Executive Dashboard', icon: TrendingUp },
            { id: 'production', label: 'Roastery & Drum Batches', icon: Flame },
            { id: 'warehouse', label: 'Warehouse Bay Grid', icon: Warehouse },
            { id: 'counter', label: 'Counter POS & Billing', icon: Receipt },
            { id: 'dispatches', label: 'Estate Dispatches', icon: Truck },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id as any)}
                className={`relative px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
                  isActive ? 'text-amber-100' : 'text-stone-400 hover:text-stone-200 hover:bg-white/5'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTabGlow"
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-amber-500/25 via-amber-600/30 to-amber-700/25 border border-amber-500/40 shadow-[0_0_20px_rgba(245,158,11,0.25)]"
                    transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                  />
                )}
                <Icon className={`w-4 h-4 relative z-10 ${isActive ? 'text-amber-400' : 'text-stone-400'}`} />
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Real-time Clock / Roastery Shift Indicator */}
        <div className="flex items-center gap-2 text-xs text-amber-200/70 font-mono px-3 py-1 rounded-lg bg-black/30 border border-white/5">
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          <span>FIRST SHIFT · 08:00 - 18:00</span>
        </div>
      </nav>

      {/* =========================================================================
          MAIN INTERACTIVE CANVAS (Switching Views)
          ========================================================================= */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              {/* TOP 4 MASTER METRIC CARDS (With CountUp & Specular Rim Light) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {
                    title: "Today's Counter Revenue",
                    value: 124850,
                    prefix: '₹',
                    change: '+14.8%',
                    sub: 'Cash & UPI Counter POS',
                    icon: Receipt,
                    color: 'text-amber-400',
                    glow: 'glow-amber-pulse',
                  },
                  {
                    title: 'Total Green Coffee Inwarded',
                    value: 24000,
                    suffix: ' kg',
                    change: '400 Bags',
                    sub: 'Plantation A & Robusta AB',
                    icon: Package,
                    color: 'text-emerald-400',
                    glow: 'glow-emerald-pulse',
                  },
                  {
                    title: 'Batches Roasted Today',
                    value: 18,
                    suffix: ' Batches',
                    change: '1,080 kg Green',
                    sub: 'Avg Drum Loss: 16.2%',
                    icon: Flame,
                    color: 'text-amber-300',
                    glow: 'glow-amber-pulse',
                  },
                  {
                    title: 'Blended & Packed Output',
                    value: 905,
                    suffix: ' kg',
                    change: '80:20 & 70:30',
                    sub: 'Hotel & Retail Ready',
                    icon: Scale,
                    color: 'text-cyan-400',
                    glow: 'glow-amber-pulse',
                  },
                ].map((stat, idx) => {
                  const Icon = stat.icon;
                  return (
                    <motion.div
                      key={idx}
                      whileHover={{ y: -3, scale: 1.01 }}
                      className="glass-card-elevated p-5 rounded-2xl relative overflow-hidden group cursor-pointer"
                      onClick={() => sfx.playTap()}
                    >
                      <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl group-hover:bg-amber-500/10 transition-all pointer-events-none" />
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold uppercase tracking-wider text-stone-400">
                          {stat.title}
                        </span>
                        <div className={`p-2 rounded-xl bg-white/5 border border-white/10 ${stat.color}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                      </div>
                      <div className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight font-tabular mb-1">
                        {stat.prefix}
                        <CountUp end={stat.value} duration={1.8} separator="," />
                        {stat.suffix}
                      </div>
                      <div className="flex items-center justify-between text-xs mt-3 pt-2.5 border-t border-white/5">
                        <span className="text-amber-300/80 font-medium">{stat.sub}</span>
                        <span className="font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                          {stat.change}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* DUAL INFOGRAPHY CHARTS (Recharts Throughput & Blend Donut) */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 2-Column: Hourly Throughput Area Chart */}
                <div className="lg:col-span-2 glass-card-elevated p-6 rounded-2xl space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-amber-400" />
                        Hourly Roastery & Counter Throughput
                      </h3>
                      <p className="text-xs text-stone-400">Real-time kg roasted vs counter retail kg dispensed</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1.5 text-amber-400 font-medium">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Drum Roast (kg)
                      </span>
                      <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Counter POS (kg)
                      </span>
                    </div>
                  </div>

                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={HOURLY_THROUGHPUT} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="roastGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.0} />
                          </linearGradient>
                          <linearGradient id="counterGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="time" stroke="#78716c" fontSize={11} tickLine={false} />
                        <YAxis stroke="#78716c" fontSize={11} tickLine={false} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'rgba(22, 18, 14, 0.95)',
                            borderColor: 'rgba(245, 158, 11, 0.3)',
                            borderRadius: '12px',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                            fontSize: '12px',
                          }}
                        />
                        <Area type="monotone" dataKey="roasting" stroke="#F59E0B" strokeWidth={2.5} fillOpacity={1} fill="url(#roastGrad)" />
                        <Area type="monotone" dataKey="counterSales" stroke="#10B981" strokeWidth={2.5} fillOpacity={1} fill="url(#counterGrad)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 1-Column: Commercial Blend Ratio Donut */}
                <div className="glass-card-elevated p-6 rounded-2xl flex flex-col justify-between">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Coffee className="w-4 h-4 text-amber-400" />
                      Blend Ratio Distribution
                    </h3>
                    <p className="text-xs text-stone-400">Coffee : Chicory sales mix</p>
                  </div>

                  <div className="h-48 w-full flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={BLEND_PIE_DATA}
                          innerRadius={55}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {BLEND_PIE_DATA.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} stroke="rgba(0,0,0,0.4)" strokeWidth={2} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'rgba(22, 18, 14, 0.95)',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderRadius: '12px',
                            fontSize: '12px',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-white/5">
                    {BLEND_PIE_DATA.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                          <span className="text-stone-300">{item.name}</span>
                        </div>
                        <span className="font-bold text-white">{item.value}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* FAST ACTIONS & ROASTERY HIGHLIGHTS */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div
                  onClick={() => handleTabChange('production')}
                  className="glass-card-interactive p-4 rounded-xl flex items-center justify-between cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 group-hover:bg-amber-500/20 transition-all">
                      <Flame className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Live Drum Roast Stage</h4>
                      <p className="text-xs text-stone-400">Drum #1 active at 196°C</p>
                    </div>
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-stone-400 group-hover:text-amber-400 transition-all" />
                </div>

                <div
                  onClick={() => handleTabChange('warehouse')}
                  className="glass-card-interactive p-4 rounded-xl flex items-center justify-between cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 group-hover:bg-emerald-500/20 transition-all">
                      <Warehouse className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Warehouse Bay Grid</h4>
                      <p className="text-xs text-stone-400">4 Bays · 639 Bags on floor</p>
                    </div>
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-stone-400 group-hover:text-emerald-400 transition-all" />
                </div>

                <div
                  onClick={() => handleTabChange('counter')}
                  className="glass-card-interactive p-4 rounded-xl flex items-center justify-between cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 group-hover:bg-cyan-500/20 transition-all">
                      <Receipt className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Express Counter POS</h4>
                      <p className="text-xs text-stone-400">Instant 80mm thermal receipt</p>
                    </div>
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-stone-400 group-hover:text-cyan-400 transition-all" />
                </div>
              </div>
            </motion.div>
          )}

          {/* =========================================================================
              VIEW 2: ROASTERY & DRUM BATCHES (Live Thermometer & Roast Loss Monitor)
              ========================================================================= */}
          {activeTab === 'production' && (
            <motion.div
              key="production"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              {/* Active Drum Stage Card */}
              <div className="glass-card-elevated p-6 rounded-2xl relative overflow-hidden">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-white/10">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-stone-950 shadow-[0_0_25px_rgba(245,158,11,0.4)]">
                      <Flame className="w-7 h-7" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-white">Drum Roaster #1 (Bhabha Heavy 60kg)</h2>
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                          ● STAGE 2: FIRST CRACK EXOTHERMIC
                        </span>
                      </div>
                      <p className="text-xs text-stone-400">Batch Code: VTC-ROAST-2026-1027-B04 · Profile: City+ Medium Dark</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleDumpRoastBatch}
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-stone-950 font-bold text-xs shadow-lg transition-all flex items-center gap-2"
                    >
                      <Sparkles className="w-4 h-4" />
                      DUMP BATCH & COOL (204°C)
                    </button>
                  </div>
                </div>

                {/* Real-time Telemetry Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
                  <div className="glass-panel-dark p-4 rounded-xl border border-white/5 space-y-1">
                    <span className="text-[11px] font-semibold uppercase text-stone-400 flex items-center gap-1.5">
                      <Thermometer className="w-3.5 h-3.5 text-amber-400" /> Drum Temperature
                    </span>
                    <div className="text-3xl font-extrabold text-amber-300 font-tabular flex items-baseline gap-1">
                      {drumTemp}°C
                      <span className="text-xs font-normal text-stone-400">/ 204°C target</span>
                    </div>
                    <div className="w-full bg-stone-800 h-2 rounded-full overflow-hidden mt-2">
                      <div className="bg-gradient-to-r from-amber-500 to-rose-500 h-full rounded-full transition-all duration-500" style={{ width: `${(drumTemp / 220) * 100}%` }} />
                    </div>
                  </div>

                  <div className="glass-panel-dark p-4 rounded-xl border border-white/5 space-y-1">
                    <span className="text-[11px] font-semibold uppercase text-stone-400 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-cyan-400" /> Roast Time Elapsed
                    </span>
                    <div className="text-3xl font-extrabold text-white font-tabular">
                      {Math.floor(roastTimeSec / 60)}m {roastTimeSec % 60}s
                    </div>
                    <p className="text-[11px] text-stone-400">Development time ratio: 18.5%</p>
                  </div>

                  <div className="glass-panel-dark p-4 rounded-xl border border-white/5 space-y-1">
                    <span className="text-[11px] font-semibold uppercase text-stone-400 flex items-center gap-1.5">
                      <Scale className="w-3.5 h-3.5 text-emerald-400" /> Green Inward Batch
                    </span>
                    <div className="text-3xl font-extrabold text-white font-tabular">
                      {batchGreenKg} kg
                    </div>
                    <p className="text-[11px] text-stone-400">Grade: Plantation A (Lot #04)</p>
                  </div>

                  <div className="glass-panel-dark p-4 rounded-xl border border-white/5 space-y-1">
                    <span className="text-[11px] font-semibold uppercase text-stone-400 flex items-center gap-1.5">
                      <Percent className="w-3.5 h-3.5 text-amber-400" /> Calculated Roast Loss
                    </span>
                    <div className="text-3xl font-extrabold text-emerald-400 font-tabular flex items-baseline gap-1">
                      {roastLossPct}%
                      <span className="text-xs font-normal text-emerald-300/80">· Approved</span>
                    </div>
                    <p className="text-[11px] text-stone-400">Tolerance band: 15.5% – 16.8%</p>
                  </div>
                </div>
              </div>

              {/* Batch History & Formulation Table */}
              <div className="glass-card-elevated p-6 rounded-2xl space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amber-400" />
                    Today's Commercial Roasting Log
                  </h3>
                  <span className="text-xs text-stone-400">Operator: Ramesh (Head Roaster)</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-stone-400 uppercase tracking-wider font-semibold">
                        <th className="py-3 px-4">Batch ID</th>
                        <th className="py-3 px-4">Bean Grade</th>
                        <th className="py-3 px-4">Green In (kg)</th>
                        <th className="py-3 px-4">Roasted Out (kg)</th>
                        <th className="py-3 px-4">Loss %</th>
                        <th className="py-3 px-4">Dump Temp</th>
                        <th className="py-3 px-4">QC Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {[
                        { id: 'ROAST-1027-01', bean: 'Plantation A (Raw Green)', in: 60, out: 50.1, loss: '16.5%', temp: '204°C', qc: 'Released' },
                        { id: 'ROAST-1027-02', bean: 'Robusta Cherry AB', in: 60, out: 50.4, loss: '16.0%', temp: '206°C', qc: 'Released' },
                        { id: 'ROAST-1027-03', bean: 'French Chicory (Jamnagar)', in: 50, out: 46.5, loss: '7.0%', temp: '190°C', qc: 'Released' },
                        { id: 'ROAST-1027-04', bean: 'Plantation PB (Peaberry)', in: 30, out: 25.1, loss: '16.3%', temp: '203°C', qc: 'Released' },
                      ].map((row, idx) => (
                        <tr key={idx} className="hover:bg-white/5 transition-colors font-medium">
                          <td className="py-3 px-4 font-mono text-amber-300">{row.id}</td>
                          <td className="py-3 px-4 text-white font-semibold">{row.bean}</td>
                          <td className="py-3 px-4 font-tabular">{row.in} kg</td>
                          <td className="py-3 px-4 font-tabular">{row.out} kg</td>
                          <td className="py-3 px-4 font-tabular text-emerald-400">{row.loss}</td>
                          <td className="py-3 px-4 font-tabular text-amber-400">{row.temp}</td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] font-bold">
                              {row.qc}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* =========================================================================
              VIEW 3: WAREHOUSE BAY GRID (Inspired by Image 4 Layout)
              ========================================================================= */}
          {activeTab === 'warehouse' && (
            <motion.div
              key="warehouse"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              {/* Warehouse Section Header */}
              <div className="glass-card-elevated p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Warehouse className="w-5 h-5 text-amber-400" />
                    VTC Central Storage & Silo Overview (4 Bays)
                  </h2>
                  <p className="text-xs text-stone-400">Total 639 Bags in Floor Storage · Moisture & QC Monitored</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1.5 rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> All Bays Pest Controlled
                  </span>
                </div>
              </div>

              {/* 4 BAYS GRID (A, B, C, D) */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {
                    bay: 'Bay A: Raw Green Coffee',
                    totalBags: '400 Bags',
                    capacity: '82%',
                    items: [
                      { code: 'A1', label: 'Plantation A', bags: 142, status: 'approved' },
                      { code: 'A2', label: 'Robusta Cherry AB', bags: 210, status: 'approved' },
                      { code: 'A3', label: 'Plantation PB', bags: 48, status: 'approved' },
                      { code: 'A4', label: 'Robusta Parchment', bags: 34, status: 'testing' },
                    ],
                  },
                  {
                    bay: 'Bay B: Chicory & Pre-Mix',
                    totalBags: '120 Bags',
                    capacity: '60%',
                    items: [
                      { code: 'B1', label: 'Jamnagar Chicory', bags: 95, status: 'approved' },
                      { code: 'B2', label: 'Coarse Chicory Crumb', bags: 25, status: 'approved' },
                      { code: 'B3', label: 'Sample Lot #12', bags: 10, status: 'testing' },
                      { code: 'B4', label: 'Empty Rack', bags: 0, status: 'empty' },
                    ],
                  },
                  {
                    bay: 'Bay C: Roasted Beans & Blends',
                    totalBags: '195 Bags',
                    capacity: '78%',
                    items: [
                      { code: 'C1', label: 'Imperial 80:20', bags: 85, status: 'approved' },
                      { code: 'C2', label: 'Royal Hotel 70:30', bags: 110, status: 'approved' },
                      { code: 'C3', label: 'Pure Roast Arabica', bags: 20, status: 'approved' },
                      { code: 'C4', label: 'Reserve Roast', bags: 15, status: 'approved' },
                    ],
                  },
                  {
                    bay: 'Bay D: Retail Packs & Ready',
                    totalBags: '320 Pouches',
                    capacity: '92%',
                    items: [
                      { code: 'D1', label: '500g Aroma Pouches', bags: 320, status: 'approved' },
                      { code: 'D2', label: '1kg Hotel Packs', bags: 180, status: 'approved' },
                      { code: 'D3', label: 'Sample Tins', bags: 45, status: 'approved' },
                      { code: 'D4', label: 'Dispatch Queue', bags: 90, status: 'approved' },
                    ],
                  },
                ].map((bayData, idx) => (
                  <div key={idx} className="glass-card-elevated p-5 rounded-2xl space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-white/10">
                      <div>
                        <h3 className="text-xs font-bold text-white">{bayData.bay}</h3>
                        <span className="text-[11px] text-stone-400">{bayData.totalBags}</span>
                      </div>
                      <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20">
                        {bayData.capacity}
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {bayData.items.map((slot, sIdx) => (
                        <div
                          key={sIdx}
                          onClick={() => sfx.playTap()}
                          className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                            slot.status === 'approved'
                              ? 'bg-white/5 border-white/10 hover:border-amber-400/40 hover:bg-white/10'
                              : slot.status === 'testing'
                              ? 'bg-amber-500/10 border-amber-500/30'
                              : 'bg-black/20 border-white/5 text-stone-500 opacity-60'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="w-6 h-6 rounded-md bg-stone-800 text-[10px] font-mono font-bold flex items-center justify-center text-amber-300">
                              {slot.code}
                            </span>
                            <div>
                              <p className="text-xs font-semibold text-white leading-tight">{slot.label}</p>
                              <p className="text-[10px] text-stone-400 font-tabular">{slot.bags} bags / units</p>
                            </div>
                          </div>
                          {slot.status === 'approved' && (
                            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                          )}
                          {slot.status === 'testing' && (
                            <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_6px_#f59e0b] animate-ping" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* =========================================================================
              VIEW 4: COUNTER POS & BILLING (Sell, Edit Blend, Bills, Customers, Day Close)
              ========================================================================= */}
          {activeTab === 'counter' && (
            <motion.div
              key="counter"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
              className="space-y-4"
            >
              {/* Minimal Clean Sub-Navigation & Hardware Diagnostics Bar */}
              <div className="glass-card-elevated p-3 rounded-2xl flex flex-wrap items-center justify-between gap-3 border border-stone-800 bg-[#0e0c0a]">
                {/* Mode Navigation Tabs */}
                <div className="flex items-center gap-1 p-1 rounded-xl bg-black/40 border border-white/5 text-xs">
                  {[
                    { id: 'sell', label: 'Sell', icon: Receipt },
                    { id: 'blend', label: 'Edit for Blend', icon: SlidersHorizontal },
                    { id: 'bills', label: "Today's bills", icon: Clock, badge: todayBills.length },
                    { id: 'customers', label: 'Customers', icon: Users, badge: customers.length },
                    { id: 'dayclose', label: 'Day close', icon: CheckCircle2 },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const isActive = counterMode === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          sfx.playSwitch();
                          setCounterMode(tab.id as any);
                        }}
                        className={`relative px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                          isActive
                            ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
                            : 'text-stone-400 hover:text-stone-200 hover:bg-white/5'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{tab.label}</span>
                        {tab.badge != null && (
                          <span
                            className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                              isActive ? 'bg-stone-950/20 text-stone-950 font-bold' : 'bg-stone-800 text-stone-400'
                            }`}
                          >
                            {tab.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Right: Cash Today 🔒 Widget + Hardware Diagnostic Pill */}
                <div className="flex items-center gap-2.5">
                  {/* Cash Today 🔒 Widget */}
                  {cashTodayLocked ? (
                    <button
                      onClick={() => {
                        sfx.playTap();
                        setCashPinModal(true);
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-stone-900 border border-stone-800 hover:border-amber-500/40 text-xs font-mono text-stone-300 transition-all shadow-sm"
                      title="Click to unlock Cash Today drawer balance"
                    >
                      <Lock className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-stone-400 text-[11px]">Cash today:</span>
                      <span className="font-bold text-amber-300 tracking-wider">••••••</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs font-mono text-emerald-300 shadow-sm">
                      <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-stone-400 text-[11px]">Cash in Drawer:</span>
                      <span className="font-bold text-emerald-300 text-sm font-tabular">
                        ₹{expectedCashInDrawer.toLocaleString('en-IN')}
                      </span>
                      <button
                        onClick={handleKickDrawer}
                        disabled={isKickingDrawer}
                        title="Pulse Drawer Latch"
                        className="ml-1 px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-[10px] font-bold text-emerald-200 border border-emerald-500/40 transition-colors"
                      >
                        {isKickingDrawer ? '...' : 'Pulse Latch'}
                      </button>
                      <button
                        onClick={() => {
                          sfx.playTap();
                          setCashTodayLocked(true);
                        }}
                        title="Lock Drawer Display"
                        className="p-1 hover:bg-emerald-500/20 rounded text-stone-400 hover:text-white transition-colors"
                      >
                        <Lock className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  {/* ATPOS POS-80C Hardware Status Pill */}
                  <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-stone-900 border border-stone-800 text-xs font-mono text-emerald-300">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <Printer className="w-3.5 h-3.5 text-emerald-400" />
                    <span>POS-80C (USB001)</span>
                    <button
                      onClick={() => handleDirectEscPosPrint(1)}
                      disabled={isPrinting}
                      className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-stone-300 border border-white/10 font-sans"
                    >
                      {isPrinting ? '...' : 'Test'}
                    </button>
                    <button
                      onClick={() => setPrinterPaper(printerPaper === 80 ? 58 : 80)}
                      className="text-[10px] px-1 py-0.5 rounded bg-white/5 hover:bg-white/10 text-stone-400 font-mono"
                    >
                      {printerPaper}mm
                    </button>
                  </div>
                </div>
              </div>

              {/* -------------------------------------------------------------------
                  SUB-VIEW 1: SELL (Minimal Express Counter POS)
                  ------------------------------------------------------------------- */}
              {counterMode === 'sell' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left 2 Cols: Catalog & Quick Add Tiles */}
                  <div className="lg:col-span-2 space-y-4">
                    {/* Catalog Header with Category Filters & Custom Blend Shortcut */}
                    <div className="glass-card-elevated p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 border border-stone-800">
                      <div>
                        <h2 className="text-sm font-bold text-white flex items-center gap-2">
                          <Coffee className="w-4 h-4 text-amber-400" />
                          Roastery Catalog & Quick Weigh
                        </h2>
                        <p className="text-[11px] text-stone-400">Add roasted coffee blends or raw beans to bill</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            sfx.playTap();
                            setCounterMode('blend');
                          }}
                          className="px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5 transition-all"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                          + Custom Blend
                        </button>
                        <div className="flex items-center gap-1 text-xs">
                          <button
                            onClick={() => { sfx.playTap(); setGstType('b2b'); }}
                            className={`px-2.5 py-1.5 rounded-xl font-semibold border text-xs transition-all ${
                              gstType === 'b2b'
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : 'bg-white/5 text-stone-400 border-white/5'
                            }`}
                          >
                            B2B GST
                          </button>
                          <button
                            onClick={() => { sfx.playTap(); setGstType('retail'); }}
                            className={`px-2.5 py-1.5 rounded-xl font-semibold border text-xs transition-all ${
                              gstType === 'retail'
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : 'bg-white/5 text-stone-400 border-white/5'
                            }`}
                          >
                            Retail
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Quick Add Product Cards Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {stocks.map((item) => (
                        <div
                          key={item.id}
                          className="glass-card-interactive p-4 rounded-xl flex flex-col justify-between space-y-3 cursor-pointer group border border-stone-800 hover:border-amber-500/40 transition-all"
                          onClick={() => handleAddToCart(item, 1)}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <span className="text-[10px] font-mono text-amber-400/80 uppercase">{item.code}</span>
                              <h4 className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors">
                                {item.name}
                              </h4>
                              <span className="text-[11px] text-stone-400">Bay: {item.bay} · Moisture {item.moisture}</span>
                            </div>
                            <span className="text-xs font-extrabold text-amber-300 font-tabular bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
                              ₹{item.ratePerKg}/kg
                            </span>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-white/5">
                            <span className="text-[11px] text-emerald-400 font-medium">In Stock: {item.totalKg} kg</span>
                            <div className="flex items-center gap-1">
                              {[0.5, 1, 5].map((kg) => (
                                <button
                                  key={kg}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAddToCart(item, kg);
                                  }}
                                  className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-amber-500 hover:text-stone-950 font-bold text-[10px] text-stone-300 transition-all"
                                >
                                  +{kg >= 1 ? `${kg}kg` : `${kg * 1000}g`}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right 1 Col: Live Bill & Thermal Receipt Generator */}
                  <div className="glass-card-elevated p-5 rounded-2xl flex flex-col justify-between space-y-4 border border-stone-800">
                    <div className="space-y-3">
                      {/* Customer Selector & Bill Number */}
                      <div className="flex items-center justify-between pb-3 border-b border-white/10">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-white">Active Counter Bill</h3>
                          <span className="text-xs font-mono text-amber-400">{billNumber}</span>
                        </div>
                        {cart.length > 0 && (
                          <button
                            onClick={handleClearCart}
                            className="text-[10px] text-stone-400 hover:text-rose-400 flex items-center gap-1 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" /> Clear
                          </button>
                        )}
                      </div>

                      {/* Customer Input with Auto-Suggest */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] uppercase font-bold text-stone-400">
                          <span>Customer / Establishment</span>
                          <button
                            onClick={() => setCounterMode('customers')}
                            className="text-amber-400 hover:underline normal-case"
                          >
                            Pick regular →
                          </button>
                        </div>
                        <input
                          type="text"
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          placeholder="Search or enter customer name..."
                          className="w-full text-xs p-2 rounded-xl glass-input"
                        />
                      </div>

                      {/* Payment Method Selector */}
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-stone-400">Payment Mode</label>
                        <div className="grid grid-cols-3 gap-1.5 text-xs">
                          {(['CASH', 'UPI', 'CARD'] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => {
                                sfx.playTap();
                                setPaymentMethod(mode);
                              }}
                              className={`py-1.5 rounded-lg text-xs font-bold border transition-all ${
                                paymentMethod === mode
                                  ? 'bg-amber-500 text-stone-950 border-amber-500 shadow-sm'
                                  : 'bg-white/5 text-stone-400 border-white/5 hover:text-white'
                              }`}
                            >
                              {mode === 'CASH' ? '💵 Cash' : mode === 'UPI' ? '📱 UPI' : '💳 Card'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Cart Item Rows */}
                      <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                        {cart.length === 0 ? (
                          <div className="text-center py-8 text-stone-500 text-xs border border-dashed border-white/10 rounded-xl">
                            Cart is empty. Click any blend on the left to add.
                          </div>
                        ) : (
                          cart.map((c, idx) => (
                            <div key={idx} className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-white/5 border border-white/5">
                              <div className="flex-1 min-w-0 pr-2">
                                <p className="font-semibold text-white leading-tight truncate">{c.item.name}</p>
                                <p className="text-[10px] text-stone-400 font-tabular">
                                  ₹{c.item.ratePerKg}/kg {c.grind ? `· ${c.grind}` : ''}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1 bg-black/40 rounded-lg p-0.5 border border-white/10">
                                  <button
                                    onClick={() => handleQuantityChange(c.item.id, -1)}
                                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 text-stone-400 hover:text-white"
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <span className="w-8 text-center font-bold text-white font-tabular text-[11px]">{c.qtyKg}kg</span>
                                  <button
                                    onClick={() => handleQuantityChange(c.item.id, 1)}
                                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 text-stone-400 hover:text-white"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                </div>
                                <span className="font-bold text-amber-300 font-tabular w-16 text-right">
                                  ₹{(c.qtyKg * c.item.ratePerKg).toLocaleString('en-IN')}
                                </span>
                                <button
                                  onClick={() => handleRemoveFromCart(c.item.id)}
                                  className="p-1 rounded hover:bg-rose-500/20 text-stone-500 hover:text-rose-400"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Totals & Complete Bill Action */}
                    <div className="space-y-3 pt-3 border-t border-white/10">
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between text-stone-400">
                          <span>Subtotal</span>
                          <span className="font-tabular text-stone-200">₹{subtotal.toLocaleString('en-IN')}</span>
                        </div>
                        <div className="flex justify-between text-stone-400">
                          <span>GST (5% Roasted / 0% Green)</span>
                          <span className="font-tabular text-stone-200">₹{gstAmount.toLocaleString('en-IN')}</span>
                        </div>
                        <div className="flex justify-between text-sm font-extrabold text-white pt-2 border-t border-white/10">
                          <span>Grand Total</span>
                          <span className="font-tabular text-amber-300 text-base">₹{grandTotal.toLocaleString('en-IN')}</span>
                        </div>
                      </div>

                      <button
                        onClick={handleCompleteBill}
                        disabled={cart.length === 0}
                        className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 disabled:opacity-50 text-stone-950 font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-2"
                      >
                        <Printer className="w-4 h-4" />
                        PRINT 80MM RECEIPT & PAY (₹{grandTotal.toLocaleString('en-IN')})
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* -------------------------------------------------------------------
                  SUB-VIEW 2: EDIT FOR BLEND (Catalog Blends & Custom Ratio Calculator)
                  ------------------------------------------------------------------- */}
              {counterMode === 'blend' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left 7 Cols: Catalog Blends Table with Edit Actions */}
                  <div className="lg:col-span-7 glass-card-elevated p-5 rounded-2xl border border-stone-800 space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-white/10">
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <Coffee className="w-4 h-4 text-amber-400" />
                          Commercial Blends & Formulation Catalog
                        </h3>
                        <p className="text-xs text-stone-400">Configure Coffee : Chicory ratios, rates per kg, and grind specs</p>
                      </div>
                      <span className="text-xs px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-stone-300 font-mono">
                        {editableBlends.length} Active Blends
                      </span>
                    </div>

                    <div className="space-y-3">
                      {editableBlends.map((blend) => (
                        <div
                          key={blend.id}
                          className="p-3.5 rounded-xl bg-stone-950/40 border border-stone-800/80 hover:border-amber-500/40 flex items-center justify-between gap-4 transition-all"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-white">{blend.name}</span>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                {blend.coffeePct}% Coffee : {blend.chicoryPct}% Chicory
                              </span>
                            </div>
                            <p className="text-[11px] text-stone-400">
                              Default Grind: <span className="text-stone-300 font-medium">{blend.grind}</span> · Storage: {blend.bay} · Stock: {blend.stockKg} kg
                            </p>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <span className="text-xs font-bold text-amber-300 font-tabular">₹{blend.ratePerKg}/kg</span>
                            </div>
                            <button
                              onClick={() => {
                                sfx.playTap();
                                setEditingBlend(blend);
                              }}
                              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-amber-500 hover:text-stone-950 text-xs font-bold text-stone-300 border border-white/10 transition-all flex items-center gap-1"
                            >
                              <Edit3 className="w-3 h-3" /> Edit
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right 5 Cols: Custom Blend Live Ratio Calculator */}
                  <div className="lg:col-span-5 glass-card-elevated p-5 rounded-2xl border border-stone-800 space-y-4">
                    <div className="pb-3 border-b border-white/10">
                      <span className="text-[10px] font-mono uppercase text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                        Express Mixer
                      </span>
                      <h3 className="text-sm font-bold text-white mt-1">Custom Coffee : Chicory Ratio</h3>
                      <p className="text-xs text-stone-400">
                        Live blended powder calculator · Coffee: ₹520/kg · Chicory: ₹160/kg
                      </p>
                    </div>

                    {/* Presets Chips */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-stone-300">Quick Ratio Presets</label>
                      <div className="grid grid-cols-3 gap-1.5 text-xs">
                        {[
                          { p: 100, label: '100% Pure' },
                          { p: 90, label: '90 : 10' },
                          { p: 85, label: '85 : 15' },
                          { p: 80, label: '80 : 20' },
                          { p: 70, label: '70 : 30' },
                          { p: 60, label: '60 : 40' },
                        ].map((r) => (
                          <button
                            key={r.p}
                            type="button"
                            onClick={() => {
                              sfx.playTap();
                              setCustomCoffeeRatio(r.p);
                            }}
                            className={`py-1.5 rounded-lg font-bold border transition-all ${
                              customCoffeeRatio === r.p
                                ? 'bg-amber-500 text-stone-950 border-amber-500'
                                : 'bg-white/5 text-stone-400 border-white/5 hover:text-white'
                            }`}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Ratio Slider */}
                    <div className="space-y-1 pt-1">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-amber-400">Coffee: {customCoffeeRatio}%</span>
                        <span className="text-stone-400">Chicory: {100 - customCoffeeRatio}%</span>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="100"
                        step="5"
                        value={customCoffeeRatio}
                        onChange={(e) => setCustomCoffeeRatio(Number(e.target.value))}
                        className="w-full accent-amber-500 cursor-pointer"
                      />
                    </div>

                    {/* Weight & Grind Size Selector */}
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-stone-400">Weight</label>
                        <select
                          value={customWeightGrams}
                          onChange={(e) => setCustomWeightGrams(Number(e.target.value))}
                          className="w-full text-xs p-2 rounded-xl glass-input"
                        >
                          <option value="250">250 grams</option>
                          <option value="500">500 grams</option>
                          <option value="1000">1.0 kg</option>
                          <option value="2000">2.0 kg</option>
                          <option value="5000">5.0 kg</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-stone-400">Grind Size</label>
                        <select
                          value={customGrind}
                          onChange={(e) => setCustomGrind(e.target.value)}
                          className="w-full text-xs p-2 rounded-xl glass-input"
                        >
                          <option value="Fine Filter">Fine Filter</option>
                          <option value="Medium Decoction">Medium Decoction</option>
                          <option value="Coarse Cold Brew">Coarse Cold Brew</option>
                          <option value="Whole Roasted Bean">Whole Bean</option>
                        </select>
                      </div>
                    </div>

                    {/* Calculated Price & Action */}
                    <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1.5 text-xs">
                      <div className="flex justify-between text-stone-400">
                        <span>Calculated Rate:</span>
                        <span className="font-tabular text-amber-300 font-bold">
                          ₹{Math.round((customCoffeeRatio / 100) * 520 + ((100 - customCoffeeRatio) / 100) * 160)}/kg
                        </span>
                      </div>
                      <div className="flex justify-between text-white font-bold text-sm border-t border-white/10 pt-1">
                        <span>Line Total:</span>
                        <span className="font-tabular text-amber-300">
                          ₹{Math.round((customWeightGrams / 1000) * Math.round((customCoffeeRatio / 100) * 520 + ((100 - customCoffeeRatio) / 100) * 160))}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleAddCustomBlendToCart}
                      className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-stone-950 font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-4 h-4" />
                      Add Custom Blend to Current Bill →
                    </button>
                  </div>
                </div>
              )}

              {/* -------------------------------------------------------------------
                  SUB-VIEW 3: TODAY'S BILLS (Invoice List & Instant Reprint)
                  ------------------------------------------------------------------- */}
              {counterMode === 'bills' && (
                <div className="glass-card-elevated p-5 rounded-2xl border border-stone-800 space-y-4">
                  {/* Search Bar & Summary Stats */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                        <input
                          type="text"
                          value={billSearchQuery}
                          onChange={(e) => setBillSearchQuery(e.target.value)}
                          placeholder="Search Bill #, Customer, Phone..."
                          className="text-xs pl-8 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white placeholder-stone-500 focus:outline-none focus:border-amber-400 w-64"
                        />
                      </div>
                      <span className="text-xs px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-stone-300 font-mono">
                        Date: {new Date().toLocaleDateString('en-IN')}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-xs">
                      <div>
                        <span className="text-stone-400">Cash:</span>{' '}
                        <span className="font-bold text-amber-300 font-tabular">₹{cashSalesToday.toLocaleString('en-IN')}</span>
                      </div>
                      <div>
                        <span className="text-stone-400">UPI:</span>{' '}
                        <span className="font-bold text-emerald-400 font-tabular">₹{upiSalesToday.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="pl-3 border-l border-white/10">
                        <span className="text-stone-400">Total:</span>{' '}
                        <span className="font-extrabold text-white text-sm font-tabular">₹{totalCounterRevenue.toLocaleString('en-IN')}</span>
                      </div>
                    </div>
                  </div>

                  {/* Bills Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-white/10 text-stone-400 uppercase tracking-wider font-semibold">
                          <th className="py-2.5 px-3">Bill #</th>
                          <th className="py-2.5 px-3">Time</th>
                          <th className="py-2.5 px-3">Customer / Hotel</th>
                          <th className="py-2.5 px-3">Blend / Items Summary</th>
                          <th className="py-2.5 px-3">Mode</th>
                          <th className="py-2.5 px-3 text-right">Amount</th>
                          <th className="py-2.5 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-medium">
                        {todayBills
                          .filter(
                            (b) =>
                              b.billNo.toLowerCase().includes(billSearchQuery.toLowerCase()) ||
                              b.customerName.toLowerCase().includes(billSearchQuery.toLowerCase()) ||
                              (b.customerPhone && b.customerPhone.includes(billSearchQuery))
                          )
                          .map((bill) => (
                            <tr key={bill.id} className="hover:bg-white/5 transition-colors">
                              <td className="py-3 px-3 font-mono text-amber-300 font-bold">{bill.billNo}</td>
                              <td className="py-3 px-3 text-stone-400">{bill.time}</td>
                              <td className="py-3 px-3 text-white font-semibold">
                                {bill.customerName}
                                {bill.customerPhone && <span className="block text-[10px] text-stone-400">{bill.customerPhone}</span>}
                              </td>
                              <td className="py-3 px-3 text-stone-300 max-w-xs truncate">{bill.itemsSummary}</td>
                              <td className="py-3 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    bill.paymentMethod === 'CASH'
                                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                      : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                  }`}
                                >
                                  {bill.paymentMethod}
                                </span>
                              </td>
                              <td className="py-3 px-3 font-tabular text-right text-white font-bold">
                                ₹{bill.grandTotal.toLocaleString('en-IN')}
                              </td>
                              <td className="py-3 px-3 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => handleReprintBill(bill)}
                                    title="Reprint Bill on POS-80C"
                                    className="p-1.5 rounded-lg bg-white/5 hover:bg-amber-500 hover:text-stone-950 text-stone-300 transition-colors"
                                  >
                                    <Printer className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      sfx.playTap();
                                      const text = `*VASAVI TRADING COMPANY*\nTax Invoice: ${bill.billNo}\nCustomer: ${bill.customerName}\nTotal: ₹${bill.grandTotal}\nPayment: ${bill.paymentMethod}\nThank you!`;
                                      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                                    }}
                                    title="Share on WhatsApp"
                                    className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/25 text-emerald-300 transition-colors"
                                  >
                                    <Share2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* -------------------------------------------------------------------
                  SUB-VIEW 4: CUSTOMERS (Directory & 1-Click Fast Billing)
                  ------------------------------------------------------------------- */}
              {counterMode === 'customers' && (
                <div className="glass-card-elevated p-5 rounded-2xl border border-stone-800 space-y-4">
                  {/* Search Bar & Add Customer Button */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                        <input
                          type="text"
                          value={customerSearchQuery}
                          onChange={(e) => setCustomerSearchQuery(e.target.value)}
                          placeholder="Search regular customer or phone..."
                          className="text-xs pl-8 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white placeholder-stone-500 focus:outline-none focus:border-amber-400 w-64"
                        />
                      </div>
                      <span className="text-xs px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-stone-300 font-mono">
                        {customers.length} Accounts
                      </span>
                    </div>

                    <button
                      onClick={() => {
                        sfx.playTap();
                        setNewCustomerModal(true);
                      }}
                      className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-stone-950 font-bold text-xs shadow-md transition-all flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Customer
                    </button>
                  </div>

                  {/* Customer Cards Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {customers
                      .filter(
                        (c) =>
                          c.name.toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
                          c.phone.includes(customerSearchQuery)
                      )
                      .map((cust) => (
                        <div
                          key={cust.id}
                          className="p-4 rounded-xl bg-stone-950/40 border border-stone-800/80 hover:border-amber-500/40 space-y-3 transition-all flex flex-col justify-between"
                        >
                          <div className="space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="text-xs font-bold text-white leading-tight">{cust.name}</h4>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-stone-400 font-mono">
                                {cust.type}
                              </span>
                            </div>
                            <p className="text-[11px] font-mono text-amber-400/90">{cust.phone}</p>
                            <p className="text-[11px] text-stone-400">
                              Prefers: <span className="text-stone-200 font-medium">{cust.favoriteBlend}</span>
                            </p>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[11px]">
                            <div>
                              <span className="text-stone-400">{cust.visits} visits · </span>
                              <span className={cust.balanceDue > 0 ? 'text-rose-400 font-bold' : 'text-emerald-400 font-semibold'}>
                                {cust.balanceDue > 0 ? `Due: ₹${cust.balanceDue}` : 'Zero Due'}
                              </span>
                            </div>
                            <button
                              onClick={() => handleCustomerSelectForBill(cust)}
                              className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500 hover:text-stone-950 text-amber-300 font-bold text-[10px] border border-amber-500/30 transition-all flex items-center gap-1"
                            >
                              <Receipt className="w-3 h-3" /> Start Bill
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* -------------------------------------------------------------------
                  SUB-VIEW 5: DAY CLOSE (Cash Register Closing & Z-Report)
                  ------------------------------------------------------------------- */}
              {counterMode === 'dayclose' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left 5 Cols: Register Reconciliation Summary */}
                  <div className="lg:col-span-5 glass-card-elevated p-5 rounded-2xl border border-stone-800 space-y-4">
                    <div className="pb-3 border-b border-white/10">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <h3 className="text-sm font-bold text-white">Shift Register Reconciliation</h3>
                      </div>
                      <p className="text-xs text-stone-400">Verify drawer cash against registered bills and float</p>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between p-2 rounded-xl bg-black/40 border border-white/5">
                        <span className="text-stone-400">Morning Opening Float:</span>
                        <span className="font-tabular font-bold text-stone-200">₹{openingFloat.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between p-2 rounded-xl bg-black/40 border border-white/5">
                        <span className="text-stone-400">Cash Sales Collected:</span>
                        <span className="font-tabular font-bold text-emerald-400">+ ₹{cashSalesToday.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between p-2 rounded-xl bg-black/40 border border-white/5">
                        <span className="text-stone-400">UPI / QR Collections:</span>
                        <span className="font-tabular font-bold text-stone-200">₹{upiSalesToday.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 font-bold">
                        <span>Expected Physical Cash in Drawer:</span>
                        <span className="font-tabular text-sm">₹{expectedCashInDrawer.toLocaleString('en-IN')}</span>
                      </div>
                    </div>

                    {/* Variance Check Banner */}
                    <div
                      className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
                        cashVariance === 0
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                          : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                      }`}
                    >
                      <span className="font-semibold">
                        {cashVariance === 0 ? '✓ Physical Count Matches Drawer' : '⚠️ Drawer Variance Detected:'}
                      </span>
                      <span className="font-bold font-tabular text-sm">
                        {cashVariance === 0 ? '₹0 Difference' : `₹${cashVariance.toLocaleString('en-IN')}`}
                      </span>
                    </div>

                    {/* Closing Notes */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-stone-400">Day Close Notes</label>
                      <textarea
                        rows={2}
                        value={closingNotes}
                        onChange={(e) => setClosingNotes(e.target.value)}
                        className="w-full text-xs p-2 rounded-xl glass-input"
                      />
                    </div>

                    {/* Actions */}
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          sfx.playCash();
                          setZReportModal(true);
                        }}
                        className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-stone-950 font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
                      >
                        <Printer className="w-4 h-4" />
                        Print 80mm Z-Report
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          sfx.playChime();
                          setIsDayClosed(true);
                          toast.success('Shift locked and finalized for today!');
                        }}
                        className="py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs border border-white/10 transition-all flex items-center justify-center gap-1.5"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        Lock Day Close
                      </button>
                    </div>
                  </div>

                  {/* Right 7 Cols: Denomination Counter Table */}
                  <div className="lg:col-span-7 glass-card-elevated p-5 rounded-2xl border border-stone-800 space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-white/10">
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <Banknote className="w-4 h-4 text-amber-400" />
                          Physical Cash Denomination Count
                        </h3>
                        <p className="text-xs text-stone-400">Count currency notes in cash drawer</p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-stone-400 uppercase">Counted Cash</span>
                        <div className="text-sm font-extrabold text-amber-300 font-tabular">
                          ₹{countedPhysicalCash.toLocaleString('en-IN')}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {[
                        { denom: 500, key: 'd500' },
                        { denom: 200, key: 'd200' },
                        { denom: 100, key: 'd100' },
                        { denom: 50, key: 'd50' },
                        { denom: 20, key: 'd20' },
                        { denom: 10, key: 'd10' },
                      ].map((item) => {
                        const val = (denominations as any)[item.key];
                        return (
                          <div key={item.denom} className="p-2.5 rounded-xl bg-stone-950/40 border border-stone-800 space-y-1">
                            <div className="flex justify-between text-xs">
                              <span className="font-bold text-stone-300">₹{item.denom}</span>
                              <span className="font-tabular text-amber-300/90 font-mono">₹{val * item.denom}</span>
                            </div>
                            <input
                              type="number"
                              min="0"
                              value={val}
                              onChange={(e) =>
                                setDenominations((prev) => ({
                                  ...prev,
                                  [item.key]: Math.max(0, parseInt(e.target.value) || 0),
                                }))
                              }
                              className="w-full text-xs p-1.5 rounded-lg glass-input text-right font-mono font-bold"
                            />
                          </div>
                        );
                      })}
                    </div>

                    <div className="p-3 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between text-xs">
                      <span className="text-stone-400">Coins & Loose Cash:</span>
                      <input
                        type="number"
                        min="0"
                        value={denominations.coins}
                        onChange={(e) =>
                          setDenominations((prev) => ({
                            ...prev,
                            coins: Math.max(0, parseInt(e.target.value) || 0),
                          }))
                        }
                        className="w-28 text-xs p-1.5 rounded-lg glass-input text-right font-mono font-bold"
                        placeholder="₹ Coins"
                      />
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* =========================================================================
              VIEW 5: DISPATCHES & AUDIT LOG (High Density Table, Image 3 Layout)
              ========================================================================= */}
          {activeTab === 'dispatches' && (
            <motion.div
              key="dispatches"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
              className="glass-card-elevated p-6 rounded-2xl space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Truck className="w-4 h-4 text-amber-400" />
                    Wholesale Dispatches & Tally Invoice Queue
                  </h2>
                  <p className="text-xs text-stone-400">All outward lots dispatched to estates, hotels, and retail distributors</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-3 py-1 rounded-xl bg-white/5 border border-white/10 text-stone-300">
                    Today: 12 Dispatches
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-stone-400 uppercase tracking-wider font-semibold">
                      <th className="py-3 px-4">Invoice #</th>
                      <th className="py-3 px-4">Client / Destination</th>
                      <th className="py-3 px-4">Blend / Grade</th>
                      <th className="py-3 px-4">Qty</th>
                      <th className="py-3 px-4">Total Amount</th>
                      <th className="py-3 px-4">Payment</th>
                      <th className="py-3 px-4">Vehicle / Driver</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {[
                      { inv: 'VTC-INV-2026-081', client: 'Sri Krishna Sweets & Bakery', blend: 'Imperial 80:20 (Medium Grind)', qty: '150 kg', amt: '₹72,000', pay: 'NEFT Confirmed', vehicle: 'AP-04-TX-2918', status: 'Dispatched' },
                      { inv: 'VTC-INV-2026-082', client: 'Hotel Annapurna Grand', blend: 'Royal Hotel Blend 70:30', qty: '200 kg', amt: '₹88,000', pay: 'UPI / Cash', vehicle: 'AP-04-UY-8192', status: 'Dispatched' },
                      { inv: 'VTC-INV-2026-083', client: 'Vasavi Coffee Depot (Branch 2)', blend: 'Plantation A + Chicory Crumb', qty: '400 kg', amt: '₹1,56,000', pay: 'Internal Transfer', vehicle: 'VTC Van #01', status: 'Loading' },
                      { inv: 'VTC-INV-2026-084', client: 'Devi Coffee Works, Vijayawada', blend: 'Raw Green Coffee (Robusta AB)', qty: '600 kg (10 Bags)', amt: '₹1,47,000', pay: 'Cheque Pending', vehicle: 'Lorry NL-01-K-3920', status: 'Scheduled' },
                    ].map((row, idx) => (
                      <tr key={idx} className="hover:bg-white/5 transition-colors font-medium">
                        <td className="py-3.5 px-4 font-mono text-amber-300 font-bold">{row.inv}</td>
                        <td className="py-3.5 px-4 text-white font-semibold">{row.client}</td>
                        <td className="py-3.5 px-4 text-stone-300">{row.blend}</td>
                        <td className="py-3.5 px-4 font-tabular">{row.qty}</td>
                        <td className="py-3.5 px-4 font-tabular text-amber-300 font-bold">{row.amt}</td>
                        <td className="py-3.5 px-4 text-stone-400">{row.pay}</td>
                        <td className="py-3.5 px-4 font-mono text-[11px] text-stone-300">{row.vehicle}</td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              row.status === 'Dispatched'
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : row.status === 'Loading'
                                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30 animate-pulse'
                                : 'bg-stone-800 text-stone-400'
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* =========================================================================
          THERMAL 80MM RECEIPT MODAL DIALOG (ATPOS POS-80C Hardware Integrated)
          ========================================================================= */}
      <AnimatePresence>
        {receiptModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 15 }}
              className="glass-card-elevated max-w-md w-full p-5 rounded-2xl border border-white/10 space-y-4 text-white shadow-2xl"
            >
              {/* Modal Top Diagnostic Bar */}
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <div>
                    <h3 className="text-xs font-bold text-white font-mono flex items-center gap-1.5">
                      <Printer className="w-3.5 h-3.5 text-emerald-400" />
                      POS-80C (USB001) Ready
                    </h3>
                    <span className="text-[10px] text-stone-400">Windows Default Spooler · 80mm ESC/POS</span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    sfx.playTap();
                    setReceiptModal(false);
                  }}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-stone-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Print Copies & Paper Toggle Controls */}
              <div className="flex items-center justify-between text-xs bg-black/30 p-2 rounded-xl border border-white/5">
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-stone-400 font-semibold mr-1">Copies:</span>
                  <button
                    onClick={() => setPrintCopies(1)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                      printCopies === 1
                        ? 'bg-amber-500 text-stone-950 shadow-sm'
                        : 'bg-white/5 text-stone-400 hover:text-white'
                    }`}
                  >
                    1 (Customer)
                  </button>
                  <button
                    onClick={() => setPrintCopies(2)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                      printCopies === 2
                        ? 'bg-amber-500 text-stone-950 shadow-sm'
                        : 'bg-white/5 text-stone-400 hover:text-white'
                    }`}
                  >
                    2 (Cust + Office)
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPrinterPaper(80)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      printerPaper === 80 ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50' : 'text-stone-500'
                    }`}
                  >
                    80mm
                  </button>
                  <button
                    onClick={() => setPrinterPaper(58)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      printerPaper === 58 ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50' : 'text-stone-500'
                    }`}
                  >
                    58mm
                  </button>
                </div>
              </div>

              {/* Physical White Thermal Receipt Preview */}
              <div
                id="thermal-receipt-preview"
                className="bg-white text-stone-950 rounded-xl p-5 shadow-inner font-mono text-[11px] leading-tight space-y-2 select-text max-h-[360px] overflow-y-auto border border-stone-300"
              >
                {/* Header */}
                <div className="text-center space-y-0.5 border-b border-dashed border-stone-400 pb-2">
                  <h4 className="font-bold text-sm tracking-tight text-black">VASAVI TRADING COMPANY</h4>
                  <p className="text-[10px] text-stone-700">ESTD. 1965 · COFFEE ROASTERS & WHOLESALE</p>
                  <p className="text-[10px] text-stone-600">GSTIN: 37AAAAA0000A1Z5 · TEL: +91 866 257 1965</p>
                  <p className="font-bold text-[10px] uppercase text-stone-800 tracking-wider">
                    {gstType === 'b2b' ? 'TAX INVOICE' : 'RETAIL CASH ESTIMATE'}
                  </p>
                  {printCopies === 2 && (
                    <p className="text-[9px] font-bold text-amber-800 uppercase tracking-widest border border-stone-300 py-0.5 my-1">
                      ** CUSTOMER COPY (1 OF 2) **
                    </p>
                  )}
                </div>

                {/* Bill Meta */}
                <div className="flex justify-between text-[10px] text-stone-800 pt-1">
                  <span>Bill: {billNumber}</span>
                  <span>{new Date().toLocaleDateString('en-IN')} {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="text-[10px] text-stone-700">
                  <p className="truncate"><span className="font-semibold">Customer:</span> {customerName}</p>
                  <p><span className="font-semibold">Counter:</span> Main Counter · POS-80C ({paymentMethod})</p>
                </div>

                {/* Item Rows Table */}
                <div className="border-t border-b border-dashed border-stone-400 py-1.5 space-y-1">
                  <div className="flex justify-between font-bold text-[10px] pb-1 border-b border-stone-200">
                    <span className="w-1/2">Blend / Item</span>
                    <span className="w-1/4 text-center">Qty x Rate</span>
                    <span className="w-1/4 text-right">Amount</span>
                  </div>
                  {cart.map((c, i) => (
                    <div key={i} className="flex justify-between text-[10px]">
                      <span className="w-1/2 truncate font-semibold">{c.item.name}</span>
                      <span className="w-1/4 text-center text-stone-600">{c.qtyKg}kg x ₹{c.item.ratePerKg}</span>
                      <span className="w-1/4 text-right font-bold">₹{(c.qtyKg * c.item.ratePerKg).toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </div>

                {/* Totals Breakdown */}
                <div className="space-y-0.5 text-right text-[11px] pt-1">
                  <div className="flex justify-between text-stone-600">
                    <span>Subtotal:</span>
                    <span className="font-tabular">₹{subtotal.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between text-stone-600">
                    <span>GST (5%):</span>
                    <span className="font-tabular">₹{gstAmount.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between font-extrabold text-sm pt-1.5 border-t border-stone-400 text-black">
                    <span>NET TOTAL ({paymentMethod}):</span>
                    <span className="font-tabular text-black">₹{grandTotal.toLocaleString('en-IN')}</span>
                  </div>
                </div>

                {/* Dynamic BharatQR / UPI QR Code */}
                <div className="flex flex-col items-center justify-center py-2 space-y-1 border-t border-dashed border-stone-300">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=115x115&data=${encodeURIComponent(
                      `upi://pay?pa=vasavitrading@okhdfcbank&pn=Vasavi%20Trading%20Company&am=${grandTotal}&cu=INR`
                    )}`}
                    alt="UPI QR Code"
                    className="w-24 h-24 border border-stone-300 p-1 rounded bg-white"
                  />
                  <span className="text-[9px] text-stone-700 font-bold">SCAN WITH ANY UPI APP TO PAY</span>
                  <span className="text-[8px] text-stone-500 font-mono">vasavitrading@okhdfcbank</span>
                </div>

                {/* Aroma Care Instructions & Footer */}
                <div className="text-center pt-1.5 text-[9px] text-stone-500 border-t border-dashed border-stone-400 space-y-0.5">
                  <p className="font-semibold text-stone-700">Thank You For Choosing Vasavi Coffee!</p>
                  <p>Store in an airtight container to preserve roast aroma.</p>
                  <p className="font-mono text-[8px]">*** AUTO PAPER CUT ***</p>
                </div>
              </div>

              {/* Action Buttons Grid */}
              <div className="space-y-2 pt-1">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleBrowserThermalPrint}
                    className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-stone-950 font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-1.5"
                  >
                    <Printer className="w-4 h-4" />
                    🖨 Print 80mm Slip
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDirectEscPosPrint()}
                    disabled={isPrinting}
                    className="py-2.5 px-3 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-bold text-xs border border-emerald-500/40 shadow-lg transition-all flex items-center justify-center gap-1.5"
                  >
                    <Zap className="w-4 h-4 text-emerald-400" />
                    {isPrinting ? 'Spooling...' : '⚡ Raw ESC/POS'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleKickDrawer}
                    disabled={isKickingDrawer}
                    className="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-stone-300 text-xs font-semibold border border-white/10 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Receipt className="w-3.5 h-3.5 text-amber-400" />
                    {isKickingDrawer ? 'Pulsing...' : 'Kick Drawer'}
                  </button>
                  <button
                    type="button"
                    onClick={handleWhatsAppReceipt}
                    className="py-2 px-3 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-semibold border border-emerald-500/30 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Share2 className="w-3.5 h-3.5" /> WhatsApp
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    sfx.playTap();
                    setReceiptModal(false);
                  }}
                  className="w-full py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 font-bold text-xs transition-colors"
                >
                  Done & Return to Counter →
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* =========================================================================
          EDIT BLEND SPECIFICATIONS MODAL
          ========================================================================= */}
      <AnimatePresence>
        {editingBlend && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card-elevated max-w-md w-full p-5 rounded-2xl border border-stone-800 space-y-4 text-white shadow-2xl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-bold text-white">Edit Blend Formula</h3>
                </div>
                <button
                  onClick={() => setEditingBlend(null)}
                  className="p-1 rounded-lg hover:bg-white/10 text-stone-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-stone-400">Blend Name</label>
                  <input
                    type="text"
                    value={editingBlend.name}
                    onChange={(e) => setEditingBlend({ ...editingBlend, name: e.target.value })}
                    className="w-full p-2 rounded-xl glass-input text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-stone-400">Coffee %</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={editingBlend.coffeePct}
                      onChange={(e) => {
                        const val = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                        setEditingBlend({ ...editingBlend, coffeePct: val, chicoryPct: 100 - val });
                      }}
                      className="w-full p-2 rounded-xl glass-input text-xs font-mono font-bold"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-stone-400">Chicory %</label>
                    <input
                      type="number"
                      readOnly
                      value={editingBlend.chicoryPct}
                      className="w-full p-2 rounded-xl glass-input text-xs font-mono opacity-70 cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-stone-400">Price per Kg (₹)</label>
                    <input
                      type="number"
                      value={editingBlend.ratePerKg}
                      onChange={(e) => setEditingBlend({ ...editingBlend, ratePerKg: parseInt(e.target.value) || 0 })}
                      className="w-full p-2 rounded-xl glass-input text-xs font-mono font-bold text-amber-300"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-stone-400">Stock (kg)</label>
                    <input
                      type="number"
                      value={editingBlend.stockKg}
                      onChange={(e) => setEditingBlend({ ...editingBlend, stockKg: parseFloat(e.target.value) || 0 })}
                      className="w-full p-2 rounded-xl glass-input text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-stone-400">Default Grind Spec</label>
                  <select
                    value={editingBlend.grind}
                    onChange={(e) => setEditingBlend({ ...editingBlend, grind: e.target.value })}
                    className="w-full p-2 rounded-xl glass-input text-xs"
                  >
                    <option value="Fine Filter">Fine Filter</option>
                    <option value="Medium Decoction">Medium Decoction</option>
                    <option value="Coarse Cold Brew">Coarse Cold Brew</option>
                    <option value="Whole Roasted Bean">Whole Roasted Bean</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingBlend(null)}
                  className="flex-1 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveEditedBlend(editingBlend)}
                  className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-stone-950 font-bold text-xs"
                >
                  Save Changes
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* =========================================================================
          CASH TODAY 🔒 PIN VERIFICATION MODAL
          ========================================================================= */}
      <AnimatePresence>
        {cashPinModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card-elevated max-w-xs w-full p-5 rounded-2xl border border-stone-800 space-y-4 text-white text-center shadow-2xl"
            >
              <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto border border-amber-500/30">
                <Lock className="w-5 h-5" />
              </div>

              <div>
                <h3 className="text-sm font-bold text-white">Cash Today is Locked</h3>
                <p className="text-xs text-stone-400 mt-1">
                  Enter 4-digit PIN to view drawer cash balance
                </p>
              </div>

              <form onSubmit={handleUnlockPin} className="space-y-3">
                <input
                  type="password"
                  maxLength={4}
                  autoFocus
                  value={enteredPin}
                  onChange={(e) => setEnteredPin(e.target.value)}
                  placeholder="PIN (1965)"
                  className="w-full text-center text-lg tracking-widest p-2.5 rounded-xl glass-input font-mono font-bold"
                />

                <div className="space-y-1.5">
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-stone-950 font-bold text-xs shadow-md"
                  >
                    Unlock Cash Display
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCashTodayLocked(false);
                      setCashPinModal(false);
                      toast.success('Cash Drawer balance unlocked (Manager Bypass)');
                    }}
                    className="w-full py-1.5 rounded-lg text-stone-400 hover:text-stone-200 text-[11px]"
                  >
                    ⚡ One-Click Manager Unlock
                  </button>
                  <button
                    type="button"
                    onClick={() => setCashPinModal(false)}
                    className="w-full py-1 text-stone-500 hover:text-stone-300 text-[11px]"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* =========================================================================
          REGISTER NEW CUSTOMER MODAL
          ========================================================================= */}
      <AnimatePresence>
        {newCustomerModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card-elevated max-w-sm w-full p-5 rounded-2xl border border-stone-800 space-y-4 text-white shadow-2xl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-bold text-white">Add Regular Customer</h3>
                </div>
                <button
                  onClick={() => setNewCustomerModal(false)}
                  className="p-1 rounded-lg hover:bg-white/10 text-stone-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-stone-400">Establishment / Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Sri Balaji Coffee Bar"
                    value={newCustName}
                    onChange={(e) => setNewCustName(e.target.value)}
                    className="w-full p-2 rounded-xl glass-input text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-stone-400">Phone Number</label>
                  <input
                    type="tel"
                    placeholder="10-digit mobile number"
                    value={newCustPhone}
                    onChange={(e) => setNewCustPhone(e.target.value)}
                    className="w-full p-2 rounded-xl glass-input text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-stone-400">Account Type</label>
                  <select
                    value={newCustType}
                    onChange={(e) => setNewCustType(e.target.value)}
                    className="w-full p-2 rounded-xl glass-input text-xs"
                  >
                    <option value="Hotel / Bar">Hotel / Restaurant</option>
                    <option value="Cafe">Cafe / Tea Shop</option>
                    <option value="Retail">Retail Consumer</option>
                    <option value="Wholesale">Wholesale Merchant</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-stone-400">Favorite Blend</label>
                  <select
                    value={newCustFav}
                    onChange={(e) => setNewCustFav(e.target.value)}
                    className="w-full p-2 rounded-xl glass-input text-xs"
                  >
                    {editableBlends.map((b) => (
                      <option key={b.id} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewCustomerModal(false)}
                  className="flex-1 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateCustomer}
                  className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-stone-950 font-bold text-xs"
                >
                  Save Customer
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* =========================================================================
          80MM DAY-CLOSE Z-REPORT MODAL
          ========================================================================= */}
      <AnimatePresence>
        {zReportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card-elevated max-w-md w-full p-5 rounded-2xl border border-stone-800 space-y-4 text-white shadow-2xl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-bold text-white">80mm Day-End Z-Report</h3>
                </div>
                <button
                  onClick={() => setZReportModal(false)}
                  className="p-1 rounded-lg hover:bg-white/10 text-stone-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Physical White Thermal Z-Report Preview */}
              <div className="bg-white text-stone-950 rounded-xl p-5 shadow-inner font-mono text-[10px] leading-tight space-y-1.5 select-text border border-stone-300 max-h-[380px] overflow-y-auto">
                <div className="text-center space-y-0.5 border-b border-dashed border-stone-400 pb-2">
                  <h4 className="font-bold text-xs tracking-tight text-black">VASAVI TRADING COMPANY</h4>
                  <p className="text-[9px] text-stone-700">ESTD. 1965 · ROASTERS & MERCHANTS</p>
                  <p className="font-bold text-[10px] uppercase text-black pt-1">DAILY REGISTER CLOSING / Z-REPORT</p>
                  <p className="text-[9px] text-stone-600">POS TERMINAL: POS-80C · USB001</p>
                </div>

                <div className="flex justify-between text-[9px] text-stone-800 pt-1">
                  <span>Date: {new Date().toLocaleDateString('en-IN')}</span>
                  <span>Time: {new Date().toLocaleTimeString('en-IN')}</span>
                </div>
                <div className="text-[9px] text-stone-700">
                  <p>Cashier: Main Counter Staff</p>
                  <p>Status: {cashVariance === 0 ? 'BALANCED & AUDITED' : 'AUDITED WITH VARIANCE'}</p>
                </div>

                <div className="border-t border-b border-dashed border-stone-400 py-1.5 space-y-1">
                  <div className="font-bold text-[10px] text-black">--- SALES SUMMARY ---</div>
                  <div className="flex justify-between">
                    <span>Total Bills Count:</span>
                    <span className="font-bold">{todayBills.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cash Sales:</span>
                    <span className="font-bold">₹{cashSalesToday.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>UPI Digital Payments:</span>
                    <span className="font-bold">₹{upiSalesToday.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[10px] pt-1 border-t border-stone-300 text-black">
                    <span>GROSS REVENUE:</span>
                    <span>₹{totalCounterRevenue.toLocaleString('en-IN')}</span>
                  </div>
                </div>

                <div className="border-b border-dashed border-stone-400 py-1.5 space-y-1">
                  <div className="font-bold text-[10px] text-black">--- CASH DRAWER RECONCILIATION ---</div>
                  <div className="flex justify-between">
                    <span>Opening Cash Float:</span>
                    <span>₹{openingFloat.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cash Collected Today:</span>
                    <span>+ ₹{cashSalesToday.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Expected in Drawer:</span>
                    <span className="font-bold">₹{expectedCashInDrawer.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Actual Physical Count:</span>
                    <span className="font-bold">₹{countedPhysicalCash.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[10px] pt-1 border-t border-stone-300 text-black">
                    <span>CASH VARIANCE:</span>
                    <span>{cashVariance === 0 ? '₹0.00 (EXACT)' : `₹${cashVariance.toLocaleString('en-IN')}`}</span>
                  </div>
                </div>

                <div className="text-center pt-2 text-[9px] text-stone-600 space-y-1">
                  <p>Supervisor Signature: __________________</p>
                  <p>Cashier Signature: _____________________</p>
                  <p className="font-mono text-[8px] pt-1">*** END OF DAY SHIFT AUDIT ***</p>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setZReportModal(false)}
                  className="flex-1 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 font-bold text-xs"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handlePrintZReport}
                  className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-stone-950 font-bold text-xs flex items-center justify-center gap-1.5"
                >
                  <Printer className="w-4 h-4" />
                  Print 80mm Z-Slip
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* =========================================================================
          ISOLATED 80MM THERMAL PRINT ELEMENT (Targeted by @media print)
          ========================================================================= */}
      <div id="print-area">
        {activePrintTarget === 'receipt' ? (
          <div style={{ fontFamily: 'monospace', fontSize: '11px', lineHeight: '1.25', width: '74mm', margin: '0 auto', color: '#000' }}>
            <div style={{ textAlign: 'center', borderBottom: '1px dashed #000', paddingBottom: '4px', marginBottom: '4px' }}>
              <div style={{ fontWeight: 'bold', fontSize: '13px' }}>VASAVI TRADING COMPANY</div>
              <div style={{ fontSize: '10px' }}>ESTD. 1965 · ROASTERS & MERCHANTS</div>
              <div style={{ fontSize: '9px' }}>GSTIN: 37AAAAA0000A1Z5 · TEL: +91 866 257 1965</div>
              <div style={{ fontWeight: 'bold', fontSize: '10px', marginTop: '2px' }}>
                {gstType === 'b2b' ? 'TAX INVOICE / 80MM BILL' : 'RETAIL CASH ESTIMATE'}
              </div>
              {printCopies === 2 && (
                <div style={{ fontWeight: 'bold', fontSize: '9px', border: '1px solid #000', margin: '2px 0', padding: '1px' }}>
                  ** CUSTOMER COPY (1 OF 2) **
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
              <span>Bill: {billNumber}</span>
              <span>{new Date().toLocaleDateString('en-IN')} {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div style={{ fontSize: '10px', marginBottom: '4px' }}>
              <div>Cust: {customerName}</div>
              <div>Counter: Main Counter · POS-80C ({paymentMethod})</div>
            </div>

            <div style={{ borderTop: '1px dashed #000', borderBottom: '1px dashed #000', padding: '4px 0', margin: '4px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '10px', borderBottom: '1px solid #ccc', paddingBottom: '2px' }}>
                <span style={{ width: '50%' }}>Item Description</span>
                <span style={{ width: '25%', textAlign: 'center' }}>Qty x Rate</span>
                <span style={{ width: '25%', textAlign: 'right' }}>Amount</span>
              </div>
              {cart.map((c, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', margin: '2px 0' }}>
                  <span style={{ width: '50%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{c.item.name}</span>
                  <span style={{ width: '25%', textAlign: 'center' }}>{c.qtyKg}kg x {c.item.ratePerKg}</span>
                  <span style={{ width: '25%', textAlign: 'right', fontWeight: 'bold' }}>₹{c.qtyKg * c.item.ratePerKg}</span>
                </div>
              ))}
            </div>

            <div style={{ textAlign: 'right', fontSize: '10px', marginTop: '4px' }}>
              <div>Subtotal: ₹{subtotal.toLocaleString('en-IN')}</div>
              <div>GST (5%): ₹{gstAmount.toLocaleString('en-IN')}</div>
              <div style={{ fontWeight: 'bold', fontSize: '12px', borderTop: '1px solid #000', paddingTop: '2px', marginTop: '2px' }}>
                TOTAL ({paymentMethod}): ₹{grandTotal.toLocaleString('en-IN')}
              </div>
            </div>

            <div style={{ textAlign: 'center', borderTop: '1px dashed #000', marginTop: '6px', paddingTop: '4px', fontSize: '9px' }}>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(
                  `upi://pay?pa=vasavitrading@okhdfcbank&pn=Vasavi%20Trading%20Company&am=${grandTotal}&cu=INR`
                )}`}
                alt="UPI QR"
                style={{ width: '70px', height: '70px', margin: '2px auto', display: 'block' }}
              />
              <div style={{ fontWeight: 'bold' }}>SCAN UPI QR TO PAY</div>
              <div style={{ fontSize: '8px' }}>vasavitrading@okhdfcbank</div>
              <div style={{ marginTop: '4px' }}>Thank You For Choosing Vasavi Coffee!</div>
              <div style={{ fontSize: '8px' }}>Keep in an airtight container for best aroma.</div>
            </div>
          </div>
        ) : (
          <div style={{ fontFamily: 'monospace', fontSize: '10px', lineHeight: '1.25', width: '74mm', margin: '0 auto', color: '#000' }}>
            <div style={{ textAlign: 'center', borderBottom: '1px dashed #000', paddingBottom: '4px', marginBottom: '4px' }}>
              <div style={{ fontWeight: 'bold', fontSize: '12px' }}>VASAVI TRADING COMPANY</div>
              <div style={{ fontSize: '9px' }}>ESTD. 1965 · ROASTERS & MERCHANTS</div>
              <div style={{ fontWeight: 'bold', fontSize: '11px', marginTop: '2px' }}>DAILY REGISTER CLOSING / Z-REPORT</div>
              <div style={{ fontSize: '8px' }}>POS-80C · USB001</div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px' }}>
              <span>Date: {new Date().toLocaleDateString('en-IN')}</span>
              <span>Time: {new Date().toLocaleTimeString('en-IN')}</span>
            </div>
            <div style={{ fontSize: '9px', marginBottom: '4px' }}>
              <div>Shift Status: {cashVariance === 0 ? 'BALANCED' : 'VARIANCE AUDIT'}</div>
            </div>

            <div style={{ borderTop: '1px dashed #000', borderBottom: '1px dashed #000', padding: '4px 0', margin: '4px 0' }}>
              <div style={{ fontWeight: 'bold', borderBottom: '1px solid #ccc', paddingBottom: '2px' }}>--- SALES SUMMARY ---</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Bills Count:</span>
                <span style={{ fontWeight: 'bold' }}>{todayBills.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Cash Sales:</span>
                <span style={{ fontWeight: 'bold' }}>₹{cashSalesToday.toLocaleString('en-IN')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>UPI Collections:</span>
                <span style={{ fontWeight: 'bold' }}>₹{upiSalesToday.toLocaleString('en-IN')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', borderTop: '1px solid #000', marginTop: '2px', paddingTop: '2px' }}>
                <span>TOTAL REVENUE:</span>
                <span>₹{totalCounterRevenue.toLocaleString('en-IN')}</span>
              </div>
            </div>

            <div style={{ borderBottom: '1px dashed #000', paddingBottom: '4px', marginBottom: '4px' }}>
              <div style={{ fontWeight: 'bold', borderBottom: '1px solid #ccc', paddingBottom: '2px' }}>--- CASH RECONCILIATION ---</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Opening Float:</span>
                <span>₹{openingFloat.toLocaleString('en-IN')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Cash In:</span>
                <span>+ ₹{cashSalesToday.toLocaleString('en-IN')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                <span>Expected Drawer:</span>
                <span>₹{expectedCashInDrawer.toLocaleString('en-IN')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                <span>Actual Count:</span>
                <span>₹{countedPhysicalCash.toLocaleString('en-IN')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', borderTop: '1px solid #000', marginTop: '2px', paddingTop: '2px' }}>
                <span>VARIANCE:</span>
                <span>{cashVariance === 0 ? '₹0.00 (BALANCED)' : `₹${cashVariance.toLocaleString('en-IN')}`}</span>
              </div>
            </div>

            <div style={{ textAlign: 'center', marginTop: '6px', fontSize: '8px' }}>
              <div>Supervisor: ____________________</div>
              <div style={{ marginTop: '4px' }}>Cashier: _______________________</div>
              <div style={{ marginTop: '4px' }}>*** END OF DAY SHIFT AUDIT ***</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
