// The 80 mm bill, drawn from the owner's layout. Used for the on-screen preview, the printer and WhatsApp.
import { h, rupee, kg } from "./ui.js";

const g = (n) => (n >= 1000 ? (n / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 }) + " kg" : `${(n / 1000).toFixed(3)} kg`);
const lineName = (l, lay) => (l.form === "mix" && !lay.show_ratio ? l.item_name.replace(/ \d+\/\d+$/, "") : l.item_name);

export function receiptHtml(b, lay, { label = "", duplicate = false, taxApproved = false } = {}) {
  const head = [lay.address, lay.phone ? `Ph ${lay.phone}` : "", lay.gstin ? `GSTIN ${lay.gstin}` : ""].filter(Boolean).map((x) => `<div>${h(x)}</div>`).join("");
  const at = new Date(b.created_at).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "numeric", minute: "2-digit" });
  const status = b.status === "CANCELLED" ? `<div class="r-c r-big">*** CANCELLED ***</div>` : "";
  
  const logoClass = lay.logo_size === "small" ? "r-logo-sm" : lay.logo_size === "large" ? "r-logo-lg" : "r-logo-md";
  const hlCx = lay.highlight_customer !== false;

  // Tax Breakdown Calculation
  const hasTaxSplit = lay.show_tax_split !== false;
  const taxable = b.taxable_paise ?? Math.max(0, (b.total_paise || 0) - (b.gst_paise || 0));
  const cgst = b.cgst_paise ?? Math.round((b.gst_paise || 0) / 2);
  const sgst = b.sgst_paise ?? ((b.gst_paise || 0) - cgst);
  const igst = b.igst_paise ?? 0;

  let taxSection = "";
  if (lay.show_gst) {
    if (!taxApproved) {
      taxSection = `<div class="r-note">Tax details pending accountant approval</div>`;
    } else if (hasTaxSplit && b.gst_paise) {
      taxSection = `
        <div class="r-sec-title">TAX BREAKDOWN (Included in Total)</div>
        <div class="r-row r-sm"><span>Taxable Value</span><span>${rupee(taxable)}</span></div>
        ${igst ? `<div class="r-row r-sm"><span>IGST</span><span>${rupee(igst)}</span></div>`
               : `<div class="r-row r-sm"><span>CGST</span><span>${rupee(cgst)}</span></div>
                  <div class="r-row r-sm"><span>SGST</span><span>${rupee(sgst)}</span></div>`}
        <div class="r-row r-sm"><b>Total GST (Included)</b><b>${rupee(b.gst_paise)}</b></div>
      `;
    } else if (b.gst_paise) {
      taxSection = `<div class="r-row r-sm"><span>GST included in total</span><span>${rupee(b.gst_paise)}</span></div>`;
    }
  }

  // Payment Breakdown
  let paySection = "";
  if (lay.show_payments && b.payments && b.payments.length) {
    paySection = `
      <div class="r-sec-title">PAID BY</div>
      ${b.payments.map((p) => `<div class="r-row"><span>${h(p.method)}${p.reference ? " (" + h(p.reference) + ")" : ""}</span><span>${rupee(p.amount_paise)}</span></div>`).join("")}
      ${b.tendered_paise ? `
        <div class="r-row r-sm"><span>Cash Given</span><span>${rupee(b.tendered_paise)}</span></div>
        <div class="r-row r-sm"><span>Change Returned</span><span>${rupee(b.change_paise || 0)}</span></div>
      ` : ""}
    `;
  }

  return `<div class="receipt">
    ${lay.logo ? `<div class="r-c"><img class="r-logo ${logoClass}" src="${h(lay.logo)}" alt=""/></div>` : ""}
    <div class="r-c"><b class="r-shop">${h(lay.shop_name)}</b>${head}</div>
    ${label ? `<div class="r-copy">${h(label)}</div>` : ""}${duplicate ? `<div class="r-c"><b>DUPLICATE${b.reprints ? " " + b.reprints : ""}</b></div>` : ""}${status}
    <hr/>
    <div class="r-row"><span>Bill ${h(b.bill_no)}</span>${lay.show_time ? `<span>${h(at)}</span>` : ""}</div>
    ${lay.show_cashier ? `<div>Cashier: ${h(b.cashier)}</div>` : ""}
    ${b.client ? `<div class="${hlCx ? 'r-hl' : ''}"><b>Client: ${h(b.client.name)}</b>${b.client.client_type ? ` <small>(${h(b.client.client_type.toUpperCase())})</small>` : ""}</div>${[b.client.address, b.client.phone ? "Ph " + b.client.phone : "", b.client.gstin ? "GSTIN " + b.client.gstin : ""].filter(Boolean).map((x) => `<div>${h(x)}</div>`).join("")}`
      : lay.show_customer_name && b.customer_name ? `<div class="${hlCx ? 'r-hl' : ''}">Customer: ${h(b.customer_name)}</div>` : ""}
    ${lay.show_customer_phone && b.customer_phone ? `<div class="${hlCx ? 'r-hl' : ''}">Phone: ${h(b.customer_phone)}</div>` : ""}
    <hr/>
    ${b.lines.map((l) => `
      <div>${h(lineName(l, lay))}${lay.show_hsn && l.hsn_code ? ` <small class="r-muted">[HSN ${h(l.hsn_code)}]</small>` : ""}</div>
      <div class="r-row"><span>${l.form === "custom" ? (l.grams ? "&nbsp;" + g(l.grams) : "") : `&nbsp;${g(l.grams)} × ${rupee(l.rate_paise)}/kg`}</span><span>${rupee(l.amount_paise)}</span></div>
    `).join("")}
    <hr/>
    <div class="r-row"><span>Subtotal</span><span>${rupee(b.subtotal_paise)}</span></div>
    ${b.discount_paise ? `<div class="r-row"><span>Discount</span><span>-${rupee(b.discount_paise)}</span></div>` : ""}
    ${b.round_off_paise ? `<div class="r-row"><span>Round off</span><span>${b.round_off_paise > 0 ? "+" : "-"}${rupee(Math.abs(b.round_off_paise))}</span></div>` : ""}
    <div class="r-row r-big"><span>TOTAL</span><span>${rupee(b.total_paise)}</span></div>
    
    ${taxSection}
    <hr/>
    ${paySection}

    ${b.client ? `<hr/><div class="r-row"><span>Paid now</span><span>${rupee(b.paid_paise || 0)}</span></div>
      <div class="r-row"><b>This bill due</b><b>${rupee(b.due_paise || 0)}</b></div>
      ${b.balance_after_paise != null ? `<div class="r-row"><b>${b.balance_after_paise < 0 ? "Advance with us" : "Total balance due"}</b><b>${rupee(Math.abs(b.balance_after_paise))}</b></div>` : ""}` : ""}
    <hr/>
    ${lay.footer ? `<div class="r-c">${h(lay.footer)}</div>` : ""}
  </div>`;
}

