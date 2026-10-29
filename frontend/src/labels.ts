// v1.4: QR lot labels printed on the 80 mm receipt printer (one label per page, so the
// printer cuts between them). The QR holds the lot code; bag labels add "/bag number".

import { api } from "./api.js";
import { icon } from "./icons.js";
import { S } from "./state.js";
import { dialog, fail, field, h, num } from "./ui.js";

const STAGE = { RAW: "Raw beans", ROASTED: "Roasted", GROUND: "Ground", BLENDED: "Blend", PACKED: "Packed" };
export const fmtDay = (d) => (d ? new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

async function qrSvg(text) {
  const { default: qrcode } = await import("./vendor/qrcode.mjs");
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  return `<svg class="ql-qr" viewBox="0 0 ${n + 8} ${n + 8}" shape-rendering="crispEdges" aria-hidden="true"><rect width="100%" height="100%" fill="#fff"/><path d="${d}"/></svg>`;
}

function lines(lot, bag) {
  const out = [];
  if (lot.owner !== "VTC") out.push("Customer's own coffee");
  if (lot.stage === "RAW" && lot.receipt_code) {
    if (bag) out.push(`<b>Bag ${bag} of ${lot.bags || "?"}</b>${lot.bag_kind !== "PARTIAL" && lot.nominal_kg ? ` · ${num(lot.nominal_kg, 1)} kg` : ""}`);
    out.push(`Received ${fmtDay(lot.created_at)}`, `${h(lot.receipt_code)}${lot.supplier ? " · " + h(lot.supplier) : ""}`);
    if (lot.bag_kind === "DAMAGED") out.push("<b>DAMAGED — DO NOT USE until verified</b>");
  } else {
    if (lot.roasted_on) out.push(`Roasted ${fmtDay(lot.roasted_on)}${lot.roast_profile ? " · " + h(lot.roast_profile) : ""}`);
    if (lot.ready_from) out.push(`<b class="ql-ready">READY FROM ${fmtDay(lot.ready_from).toUpperCase()}</b>`);
    if (lot.pack_g) out.push(`${num(lot.pack_g, 0)} g packs`);
    if (lot.location === "IN_TRANSIT") out.push("On the way to the counter");
    out.push(`Lot ${num(lot.kg, 3)} kg`);
  }
  return out;
}

async function labelHtml(lot, bag = null) {
  const svg = await qrSvg(lot.code + (bag ? "/" + bag : ""));
  return `<div class="qr-label"><div class="ql-top"><b>VASAVI TRADING CO.</b><span>${h(STAGE[lot.stage] || lot.stage)}</span></div>
    <div class="ql-body">${svg}<div class="ql-txt"><div class="ql-code">${h(lot.code)}</div><div class="ql-bean">${h(lot.bean || lot.product || lot.name)}</div>
      ${lines(lot, bag).map((l) => `<div>${l}</div>`).join("")}</div></div></div>`;
}

function printHtml(html) {
  let area = document.getElementById("print-area");
  if (!area) { area = document.createElement("div"); area.id = "print-area"; document.body.appendChild(area); }
  area.innerHTML = html;
  window.print();
}

export async function printLabels(lot, from = 1, to = 1) {
  const bagged = lot.stage === "RAW" && lot.receipt_code && lot.bags;
  const html = [];
  for (let i = from; i <= to; i++) html.push(await labelHtml(lot, bagged ? i : null));
  printHtml(html.join(""));
}

/** Ask how many labels, then print. `lot` is a lot row (with code) or a lot id. */
export async function offerLabels(lot, { copies = 1, title = null } = {}) {
  try { if (typeof lot !== "object") lot = (await api(`/lots/find?id=${lot}`)).lot; } catch (e) { return fail(e); }
  const bagged = lot.stage === "RAW" && lot.receipt_code && lot.bags;
  const preview = await labelHtml(lot, bagged ? 1 : null);
  const f = await dialog({ title: title || `Labels for ${lot.code}`, submit: "Print labels",
    body: `<div class="label-preview">${preview}</div>
      ${bagged ? `<div class="form-grid">${field("from", "From bag", "number", `required min="1" max="${lot.bags}" value="1"`)}${field("to", "To bag", "number", `required min="1" max="${lot.bags}" value="${lot.bags}"`)}</div>
        <p class="tiny">One label per bag, numbered. Stick one on each bag.</p>`
        : field("copies", "How many labels", "number", `required min="1" max="200" value="${copies}"`)}
      <p class="tiny">${icon("printer", 14)} Prints on the 80 mm bill printer; each label is cut separately.</p>` });
  if (!f) return;
  if (bagged) await printLabels(lot, Math.min(+f.from, +f.to), Math.max(+f.from, +f.to));
  else await printLabels(lot, 1, Math.max(1, Math.min(200, +f.copies || 1)));
}

/** After a stock input: one dialog for every bag label of the new lots. */
export async function offerBagLabels(receipt) {
  const lots = receipt.lots || [], total = lots.reduce((n, x) => n + x.bags, 0);
  if (!total) return;
  const f = await dialog({ title: `${receipt.code} saved — print bag labels?`, submit: `Print ${total} label${total > 1 ? "s" : ""}`,
    body: `<p class="sub">${lots.map((x) => `<b>${h(x.code)}</b> · ${x.bags} bag${x.bags > 1 ? "s" : ""}`).join("<br>")}</p>
      <p class="tiny">Stick one on each bag. Scanning any bag opens its lot. You can reprint later from the lot.</p>` });
  if (!f) return;
  const html = [];
  for (const x of lots) {
    const lot = (await api(`/lots/find?id=${x.id}`)).lot;
    for (let i = 1; i <= x.bags; i++) html.push(await labelHtml(lot, i));
  }
  printHtml(html.join(""));
}

/** "Just saved" strip under the page title with a one-tap label print (no pop-up in the way). */
export function savedBanner() {
  const x = S.saved;
  if (!x || x.view !== S.view) return "";
  const bags = x.receipt ? x.receipt.lots.reduce((n, l) => n + l.bags, 0) : 0;
  const btn = x.receipt ? (bags ? `<button class="btn btn-primary" data-baglabels>${icon("qr-code", 16)} Print ${bags} bag label${bags > 1 ? "s" : ""}</button>` : "")
    : `<button class="btn btn-primary" data-label="${x.lot_id}">${icon("qr-code", 16)} Print label${x.copies > 1 ? "s" : ""}</button>`;
  return `<div class="saved-banner" role="status">${icon("circle-check", 20)}<div class="sb-txt"><b>${h(x.title)}</b>${x.note ? `<span class="tiny">${h(x.note)}</span>` : ""}</div>
    ${btn}<button class="icon-btn" data-savedclose aria-label="Dismiss">${icon("x", 16)}</button></div>`;
}
