// Outgoing Sales, customer credit, Dispatch & delivery, Finance (receivables,
// supplier payables, Tally export), Exception centre, Reports. (DPR §10–§12)

import { api, newKey } from "../api.js";
import { icon } from "../icons.js";
import { t } from "../i18n.js";
import { S, can, nav } from "../state.js";
import { check, chip, confirmBox, dialog, fail, field, h, num, pageHead, select, table, tag, toast, when } from "../ui.js";
import { discussBtn } from "./comms.js";
import { waOrder, waReminder } from "../whatsapp.js";
import { fmtDay } from "../labels.js";

const eyebrow = () => `${S.me.settings.short_name} / ${S.me.user.role_name}`;
const rupee = (p) => (p == null ? "—" : "₹" + (Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const FORM = { RAW: "Green / raw beans", ROASTED: "Roasted beans", BLENDED: "Blended roasted", GROUND: "Ground coffee", PACKED: "Packed (finished packs)" };
const MODE = { RAPIDO: "Rapido", UBER: "Uber", OTHER_APP: "Other delivery app", CUSTOMER_PICKUP: "Customer pickup", CUSTOMER_VEHICLE: "Customer's vehicle", VTC_DELIVERY: "VTC delivery" };
// v1.3: open the delivery app to book. Rapido has no public booking link, so its app opens
// (Android) or its store page (iPhone), with the drop address copied to paste in. Uber gets the drop address.
const UA = navigator.userAgent, ANDROID = /Android/i.test(UA), IOS = /iPhone|iPad|iPod/i.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const RIDE = {
  RAPIDO: () => ANDROID ? `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=com.rapido.passenger;S.browser_fallback_url=${encodeURIComponent("https://play.google.com/store/apps/details?id=com.rapido.passenger")};end`
    : IOS ? "https://apps.apple.com/in/app/rapido-bike-taxi-auto-cabs/id1198464606" : "https://www.rapido.bike/",
  // shortcut: Uber documents a client_id for this link; works without one today, register an Uber app if it stops
  UBER: (addr) => `https://m.uber.com/ul/?action=setPickup&pickup=my_location${addr ? `&dropoff[formatted_address]=${encodeURIComponent(addr)}` : ""}`,
};
async function openRide(mode, addr) {
  if (addr) { try { await navigator.clipboard.writeText(addr); toast(`Drop address copied. Paste it in ${MODE[mode]}.`); } catch { /* clipboard blocked: address is shown on screen */ } }
  const url = RIDE[mode](addr);
  if (url.startsWith("intent:")) location.href = url; else window.open(url, "_blank", "noopener");
}
const STATE_TAG = { DRAFT: "hold", CREDIT_REVIEW: "hold", CONFIRMED: "hold", RESERVED: "hold", DISPATCHED: "hold", DELIVERED: "DONE", CANCELLED: "REJECTED" };
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

function printDoc(html) {
  let area = document.getElementById("print-area");
  if (!area) { area = document.createElement("div"); area.id = "print-area"; document.body.appendChild(area); }
  area.innerHTML = `<div class="a4">${html}</div>`;
  window.print();
}

// ================================================================= orders
export const orders = {
  paths() {
    const s = (S.sub ||= { tab: "orders" });
    return ["/orders", ...(can("outgoing.create") ? ["/masters?kind=customer", "/masters?kind=product"] : []), ...(s.tab === "credit" ? ["/customers/credit"] : [])];
  },
  render() {
    const s = S.sub, rows = S.data["/orders"];
    const tabs = [["orders", "Orders", true], ["credit", "Customer credit", can("outgoing.credit.approve")]].filter((x) => x[2]);
    const money = can("outgoing.price_override") || can("documents.commercial") || can("finance.view");
    const body = s.tab === "credit" ? creditTab() : `<section class="card">${table(["Order", "Customer", "What", "Qty", ...(money ? ["Price"] : []), "Credit", "State", ""], rows.map((o) => {
      const acts = [];
      if (o.state === "DRAFT" && can("outgoing.price_override")) acts.push(`<button class="btn btn-small" data-oprice="${o.id}">${o.price_per_kg_paise ? "Change price" : "Set price"}</button>`);
      if (o.state === "DRAFT" && can("outgoing.create")) acts.push(`<button class="btn btn-small btn-primary" data-oconfirm="${o.id}">Confirm</button>`);
      if (o.state === "CREDIT_REVIEW" && can("outgoing.credit.approve")) acts.push(o.created_by === S.me.user.id ? '<span class="tiny">Credit decision by someone else</span>' : `<button class="btn btn-small" data-ocredit="${o.id}">Credit decision</button>`);
      if (o.state === "CONFIRMED") acts.push(`<button class="btn btn-small" data-oreserve="${o.id}">Reserve stock</button>`);
      if (!o.credit_requested && ["CONFIRMED", "RESERVED"].includes(o.state) && !o.cleared && can("finance.collection.verify")) acts.push(`<button class="btn btn-small" data-oadvance="${o.id}">Record payment</button>`);
      if (["DRAFT", "CREDIT_REVIEW", "CONFIRMED", "RESERVED"].includes(o.state) && !o.dispatched_kg && can("outgoing.create")) acts.push(`<button class="btn btn-small btn-danger" data-ocancel="${o.id}">Cancel</button>`);
      o.invoices.forEach((i) => acts.push(`<button class="btn btn-small btn-quiet" data-invoice="${i.id}">${h(i.number)}</button>`));
      if (o.customer_phone && ["CONFIRMED", "RESERVED", "DISPATCHED"].includes(o.state)) acts.push(`<button class="btn btn-small wa" data-waorder="${o.id}" aria-label="Send order confirmation on WhatsApp">${icon("message-circle", 14)} WhatsApp</button>`);
      return `<tr><td><b>#${o.id}</b><br><span class="tiny">${when(o.created_at)}</span></td><td>${h(o.customer)}</td><td>${h(o.item)}<br><span class="tiny">${FORM[o.form] || o.form}</span></td>
        <td>${num(o.quantity_kg, 3)} kg${o.dispatched_kg ? `<br><span class="tiny">${num(o.dispatched_kg, 3)} sent</span>` : ""}${o.reserved_kg ? `<br><span class="tiny">${num(o.reserved_kg, 3)} reserved</span>` : ""}</td>
        ${money ? `<td>${o.price_per_kg_paise ? rupee(o.price_per_kg_paise) + "/kg" : '<span class="tiny">not set</span>'}${o.gst_rate_bp != null ? `<br><span class="tiny">GST ${o.gst_rate_bp / 100}%</span>` : ""}</td>` : ""}
        <td>${o.credit_requested ? "Credit" : "Pay first"}${o.credit_note ? `<br><span class="tiny">${h(o.credit_note)}</span>` : ""}</td>
        <td>${tag(STATE_TAG[o.state], o.state.replace("_", " "))}</td><td class="nowrap">${acts.join(" ")}${discussBtn("order", o.id)}</td></tr>`;
    }), "No orders yet.")}</section>`;
    return pageHead(eyebrow(), t("orders"), "Orders to cafés and dealers: price, credit, stock reservation, then dispatch.",
      can("outgoing.create") && s.tab !== "credit" ? '<button class="btn btn-primary" data-action="newOrder">+ New order</button>' : "") +
      (tabs.length > 1 ? `<div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${s.tab === k ? "on" : ""}" data-stab="${k}">${l}</button>`).join("")}</div>` : "") + body;
  },
};

function creditTab() {
  const rows = S.data["/customers/credit"];
  return `<p class="sub">Credit limits and due days are set by you, per customer (O-08). Customers with overdue invoices go on hold automatically.</p>
    <section class="card">${table(["Customer", "Credit limit", "Due in", "Owes now", "Overdue", ""], rows.map((r) =>
      `<tr><td><b>${h(r.name)}</b></td><td>${r.credit_limit_paise == null ? '<span class="tiny">No credit</span>' : rupee(r.credit_limit_paise)}</td><td>${r.due_days == null ? "—" : r.due_days + " days"}</td>
       <td>${rupee(r.open_paise)}</td><td>${r.overdue.length ? chip(r.overdue.length + " overdue", "bad") : "—"}</td>
       <td><button class="btn btn-small" data-terms="${r.id}">Set terms</button></td></tr>`), "Add customers in Master Data first.")}</section>`;
}

async function newOrder() {
  const customers = (S.data["/masters?kind=customer"] || []).filter((c) => c.state === "ACTIVE");
  if (!customers.length) return toast("Add the customer in Master Data first.", true);
  const products = (S.data["/masters?kind=product"] || []).filter((p) => p.state === "ACTIVE");
  const priceFields = can("outgoing.price_override") ? `<div class="form-grid">${field("price", "Price per kg (₹, before GST)", "number", 'min="0.01" step="0.01"')}${field("gst", "GST %", "number", 'min="0" max="28" step="0.01"', "From your accountant")}</div>` : '<p class="tiny">A manager or admin sets the price before confirming.</p>';
  const f = await dialog({ title: "New outgoing order", submit: "Save draft",
    body: `${select("customer_id", "Customer", customers.map((c) => [c.id, c.name]))}
      ${select("form", "What form?", Object.entries(FORM), "", "ROASTED")}
      <div id="rawBox" hidden>${select("product_id", "Which green coffee?", [["", "Choose"], ...products.map((p) => [p.id, p.name])])}</div>
      ${field("item", "Description on the order", "text", 'required minlength="2" maxlength="120" placeholder="e.g. Filter blend roast, medium"')}
      ${field("quantity_kg", "Quantity (kg)", "number", 'required min="0.001" step="0.001"')}
      ${priceFields}
      ${can("outgoing.credit.request") ? check("credit_requested", "Customer pays later (credit)", false, "Needs approved credit terms; otherwise payment must come before dispatch") : ""}
      ${field("notes", "Notes", "text", 'maxlength="300"')}`,
    onReady(d) { const fm = d.querySelector("[name=form]"); fm.addEventListener("change", () => (d.querySelector("#rawBox").hidden = fm.value !== "RAW")); } });
  if (!f) return;
  try {
    await api("/orders", "POST", { customer_id: Number(f.customer_id), form: f.form, product_id: f.product_id ? Number(f.product_id) : null, item: f.item,
      quantity_kg: Number(f.quantity_kg), credit_requested: !!f.credit_requested, notes: f.notes,
      price_per_kg_paise: f.price ? Math.round(Number(f.price) * 100) : null, gst_rate_bp: f.gst === "" || f.gst == null ? null : Math.round(Number(f.gst) * 100) });
    toast("Order saved as draft. Confirm it to reserve stock.");
    await nav.go("orders", S.sub);
  } catch (e) { fail(e); }
}

async function invoiceDialog(id) {
  try {
    const i = await api(`/invoices/${id}`);
    const hd = i.header;
    const html = `<div class="doc"><div class="doc-head"><div><h2>${h(hd.company_name)}</h2><div>${h(hd.company_address || "")}</div>${hd.company_gstin ? `<div>GSTIN ${h(hd.company_gstin)}</div>` : ""}</div>
      <div class="doc-title"><b>TAX INVOICE</b><br>${h(i.number)}<br>${new Date(i.created_at).toLocaleDateString("en-IN")}</div></div>
      ${hd.tax_setup_approved ? "" : '<div class="doc-warn">DRAFT FORMAT — GST/invoice layout pending accountant approval (O-17). Do not issue as a legal invoice.</div>'}
      <p><b>Bill to:</b> ${h(i.customer)}</p>
      <table class="doc-table"><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
      <tr><td>${h(i.item)} (${FORM[i.form] || i.form})</td><td>${num(i.taxable_paise / i.price_per_kg_paise, 3)} kg</td><td>${rupee(i.price_per_kg_paise)}/kg</td><td>${rupee(i.taxable_paise)}</td></tr>
      <tr><td colspan="3">GST ${i.gst_rate_bp != null ? i.gst_rate_bp / 100 + "%" : "(rate not set)"}</td><td>${rupee(i.gst_paise)}</td></tr>
      <tr><td colspan="3"><b>Total</b></td><td><b>${rupee(i.total_paise)}</b></td></tr></table>
      <p>Due date: <b>${h(i.due_date)}</b> · Status: ${h(i.status.replace("_", " "))}</p></div>`;
    await dialog({ title: `Invoice ${i.number}`, submit: null, wide: true, body: `<div class="doc-preview">${html}</div><div class="row mt"><button type="button" class="btn btn-primary" data-pdoc>🖨 Print / save as PDF</button></div>`,
      onReady(d) { d.querySelector("[data-pdoc]").addEventListener("click", () => printDoc(html)); } });
  } catch (e) { fail(e); }
}

// ================================================================= dispatch
export const dispatch = {
  paths: () => ["/orders"],
  render() {
    const rows = S.data["/orders"];
    const ready = rows.filter((o) => o.state === "RESERVED");
    const waiting = rows.flatMap((o) => o.dispatches.filter((d) => !d.delivered_at).map((d) => ({ ...d, order: o })));
    const done = rows.flatMap((o) => o.dispatches.filter((d) => d.delivered_at).map((d) => ({ ...d, order: o }))).slice(-20).reverse();
    return pageHead(eyebrow(), t("dispatch"), "Hand over reserved orders and confirm delivery. Opening a delivery app is not a booking: enter the real booking reference.") +
      `<section class="card"><h3>Ready to go (${ready.length})</h3>${table(["Order", "Customer", "Still to send", "Cleared?", ""], ready.map((o) =>
        `<tr><td><b>#${o.id}</b> ${h(o.item)}</td><td>${h(o.customer)}</td><td>${num(o.quantity_kg - o.dispatched_kg, 3)} kg</td>
         <td>${o.cleared ? tag("DONE", o.clearance_note) : tag("BLOCKED", o.clearance_note)}</td>
         <td class="nowrap"><button class="btn btn-small" data-slip="${o.id}">Pick slip</button> ${can("dispatch.handover") ? `<button class="btn btn-small btn-primary" data-dispatch="${o.id}:${o.quantity_kg - o.dispatched_kg}" ${o.cleared ? "" : "disabled"}>Hand over</button>` : ""}</td></tr>`), "Nothing reserved and waiting.")}${!ready.length && can("outgoing.view") ? `<p class="tiny mt">Orders appear here once they are confirmed and their stock is reserved. <button class="btn btn-small" data-go="orders">Open Outgoing Sales →</button></p>` : ""}</section>
      <section class="card mt"><h3>On the way — confirm delivery (${waiting.length})</h3>${table(["Dispatch", "Order", "How", "Kg", "Handed to", "When", ""], waiting.map((d) =>
        `<tr><td>#${d.id}</td><td>#${d.order.id} ${h(d.order.customer)}</td><td>${MODE[d.mode]}${d.booking_ref ? `<br><span class="tiny">${h(d.booking_ref)}</span>` : ""}</td><td>${num(d.kg, 3)}</td><td>${h(d.handover_to)}</td><td>${when(d.created_at)}</td>
         <td>${can("dispatch.handover") ? `<button class="btn btn-small" data-deliver="${d.id}:${d.kg}">Confirm delivery</button>` : ""}</td></tr>`), "Nothing on the way.")}</section>
      <section class="card mt"><h3>Recently delivered</h3>${table(["Dispatch", "Order", "Sent", "Delivered", "Proof"], done.map((d) =>
        `<tr><td>#${d.id}</td><td>#${d.order.id} ${h(d.order.customer)}</td><td>${num(d.kg, 3)} kg</td><td>${num(d.delivered_kg, 3)} kg ${d.delivered_kg < d.kg ? chip("short", "bad") : ""}</td><td>${h(d.pod_note || "")}</td></tr>`), "No deliveries yet.")}</section>`;
  },
};

// ================================================================= finance
const FIN_TABS: [string, string, () => boolean][] = [
  ["recv", "Customer receivables", () => can("finance.view") || can("finance.collection.record") || can("finance.collection.verify")],
  ["pay", "Supplier payables", () => can("finance.view")],
  ["tally", "Tally export", () => can("finance.export")],
  ["old", "Old dues", () => can("finance.view") || can("finance.collection.record") || can("finance.collection.verify") || can("supplier.pay.record")],   // v1.6: dues from before the portal (go-live setup)
];
export const finance = {
  paths() {
    const s = (S.sub ||= {});
    if (!FIN_TABS.some(([k, , ok]) => k === s.tab && ok())) s.tab = FIN_TABS.find(([, , ok]) => ok())?.[0];
    return { recv: ["/receivables"], pay: ["/payables"], tally: ["/tally/exports"], old: ["/opening-dues"] }[s.tab] || [];
  },
  render() {
    const s = S.sub;
    const tabs = FIN_TABS.filter(([, , ok]) => ok());
    const body = { recv: recvTab, pay: payTab, tally: tallyTab, old: oldTab }[s.tab]?.() || "";
    return pageHead(eyebrow(), t("finance"), "Money in and out. Tally stays the accounting system of record; nothing here marks a bank transfer as verified by itself.") +
      `<div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${s.tab === k ? "on" : ""}" data-ftab="${k}">${l}</button>`).join("")}</div>${body}`;
  },
};

function recvTab() {
  const d = S.data["/receivables"], a = d.aging;
  return `<div class="grid">${[["Not yet due", a.current], ["1–30 days late", a["1-30"]], ["31–60 days late", a["31-60"]], ["60+ days late", a["60+"]]].map(([l, v]) =>
      `<section class="card stat span3"><div class="stat-label">${l}</div><div class="stat-number">${rupee(v)}</div></section>`).join("")}</div>
    ${d.pending.length && can("finance.collection.verify") ? `<section class="card mt"><h3>Collections to verify</h3>${table(["Invoice", "Amount", "How", "Reference", "Recorded by", ""], d.pending.map((k) =>
      `<tr><td>${h(k.number)}</td><td>${rupee(k.amount_paise)}</td><td>${k.method}</td><td>${h(k.reference)}</td><td>${h(k.recorded_by_name)}</td><td>${k.recorded_by === S.me.user.id ? '<span class="tiny">Waiting for someone else to approve</span>' : `<button class="btn btn-small" data-verifycol="${k.id}:1">Verified in bank</button> <button class="btn btn-small btn-danger" data-verifycol="${k.id}:0">Not received</button>`}</td></tr>`))}</section>` : ""}
    <section class="card mt"><h3>Invoices</h3>${table(["Invoice", "Customer", "Total", "Paid", "Due", "Due date", "Status", ""], d.invoices.map((i) =>
      `<tr><td><b>${h(i.number)}</b></td><td>${h(i.customer)}</td><td>${rupee(i.total_paise)}</td><td>${rupee(i.paid_paise)}</td><td><b>${rupee(i.due_paise)}</b></td><td>${h(i.due_date)}${i.days_late ? `<br>${chip(i.days_late + " days late", "bad")}` : ""}</td><td>${tag(i.status === "PAID" ? "PAID" : "hold", i.status.replace("_", " "))}</td>
       <td class="nowrap">${can("documents.commercial") || can("finance.view") ? `<button class="btn btn-small btn-quiet" data-invoice="${i.id}">View</button>` : ""} ${i.customer_phone && i.due_paise > 0 ? `<button class="btn btn-small wa" data-waremind="${i.id}" aria-label="Send payment reminder on WhatsApp">${icon("message-circle", 14)} Remind</button> ` : ""}${can("finance.collection.record") && i.due_paise > 0 ? `<button class="btn btn-small" data-collect="${i.id}:${i.due_paise}">Record payment</button>` : ""}</td></tr>`), "No invoices yet. They are created at dispatch.")}</section>`;
}

const SIDE = { CLIENT: ["Clients who owe us", "finance.collection.record", "finance.collection.verify"], SUPPLIER: ["What we owe suppliers", "supplier.pay.record", "supplier.pay.approve"],
  STAFF: ["Staff advances", "finance.collection.record", "finance.collection.verify"] };
function oldTab() {
  const d = S.data["/opening-dues"], late = (x) => x.due_date && x.due_date < today() && x.due_paise > 0;
  const pend = d.pending.filter((p) => can(SIDE[p.side][2]));
  return `<p class="hint">Money owed from before the portal, entered at go-live. A payment counts only after a second person verifies it.</p>
    ${pend.length ? `<section class="card"><h3>Payments to verify</h3>${table(["Who", "Amount", "How", "Reference", "Recorded by", ""], pend.map((p) => {
      const due = d.dues.find((x) => x.id === p.due_id);
      return `<tr><td>${h(due?.party)}<br><span class="tiny">${SIDE[p.side][0]}</span></td><td>${rupee(p.amount_paise)}</td><td>${p.method}</td><td>${h(p.reference)}</td><td>${h(p.recorded_by_name)}</td>
        <td>${p.recorded_by === S.me.user.id ? '<span class="tiny">Waiting for someone else to verify</span>' : `<button class="btn btn-small" data-dueverify="${p.id}:1">Verified</button> <button class="btn btn-small btn-danger" data-dueverify="${p.id}:0">Not received</button>`}</td></tr>`;
    }))}</section>` : ""}
    ${Object.entries(SIDE).map(([side, [label, rec]]) => { const rows = d.dues.filter((x) => x.side === side); if (!rows.length && !can("finance.view")) return ""; return `<section class="card mt"><div class="toolbar"><h3 class="m0">${label}</h3><b>${rupee(rows.reduce((n, x) => n + x.due_paise, 0))} still due</b></div>
      ${table(["Who", "Amount", "Paid", "Still due", "Due date", "Note", ""], rows.map((x) => `<tr><td><b>${h(x.party)}</b></td><td>${rupee(x.amount_paise)}</td><td>${rupee(x.paid_paise)}</td><td><b>${rupee(x.due_paise)}</b></td>
        <td>${h(x.due_date || "—")}${late(x) ? `<br>${chip("late", "bad")}` : ""}</td><td>${h(x.note)}</td>
        <td class="nowrap">${x.party_phone && x.due_paise > 0 ? `<button class="btn btn-small wa" data-dueremind="${x.id}">${icon("message-circle", 14)} Remind</button> ` : ""}${can(rec) && x.due_paise > 0 ? `<button class="btn btn-small" data-duepay="${x.id}:${x.due_paise}">Record payment</button>` : x.due_paise <= 0 ? tag("PAID", "Paid") : ""}</td></tr>`),
        "Nothing here.")}</section>`; }).join("")}`;
}

function payTab() {
  const d = S.data["/payables"];
  return `<section class="card">${table(["Receipt", "Supplier", "Coffee", "Invoice", ...(can("invoice.cost") ? ["Invoice amount"] : []), ...(can("supplier.pay.amount") ? ["Paid"] : []), "Payment", ""], d.receipts.map((r) =>
      `<tr><td>#${r.id}<br><span class="tiny">${when(r.created_at)}</span></td><td>${h(r.source_name)}</td><td>${h(r.product)} · ${r.bags} bags</td><td>${h(r.invoice_ref || "—")}<br>${tag(r.invoice_status)}</td>
       ${can("invoice.cost") ? `<td>${rupee(r.invoice_amount_paise)}</td>` : ""}${can("supplier.pay.amount") ? `<td>${rupee(r.paid_paise)}</td>` : ""}<td>${r.payment_status ? tag(r.payment_status) : "—"}</td>
       <td class="nowrap">${can("invoice.reconcile") ? `<button class="btn btn-small" data-match="${r.id}">Match invoice</button> <button class="btn btn-small btn-quiet" data-invfile="${r.id}">Attach file</button>` : ""} ${can("supplier.pay.record") ? `<button class="btn btn-small" data-suppay="${r.id}">Record payment</button>` : ""} ${can("invoice.file") ? `<a class="btn btn-small btn-quiet" href="/api/v1/inward/${r.id}/invoice-file" target="_blank" rel="noopener">Open file</a>` : ""}</td></tr>`), "No receipts yet.")}</section>
    <section class="card mt"><h3>Supplier payments</h3>${table(["#", "Receipt", ...(can("supplier.pay.amount") ? ["Amount"] : []), ...(can("supplier.pay.proof") ? ["Reference"] : []), "Paid on", "Recorded by", "State", ""], d.payments.map((p) =>
      `<tr><td>#${p.id}</td><td>#${p.receipt_id}</td>${can("supplier.pay.amount") ? `<td>${rupee(p.amount_paise)}</td>` : ""}${can("supplier.pay.proof") ? `<td>${h(p.reference)}</td>` : ""}<td>${h(p.paid_on)}</td><td>${h(p.recorded_by_name)}</td><td>${tag(p.state === "APPROVED" ? "DONE" : p.state === "REJECTED" ? "REJECTED" : "hold", p.state.replace("_", " "))}</td>
       <td>${p.state === "PENDING_APPROVAL" && can("supplier.pay.approve") && p.recorded_by === S.me.user.id ? '<span class="tiny">Waiting for someone else to approve</span>' : p.state === "PENDING_APPROVAL" && can("supplier.pay.approve") ? `<button class="btn btn-small" data-decidepay="${p.id}:1">Approve</button> <button class="btn btn-small btn-danger" data-decidepay="${p.id}:0">Reject</button>` : ""}</td></tr>`), "No supplier payments recorded.")}</section>`;
}

function tallyTab() {
  const rows = S.data["/tally/exports"];
  return `<div class="hint">Make an export for a date range, import the file into Tally, then record what Tally said. Accepted vouchers are never exported again; a rejected batch can be corrected and exported again. The column mapping must be checked by your accountant against your TallyPrime version (O-19).</div>
    <form data-fform="tally" class="toolbar mt"><div class="row">${field("from", "From", "date", `required value="${today()}"`)}${field("to", "To", "date", `required value="${today()}"`)}</div><button class="btn btn-primary">Make export file</button></form>
    <section class="card">${table(["Batch", "Period", "Vouchers", "Control total", "Checksum", "State", ""], rows.map((e) =>
      `<tr><td><b>${h(e.batch_no)}</b><br><span class="tiny">${when(e.created_at)}</span></td><td>${h(e.period_from)} → ${h(e.period_to)}</td><td>${e.voucher_count}</td><td>${rupee(e.control_total_paise)}</td><td class="tiny">${h(e.checksum.slice(0, 12))}…</td>
       <td>${tag(e.state === "ACCEPTED" ? "DONE" : e.state === "REJECTED" ? "REJECTED" : "hold", e.state)}${e.result_note ? `<br><span class="tiny">${h(e.result_note)}</span>` : ""}</td>
       <td class="nowrap"><button class="btn btn-small btn-quiet" data-tallyview="${e.id}">File</button> ${e.state === "EXPORTED" ? `<button class="btn btn-small" data-tallyres="${e.id}:1">Tally accepted</button> <button class="btn btn-small btn-danger" data-tallyres="${e.id}:0">Tally rejected</button>` : ""}</td></tr>`), "No exports yet.")}</section>`;
}

function showFile(e) {
  return dialog({ title: `${e.batch_no} — CSV for Tally`, submit: null, wide: true,
    body: `<p class="tiny">${e.voucher_count} vouchers · control total ${rupee(e.control_total_paise)} · sha256 ${h(e.checksum)}</p><textarea class="csv" readonly rows="14">${h(e.content)}</textarea>
      <div class="row mt"><button type="button" class="btn btn-primary" data-copy>Copy</button><button type="button" class="btn" data-dl>Download .csv</button></div>`,
    onReady(d) {
      d.querySelector("[data-copy]").addEventListener("click", async () => { try { await navigator.clipboard.writeText(e.content); toast("Copied."); } catch { d.querySelector("textarea").select(); toast("Press Ctrl+C to copy.", true); } });
      d.querySelector("[data-dl]").addEventListener("click", () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([e.content], { type: "text/csv" })); a.download = `${e.batch_no}.csv`; a.click(); toast(`${e.batch_no}.csv saved to your Downloads folder.`); });
    } });
}

