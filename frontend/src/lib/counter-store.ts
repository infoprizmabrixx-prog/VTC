import { create } from 'zustand';

export interface CounterItem {
  id: number;
  name: string;
  kind: 'coffee_ground' | 'coffee_beans' | 'product';
  coffee_pct: number;
  chicory_product_id?: number | null;
  chicory_name?: string;
  stock_product_id?: number | null;
  stock_name?: string;
  price_per_kg_paise: number;
  gst_rate_bp?: number | null;
  hsn?: string;
  stock_kg: number;
  active: boolean;
}

export interface CartLine {
  id: string; // temporary cart line id
  item_id?: number;
  name: string;
  weight_kg: number;
  rate_paise: number;
  amount_paise: number;
  custom?: {
    coffee_pct: number;
    override_rate_paise?: number;
    override_reason?: string;
  };
}

export interface CustomerHistory {
  id: number;
  name: string;
  phone: string;
  visits: number;
  last_seen: string;
  last_bill?: {
    bill_no: string;
    total_paise: number;
    lines: Array<{
      item_name: string;
      weight_kg: number;
      rate_paise: number;
    }>;
  };
}

export interface CounterState {
  // Cart
  lines: CartLine[];
  discountPaise: number;
  discountReason: string;
  customerName: string;
  customerPhone: string;
  matchedCustomer: CustomerHistory | null;

  // Catalog & Setup Data
  items: CounterItem[];
  incomingTransfers: any[];
  stock: {
    coffee_ground: number;
    coffee_beans: number;
    custom_chicory: number;
  };
  settings: {
    company_name: string;
    company_address: string;
    company_gstin: string;
    discount_cap_pct: number;
    custom_coffee_rate_paise: number;
    custom_chicory_rate_paise: number;
    custom_chicory_product_id?: number;
    counter_opening_float_paise: number;
  };
  dayClosed: boolean;
  dayClosedInfo: any;

  // Actions
  setSetupData: (data: any) => void;
  addLine: (line: Omit<CartLine, 'id'>) => void;
  removeLine: (id: string) => void;
  updateLineWeight: (id: string, weightKg: number) => void;
  clearCart: () => void;
  setDiscount: (paise: number, reason: string) => void;
  clearDiscount: () => void;
  setCustomer: (name: string, phone: string) => void;
  setMatchedCustomer: (customer: CustomerHistory | null) => void;
  applyPreviousOrder: () => void;
}

export const useCounterStore = create<CounterState>((set, get) => ({
  lines: [],
  discountPaise: 0,
  discountReason: '',
  customerName: '',
  customerPhone: '',
  matchedCustomer: null,

  items: [],
  incomingTransfers: [],
  stock: {
    coffee_ground: 28.5,
    coffee_beans: 42.0,
    custom_chicory: 18.2,
  },
  settings: {
    company_name: 'VASAVI TRADING COMPANY',
    company_address: 'Coffee Roasters & Wholesale Merchants, Main Bazaar',
    company_gstin: '37AAAAA0000A1Z5',
    discount_cap_pct: 10,
    custom_coffee_rate_paise: 52000, // Rs 520/kg pure coffee base
    custom_chicory_rate_paise: 16000, // Rs 160/kg chicory base
    counter_opening_float_paise: 200000, // Rs 2,000 float
  },
  dayClosed: false,
  dayClosedInfo: null,

  setSetupData: (data) => {
    set({
      items: data.items || [],
      incomingTransfers: data.incoming || [],
      stock: data.stock || { coffee_ground: 0, coffee_beans: 0, custom_chicory: 0 },
      settings: {
        company_name: data.settings?.company_name || 'VASAVI TRADING COMPANY',
        company_address: data.settings?.company_address || 'Coffee Roasters & Wholesale Merchants',
        company_gstin: data.settings?.company_gstin || '',
        discount_cap_pct: Number(data.settings?.discount_cap_pct || 10),
        custom_coffee_rate_paise: Number(data.settings?.custom_coffee_rate_paise || 52000),
        custom_chicory_rate_paise: Number(data.settings?.custom_chicory_rate_paise || 16000),
        custom_chicory_product_id: data.settings?.custom_chicory_product_id,
        counter_opening_float_paise: Number(data.settings?.counter_opening_float_paise || 200000),
      },
      dayClosed: !!data.day_closed,
      dayClosedInfo: data.day_closed || null,
    });
  },

  addLine: (line) => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({
      lines: [...state.lines, { ...line, id }],
    }));
  },

  removeLine: (id) => {
    set((state) => ({
      lines: state.lines.filter((l) => l.id !== id),
    }));
  },

  updateLineWeight: (id, weightKg) => {
    set((state) => ({
      lines: state.lines.map((l) => {
        if (l.id === id) {
          const amount_paise = Math.round(weightKg * l.rate_paise);
          return { ...l, weight_kg: weightKg, amount_paise };
        }
        return l;
      }),
    }));
  },

  clearCart: () => {
    set({
      lines: [],
      discountPaise: 0,
      discountReason: '',
      customerName: '',
      customerPhone: '',
      matchedCustomer: null,
    });
  },

  setDiscount: (paise, reason) => {
    set({ discountPaise: paise, discountReason: reason });
  },

  clearDiscount: () => {
    set({ discountPaise: 0, discountReason: '' });
  },

  setCustomer: (customerName, customerPhone) => {
    set({ customerName, customerPhone });
  },

  setMatchedCustomer: (matchedCustomer) => {
    set({ matchedCustomer });
  },

  applyPreviousOrder: () => {
    const cust = get().matchedCustomer;
    if (!cust?.last_bill?.lines) return;

    cust.last_bill.lines.forEach((l) => {
      get().addLine({
        name: l.item_name,
        weight_kg: l.weight_kg,
        rate_paise: l.rate_paise,
        amount_paise: Math.round(l.weight_kg * l.rate_paise),
      });
    });
  },
}));
