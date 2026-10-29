// Counter Sales (DPR §9): fast paid-in-full sales, 80 mm receipts, refunds,
// cash close, the admin price list and receiving stock from production.

import { api, newKey } from "../api.js";
import { t } from "../i18n.js";
import { S, can, nav } from "../state.js";
import { check, chip, confirmBox, dialog, fail, field, goto, h, num, pageHead, select, table, tag, toast, when } from "../ui.js";
import { discussBtn } from "./comms.js";
import { icon } from "../icons.js";
import { fmtDay } from "../labels.js";
import { waBill } from "../whatsapp.js";
import { cashTab, clearCustomer, customerCard, customersTab, cxCan, cxClick, cxSubmit, lastCustomer, maybeLookup, openCash } from "./countercx.js";

const rupee = (p) => "₹" + (Number(p || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const KIND_LABEL = { coffee_ground: "Ground coffee blend", coffee_beans: "Coffee beans blend", product: "Stock product (tea, chicory…)" };
let cart = { lines: [], discount: 0, reason: "", name: "", phone: "" };

const TABS: [string, string, () => boolean][] = [
  ["sell", "Sell", () => can("counter.sell")],
  ["bills", "Today's bills", () => can("counter.sell") || can("counter.refund")],
  ["close", "Day close", () => can("counter.close") || can("counter.close_approve") || can("counter.reopen_day")],
  ["customers", "Customers", cxCan.customers],
  ["cash", "Cash today 🔒", cxCan.cash],
];
const sub = () => (S.sub ||= { tab: TABS.find(([, , ok]) => ok())?.[0] || "sell" });

export const counter = {
  paths() {
    const s = sub();
    return ["/counter/setup", ...(s.tab === "bills" ? [`/counter/sales${s.day ? "?day=" + s.day : ""}`] : []), ...(s.tab === "close" ? ["/counter/cash-close"] : []),
      ...(s.tab === "customers" ? [`/counter/customers?q=${encodeURIComponent(s.q || "")}`] : [])];
  },
  render() {
    const s = sub(), setup = S.data["/counter/setup"];
    const tabs = `<div class="tabs">${TABS.filter(([, , ok]) => ok()).map(([k, l]) => `<button class="tab ${s.tab === k ? "on" : ""}" data-ctab="${k}">${l}</button>`).join("")}</div>`;
    const incoming = setup.incoming.length && can("counter.sell") ? `<div class="hint warn row between">📦 ${setup.incoming.length} transfer${setup.incoming.length > 1 ? "s" : ""} from production waiting to be counted in.
      <span class="row">${setup.incoming.map((x) => `<button class="btn btn-small" data-receive="${x.id}:${x.kg_sent}">Receive ${h(x.transit_code || "#" + x.id)} · ${num(x.kg_sent, 3)} kg</button>`).join("")}</span></div>` : "";
    const body = { sell: sellTab, bills: billsTab, close: closeTab, customers: customersTab, cash: cashTab }[s.tab](setup);
    return pageHead(`${S.me.settings.short_name} / ${S.me.user.role_name}`, t("counter"), "Paid in full at the counter. Every bill takes its coffee and chicory from counter stock.") + tabs + incoming + body;
  },
};

// ---------------------------------------------------------------- sell
function sellTab(setup) {
  const items = setup.items.filter((i) => i.active);
  // v1.5 (owner report): say *why* an item can't be sold, not just "out of stock"
  const onWay = setup.incoming.reduce((n, x) => n + x.kg_sent, 0);
  const whyOut = (i) => (i.kind === "product" ? "None at the counter"
    : !(setup.stock?.[i.kind] > 0) ? `No ${i.kind === "coffee_ground" ? "ground coffee" : "roasted beans"} at the counter`
    : "No chicory at the counter — send chicory too") + (onWay ? ` · ${num(onWay, 3)} kg on the way: press Receive above` : "");
  if (setup.day_closed) return `<div class="closed-banner"><div><b>Counter closed for today</b><br><span class="sub">Today's bills were closed at ${new Date(setup.day_closed.created_at).toLocaleTimeString("en-IN", { timeStyle: "short" })}. Selling opens again tomorrow${can("counter.reopen_day") ? ", or reopen it from Day close" : ""}.</span></div>
    <button class="btn" data-ctab="close">See today's register →</button></div>`;
  if (!items.length) return `<div class="empty"><b>No price list yet</b>${can("system.settings") ? "Add the counter's items and prices." + goto("admin", "prices", "Open Prices") : "Ask the admin to publish the counter price list."}</div>`;
  const st = setup.settings, customReady = st.custom_coffee_rate_paise && st.custom_chicory_rate_paise && st.custom_chicory_product_id;
  const subtotal = cart.lines.reduce((s, l) => s + l.amount, 0);
  const total = subtotal - cart.discount;
  return `<div class="pos">
    <section class="pos-items">${items.map((i) => `<button class="pos-tile ${i.stock_kg <= 0 ? "out" : ""}" data-additem="${i.id}">
        <b>${h(i.name)}</b><span class="pos-price">${rupee(i.price_per_kg_paise)}<small>/kg</small></span>
        <span class="tiny">${i.stock_kg > 0 ? `${num(i.stock_kg, 2)} kg at counter` : whyOut(i)}</span></button>`).join("")}
        <button class="pos-tile other" data-action="customBlend"><b>Others…</b><span class="pos-price">Any ratio</span>
        <span class="tiny">${customReady ? "e.g. 80/20, 90/10 coffee : chicory" : "Not set up — admin sets the rates in Prices"}</span></button>
        ${!customReady && can("system.settings") ? goto("admin", "prices", "Set custom blend rates") : ""}</section>
    <section class="card pos-bill"><h3>Current bill</h3>
      ${cart.lines.length ? `<div class="bill-lines">${cart.lines.map((l, i) => `<div class="bill-line"><div><b>${h(l.name)}</b><br><span class="tiny">${num(l.weight_kg * 1000, 0)} g × ${rupee(l.rate)}/kg</span></div><b>${rupee(l.amount)}</b><button class="icon-btn" data-rmline="${i}" aria-label="Remove">✕</button></div>`).join("")}</div>`
        : '<div class="empty">Tap an item to add it.</div>'}
      <div class="kv"><span>Subtotal</span><b>${rupee(subtotal)}</b></div>
      ${cart.discount ? `<div class="kv"><span>Discount · ${h(cart.reason)}</span><b>− ${rupee(cart.discount)}</b></div>` : ""}
      <div class="kv total"><span>Total to collect</span><b>${rupee(total)}</b></div>
      <div class="form-grid mt">${field("cust_name", "Customer name (optional)", "text", `maxlength="60" value="${h(cart.name)}" data-cart="name"`)}${field("cust_phone", "Phone (optional)", "tel", `maxlength="15" value="${h(cart.phone)}" data-cart="phone" inputmode="tel"`)}</div>
      ${customerCard()}
      ${restWarning(setup)}
      <div class="row mt">${can("counter.discount") && cart.lines.length ? `<button class="btn" data-action="discount">Discount</button>` : ""}
        ${cart.lines.length ? '<button class="btn" data-action="clearCart">Clear</button>' : ""}
        <button class="btn btn-primary btn-big grow" data-action="pay" ${cart.lines.length ? "" : "disabled"}>Take payment ${rupee(total)}</button></div>
    </section></div>`;
}

// v1.4: roasted coffee rests before use. FIFO sells the oldest (rested) coffee first; warn only when
// this bill needs more coffee than has finished resting.
function restWarning(setup) {
  const need = { coffee_ground: 0, coffee_beans: 0 };
  for (const l of cart.lines) {
    const it = l.custom ? { kind: "coffee_ground", coffee_pct: l.custom.coffee_pct } : setup.items.find((i) => i.id === l.item_id);
    if (it && it.kind in need) need[it.kind] += l.weight_kg * (it.coffee_pct || 0) / 100;
  }
  const warn = Object.entries<any>(setup.stock.resting || {}).filter(([pool, r]) => need[pool] > setup.stock[pool] - r.kg + 1e-6);
  return warn.map(([pool, r]) => {
    const ready = Math.max(0, setup.stock[pool] - r.kg), what = pool === "coffee_ground" ? "ground coffee" : "coffee beans";
    return `<div class="hint warn mt">${icon("hourglass", 16)} ${ready > 0.0005 ? `Only ${num(ready, 2)} kg of ${what} here has finished resting.` : `The ${what} here is still resting.`}
      This bill uses coffee that is ready from ${fmtDay(r.ready_from)}. Tell the customer, or sell less.</div>`;
  }).join("");
}

async function addItem(id) {
  const item = S.data["/counter/setup"].items.find((i) => i.id === Number(id));
  const r = await dialog({
    title: item.name, submit: "Add to bill",
    body: `<p class="sub">${rupee(item.price_per_kg_paise)} per kg${item.kind !== "product" ? ` · ${item.coffee_pct}% coffee` : ""}</p>
      <div class="presets">${[100, 250, 500, 1000].map((g) => `<button type="button" class="preset" data-g="${g}">${g >= 1000 ? g / 1000 + " kg" : g + " g"}</button>`).join("")}</div>
      <div class="form-grid">${field("grams", "Weight on the scale (grams)", "number", 'required min="1" step="1" inputmode="numeric"')}${field("rupees", "…or customer asks for ₹", "number", 'min="1" step="1" inputmode="numeric"')}</div>
      <p class="tiny" id="calc">Enter the actual weighed quantity. A rupee amount gives the target weight to weigh.</p>`,
    onReady(d) {
      const g = d.querySelector("[name=grams]"), rs = d.querySelector("[name=rupees]"), calc = d.querySelector("#calc");
      const show = () => { if (g.value) calc.textContent = `${g.value} g = ${rupee(Math.round((g.value / 1000) * item.price_per_kg_paise))}`; };
      d.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => { g.value = b.dataset.g; rs.value = ""; show(); }));
      rs.addEventListener("input", () => { if (rs.value) { g.value = Math.round((rs.value * 100 / item.price_per_kg_paise) * 1000); show(); calc.textContent += " — weigh this amount"; } });
      g.addEventListener("input", show);
    },
  });
  if (!r) return;
  const w = Math.round(Number(r.grams)) / 1000;
  cart.lines.push({ item_id: item.id, name: item.name, rate: item.price_per_kg_paise, weight_kg: w, amount: Math.round(w * item.price_per_kg_paise) });
  cart.discount = 0;
  nav.rerender();
}