// ================================================================= exceptions & reports
export const exceptions = {
  paths: () => ["/exceptions"],
  render() {
    const rows = S.data["/exceptions"];
    const counts = rows.reduce((m, r) => ((m[r.severity] = (m[r.severity] || 0) + 1), m), {});
    return pageHead(eyebrow(), t("exceptions"), "Everything that needs a decision, in one place. Items stay here until they are resolved — they never just expire.") +
      `<div class="row">${chip(`${counts.critical || 0} critical`, "bad")}${chip(`${counts.high || 0} high`, "warn")}${chip(`${counts.normal || 0} normal`)}</div>
      <section class="card mt">${rows.length ? `<div class="alert-list">${rows.map((r) => `<button class="alert-row sev-${r.severity}" data-go="${r.view}"><span class="sev-dot"></span><span><b>${h(r.title)}</b>${r.detail ? `<br><span class="tiny">${h(r.detail)}</span>` : ""}<br><span class="tiny">${r.category.replace(/_/g, " ").toLowerCase()} · open since ${when(r.opened_at)}</span></span></button>`).join("")}</div>`
        : '<div class="empty"><b>Nothing needs attention</b>New problems appear here automatically.</div>'}</section>`;
  },
};

export const reports = {
  paths() {
    const s = (S.sub ||= { from: new Date(Date.now() + 330 * 60000 - 6 * 864e5).toISOString().slice(0, 10), to: today() });
    return [`/reports?from=${s.from}&to=${s.to}`];
  },
  render() {
    const s = S.sub, r = S.data[`/reports?from=${s.from}&to=${s.to}`];
    const ro = r.roasting, rc = r.receipts;
    const op = ro ? `<div class="grid">
      <section class="card stat span3"><div class="stat-label">Roast batches</div><div class="stat-number">${ro.batches}</div><div class="tiny">${num(ro.input_kg, 1)} kg in → ${num(ro.output_kg, 1)} kg out</div></section>
      <section class="card stat span3"><div class="stat-label">Average roast loss</div><div class="stat-number">${ro.loss_pct == null ? "—" : ro.loss_pct + "%"}</div><div class="tiny">${ro.on_hold || 0} still on QC hold</div></section>
      <section class="card stat span3"><div class="stat-label">Bags received</div><div class="stat-number">${rc.bags}</div><div class="tiny">${rc.damaged} damaged · ${num(rc.kg, 1)} kg declared</div></section>
      <section class="card stat span3"><div class="stat-label">Packed</div><div class="stat-number">${num(r.packing.kg, 1)}<span class="unit">kg</span></div><div class="tiny">${r.packing.runs} packing runs</div></section></div>
      <section class="card mt"><h3>Stock now by bean, stage and place</h3>${table(["Bean", "Stage", "Where", "Kg"], r.stock.map((x) => `<tr><td>${h(x.bean)}</td><td>${h(x.stage)}</td><td>${h({ "PROD-01": "Production", "CTR-01": "Counter", IN_TRANSIT: "On the way" }[x.location] || x.location)}</td><td>${num(x.kg, 3)}</td></tr>`))}</section>` : "";
    const com = r.counter ? `<div class="grid mt">
      <section class="card stat span4"><div class="stat-label">Counter sales</div><div class="stat-number">${rupee(r.counter.total_paise)}</div><div class="tiny">${r.counter.bills} bills · ${rupee(r.counter.discount_paise)} discounts · ${r.counter_methods.map((m) => `${m.method} ${rupee(m.total_paise)}`).join(" · ")}</div></section>
      <section class="card stat span4"><div class="stat-label">Invoiced to customers</div><div class="stat-number">${rupee(r.invoiced.total_paise)}</div><div class="tiny">${r.invoiced.invoices} invoices</div></section>
      <section class="card stat span4"><div class="stat-label">Outside roasting charges</div><div class="stat-number">${rupee(r.outside.charge_paise)}</div><div class="tiny">${r.outside.jobs} jobs</div></section></div>
      <p class="hint mt">${h(r.margin_note)}</p>` : "";
    return pageHead(eyebrow(), t("reports"), "Daily, weekly or any period. Figures come straight from the ledger.") +
      `<form data-fform="period" class="toolbar"><div class="row">${field("from", "From", "date", `required value="${s.from}"`)}${field("to", "To", "date", `required value="${s.to}"`)}</div><button class="btn">Show</button></form>${op}${com}`;
  },
};

