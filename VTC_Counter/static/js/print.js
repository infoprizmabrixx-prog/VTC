// Printing: one press = one bill on the ATPOS 80 mm printer.
// Main way: the counter server sends the bill straight to the printer (ESC/POS) — no browser involved.
// Fallback (Setup → Printer → "Through the browser"): the PC marked "print station" prints from Chrome.
import { api } from "./api.js";
import { receiptHtml } from "./receipt.js";
import { fail, toast } from "./ui.js";

const KEY = "vtcPrintStation";
export const isStation = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
export const setStation = (on) => { try { on ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY); } catch { /* storage blocked */ } };

const PRINT_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: 72mm; margin: 0 4mm; padding: 2mm 0 6mm; font: 12px/1.4 "Courier New", ui-monospace, monospace; color: #000; }
  .r-c { text-align: center; } .r-row { display: flex; justify-content: space-between; gap: 6px; }
  .r-big { font-weight: 800; font-size: 15px; } .r-shop { font-size: 15px; }
  .r-note { font-size: 10px; text-align: center; margin: 2px 0; }
  .r-copy { text-align: center; border: 1px solid #000; font-weight: 800; margin: 4px 0; }
  .r-logo { max-width: 46mm; max-height: 24mm; filter: grayscale(1) contrast(1.4); }
  hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }`;

let busy = Promise.resolve();

// Print one bill. Queued so two prints never mix on the paper.
export function printBill(bill, layout, opts) {
  busy = busy.then(() => printHtml(receiptHtml(bill, layout, opts))).catch(() => {});
  return busy;
}

function printHtml(inner) {
  return new Promise((resolve) => {
    const f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true");
    f.style.cssText = "position:fixed;right:0;bottom:0;width:80mm;height:10px;border:0;visibility:hidden";
    document.body.appendChild(f);
    const doc = f.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${PRINT_CSS}</style><style id="page"></style></head><body>${inner}</body></html>`);
    doc.close();
    const go = () => {
      const mm = Math.ceil((doc.body.scrollHeight * 25.4) / 96) + 8;
      // No custom page size: Chrome fits a custom size onto the driver's paper and may turn and shrink it.
      // Zero margins keep Chrome from adding its date and "1/1" lines.
      doc.getElementById("page").textContent = "@page { margin: 0; }";
      const win = f.contentWindow;
      if (window.__vtcPrintTest) { window.__vtcPrintTest(doc.documentElement.outerHTML, mm); f.remove(); return resolve(); }   // browser tests only
      const finish = () => { setTimeout(() => f.remove(), 1500); resolve(); };
      win.addEventListener("afterprint", finish, { once: true });
      win.focus();
      win.print();
      setTimeout(finish, 15000);   // some browsers never fire afterprint
    };
    const imgs = [...doc.images].filter((i) => !i.complete);
    if (!imgs.length) return setTimeout(go, 50);
    let left = imgs.length;
    imgs.forEach((i) => (i.onload = i.onerror = () => --left || go()));
  });
}

async function printJob(got) {
  const { job, bill, layout, tax_approved } = got;
  await printBill(bill, layout, { label: job.label === "CUSTOMER COPY" ? "" : job.label, duplicate: !!job.duplicate, taxApproved: tax_approved });
  await api(`/print-jobs/${job.id}/done`, "POST");
}

// Ask for one bill to be printed. On the print station it prints here at once; elsewhere it goes to the PC.
export async function requestPrint(billId, copy = "customer") {
  try {
    const r = await api(`/bills/${billId}/print`, "POST", { copy }), job_id = r.job_id;
    if (r.direct) {   // the counter server sent it straight to the ATPOS printer
      if (r.ok) toast("Printed.");
      else toast(`Not printed: ${r.error} Check the printer is on, has paper, then reprint from Today's bills.`, true);
      return r.ok;
    }
    if (isStation()) {
      const got = await api(`/print-jobs/${job_id}/claim`, "POST");
      if (got.job) await printJob(got);
    } else toast("Sent to the counter PC printer.");
  } catch (e) { fail(e); }
}

// On the print station: keep waiting for bills from the tablet and print each one once.
let running = false;
export async function startStation() {
  if (running || !isStation()) return;
  running = true;
  while (isStation()) {
    try {
      const got = await api("/print-jobs/next?wait=25");
      if (got.job) await printJob(got);
    } catch (e) {
      if (e.status === 401) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  running = false;
}
