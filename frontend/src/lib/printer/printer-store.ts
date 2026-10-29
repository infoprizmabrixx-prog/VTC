import { create } from 'zustand';
import { atposDevice, PrinterTransport } from './atpos-device';
import { generateBillEscPos, generateTestEscPos, PaperWidth } from './escpos';
import axios from 'axios';
import toast from 'react-hot-toast';

export interface PrinterState {
  transport: PrinterTransport;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  deviceName: string;
  errorMessage: string | null;
  paperWidth: PaperWidth;
  autoCut: boolean;
  autoDrawerKick: boolean;
  copies: 1 | 2;
  networkIp: string;
  networkPort: number;
  upiVpa: string;
  logs: Array<{ time: string; text: string; type: 'info' | 'success' | 'warn' | 'error' }>;

  // Actions
  setTransport: (transport: PrinterTransport) => void;
  connectUsb: () => Promise<boolean>;
  connectSerial: (baudRate?: number) => Promise<boolean>;
  connectBluetooth: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  setPaperWidth: (width: PaperWidth) => void;
  setAutoCut: (autoCut: boolean) => void;
  setAutoDrawerKick: (autoKick: boolean) => void;
  setCopies: (copies: 1 | 2) => void;
  setNetworkConfig: (ip: string, port?: number) => void;
  setUpiVpa: (vpa: string) => void;
  addLog: (text: string, type?: 'info' | 'success' | 'warn' | 'error') => void;

  // Print Operations
  printBillData: (bill: any, customCopies?: 1 | 2) => Promise<boolean>;
  runTestPrint: () => Promise<boolean>;
  kickDrawer: () => Promise<boolean>;
}