// ================================================================= events
export async function salesClick(el) {
  const ds = el.dataset, go = () => nav.go(S.view, S.sub);
  const run = async (fn, msg) => { try { await fn(); if (msg) toast(msg); await go(); } catch (e) { fail(e); } };
  if (ds.stab) { S.sub = { tab: ds.stab }; return go(), true; }
  if (ds.ftab) { S.sub = { tab: ds.ftab }; return go(), true; }
  if (ds.action === "newOrder") return newOrder(), true;
  if (ds.oprice) {
    const f = await dialog({ title: `Price for order #${ds.oprice}`, submit: "Save price", body: `<div class="form-grid">${field("price", "Price per kg (₹, before GST)", "number", 'required min="0.01" step="0.01"')}${field("gst", "GST % (from accountant)", "number", 'min="0" max="28" step="0.01"')}</div>` });
    if (f) await run(() => api(`/orders/${ds.oprice}/price`, "PUT", { price_per_kg_paise: Math.round(Number(f.price) * 100), gst_rate_bp: f.gst === "" ? null : Math.round(Number(f.gst) * 100) }), "Price saved.");
    return true;
  }
  if (ds.oconfirm) { try { const r = await api(`/orders/${ds.oconfirm}/confirm`, "POST"); toast(r.state === "RESERVED" ? "Confirmed and stock reserved." : r.state === "CREDIT_REVIEW" ? "Sent for credit decision: " + r.note : "Confirmed, but not enough stock to reserve yet."); await go(); } catch (e) { fail(e); } return true; }
  if (ds.ocredit) {
    const f = await dialog({ title: `Credit decision · order #${ds.ocredit}`, submit: "Save decision", body: `${select("approve", "Decision", [["1", "Approve credit"], ["0", "Refuse — cancel order"]])}<div class="field"><label>Reason</label><textarea name="note" required minlength="5" rows="2"></textarea></div>` });
    if (f) await run(() => api(`/orders/${ds.ocredit}/credit`, "POST", { approve: f.approve === "1", note: f.note }), "Decision saved.");
    return true;
  }
  if (ds.oreserve) { await run(() => api(`/orders/${ds.oreserve}/reserve`, "POST"), "Stock reserved."); return true; }
  if (ds.ocancel) {
    const f = await dialog({ title: `Cancel order #${ds.ocancel}`, submit: "Cancel order", danger: true, body: `<div class="field"><label>Reason</label><textarea name="reason" required minlength="5" rows="2"></textarea></div><p class="tiny">Reserved stock is released.</p>` });
    if (f) await run(() => api(`/orders/${ds.ocancel}/cancel`, "POST", f), "Order cancelled.");
    return true;
  }
  if (ds.oadvance) {
    const f = await dialog({ title: `Payment before dispatch · order #${ds.oadvance}`, submit: "Mark as received", body: `${field("amount", "Amount received (₹)", "number", 'required min="0.01" step="0.01"')}${field("reference", "Bank / UPI reference", "text", 'required minlength="3"')}<p class="tiny">Only mark it once you have seen it in the bank account.</p>` });
    if (f) await run(() => api(`/orders/${ds.oadvance}/advance`, "POST", { amount_paise: Math.round(Number(f.amount) * 100), reference: f.reference }), "Payment recorded.");
    return true;
  }
  if (ds.invoice) return invoiceDialog(ds.invoice), true;
  if (ds.terms) {
    const c = S.data["/customers/credit"].find((x) => x.id === Number(ds.terms));
    const f = await dialog({ title: `Credit terms · ${c.name}`, submit: "Save terms", body: `<div class="form-grid">${field("limit", "Credit limit (₹)", "number", `required min="0" step="1" value="${c.credit_limit_paise != null ? c.credit_limit_paise / 100 : ""}"`)}${field("days", "Pay within (days)", "number", `required min="0" max="180" step="1" value="${c.due_days ?? ""}"`)}</div><p class="tiny">0 limit = no credit.</p>` });
    if (f) await run(() => api(`/customers/${c.id}/credit`, "PUT", { credit_limit_paise: Math.round(Number(f.limit) * 100), due_days: Number(f.days) }), "Terms saved.");
    return true;
  }
  if (ds.slip) {
    try {
      const s = await api(`/orders/${ds.slip}/slip`);
      const html = `<div class="doc"><div class="doc-head"><h2>${h(s.company)}</h2><div class="doc-title"><b>PICK / DISPATCH SLIP</b><br>Order #${s.order.id}</div></div><p class="tiny">No prices on this slip.</p>
        <p><b>Customer:</b> ${h(s.order.customer)}<br><b>Item:</b> ${h(s.order.item)} (${FORM[s.order.form] || s.order.form})<br><b>Quantity:</b> ${num(s.order.quantity_kg, 3)} kg</p>
        <table class="doc-table"><tr><th>Take from lot</th><th>Kg</th></tr>${s.lots.filter((l) => l.state === "ACTIVE").map((l) => `<tr><td>#${l.lot_id} ${h(l.name)}</td><td>${num(l.kg, 3)}</td></tr>`).join("")}</table>
        <p>${h(s.order.notes || "")}</p><p>Packed by: __________ Checked by: __________</p></div>`;
      await dialog({ title: `Pick slip · order #${s.order.id}`, submit: null, wide: true, body: `<div class="doc-preview">${html}</div><div class="row mt"><button type="button" class="btn btn-primary" data-pdoc>🖨 Print</button></div>`,
        onReady(d) { d.querySelector("[data-pdoc]").addEventListener("click", () => printDoc(html)); } });
    } catch (e) { fail(e); }
    return true;
  }
  if (ds.dispatch) {
    const [id, left] = ds.dispatch.split(":");
    const o = (S.data["/orders"] || []).find((x) => x.id === Number(id)), addr = o?.customer_address || "";
    const f = await dialog({ title: `Hand over order #${id}`, submit: "Record hand-over",
      onReady(d) {
        d.querySelectorAll("[data-ride]").forEach((b) => b.addEventListener("click", () => { d.querySelector("[name=mode]").value = b.dataset.ride; openRide(b.dataset.ride, addr); d.querySelector("[name=booking_ref]").focus(); }));
      },
      body: `<div class="ride-row"><span class="tiny">Book a rider:</span><button type="button" class="btn ride rapido" data-ride="RAPIDO">${icon("bike", 18)} Open Rapido</button><button type="button" class="btn ride uber" data-ride="UBER">${icon("car", 18)} Open Uber</button></div>
        ${addr ? `<p class="tiny">Drop: ${h(addr)}</p>` : '<p class="tiny">No address saved for this customer. Add it in Admin Control → Clients.</p>'}
        ${o?.resting_until ? `<div class="hint warn">${icon("hourglass", 16)} Some of this coffee is still resting — ready from ${fmtDay(o.resting_until)}.</div>
          ${check("rest_ok", "Customer agreed to take it before it has rested", false, "Recorded in the audit log", "required")}` : ""}
        ${field("kg", `Kg handed over (up to ${num(left, 3)})`, "number", `required min="0.001" max="${left}" step="0.001" value="${left}"`)}
        ${select("mode", "How is it going?", Object.entries(MODE))}${field("booking_ref", "Booking reference (needed for apps)", "text", 'maxlength="60"')}
        ${field("handover_to", "Handed to (name)", "text", 'required minlength="2" maxlength="80"')}${field("evidence", "Evidence (vehicle no., photo note…)", "text", 'maxlength="200"')}
        <p class="tiny">This takes the stock out and creates the invoice.</p>` });
    if (f) { try { const r = await api(`/orders/${id}/dispatch`, "POST", { ...f, kg: Number(f.kg) }, newKey()); toast(`Handed over · invoice ${r.invoice}`); await go(); } catch (e) { fail(e); } }
    return true;
  }
  if (ds.deliver) {
    const [id, kg] = ds.deliver.split(":");
    const f = await dialog({ title: `Confirm delivery · dispatch #${id}`, submit: "Confirm", body: `${field("delivered_kg", "Kg the customer received", "number", `required min="0" max="${kg}" step="0.001" value="${kg}"`)}${field("pod_note", "Proof of delivery", "text", 'required minlength="3" placeholder="Signed by…, photo on WhatsApp group…"')}<p class="tiny">Less than sent raises an exception for the manager.</p>` });
    if (f) await run(() => api(`/dispatches/${id}/deliver`, "POST", { delivered_kg: Number(f.delivered_kg), pod_note: f.pod_note }), "Delivery confirmed.");
    return true;
  }
  if (ds.collect) {
    const [id, due] = ds.collect.split(":");
    const f = await dialog({ title: "Record customer payment", submit: "Record", body: `${field("amount", `Amount (₹, up to ${rupee(due)})`, "number", `required min="0.01" max="${due / 100}" step="0.01"`)}${select("method", "How", [["UPI", "UPI"], ["BANK", "Bank transfer"], ["CASH", "Cash"], ["CHEQUE", "Cheque"]])}${field("reference", "Reference", "text", 'maxlength="60"')}<p class="tiny">Someone else verifies it against the bank before the invoice counts as paid.</p>` });
    if (f) await run(() => api(`/invoices/${id}/collections`, "POST", { amount_paise: Math.round(Number(f.amount) * 100), method: f.method, reference: f.reference }), "Recorded — waiting for verification.");
    return true;
  }
  if (ds.waorder) return waOrder(S.data["/orders"].find((o) => o.id === Number(ds.waorder))), true;
  if (ds.waremind) return waReminder(S.data["/receivables"].invoices.find((i) => i.id === Number(ds.waremind))), true;
  if (ds.duepay) {
    const [id, due] = ds.duepay.split(":"), x = S.data["/opening-dues"].dues.find((y) => y.id === Number(id));
    const f = await dialog({ title: `Payment · ${x.party}`, submit: "Record", body: `${field("amount", `Amount (₹, up to ${rupee(due)})`, "number", `required min="0.01" max="${due / 100}" step="0.01"`)}${select("method", "How", [["UPI", "UPI"], ["BANK", "Bank transfer"], ["CASH", "Cash"], ["CHEQUE", "Cheque"], ...(x.side === "STAFF" ? [["SALARY", "Cut from salary"]] : [])])}${field("reference", "Reference", "text", 'maxlength="60"')}<p class="tiny">Someone else verifies it before it counts.</p>` });
    if (f) await run(() => api(`/opening-dues/${id}/payments`, "POST", { amount_paise: Math.round(Number(f.amount) * 100), method: f.method, reference: f.reference }), "Recorded — waiting for verification.");
    return true;
  }
  if (ds.dueverify) { const [id, ok] = ds.dueverify.split(":"); await run(() => api(`/opening-due-payments/${id}/verify`, "POST", { approve: ok === "1" }), ok === "1" ? "Verified." : "Marked not received."); return true; }
  if (ds.dueremind) {
    const x = S.data["/opening-dues"].dues.find((y) => y.id === Number(ds.dueremind));
    return waReminder({ customer_phone: x.party_phone, label: "Earlier balance", created_at: x.since || x.created_at, due_paise: x.due_paise, due_date: x.due_date }), true;
  }
  if (ds.verifycol) { const [id, ok] = ds.verifycol.split(":"); await run(() => api(`/collections/${id}/verify`, "POST", { approve: ok === "1" }), ok === "1" ? "Verified." : "Marked not received."); return true; }
  if (ds.match) {
    const r = S.data["/payables"].receipts.find((x) => x.id === Number(ds.match));
    const f = await dialog({ title: `Match supplier invoice · receipt #${r.id}`, submit: "Save",
      body: `${field("invoice_ref", "Invoice number", "text", `maxlength="90" value="${h(r.invoice_ref || "")}"`)}${select("invoice_status", "Result", [["PENDING", "Not checked yet"], ["MATCHED", "Matches what we received"], ["EXCEPTION", "Difference — needs follow-up"]], "", r.invoice_status)}
        ${can("invoice.cost") ? field("amount", "Invoice amount (₹)", "number", `min="0" step="0.01" value="${r.invoice_amount_paise != null ? r.invoice_amount_paise / 100 : ""}"`) : ""}
        <p class="tiny">Invoice facts never change the received kg. A real quantity difference is corrected through Inventory → Correct, with approval.</p>` });
    if (f) await run(() => api(`/inward/${r.id}/finance`, "PUT", { invoice_ref: f.invoice_ref, invoice_status: f.invoice_status, ...(can("invoice.cost") ? { invoice_amount_paise: f.amount === "" ? null : Math.round(Number(f.amount) * 100) } : {}) }), "Saved.");
    return true;
  }
  if (ds.invfile) {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/pdf,image/jpeg,image/png,image/webp";
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 8e6) return toast("File is larger than 8 MB.", true);
      const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(file); });
      await run(() => api(`/inward/${ds.invfile}/invoice-file`, "POST", { mime: file.type, data: b64 }), "Invoice file attached.");
    };
    input.click();
    return true;
  }
  if (ds.suppay) {
    const f = await dialog({ title: `Supplier payment · receipt #${ds.suppay}`, submit: "Send for approval", body: `${field("amount", "Amount paid (₹)", "number", 'required min="0.01" step="0.01"')}${field("paid_on", "Payment date", "date", `required value="${today()}"`)}${field("reference", "Bank reference", "text", 'maxlength="60"')}<p class="tiny">Someone else approves it. This never changes stock.</p>` });
    if (f) await run(() => api(`/receipts/${ds.suppay}/payments`, "POST", { amount_paise: Math.round(Number(f.amount) * 100), paid_on: f.paid_on, reference: f.reference }), "Sent for approval.");
    return true;
  }
  if (ds.decidepay) { const [id, ok] = ds.decidepay.split(":"); await run(() => api(`/supplier-payments/${id}/decide`, "POST", { approve: ok === "1" }), "Decision saved."); return true; }
  if (ds.tallyview) { try { showFile(await api(`/tally/exports/${ds.tallyview}`)); } catch (e) { fail(e); } return true; }
  if (ds.tallyres) {
    const [id, ok] = ds.tallyres.split(":");
    const f = await dialog({ title: ok === "1" ? "Tally accepted the import" : "Tally rejected the import", submit: "Save", danger: ok !== "1", body: `<div class="field"><label>${ok === "1" ? "Note (e.g. imported by, date)" : "What did Tally say?"}</label><textarea name="note" required minlength="3" rows="2"></textarea></div>` });
    if (f) await run(() => api(`/tally/exports/${id}/result`, "POST", { accepted: ok === "1", note: f.note }), "Saved.");
    return true;
  }
  return false;
}

export async function salesSubmit(form: HTMLFormElement) {
  const f: Record<string, any> = Object.fromEntries(new FormData(form).entries());
  if (form.dataset.fform === "tally") {
    try { const e = await api("/tally/exports", "POST", { from: f.from, to: f.to }); toast(`${e.batch_no}: ${e.vouchers} vouchers.`); await nav.go("finance", S.sub); showFile({ ...e, state: "EXPORTED" }); } catch (e) { fail(e); }
  }
  if (form.dataset.fform === "period") {
    if (f.from > f.to) return toast("The 'From' date must be before the 'To' date.", true);
    S.sub = { from: f.from, to: f.to }; await nav.go("reports", S.sub);
    toast(`Showing ${new Date(f.from).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${new Date(f.to).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.`);
  }
}