async function customBlendDialog() {
  const st = S.data["/counter/setup"].settings, stock = S.data["/counter/setup"].stock;
  if (!st.custom_coffee_rate_paise || !st.custom_chicory_rate_paise || !st.custom_chicory_product_id)
    return toast("Custom blends aren't set up. The admin sets the coffee and chicory rates in Admin Control → Prices.", true);
  const rateFor = (pct) => Math.round((pct / 100) * st.custom_coffee_rate_paise + ((100 - pct) / 100) * st.custom_chicory_rate_paise);
  const mayOverride = can("counter.price_override");
  const r = await dialog({ title: "Others — custom coffee : chicory", submit: "Add to bill",
    body: `<div class="presets">${[95, 90, 85, 80, 75, 65, 55, 50].map((p) => `<button type="button" class="preset" data-pct="${p}">${p}/${100 - p}</button>`).join("")}</div>
      <div class="form-grid">${field("coffee_pct", "Coffee %", "number", 'required min="1" max="100" step="1" inputmode="numeric"', "Chicory is the rest")}
        ${field("grams", "Weight on the scale (grams)", "number", 'required min="1" step="1" inputmode="numeric"')}</div>
      <p class="hint" id="cbRate">Choose the ratio.</p>
      ${mayOverride ? `<details><summary>Change the price for this bill (manager)</summary><div class="form-grid">${field("override", "New price ₹/kg", "number", 'min="0.01" step="0.01"')}${field("override_reason", "Reason", "text", 'maxlength="120"')}</div></details>` : ""}
      <p class="tiny">At the counter now: ${num(stock.coffee_ground, 2)} kg ground coffee, ${num(stock.custom_chicory, 2)} kg chicory.</p>`,
    onReady(d) {
      const pct = d.querySelector("[name=coffee_pct]"), g = d.querySelector("[name=grams]"), out = d.querySelector("#cbRate");
      const show = () => { const p = Number(pct.value); if (!(p >= 1 && p <= 100)) return; const rate = rateFor(p);
        out.textContent = `${p}% coffee + ${100 - p}% chicory = ${rupee(rate)}/kg` + (g.value ? ` · ${g.value} g = ${rupee(Math.round((g.value / 1000) * rate))}` : ""); };
      d.querySelectorAll("[data-pct]").forEach((b) => b.addEventListener("click", () => { pct.value = b.dataset.pct; show(); }));
      pct.addEventListener("input", show); g.addEventListener("input", show);
    } });
  if (!r) return;
  const pct = Math.round(Number(r.coffee_pct)), w = Math.round(Number(r.grams)) / 1000;
  let rate = rateFor(pct), custom: any = { coffee_pct: pct };
  if (r.override) {
    if ((r.override_reason || "").trim().length < 3) return toast("Give a reason for changing the price.", true);
    rate = Math.round(Number(r.override) * 100);
    custom = { ...custom, override_rate_paise: rate, override_reason: r.override_reason };
  }
  const name = pct < 100 ? `Custom ${pct}/${100 - pct} coffee powder` : "Custom pure coffee powder";
  cart.lines.push({ custom, name: name + (custom.override_rate_paise ? " (price changed)" : ""), rate, weight_kg: w, amount: Math.round(w * rate) });
  cart.discount = 0;
  nav.rerender();
}

