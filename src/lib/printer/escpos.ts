/**
 * ESC/POS Binary Protocol Encoder for ATPOS 80mm & 58mm Thermal Receipt Printers.
 * Implements hardware commands for text formatting, tabular alignment, 
 * dynamic BharatQR / UPI QR code generation, cash drawer kick pulses, and auto paper cutting.
 */

export type PaperWidth = 80 | 58;

export class EscPosBuilder {
  private buffer: number[] = [];
  private cols: number;

  constructor(paperWidth: PaperWidth = 80) {
    this.cols = paperWidth <= 58 ? 32 : 48;
  }

  getColumns(): number {
    return this.cols;
  }

  // Raw byte appender
  raw(bytes: number[] | Uint8Array): this {
    if (bytes instanceof Uint8Array) {
      for (let i = 0; i < bytes.length; i++) {
        this.buffer.push(bytes[i]);
      }
    } else {
      this.buffer.push(...bytes);
    }
    return this;
  }

  // Initialize printer (ESC @)
  init(): this {
    return this.raw([0x1b, 0x40]);
  }

  // Text Alignment (ESC a n: 0=Left, 1=Center, 2=Right)
  align(alignment: 'left' | 'center' | 'right'): this {
    const val = alignment === 'center' ? 1 : alignment === 'right' ? 2 : 0;
    return this.raw([0x1b, 0x61, val]);
  }

  // Bold on/off (ESC E n)
  bold(enable: boolean): this {
    return this.raw([0x1b, 0x45, enable ? 1 : 0]);
  }

  // Double size on/off (GS ! n)
  doubleSize(enable: boolean): this {
    return this.raw([0x1d, 0x21, enable ? 0x11 : 0x00]);
  }

  // Double width only (GS ! n)
  doubleWidth(enable: boolean): this {
    return this.raw([0x1d, 0x21, enable ? 0x20 : 0x00]);
  }

  // Double height only (GS ! n)
  doubleHeight(enable: boolean): this {
    return this.raw([0x1d, 0x21, enable ? 0x01 : 0x00]);
  }

  // Underline (ESC - n: 0=off, 1=1-dot, 2=2-dot)
  underline(enable: boolean): this {
    return this.raw([0x1b, 0x2d, enable ? 1 : 0]);
  }

  // Inverted white on black (GS B n)
  invert(enable: boolean): this {
    return this.raw([0x1d, 0x42, enable ? 1 : 0]);
  }

  // Feed lines (ESC d n)
  feed(lines = 1): this {
    return this.raw([0x1b, 0x64, Math.max(1, lines)]);
  }

  // UTF-8 / ASCII text encoding
  text(str: string): this {
    if (!str) return this;
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    return this.raw(bytes);
  }

  // Text line with trailing newline
  textLn(str = ''): this {
    return this.text(str + '\n');
  }

  // Horizontal separator line
  line(char = '-'): this {
    return this.text(char.repeat(this.cols) + '\n');
  }

  // Two columns justified (Left text .... Right text)
  twoColumns(left: string, right: string): this {
    const remaining = this.cols - left.length - right.length;
    if (remaining < 1) {
      return this.text(`${left} ${right}\n`);
    }
    return this.text(`${left}${' '.repeat(remaining)}${right}\n`);
  }

  // Three column table row for items: Item, Qty/Rate, Amount
  tableRow(col1: string, col2: string, col3: string): this {
    if (this.cols >= 48) {
      // 80mm format: 24 cols for item name, 14 cols for Qty x Rate, 10 cols for Amount
      if (col1.length > 24) {
        this.textLn(col1);
        const padding = ' '.repeat(24);
        const middle = col2.padStart(13);
        const right = col3.padStart(10);
        return this.textLn(`${padding} ${middle} ${right}`);
      } else {
        const left = col1.padEnd(24);
        const middle = col2.padStart(13);
        const right = col3.padStart(10);
        return this.textLn(`${left} ${middle} ${right}`);
      }
    } else {
      // 58mm format: 14 cols for item name, 9 cols for Qty, 9 cols for Amount
      if (col1.length > 14) {
        this.textLn(col1);
        const padding = ' '.repeat(14);
        const middle = col2.padStart(9);
        const right = col3.padStart(9);
        return this.textLn(`${padding} ${middle} ${right}`);
      } else {
        const left = col1.padEnd(14);
        const middle = col2.padStart(14);
        const right = col3.padStart(8);
        return this.textLn(`${left} ${middle} ${right}`);
      }
    }
  }