// The same bill as a WhatsApp message (plain text).
export function waText(b, lay) {
  const L = [
    `*${lay.shop_name}*`,
    lay.address ? `${lay.address}` : null,
    `Bill: *${b.bill_no}*`,
    `Date: ${new Date(b.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}`,
    b.client ? `Client: ${b.client.name}` : (b.customer_name ? `Customer: ${b.customer_name}` : null),
    "--------------------------------",
    ...b.lines.map((l) => `${lineName(l, lay)}${l.grams ? " (" + g(l.grams) + ")" : ""} : ${rupee(l.amount_paise)}`),
    "--------------------------------",
    `Subtotal: ${rupee(b.subtotal_paise)}`,
  ].filter(Boolean);

  if (b.discount_paise) L.push(`Discount: -${rupee(b.discount_paise)}`);
  if (b.round_off_paise) L.push(`Round off: ${b.round_off_paise > 0 ? "+" : "-"}${rupee(Math.abs(b.round_off_paise))}`);
  L.push(`*TOTAL: ${rupee(b.total_paise)}*`);

  if (b.gst_paise) {
    L.push(`GST (included): ${rupee(b.gst_paise)}`);
  }

  if (b.payments && b.payments.length) {
    const payStr = b.payments.map((p) => `${p.method}${p.reference ? " (" + p.reference + ")" : ""}: ${rupee(p.amount_paise)}`).join(", ");
    L.push(`Paid by: ${payStr}`);
    if (b.tendered_paise) {
      L.push(`Cash Given: ${rupee(b.tendered_paise)}, Change: ${rupee(b.change_paise || 0)}`);
    }
  }

  if (b.client && b.due_paise != null) {
    L.push(`This bill due: ${rupee(b.due_paise)}`);
    if (b.balance_after_paise != null) {
      L.push(`Total balance due: ${rupee(Math.abs(b.balance_after_paise))}`);
    }
  }

  if (lay.footer) L.push(lay.footer);
  return L.join("\n");
}

export function waLink(b, lay, phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.length === 10) d = "91" + d;
  const msg = encodeURIComponent(waText(b, lay));
  // Windows WhatsApp Desktop custom scheme
  return `whatsapp://send?phone=${d}&text=${msg}`;
}

export const SAMPLE = {
  bill_no: "CTR-2610-0042", created_at: new Date().toISOString(), cashier: "Lakshmi", customer_name: "Ravi", customer_phone: "9876543210",
  status: "PAID", reprints: 0, subtotal_paise: 66500, discount_paise: 1000, round_off_paise: 0, total_paise: 65500,
  taxable_paise: 62381, gst_paise: 3119, cgst_paise: 1560, sgst_paise: 1559, igst_paise: 0,
  tendered_paise: 50000, change_paise: 10000,
  lines: [
    { item_name: "Premium powder 80/20", form: "mix", grams: 500, rate_paise: 78000, amount_paise: 39000, hsn_code: "0901" },
    { item_name: "Premium beans", form: "plain", grams: 250, rate_paise: 110000, amount_paise: 27500, hsn_code: "0901" }
  ],
  payments: [
    { method: "CASH", amount_paise: 40000, reference: "" },
    { method: "UPI", amount_paise: 25500, reference: "UTR1234" }
  ],
};