async function discountDialog() {
  const cap = S.data["/counter/setup"].settings.discount_cap_pct;
  if (cap == null) return toast("Discounts aren't set up. The admin sets the discount cap in Admin Control → Settings → Business values.", true);
  const subtotal = cart.lines.reduce((s, l) => s + l.amount, 0);
  const r = await dialog({ title: "Discount", submit: "Apply",
    body: `<p class="hint">Up to ${cap}% (${rupee(Math.floor(subtotal * cap / 100))}). Weight stays as weighed; only the price changes.</p>
      ${field("amount", "Discount (₹)", "number", `required min="1" max="${Math.floor(subtotal * cap / 10000)}" step="1"`)}${field("reason", "Reason", "text", 'required minlength="3" maxlength="120"')}` });
  if (!r) return;
  cart.discount = Math.round(Number(r.amount) * 100);
  cart.reason = r.reason;
  nav.rerender();
}

async function payDialog() {
  const total = cart.lines.reduce((s, l) => s + l.amount, 0) - cart.discount;
  const r = await dialog({ title: `Collect ${rupee(total)}`, submit: "Complete sale",
    body: `<div class="seg wide-seg" id="paySeg">${["CASH", "UPI", "CARD", "SPLIT"].map((m, i) => `<label class="seg-btn ${i ? "" : "on"}"><input type="radio" name="method" value="${m}" ${i ? "" : "checked"}/> ${m === "SPLIT" ? "Cash + UPI" : m === "UPI" ? "UPI / online" : m[0] + m.slice(1).toLowerCase()}</label>`).join("")}</div>
      <div id="payCash">${field("tendered", "Cash received (₹)", "number", `min="${total / 100}" step="any" inputmode="decimal"`)}<p class="tiny" id="change"></p></div>
      <div id="payRef" hidden>${field("reference", "UPI / card reference (optional)", "text", 'maxlength="40"')}<p class="tiny">Recorded by staff — this does not confirm the bank received it.</p></div>
      <div id="paySplit" hidden class="form-grid">${field("cash_part", "Cash part (₹)", "number", 'min="0" step="0.01"')}${field("upi_part", "UPI part (₹)", "number", 'min="0" step="0.01"')}</div>`,
    onReady(d) {
      const sync = () => {
        const m = d.querySelector("[name=method]:checked").value;
        d.querySelectorAll("#paySeg .seg-btn").forEach((l) => l.classList.toggle("on", l.querySelector("input").checked));
        d.querySelector("#payCash").hidden = m !== "CASH";
        d.querySelector("#payRef").hidden = !["UPI", "CARD", "SPLIT"].includes(m);
        d.querySelector("#paySplit").hidden = m !== "SPLIT";
      };
      d.querySelectorAll("[name=method]").forEach((x) => x.addEventListener("change", sync));
      const ten = d.querySelector("[name=tendered]"), ch = d.querySelector("#change");
      ten.addEventListener("input", () => { const c = Math.round(ten.value * 100) - total; ch.textContent = c >= 0 ? `Give back ${rupee(c)}` : `Short by ${rupee(-c)}`; });
      const cp = d.querySelector("[name=cash_part]"), up = d.querySelector("[name=upi_part]");
      cp.addEventListener("input", () => (up.value = Math.max(0, (total - Math.round(cp.value * 100)) / 100).toFixed(2)));
      sync();
    } });
  if (!r) return;
  let payments;
  if (r.method === "SPLIT") {
    const cash = Math.round(Number(r.cash_part || 0) * 100), upi = Math.round(Number(r.upi_part || 0) * 100);
    payments = [cash && { method: "CASH", amount_paise: cash }, upi && { method: "UPI", amount_paise: upi, reference: r.reference }].filter(Boolean);
  } else payments = [{ method: r.method, amount_paise: total, reference: r.reference || "" }];
  try {
    const bill = await api("/counter/sales", "POST", { lines: cart.lines.map((l) => (l.custom ? { custom: l.custom, weight_kg: l.weight_kg } : { item_id: l.item_id, weight_kg: l.weight_kg })),
      discount_paise: cart.discount, discount_reason: cart.reason, customer_name: cart.name, customer_phone: cart.phone, payments }, newKey());
    const phone = cart.phone;   // typed by the cashier for this bill: used for the WhatsApp copy
    cart = { lines: [], discount: 0, reason: "", name: "", phone: "" };
    clearCustomer();
    await nav.go("counter", S.sub);
    receiptDialog(bill, r.method === "CASH" && r.tendered ? Math.round(r.tendered * 100) - total : null, phone);
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------- receipt (80 mm)
function receiptHtml(b, copy = false, label = "") {
  const hd = b.header, line = "-".repeat(32);
  const gst = hd.tax_setup_approved ? (b.gst_paise ? `<div class="r-row"><span>GST included</span><span>${rupee(b.gst_paise)}</span></div>` : "")
    : `<div class="r-note">Tax details pending accountant approval</div>`;
  return `<div class="receipt"><div class="r-c"><b>${h(hd.company_name)}</b>${hd.company_address ? `<br>${h(hd.company_address)}` : ""}${hd.company_gstin ? `<br>GSTIN ${h(hd.company_gstin)}` : ""}</div>
    ${label ? `<div class="r-copy">${label}</div>` : ""}${copy ? `<div class="r-c"><b>DUPLICATE COPY ${b.reprints}</b></div>` : ""}<div>${line}</div>
    <div class="r-row"><span>Bill ${h(b.bill_no)}</span><span>${new Date(b.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</span></div>
    <div>Cashier: ${h(b.cashier)}${b.customer_name ? `<br>Customer: ${h(b.customer_name)}` : ""}</div><div>${line}</div>
    ${b.lines.map((l) => `<div>${h(l.item_name)}</div><div class="r-row"><span>${num(l.weight_kg, 3)} kg × ${rupee(l.rate_paise)}</span><span>${rupee(l.amount_paise)}</span></div>`).join("")}
    <div>${line}</div><div class="r-row"><span>Subtotal</span><span>${rupee(b.subtotal_paise)}</span></div>
    ${b.discount_paise ? `<div class="r-row"><span>Discount</span><span>-${rupee(b.discount_paise)}</span></div>` : ""}
    <div class="r-row r-big"><span>TOTAL</span><span>${rupee(b.total_paise)}</span></div>${gst}
    ${b.payments.map((p) => `<div class="r-row"><span>${p.method}${p.reference ? " " + h(p.reference) : ""}</span><span>${rupee(p.amount_paise)}</span></div>`).join("")}
    ${b.payments.some((p) => p.method !== "CASH") ? '<div class="r-note">Online payment recorded by staff</div>' : ""}
    ${b.status !== "PAID" ? `<div class="r-c"><b>${b.status.replace("_", " ")}</b></div>` : ""}
    <div>${line}</div><div class="r-c">Thank you! Visit again.</div></div>`;
}

export function printReceipt(b, copy = false, labels = [""]) {
  let area = document.getElementById("print-area");
  if (!area) { area = document.createElement("div"); area.id = "print-area"; document.body.appendChild(area); }
  area.innerHTML = labels.map((l) => receiptHtml(b, copy, l)).join("");
  window.print();
}
const COPY_BUTTONS = `<div class="row mt"><button type="button" class="btn" data-copies="1">🖨 Customer copy</button><button type="button" class="btn btn-primary" data-copies="2">🖨 Customer + office copy</button></div>`;
const copyLabels = (n) => (n === "2" ? ["CUSTOMER COPY", "OFFICE COPY"] : ["CUSTOMER COPY"]);

const WA_BTN = `<button type="button" class="btn wa" data-wa>${icon("message-circle", 16)} Send bill on WhatsApp</button>`;
async function receiptDialog(b, change = null, phone = "") {
  await dialog({ title: `Bill ${b.bill_no} saved`, submit: null,
    body: `${change != null && change >= 0 ? `<div class="hint"><b>Give back ${rupee(change)}</b></div>` : ""}<div class="receipt-preview">${receiptHtml(b, false, "CUSTOMER COPY")}</div>
      <p class="sub mt">How many copies? Keep the office copy to tally with today's bill register.</p>${COPY_BUTTONS}
      ${phone ? `<div class="row mt">${WA_BTN}</div>` : ""}
      <p class="tiny">The sale is saved even if printing fails — reprint any time from Today's bills.</p>`,
    onReady(d) {
      d.querySelectorAll("[data-copies]").forEach((x) => x.addEventListener("click", () => printReceipt(b, false, copyLabels(x.dataset.copies))));
      d.querySelector("[data-wa]")?.addEventListener("click", () => waBill(b, phone));
    } });
}

// ---------------------------------------------------------------- bills, refunds
function billsTab() {
  const s = sub(), data = S.data[`/counter/sales${s.day ? "?day=" + s.day : ""}`];
  const refunds = can("counter.refund") && data.pending_refunds.length ? `<section class="card mt-b"><h3>Refunds waiting for approval</h3>${table(["Bill", "Amount", "Reason", "Asked by", ""], data.pending_refunds.map((r) =>
    `<tr><td>${h(r.bill_no)}</td><td>${rupee(r.amount_paise)} ${r.method}</td><td>${h(r.reason)}</td><td>${h(r.requested_by_name)}</td><td>${r.requested_by === S.me.user.id ? '<span class="tiny">Waiting for someone else to approve</span>' : `<button class="btn btn-small" data-refund="${r.id}:1">Approve</button> <button class="btn btn-small btn-danger" data-refund="${r.id}:0">Reject</button>`}</td></tr>`))}</section>` : "";
  const isToday = data.day === new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const closeBtn = isToday && !data.closed && can("counter.close") ? '<button class="btn btn-primary" data-ctab="close">Close today\'s bills →</button>' : "";
  return `${refunds}${data.closed ? `<div class="hint row between">This day is closed. Bills are saved in the day register.<button class="btn btn-small" data-register="${data.closed.id}">View day register</button></div>` : ""}
    <div class="toolbar"><div class="row">${chip(`${data.totals.bills} bills`)}${chip(`${rupee(data.totals.total_paise)} total`)}</div>
      <div class="row"><input type="date" class="search" value="${data.day}" data-billday aria-label="Day"/>${closeBtn}</div></div>
    <section class="card">${table(["Bill", "Time", "Cashier", "Paid by", "Total", "Status", ""], data.sales.map((b) =>
      `<tr><td><b>${h(b.bill_no)}</b>${b.customer_name ? `<br><span class="tiny">${h(b.customer_name)}</span>` : ""}</td><td>${new Date(b.created_at).toLocaleTimeString("en-IN", { timeStyle: "short" })}</td><td>${h(b.cashier)}</td><td>${h(b.methods)}</td><td><b>${rupee(b.total_paise)}</b></td><td>${tag(b.status === "PAID" ? "DONE" : b.status, b.status.replace("_", " "))}</td>
       <td class="nowrap"><button class="btn btn-small" data-bill="${b.id}">View / reprint</button> ${can("counter.sell") && b.status !== "REFUNDED" ? `<button class="btn btn-small" data-askrefund="${b.id}:${b.total_paise}">Refund</button>` : ""}${discussBtn("sale", b.id)}</td></tr>`), "No bills on this day.")}</section>`;
}

// ---------------------------------------------------------------- cash close
function closeTab() {
  const d = S.data["/counter/cash-close"], x = d.today, lock = d.closed_today;
  const okState = (k) => (["BALANCED", "ACCEPTED"].includes(k.state) ? "DONE" : ["REJECTED", "REOPENED"].includes(k.state) ? "REJECTED" : "hold");
  const left = lock ? `<section class="card span5"><h3>Today is closed · ${h(x.day)}</h3>
      <div class="kv"><span>Bills</span><b>${lock.bills ?? x.bills}</b></div><div class="kv"><span>Total billed</span><b>${rupee(lock.total_paise ?? x.total_paise)}</b></div>
      <div class="kv"><span>Cash counted</span><b>${rupee(lock.counted_paise)}</b></div><div class="kv"><span>State</span><b>${tag(okState(lock), lock.state.replace("_", " "))}</b></div>
      <div class="row mt"><button class="btn btn-primary" data-register="${lock.id}">View / print day register</button>
      ${can("counter.reopen_day") ? `<button class="btn btn-danger" data-reopen="${lock.id}">Reopen counter</button>` : ""}</div>
      <p class="tiny">Selling is locked until tomorrow. Tally the office copies against the register.</p></section>`
    : `<section class="card span5"><h3>Close today's bills · ${h(x.day)}</h3>
      <p class="sub">Counts the cash, locks the counter for today and saves today's bill register separately.</p>
      ${x.opening_paise == null ? `<div class="hint warn">Opening cash is not set. The admin sets it in Admin Control → Settings → Business values.${can("system.settings") ? goto("admin", "settings", "Open Settings") : ""}</div>` : ""}
      <div class="kv"><span>Bills today</span><b>${x.bills}</b></div><div class="kv"><span>Total billed</span><b>${rupee(x.total_paise)}</b></div>
      <div class="divider"></div>
      <div class="kv"><span>Opening cash</span><b>${x.opening_paise == null ? "Not set" : rupee(x.opening_paise)}</b></div>
      <div class="kv"><span>+ Cash sales</span><b>${rupee(x.cash_sales_paise)}</b></div>
      <div class="kv"><span>− Cash refunds</span><b>${rupee(x.cash_refunds_paise)}</b></div>
      <div class="kv total"><span>Cash that should be in the drawer</span><b>${x.expected_paise == null ? "—" : rupee(x.expected_paise)}</b></div>
      <div class="kv"><span>UPI / card today (not in drawer)</span><b>${rupee(x.online_paise)}</b></div>
      ${can("counter.close") && x.expected_paise != null ? `<form data-cform="close" class="mt">${field("counted", "Cash counted in drawer (₹)", "number", 'required min="0" step="0.01" inputmode="decimal"')}
          <div class="field"><label>Note (required if there is a difference)</label><textarea name="note" rows="2" maxlength="200"></textarea></div>
          <button class="btn btn-primary btn-big">Close today's bills</button></form>` : ""}
    </section>`;
  return `<div class="grid">${left}
    <section class="card span7"><h3>Closed days</h3>${table(["Day", "Bills", "Total", "Cash diff.", "Closed by", "State", ""], d.closes.map((k) =>
      `<tr><td><b>${h(k.shift_date)}</b></td><td>${k.bills ?? "—"}</td><td>${k.total_paise == null ? "—" : rupee(k.total_paise)}</td><td><b class="${k.difference_paise ? "neg" : ""}">${k.difference_paise ? (k.difference_paise > 0 ? "+" : "−") + rupee(Math.abs(k.difference_paise)) : "—"}</b></td><td>${h(k.submitted_by_name)}</td><td>${tag(okState(k), k.state.replace("_", " "))}${k.reopen_reason ? `<br><span class="tiny">${h(k.reopened_by_name || "")}: ${h(k.reopen_reason)}</span>` : ""}</td>
       <td class="nowrap">${k.state === "VARIANCE_REVIEW" && can("counter.close_approve") && k.submitted_by !== S.me.user.id ? `<button class="btn btn-small" data-closedecide="${k.id}:1">Accept</button> <button class="btn btn-small btn-danger" data-closedecide="${k.id}:0">Reject</button> ` : ""}${k.bills != null ? `<button class="btn btn-small btn-quiet" data-register="${k.id}">Register</button>` : ""}</td></tr>`), "No closed days yet.")}</section></div>`;
}

function registerHtml(x) {
  const k = x.close, r = x.register, hd = x.header;
  return `<div class="doc"><div class="doc-head"><div><h2>${h(hd.company_name)}</h2>${hd.company_address ? `<div>${h(hd.company_address)}</div>` : ""}</div>
    <div class="doc-title"><b>COUNTER DAY REGISTER</b><br>${h(k.shift_date)}<br>Closed by ${h(k.submitted_by_name)}</div></div>
    <p>${r.bill_count} bills${r.first_bill ? ` · ${h(r.first_bill)} to ${h(r.last_bill)}` : ""} · total <b>${rupee(r.total_paise)}</b></p>
    <table class="doc-table"><thead><tr><th>Bill</th><th>Time</th><th>Items</th><th>Paid</th><th>Total</th><th>✓</th></tr></thead><tbody>${(r.bills || []).map((b) =>
      `<tr><td>${h(b.bill_no)}${b.status !== "PAID" ? ` (${h(b.status)})` : ""}</td><td>${new Date(b.created_at).toLocaleTimeString("en-IN", { timeStyle: "short" })}</td><td>${h(b.items || "")}</td>
       <td>${h((b.pays || "").split("; ").map((p) => { const [m, a] = p.split(" "); return a ? `${m} ${rupee(a)}` : p; }).join(", "))}</td><td>${rupee(b.total_paise)}</td><td></td></tr>`).join("") || '<tr><td colspan="6">No bills.</td></tr>'}</tbody></table>
    <table class="doc-table"><tbody>${Object.entries(r.by_method || {}).map(([m, v]) => `<tr><td>${m}</td><td>${rupee(v)}</td></tr>`).join("")}
      <tr><td>Refunds paid today</td><td>${rupee((r.refunds || []).reduce((s, x) => s + x.amount_paise, 0))}</td></tr>
      <tr><td>Opening cash</td><td>${rupee(k.opening_paise)}</td></tr><tr><td>Cash expected in drawer</td><td>${rupee(k.expected_paise)}</td></tr>
      <tr><td>Cash counted</td><td>${rupee(k.counted_paise)}</td></tr><tr><td><b>Difference</b></td><td><b>${rupee(k.difference_paise)}</b></td></tr></tbody></table>
    <p>Tick each bill against its office copy. Signature: ______________________</p></div>`;
}

async function registerDialog(id) {
  try {
    const x = await api(`/counter/cash-close/${id}/register`), html = registerHtml(x);
    await dialog({ title: `Day register · ${x.close.shift_date}`, submit: null, wide: true,
      body: `<div class="doc-preview">${html}</div><div class="row mt"><button type="button" class="btn btn-primary" data-preg>🖨 Print register (A4)</button></div>`,
      onReady(d) { d.querySelector("[data-preg]").addEventListener("click", () => {
        let area = document.getElementById("print-area");
        if (!area) { area = document.createElement("div"); area.id = "print-area"; document.body.appendChild(area); }
        area.innerHTML = `<div class="a4">${html}</div>`; window.print(); }); } });
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------- price list (admin)
export function pricesTable(setup) {
  return `${table(["Item", "Type", "Price / kg", "Mix", "GST", "Version", "At counter", ""], setup.items.map((i) =>
      `<tr class="${i.active ? "" : "muted"}"><td><b>${h(i.name)}</b></td><td>${h(KIND_LABEL[i.kind])}</td><td>${rupee(i.price_per_kg_paise)}</td>
       <td>${i.kind === "product" ? h(i.stock_name || "") : `${i.coffee_pct}% coffee${i.coffee_pct < 100 ? ` + ${100 - i.coffee_pct}% ${h(i.chicory_name || "")}` : ""}`}</td>
       <td>${i.gst_rate_bp == null ? '<span class="tiny">not set</span>' : i.gst_rate_bp / 100 + "%"}</td><td>v${i.version}</td><td>${num(i.stock_kg, 2)} kg</td>
       <td class="nowrap"><button class="btn btn-small" data-edititem="${i.id}">Edit</button> <button class="btn btn-small" data-toggleitem="${i.id}:${i.active ? 0 : 1}">${i.active ? "Hide" : "Show"}</button></td></tr>`), "No items yet. Add the counter's coffee blends, tea and other items.")}`;
}

export async function itemDialog(item = null) {
  const products = S.data["/counter/setup"].products.map((p) => [p.id, p.name]);
  const chicoryDefault = item?.chicory_product_id || S.data["/counter/setup"].products.find((p) => p.category === "CHICORY")?.id || "";
  const r = await dialog({ title: item ? `Edit ${item.name}` : "Add counter item", submit: item ? "Publish new price" : "Add item",
    body: `${field("name", "Name on bill", "text", `required maxlength="60" value="${h(item?.name || "")}"`)}
      ${select("kind", "What is it?", Object.entries(KIND_LABEL), "", item?.kind || "coffee_ground")}
      ${field("price", "Price per kg (₹, tax included)", "number", `required min="1" step="0.01" value="${item ? item.price_per_kg_paise / 100 : ""}"`)}
      <div id="mixBox" class="form-grid">${field("coffee_pct", "Coffee %", "number", `min="1" max="100" step="1" value="${item?.coffee_pct ?? 100}"`, "e.g. 70 for 70/30")}
        ${select("chicory_product_id", "Chicory comes from", [["", "Choose chicory stock…"], ...products], "", chicoryDefault)}</div>
      <div id="stockBox">${select("stock_product_id", "Stock product", [["", "Choose…"], ...products], "", item?.stock_product_id || "")}</div>
      <div class="form-grid">${field("gst", "GST % (from accountant)", "number", `min="0" max="28" step="0.01" value="${item?.gst_rate_bp != null ? item.gst_rate_bp / 100 : ""}"`)}${field("hsn", "HSN code", "text", `maxlength="12" value="${h(item?.hsn || "")}"`)}</div>`,
    onReady(d) {
      const k = d.querySelector("[name=kind]"), pct = d.querySelector("[name=coffee_pct]"), chic = d.querySelector("[name=chicory_product_id]"), stock = d.querySelector("[name=stock_product_id]");
      const sync = () => { const prod = k.value === "product"; d.querySelector("#mixBox").hidden = prod; d.querySelector("#stockBox").hidden = !prod;
        chic.required = !prod && Number(pct.value) < 100; stock.required = prod; pct.required = !prod; };
      k.addEventListener("change", sync); pct.addEventListener("input", sync); sync();
    } });
  if (!r) return;
  const body = { name: r.name, kind: r.kind, price_per_kg_paise: Math.round(Number(r.price) * 100), hsn: r.hsn,
    gst_rate_bp: r.gst === "" ? null : Math.round(Number(r.gst) * 100), coffee_pct: Number(r.coffee_pct || 0),
    chicory_product_id: r.chicory_product_id ? Number(r.chicory_product_id) : null, stock_product_id: r.stock_product_id ? Number(r.stock_product_id) : null };
  try {
    await api(item ? `/counter/items/${item.id}` : "/counter/items", item ? "PUT" : "POST", body);
    toast(item ? "New price published." : "Item added.");
    await nav.go(S.view, S.sub);
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------- events
export async function counterClick(el) {
  const ds = el.dataset, s = sub();
  if (ds.ctab) { S.sub = { tab: ds.ctab }; if (ds.ctab === "cash") await openCash(); return nav.go("counter", S.sub), true; }
  if (await cxClick(ds)) return true;
  if (ds.action === "sameAgain") {
    const items = S.data["/counter/setup"].items, st = S.data["/counter/setup"].settings;
    for (const l of lastCustomer.card.last_bill.lines) {
      if (l.price_now == null) continue;
      if (l.item_id) { const it = items.find((i) => i.id === l.item_id && i.active); if (it) cart.lines.push({ item_id: it.id, name: it.name, rate: it.price_per_kg_paise, weight_kg: l.weight_kg, amount: Math.round(l.weight_kg * it.price_per_kg_paise) }); }
      else if (l.coffee_pct) cart.lines.push({ custom: { coffee_pct: l.coffee_pct }, name: l.item_name, rate: l.price_now, weight_kg: l.weight_kg, amount: Math.round(l.weight_kg * l.price_now) });
    }
    cart.discount = 0; toast("Last order added at today's prices. Weigh again before paying.");
    return nav.rerender(), true;
  }
  if (ds.additem) return addItem(ds.additem), true;
  if (ds.rmline) { cart.lines.splice(Number(ds.rmline), 1); cart.discount = 0; return nav.rerender(), true; }
  if (ds.action === "clearCart") { cart = { lines: [], discount: 0, reason: "", name: "", phone: "" }; return nav.rerender(), true; }
  if (ds.action === "discount") return discountDialog(), true;
  if (ds.action === "pay") return payDialog(), true;
  if (ds.action === "customBlend") return customBlendDialog(), true;
  if (ds.register) return registerDialog(ds.register), true;
  if (ds.reopen) {
    const r = await dialog({ title: "Reopen the counter for today?", submit: "Reopen", danger: true,
      body: `<p class="hint warn">The closed register stays in history marked reopened. The day must be closed again before tomorrow.</p><div class="field"><label>Reason</label><textarea name="reason" required minlength="5" rows="2"></textarea></div>` });
    if (!r) return true;
    try { await api(`/counter/cash-close/${ds.reopen}/reopen`, "POST", r); toast("Counter reopened."); await nav.go("counter", s); } catch (e) { fail(e); }
    return true;
  }
  if (ds.bill) { try { const b = await api(`/counter/sales/${ds.bill}`); await dialog({ title: `Bill ${b.bill_no}`, submit: null, body: `<div class="receipt-preview">${receiptHtml(b)}</div><p class="sub mt">Reprints are marked duplicate.</p><div class="row"><button type="button" class="btn" data-reprint="1">🖨 Customer copy</button><button type="button" class="btn btn-primary" data-reprint="2">🖨 Customer + office copy</button></div>${b.wa_phone ? `<div class="row mt">${WA_BTN}</div>` : ""}`,
      onReady(d) { d.querySelector("[data-wa]")?.addEventListener("click", () => waBill(b, b.wa_phone)); d.querySelectorAll("[data-reprint]").forEach((btn) => btn.addEventListener("click", async () => { try { const x = await api(`/counter/sales/${b.id}/reprint`, "POST"); printReceipt(x, true, copyLabels(btn.dataset.reprint)); } catch (e) { fail(e); } })); } }); } catch (e) { fail(e); } return true; }
  if (ds.askrefund) {
    const [id, total] = ds.askrefund.split(":");
    const r = await dialog({ title: "Ask for a refund", submit: "Send for approval",
      body: `<p class="hint">Someone else with refund rights must approve it. Returned goods do not go back into stock without inspection.</p>${field("amount", "Refund amount (₹)", "number", `required min="1" max="${total / 100}" step="0.01"`)}${select("method", "Paid back by", [["CASH", "Cash"], ["UPI", "UPI"], ["CARD", "Card"]])}<div class="field"><label>Reason</label><textarea name="reason" required minlength="5" rows="2"></textarea></div>` });
    if (!r) return true;
    try { await api(`/counter/sales/${id}/refunds`, "POST", { amount_paise: Math.round(Number(r.amount) * 100), method: r.method, reason: r.reason }); toast("Refund request sent for approval."); await nav.go("counter", s); } catch (e) { fail(e); }
    return true;
  }
  if (ds.refund) { const [id, ap] = ds.refund.split(":"); try { await api(`/counter/refunds/${id}/decide`, "POST", { approve: ap === "1" }); toast(ap === "1" ? "Refund approved." : "Refund rejected."); await nav.go("counter", s); } catch (e) { fail(e); } return true; }
  if (ds.closedecide) {
    const [id, ap] = ds.closedecide.split(":");
    const r = await dialog({ title: ap === "1" ? "Accept cash difference" : "Reject cash close", submit: ap === "1" ? "Accept" : "Reject", danger: ap !== "1", body: `<div class="field"><label>Note</label><textarea name="note" required minlength="5" rows="2"></textarea></div>` });
    if (!r) return true;
    try { await api(`/counter/cash-close/${id}/decide`, "POST", { approve: ap === "1", note: r.note }); toast("Saved."); await nav.go("counter", s); } catch (e) { fail(e); }
    return true;
  }
  if (ds.receive) { const [id, sent] = ds.receive.split(":"); return receiveTransfer(id, sent), true; }
  return false;
}

// v1.4: also used by the scan sheet (scan.js)
export async function receiveTransfer(id, sent, code = "") {
  const r = await dialog({ title: `Receive ${code || "transfer #" + id}`, submit: "Confirm received",
    body: `<p class="sub">Production sent <b>${num(sent, 3)} kg</b>. Weigh or count what actually arrived.</p>${field("kg", "Kg received", "number", `required min="0" max="${sent}" step="0.001" value="${sent}"`)}<p class="tiny">Less than sent is recorded as a shortage and the managers are alerted.</p>` });
  if (!r) return;
  try { const x = await api(`/transfers/${id}/receive`, "POST", { kg_received: Number(r.kg) }); toast(x.state === "SHORTAGE" ? `Received with ${x.shortage_kg} kg short — managers alerted.` : "Received into counter stock."); await nav.go(S.view, S.sub); } catch (e) { fail(e); }
}

export function counterInput(el) {
  if (el.dataset.cart) {
    cart[el.dataset.cart] = el.value;
    if (el.dataset.cart === "phone") maybeLookup(el.value).then((changed) => {
      if (!changed) return;
      if (lastCustomer?.card?.name && !cart.name) cart.name = lastCustomer.card.name;
      nav.rerender().then(() => { const p = document.querySelector<HTMLInputElement>("[data-cart=phone]"); p?.focus(); p?.setSelectionRange?.(99, 99); });
    });
    return true;
  }
  if (el.hasAttribute("data-cxsearch")) { sub().q = el.value; nav.go("counter", S.sub); return true; }
  if (el.hasAttribute("data-cashday")) { openCash(el.value).then(() => nav.go("counter", S.sub)); return true; }
  if (el.hasAttribute("data-billday")) { sub().day = el.value; nav.go("counter", S.sub); return true; }
  return false;
}

export async function counterSubmit(form) {
  if (await cxSubmit(form)) return;
  if (form.dataset.cform === "close") {
    const f = Object.fromEntries(new FormData(form).entries());
    const counted = Math.round(Number(f.counted) * 100);
    const exp = S.data["/counter/cash-close"].today.expected_paise;
    if (counted !== exp && !(await confirmBox("Cash doesn't match", `Expected ${rupee(exp)}, counted ${rupee(counted)} (${counted > exp ? "+" : "−"}${rupee(Math.abs(counted - exp))}). Someone else will need to approve this difference.`, "Submit anyway"))) return;
    try { const r = await api("/counter/cash-close", "POST", { counted_paise: counted, note: f.note }); toast(r.state === "BALANCED" ? "Cash matches. Today's bills are closed and saved." : "Day closed — cash difference sent for approval."); await nav.go("counter", S.sub); } catch (e) { fail(e); }
  }
}