  // Cash drawer kick pulse (ESC p 0 25 250)
  drawerKick(): this {
    return this.raw([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  }

  // Paper cut: partial cut with 4 line feeds (GS V 66 0)
  cut(partial = true): this {
    this.feed(3);
    if (partial) {
      return this.raw([0x1d, 0x56, 0x42, 0x00]);
    } else {
      return this.raw([0x1d, 0x56, 0x00]);
    }
  }

  // Native ESC/POS 2D QR Code Generation (GS ( k)
  qrCode(data: string, size = 6): this {
    if (!data) return this;
    const encoder = new TextEncoder();
    const payload = encoder.encode(data);
    const len = payload.length + 3;
    const pL = len & 0xff;
    const pH = (len >> 8) & 0xff;

    // 1. Select Model 2: GS ( k 4 0 49 65 50 0
    this.raw([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
    // 2. Set Module Size: GS ( k 3 0 49 67 size
    this.raw([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, Math.min(8, Math.max(3, size))]);
    // 3. Set Error Correction M: GS ( k 3 0 49 69 49
    this.raw([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]);
    // 4. Store Data: GS ( k pL pH 49 80 48 <data>
    this.raw([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]);
    this.raw(payload);
    // 5. Print the symbol: GS ( k 3 0 49 81 48
    this.raw([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);
    return this;
  }

  // Build final Uint8Array
  build(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

/**
 * Encodes a complete VTC Counter Bill into standard ATPOS ESC/POS thermal printer bytes.
 */
export function generateBillEscPos(
  bill: {
    bill_no: string;
    created_at?: string;
    cashier?: string;
    customer_name?: string;
    customer_phone?: string;
    subtotal_paise: number;
    discount_paise?: number;
    discount_reason?: string;
    total_paise: number;
    reprints?: number;
    header?: {
      company_name?: string;
      company_address?: string;
      company_gstin?: string;
    };
    lines: Array<{
      item_name: string;
      weight_kg: number;
      rate_paise: number;
      amount_paise: number;
    }>;
    payments: Array<{
      method: string;
      amount_paise: number;
      reference?: string;
    }>;
  },
  options: {
    paperWidth?: PaperWidth;
    copyLabel?: string;
    duplicate?: boolean;
    kickDrawer?: boolean;
    autoCut?: boolean;
    upiVpa?: string;
  } = {}
): Uint8Array {
  const paperWidth = options.paperWidth || 80;
  const builder = new EscPosBuilder(paperWidth);

  // Initialize
  builder.init();

  // Cash Drawer Kick pulse on CASH payment if configured
  const hasCash = bill.payments.some((p) => p.method === 'CASH');
  if (options.kickDrawer !== false && hasCash) {
    builder.drawerKick();
  }

  // 1. Header (Centered, bold, double height/width for company name)
  builder.align('center');
  builder.bold(true);
  builder.doubleSize(true);
  const companyName = bill.header?.company_name || 'VASAVI TRADING COMPANY';
  builder.textLn(companyName.toUpperCase());

  builder.doubleSize(false);
  builder.bold(false);

  const address = bill.header?.company_address || 'Coffee Roasters & Wholesale Merchants';
  if (address) builder.textLn(address);

  const gstin = bill.header?.company_gstin || '';
  if (gstin) builder.textLn(`GSTIN: ${gstin}`);

  builder.bold(true);
  builder.textLn('RETAIL TAX INVOICE / CASH MEMO');

  if (options.copyLabel) {
    builder.textLn(`[${options.copyLabel}]`);
  }
  if (options.duplicate || (bill.reprints && bill.reprints > 0)) {
    builder.textLn(`*** DUPLICATE COPY #${bill.reprints || 1} ***`);
  }
  builder.bold(false);

  // Divider
  builder.line('=');

  // 2. Bill Meta
  builder.align('left');
  const billDate = bill.created_at
    ? new Date(bill.created_at).toLocaleString('en-IN', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      })
    : new Date().toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });

  builder.twoColumns(`Bill: ${bill.bill_no}`, billDate);

  let cashierInfo = `Cashier: ${bill.cashier || 'Counter Staff'}`;
  if (bill.customer_name) {
    cashierInfo += ` | Cust: ${bill.customer_name}`;
  }
  if (bill.customer_phone) {
    cashierInfo += ` (${bill.customer_phone})`;
  }
  builder.textLn(cashierInfo);

  builder.line('-');

  // 3. Table Header
  builder.bold(true);
  if (paperWidth >= 80) {
    builder.tableRow('Item Description', 'Qty x Rate', 'Amount (Rs)');
  } else {
    builder.tableRow('Item', 'Qty', 'Amount');
  }
  builder.bold(false);
  builder.line('-');

  // 4. Line Items
  for (const line of bill.lines) {
    const qtyStr = line.weight_kg >= 1.0
      ? `${line.weight_kg.toFixed(3)}kg`
      : `${Math.round(line.weight_kg * 1000)}g`;
    const rateStr = (line.rate_paise / 100).toFixed(2);
    const amountStr = (line.amount_paise / 100).toFixed(2);

    const qtyRate = paperWidth >= 80 ? `${qtyStr} x ${rateStr}` : qtyStr;
    builder.tableRow(line.item_name, qtyRate, amountStr);
  }

  builder.line('-');

  // 5. Totals
  const subtotalStr = (bill.subtotal_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  builder.twoColumns('Subtotal:', `Rs. ${subtotalStr}`);

  if (bill.discount_paise && bill.discount_paise > 0) {
    const discStr = (bill.discount_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    const reasonStr = bill.discount_reason ? ` (${bill.discount_reason})` : '';
    builder.twoColumns(`Discount${reasonStr}:`, `- Rs. ${discStr}`);
  }

  builder.line('=');

  // 6. Net Total (Highlighted & Double size)
  builder.bold(true);
  builder.doubleSize(true);
  const totalStr = (bill.total_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  builder.twoColumns('NET PAYABLE:', `Rs. ${totalStr}`);
  builder.doubleSize(false);
  builder.bold(false);

  builder.line('=');

  // 7. Payment Modes
  builder.bold(true);
  builder.textLn('PAYMENT SUMMARY:');
  builder.bold(false);
  for (const p of bill.payments) {
    const amtStr = (p.amount_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    const refStr = p.reference ? ` [${p.reference}]` : '';
    builder.twoColumns(`  ${p.method}${refStr}:`, `Rs. ${amtStr}`);
  }

  // 8. Dynamic UPI QR Code for Instant Verification / Customer Scanning
  const upiVpa = options.upiVpa || 'vasavitrading@okhdfcbank';
  const totalRupees = (bill.total_paise / 100).toFixed(2);
  const upiPayload = `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=Vasavi%20Trading%20Company&am=${totalRupees}&cu=INR&tn=Bill%20${bill.bill_no}`;

  builder.feed(1);
  builder.align('center');
  builder.textLn('Scan with any UPI App to Pay/Verify:');
  builder.qrCode(upiPayload, 6);

  // 9. Brand Roastery Footer
  builder.feed(1);
  builder.align('center');
  builder.bold(true);
  builder.textLn('Thank You! Visit Again.');
  builder.bold(false);
  builder.textLn('VASAVI TRADING COMPANY · ESTD. 1965');
  builder.textLn('Store pure coffee powder in an airtight stainless steel or glass tin.');
  builder.textLn('Freshly Ground Aroma Guaranteed.');
  builder.feed(3);

  // 10. Auto Cut
  if (options.autoCut !== false) {
    builder.cut(true);
  }

  return builder.build();
}

/**
 * Generates an ATPOS hardware diagnostic test print payload.
 */
export function generateTestEscPos(paperWidth: PaperWidth = 80): Uint8Array {
  const builder = new EscPosBuilder(paperWidth);

  builder.init();
  builder.drawerKick(); // Test cash drawer

  builder.align('center');
  builder.bold(true);
  builder.doubleSize(true);
  builder.textLn('ATPOS HARDWARE TEST');
  builder.doubleSize(false);
  builder.bold(false);

  builder.line('=');
  builder.twoColumns('Model:', `ATPOS ${paperWidth}mm Thermal Bill Printer`);
  builder.twoColumns('Width:', `${builder.getColumns()} Columns`);
  builder.twoColumns('Time:', new Date().toLocaleTimeString('en-IN'));
  builder.line('-');

  builder.align('left');
  builder.textLn('Font Regular: ABCDEFGHIJKLMNOPQRSTUVWXYZ 1234567890');
  builder.bold(true);
  builder.textLn('Font Bold:    ABCDEFGHIJKLMNOPQRSTUVWXYZ 1234567890');
  builder.bold(false);
  builder.line('-');

  builder.align('center');
  builder.textLn('2D ESC/POS Dynamic Test QR:');
  builder.qrCode('https://vasavitrading.in/atpos-ready', 6);

  builder.feed(1);
  builder.bold(true);
  builder.textLn('*** ATPOS PRINTER READY ***');
  builder.textLn('Cash Drawer Kick: OK · Auto Cutter: OK');
  builder.bold(false);
  builder.feed(3);
  builder.cut(true);

  return builder.build();
}