export const usePrinterStore = create<PrinterState>((set, get) => ({
  transport: 'webusb',
  status: 'disconnected',
  deviceName: 'ATPOS Thermal Printer (Not Connected)',
  errorMessage: null,
  paperWidth: 80,
  autoCut: true,
  autoDrawerKick: true,
  copies: 1,
  networkIp: '192.168.1.200',
  networkPort: 9100,
  upiVpa: 'vasavitrading@okhdfcbank',
  logs: [
    {
      time: new Date().toLocaleTimeString(),
      text: 'ATPOS Thermal Printer subsystem initialized.',
      type: 'info',
    },
  ],

  setTransport: (transport) => {
    set({ transport });
    get().addLog(`Active transport changed to ${transport.toUpperCase()}`, 'info');
  },

  setPaperWidth: (paperWidth) => {
    set({ paperWidth });
    get().addLog(`Paper width set to ${paperWidth}mm`, 'info');
  },

  setAutoCut: (autoCut) => set({ autoCut }),
  setAutoDrawerKick: (autoDrawerKick) => set({ autoDrawerKick }),
  setCopies: (copies) => set({ copies }),

  setNetworkConfig: (networkIp, networkPort = 9100) => {
    set({ networkIp, networkPort });
    get().addLog(`Network ATPOS configured to ${networkIp}:${networkPort}`, 'info');
  },

  setUpiVpa: (upiVpa) => set({ upiVpa }),

  addLog: (text, type = 'info') => {
    set((state) => ({
      logs: [
        { time: new Date().toLocaleTimeString(), text, type },
        ...state.logs.slice(0, 39), // keep last 40 logs
      ],
    }));
  },

  connectUsb: async () => {
    set({ status: 'connecting', errorMessage: null });
    get().addLog('Requesting USB port for ATPOS printer...', 'info');

    const res = await atposDevice.connectUsb();
    if (res.ok) {
      set({
        status: 'connected',
        transport: 'webusb',
        deviceName: res.name || 'ATPOS USB Thermal Printer',
      });
      get().addLog(`Connected to ${res.name} via WebUSB`, 'success');
      toast.success(`ATPOS Printer connected: ${res.name}`);
      return true;
    } else {
      set({ status: 'error', errorMessage: res.error || 'Failed to connect USB' });
      get().addLog(`USB connection error: ${res.error}`, 'error');
      toast.error(res.error || 'USB Printer connection failed');
      return false;
    }
  },

  connectSerial: async (baudRate = 9600) => {
    set({ status: 'connecting', errorMessage: null });
    get().addLog(`Opening COM port at ${baudRate} baud...`, 'info');

    const res = await atposDevice.connectSerial(baudRate);
    if (res.ok) {
      set({
        status: 'connected',
        transport: 'webserial',
        deviceName: res.name || 'ATPOS Serial Printer',
      });
      get().addLog(`Connected to ${res.name}`, 'success');
      toast.success('Connected to ATPOS Serial Port');
      return true;
    } else {
      set({ status: 'error', errorMessage: res.error || 'Failed to connect COM port' });
      get().addLog(`Serial error: ${res.error}`, 'error');
      toast.error(res.error || 'COM port connection failed');
      return false;
    }
  },

  connectBluetooth: async () => {
    set({ status: 'connecting', errorMessage: null });
    get().addLog('Scanning for Bluetooth POS Printers...', 'info');

    const res = await atposDevice.connectBluetooth();
    if (res.ok) {
      set({
        status: 'connected',
        transport: 'bluetooth',
        deviceName: res.name || 'ATPOS Bluetooth Printer',
      });
      get().addLog(`Paired with ${res.name}`, 'success');
      toast.success(`Connected to ${res.name}`);
      return true;
    } else {
      set({ status: 'error', errorMessage: res.error || 'Bluetooth pairing failed' });
      get().addLog(`Bluetooth error: ${res.error}`, 'error');
      toast.error(res.error || 'Bluetooth connection failed');
      return false;
    }
  },

  disconnect: async () => {
    await atposDevice.disconnect();
    set({
      status: 'disconnected',
      deviceName: 'ATPOS Thermal Printer (Disconnected)',
      errorMessage: null,
    });
    get().addLog('Disconnected printer hardware.', 'warn');
    toast('Printer disconnected');
  },

  printBillData: async (bill, customCopies) => {
    const state = get();
    const count = customCopies || state.copies;
    const labels = count === 2 ? ['CUSTOMER COPY', 'OFFICE COPY'] : ['CUSTOMER COPY'];

    get().addLog(`Preparing bill ${bill.bill_no} (${count} ${count > 1 ? 'copies' : 'copy'})...`, 'info');

    try {
      // 1. Direct hardware transmission (WebUSB / WebSerial / Bluetooth)
      if (['webusb', 'webserial', 'bluetooth'].includes(state.transport) && state.status === 'connected') {
        for (const copyLabel of labels) {
          const rawBytes = generateBillEscPos(bill, {
            paperWidth: state.paperWidth,
            copyLabel,
            duplicate: (bill.reprints || 0) > 0,
            kickDrawer: state.autoDrawerKick,
            autoCut: state.autoCut,
            upiVpa: state.upiVpa,
          });

          const result = await atposDevice.sendRawData(rawBytes, state.transport);
          if (!result.ok) {
            throw new Error(result.error);
          }
        }
        get().addLog(`Printed ${count} copies on ATPOS (${state.transport.toUpperCase()})`, 'success');
        toast.success(`Printed Bill ${bill.bill_no} on ATPOS`);
        return true;
      }

      // 2. Network TCP 9100 / Backend Spooler API
      if (state.transport === 'network' || state.transport === 'system_driver') {
        try {
          const res = await axios.post('/api/v1/counter/printer/print', {
            sale_id: bill.id,
            copies: count,
            paper_width: state.paperWidth,
            target: state.transport === 'network' ? 'network' : 'spooler',
            ip: state.networkIp,
            port: state.networkPort,
          });
          if (res.data?.ok) {
            get().addLog(`Sent to ${state.transport === 'network' ? state.networkIp : 'Windows spooler'}`, 'success');
            toast.success(`Printed Bill ${bill.bill_no} via ${state.transport.toUpperCase()}`);
            return true;
          }
        } catch (apiErr: any) {
          get().addLog(`Backend print error: ${apiErr.message}`, 'warn');
        }
      }

      // 3. Fallback: Browser Print
      get().addLog('Printing via Browser print dialog...', 'info');
      return true;
    } catch (err: any) {
      get().addLog(`Print failed: ${err.message}`, 'error');
      toast.error(`Printing failed: ${err.message}`);
      return false;
    }
  },

  runTestPrint: async () => {
    const state = get();
    get().addLog(`Running ATPOS diagnostic test on ${state.transport.toUpperCase()}...`, 'info');

    try {
      const testBytes = generateTestEscPos(state.paperWidth);
      if (['webusb', 'webserial', 'bluetooth'].includes(state.transport) && state.status === 'connected') {
        const result = await atposDevice.sendRawData(testBytes, state.transport);
        if (!result.ok) throw new Error(result.error);
        get().addLog('Test slip printed successfully!', 'success');
        toast.success('ATPOS Hardware Test Print Sent!');
        return true;
      }

      // Backend test endpoint
      const res = await axios.post('/api/v1/counter/printer/test', {
        paper_width: state.paperWidth,
        target: state.transport === 'network' ? 'network' : 'spooler',
        ip: state.networkIp,
        port: state.networkPort,
      });

      if (res.data?.ok) {
        get().addLog('Diagnostic test completed via Backend Service.', 'success');
        toast.success('Test Print Dispatched to ATPOS!');
        return true;
      }
      return true;
    } catch (err: any) {
      get().addLog(`Test print error: ${err.message}`, 'error');
      toast.error(`Test print failed: ${err.message}`);
      return false;
    }
  },

  kickDrawer: async () => {
    const state = get();
    get().addLog('Sending cash drawer kick pulse (ESC p)...', 'info');

    try {
      const pulseBytes = new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]);
      if (['webusb', 'webserial', 'bluetooth'].includes(state.transport) && state.status === 'connected') {
        await atposDevice.sendRawData(pulseBytes, state.transport);
        get().addLog('Cash drawer pulse sent via Direct Hardware.', 'success');
        toast.success('Cash Drawer Opened');
        return true;
      }

      // Via backend API
      await axios.post('/api/v1/counter/printer/kick-drawer', {
        ip: state.networkIp,
        port: state.networkPort,
      });
      get().addLog('Cash drawer pulse sent via Backend.', 'success');
      toast.success('Cash Drawer Opened');
      return true;
    } catch (err: any) {
      get().addLog(`Cash drawer kick error: ${err.message}`, 'error');
      toast.error('Could not open cash drawer');
      return false;
    }
  },
}));
