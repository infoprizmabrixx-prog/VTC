import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Printer,
  Usb,
  Wifi,
  Bluetooth,
  X,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Scissors,
  Sliders,
  Terminal,
  Activity,
} from 'lucide-react';
import { usePrinterStore } from '../../lib/printer/printer-store';
import { atposDevice } from '../../lib/printer/atpos-device';

interface AtposPrinterSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AtposPrinterSettingsModal: React.FC<AtposPrinterSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    transport,
    setTransport,
    status,
    deviceName,
    paperWidth,
    setPaperWidth,
    autoCut,
    setAutoCut,
    autoDrawerKick,
    setAutoDrawerKick,
    copies,
    setCopies,
    networkIp,
    networkPort,
    setNetworkConfig,
    upiVpa,
    setUpiVpa,
    connectUsb,
    connectSerial,
    connectBluetooth,
    disconnect,
    runTestPrint,
    kickDrawer,
    logs,
  } = usePrinterStore();

  const [ipInput, setIpInput] = useState(networkIp);
  const [portInput, setPortInput] = useState(networkPort.toString());
  const [upiInput, setUpiInput] = useState(upiVpa);
  const [baudRate, setBaudRate] = useState<number>(9600);
  const [isTesting, setIsTesting] = useState(false);

  if (!isOpen) return null;

  const handleSaveNetwork = () => {
    setNetworkConfig(ipInput, parseInt(portInput) || 9100);
    setUpiVpa(upiInput);
  };

  const handleTestPrint = async () => {
    setIsTesting(true);
    await runTestPrint();
    setIsTesting(false);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 15 }}
          className="glass-card-elevated max-w-xl w-full p-6 rounded-2xl border border-white/10 space-y-5 text-white"
        >
          {/* Header */}
          <div className="flex items-start justify-between pb-3 border-b border-white/10">
            <div>
              <span className="text-[10px] font-mono uppercase text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                Hardware Communication Hub
              </span>
              <h3 className="text-base font-bold text-white mt-1 flex items-center gap-2">
                <Printer className="w-5 h-5 text-amber-400" />
                ATPOS 80mm/58mm Thermal Printer Setup
              </h3>
              <p className="text-xs text-stone-400">
                Direct WebUSB, Virtual COM Port, Bluetooth, & Raw TCP 9100 Driver
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-stone-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Current Device Status Card */}
          <div className="p-4 rounded-xl bg-stone-950/80 border border-white/10 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-mono text-stone-400">Active Printer Device</span>
              <div className="text-sm font-bold text-white flex items-center gap-2">
                {deviceName}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    status === 'connected'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : status === 'connecting'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                      : 'bg-stone-800 text-stone-400 border border-white/5'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-emerald-400' : 'bg-stone-500'}`} />
                  {status.toUpperCase()}
                </span>
                <span className="text-stone-400 text-[11px]">
                  Mode: <b className="text-amber-300">{transport.toUpperCase()}</b> · Width: <b className="text-amber-300">{paperWidth}mm</b>
                </span>
              </div>
            </div>

            {status === 'connected' ? (
              <button
                type="button"
                onClick={() => disconnect()}
                className="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold transition-colors"
              >
                Disconnect
              </button>
            ) : null}
          </div>

          {/* Connection Interface Selector */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-stone-300">Choose Hardware Interface</label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { id: 'webusb', label: 'Direct USB', icon: Usb, desc: 'Plug & Play' },
                { id: 'webserial', label: 'COM Port', icon: Activity, desc: 'Virtual COM' },
                { id: 'bluetooth', label: 'Bluetooth', icon: Bluetooth, desc: 'Wireless POS' },
                { id: 'network', label: 'Network/LAN', icon: Wifi, desc: 'TCP Port 9100' },
              ].map((item) => {
                const Icon = item.icon;
                const active = transport === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTransport(item.id as any)}
                    className={`p-3 rounded-xl text-left border transition-all flex flex-col justify-between ${
                      active
                        ? 'bg-amber-500/20 border-amber-500/50 text-white shadow-md shadow-amber-500/10'
                        : 'bg-white/5 hover:bg-white/10 border-white/10 text-stone-400'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${active ? 'text-amber-400' : 'text-stone-400'}`} />
                    <div className="mt-2">
                      <div className="text-xs font-bold text-white">{item.label}</div>
                      <div className="text-[10px] text-stone-400">{item.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dynamic Connection Controls based on selected Interface */}
          <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-3">
            {transport === 'webusb' && (
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white">WebUSB Direct Raw Protocol</h4>
                  <p className="text-[11px] text-stone-400">
                    Communicates with ATPOS USB printers without print driver spooler latency.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => connectUsb()}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-amber-500/20"
                >
                  <Usb className="w-3.5 h-3.5" /> Connect USB Printer
                </button>
              </div>
            )}

            {transport === 'webserial' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-white">Virtual Serial COM Port</h4>
                    <p className="text-[11px] text-stone-400">
                      Standard for ATPOS USB-to-UART bridge chips (CH340, PL2303, FTDI).
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={baudRate}
                      onChange={(e) => setBaudRate(parseInt(e.target.value))}
                      className="text-xs p-2 rounded-xl bg-stone-900 border border-white/15 text-white"
                    >
                      <option value="9600">9600 Baud (Standard)</option>
                      <option value="19200">19200 Baud</option>
                      <option value="38400">38400 Baud</option>
                      <option value="115200">115200 Baud</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => connectSerial(baudRate)}
                      className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs"
                    >
                      Pick COM Port
                    </button>
                  </div>
                </div>
              </div>
            )}

            {transport === 'bluetooth' && (
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white">WebBluetooth Wireless Connection</h4>
                  <p className="text-[11px] text-stone-400">
                    Pair with portable 58mm/80mm ATPOS Bluetooth belt printers.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => connectBluetooth()}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs flex items-center gap-1.5"
                >
                  <Bluetooth className="w-3.5 h-3.5" /> Pair Bluetooth
                </button>
              </div>
            )}

            {transport === 'network' && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="text-[10px] text-stone-300">Printer LAN IP Address</label>
                    <input
                      type="text"
                      value={ipInput}
                      onChange={(e) => setIpInput(e.target.value)}
                      placeholder="192.168.1.200"
                      className="w-full text-xs font-mono p-2 rounded-xl bg-stone-900 border border-white/15 text-white mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-stone-300">Port (Default: 9100)</label>
                    <input
                      type="number"
                      value={portInput}
                      onChange={(e) => setPortInput(e.target.value)}
                      placeholder="9100"
                      className="w-full text-xs font-mono p-2 rounded-xl bg-stone-900 border border-white/15 text-white mt-1"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSaveNetwork}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white"
                >
                  Save Network Config
                </button>
              </div>
            )}
          </div>

          {/* Hardware Feature Flags: Width, Auto-Cut, Cash Drawer Kick */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-stone-950/80 border border-white/10 space-y-2">
              <span className="font-bold text-stone-200">Thermal Paper Width</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaperWidth(80)}
                  className={`py-1.5 rounded-lg font-bold border ${
                    paperWidth === 80
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-white/5 text-stone-400 border-white/10'
                  }`}
                >
                  80mm (48 Cols)
                </button>
                <button
                  type="button"
                  onClick={() => setPaperWidth(58)}
                  className={`py-1.5 rounded-lg font-bold border ${
                    paperWidth === 58
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-white/5 text-stone-400 border-white/10'
                  }`}
                >
                  58mm (32 Cols)
                </button>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-stone-950/80 border border-white/10 space-y-2">
              <span className="font-bold text-stone-200">Hardware Automation</span>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer text-stone-300">
                  <input
                    type="checkbox"
                    checked={autoCut}
                    onChange={(e) => setAutoCut(e.target.checked)}
                    className="accent-amber-500 rounded"
                  />
                  Auto Paper Cutter on bill end
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-stone-300">
                  <input
                    type="checkbox"
                    checked={autoDrawerKick}
                    onChange={(e) => setAutoDrawerKick(e.target.checked)}
                    className="accent-amber-500 rounded"
                  />
                  Pulse Cash Drawer on Cash Sale
                </label>
              </div>
            </div>
          </div>

          {/* Diagnostic Controls */}
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              disabled={isTesting}
              onClick={handleTestPrint}
              className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-stone-950 font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50 shadow-md"
            >
              <Printer className="w-4 h-4" />
              {isTesting ? 'Sending Test...' : 'Test ATPOS Thermal Print'}
            </button>
            <button
              type="button"
              onClick={() => kickDrawer()}
              className="py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-stone-200 font-bold text-xs border border-white/10 flex items-center justify-center gap-1.5"
            >
              <KeyRound className="w-4 h-4 text-emerald-400" />
              Test Cash Drawer Kick
            </button>
          </div>

          {/* Diagnostic Terminal Logs */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-stone-400 uppercase font-mono">
              <span className="flex items-center gap-1">
                <Terminal className="w-3.5 h-3.5 text-stone-400" /> Hardware Diagnostic Stream
              </span>
              <span>{logs.length} entries</span>
            </div>
            <div className="bg-stone-950 p-2.5 rounded-xl border border-white/10 font-mono text-[10px] h-24 overflow-y-auto space-y-1 text-stone-400 select-text">
              {logs.map((log, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="text-stone-600 shrink-0">[{log.time}]</span>
                  <span
                    className={
                      log.type === 'success'
                        ? 'text-emerald-400'
                        : log.type === 'error'
                        ? 'text-rose-400'
                        : log.type === 'warn'
                        ? 'text-amber-400'
                        : 'text-stone-300'
                    }
                  >
                    {log.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
