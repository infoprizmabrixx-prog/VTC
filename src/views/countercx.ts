// Counter v1.2: returning-customer card, admin customer list, and the owner's
// PIN-locked "Cash today" view with forecast and collections.

import { api } from "../api.js";
import { icon } from "../icons.js";
import { S, can, nav } from "../state.js";
import { chip, dialog, fail, field, h, num, select, table, toast, when } from "../ui.js";

const rupee = (p) => (p == null ? "—" : "₹" + (Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
const digits = (v) => String(v || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");

// ---------------------------------------------------------------- returning customer
export let lastCustomer = null;   // { phone, card }
export async function maybeLookup(phone) {
  const d = digits(phone);
  if (d.length !== 10) { if (lastCustomer && lastCustomer.phone !== d) { lastCustomer = null; return true; } return false; }
  if (lastCustomer?.phone === d) return false;
  try { lastCustomer = { phone: d, card: await api(`/counter/customers/lookup?phone=${d}`) }; return true; } catch (e) { fail(e); return false; }
}
export const clearCustomer = () => (lastCustomer = null);

export function customerCard() {
  const c = lastCustomer?.card;
  if (!c) return "";
  if (!c.found) return `<div class="cx-card new">${icon("user", 18)}<span><b>New customer</b> · ${h(c.phone_masked)} · will be saved with this bill</span></div>`;
  const lb = c.last_bill, changed = lb?.lines.some((l) => l.price_now != null && l.price_now !== l.rate_paise);
  return `<div class="cx-card"><div class="cx-top">${icon("history", 18)}<b>${h(c.name || "Returning customer")}</b>${chip(`${c.visits} visit${c.visits > 1 ? "s" : ""}`)}<span class="tiny">${h(c.phone_masked)}</span></div>
    ${lb ? `<div class="tiny">Last bill ${h(lb.bill_no)} · ${when(lb.at)} · ${rupee(lb.total_paise)}${c.favourite ? ` · usually buys ${h(c.favourite)}` : ""}</div>
    <ul class="cx-lines">${lb.lines.map((l) => `<li><span>${h(l.item_name)} · ${num(l.weight_kg * 1000, 0)} g</span><span>${rupee(l.rate_paise)}/kg${
      l.price_now == null ? ' <em class="neg">not on sale now</em>' : l.price_now !== l.rate_paise ? ` → <b class="${l.price_now > l.rate_paise ? "neg" : ""}">now ${rupee(l.price_now)}/kg</b>` : " · same price"}</span></li>`).join("")}</ul>
    ${changed ? '<div class="hint warn">Price has changed since last time. Tell the customer before billing.</div>' : ""}
    <button class="btn btn-small" data-action="sameAgain">${icon("repeat", 14)} Same again</button>` : ""}</div>`;
}

// ---------------------------------------------------------------- customers (admin)
export function customersTab() {
  const rows = S.data[`/counter/customers?q=${encodeURIComponent(S.sub.q || "")}`] || [];
  return `<div class="toolbar"><p class="sub m0">${icon("lock", 14)} Private. Only owner/admin see full numbers; every view is in the audit log.</p>
    <input class="search" type="search" placeholder="Search name or phone" value="${h(S.sub.q || "")}" data-cxsearch aria-label="Search customers"/></div>
    <section class="card">${table(["Customer", "Phone", "Visits", "Spent", "First seen", "Last seen"], rows.map((c) =>
      `<tr><td><b>${h(c.name || "—")}</b></td><td class="nowrap">${h(c.phone)}</td><td>${c.visits}</td><td>${rupee(c.spent_paise)}</td><td>${when(c.first_seen)}</td><td>${when(c.last_seen)}</td></tr>`), "No customers yet. They are saved when the cashier types a phone number on a bill.")}</section>`;
}

// ---------------------------------------------------------------- cash today (owner/admin + PIN)
export function cashTab() {
  const x = S.insights;
  if (!x) return `<section class="card lockcard"><span class="lock-ic">${icon("lock", 30)}</span><h3>Cash today is locked</h3>
    <p class="sub">Enter the 4-digit cash-view PIN. It stays open for 15 minutes on this device.</p>
    <form data-cform="unlock" class="row">${field("pin", "PIN", "password", 'required inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="off"')}<button class="btn btn-primary" type="submit">${icon("lock-open", 16)} Unlock</button></form>
    <button class="btn btn-small btn-quiet" data-action="setPin">Set or change the PIN</button></section>`;
  const f = x.forecast, e = x.expected, maxH = Math.max(1, ...x.hours), maxT = Math.max(1, ...x.trend.map((d) => d.total_paise));
  const hours = x.hours.map((v, i) => [i, v]).filter(([i]) => i >= 7 && i <= 22);
  const diff = (v) => (v == null ? "—" : `<b class="${v ? "neg" : ""}">${v > 0 ? "+" : v < 0 ? "−" : ""}${rupee(Math.abs(v))}</b>`);
  return `<div class="toolbar"><div class="row"><span class="chip">${icon("lock-open", 12)}&nbsp;open until ${h(new Date(x.unlocked_until).toLocaleTimeString("en-IN", { timeStyle: "short" }))}</span><input type="date" class="search" value="${x.day}" data-cashday aria-label="Day"/></div>
      <button class="btn btn-small" data-action="lockCash">${icon("lock", 14)} Lock now</button></div>
    <div class="grid">
      <section class="card stat span3" style="--sec:#1e8f6a"><div class="stat-top"><div class="stat-label">Sales ${x.is_today ? "so far today" : "that day"}</div><div class="stat-icon">${icon("trending-up", 20)}</div></div><div class="stat-number">${rupee(x.total_paise)}</div><span class="tiny">${x.bills} bills · discounts ${rupee(x.discount_paise)}</span></section>
      <section class="card stat span3" style="--sec:#9a7414"><div class="stat-top"><div class="stat-label">Cash that should be in the drawer</div><div class="stat-icon">${icon("badge-indian-rupee", 20)}</div></div><div class="stat-number">${rupee(e.expected_paise)}</div><span class="tiny">opening ${rupee(e.opening_paise)} + cash ${rupee(e.cash_sales_paise)} − refunds ${rupee(e.cash_refunds_paise)}</span></section>
      <section class="card stat span3" style="--sec:#2f6fd0"><div class="stat-top"><div class="stat-label">UPI / card</div><div class="stat-icon">${icon("wallet", 20)}</div></div><div class="stat-number">${rupee(x.by_method.UPI + x.by_method.CARD)}</div><span class="tiny">UPI ${rupee(x.by_method.UPI)} · card ${rupee(x.by_method.CARD)}</span></section>
      <section class="card stat span3" style="--sec:#8d4f9e"><div class="stat-top"><div class="stat-label">${x.is_today ? "Likely by closing" : "Normal for this weekday"}</div><div class="stat-icon">${icon("gauge", 20)}</div></div>
        <div class="stat-number">${f ? rupee(f.total_paise) : "—"}</div><span class="tiny">${f ? `range ${rupee(f.low_paise)}–${rupee(f.high_paise)} · from ${f.weeks} past ${new Date(x.day).toLocaleDateString("en-IN", { weekday: "long" })}s${f.cash_close_paise != null ? ` · drawer at close ≈ ${rupee(f.cash_close_paise)}` : ""}` : "Needs a few weeks of bills to forecast"}</span></section>
      <section class="card span7"><h3>Sales by hour</h3><div class="bars" role="img" aria-label="Sales by hour">${hours.map(([i, v]) => `<div class="b"><span style="height:${(v / maxH) * 100}%" title="${i}:00 · ${rupee(v)}"></span><i>${i}</i></div>`).join("")}</div></section>
      <section class="card span5"><h3>Who sold</h3>${table(["Cashier", "Bills", "Total"], x.cashiers.map((c) => `<tr><td>${h(c.name)}</td><td>${c.bills}</td><td><b>${rupee(c.total_paise)}</b></td></tr>`), "No bills.")}</section>
      <section class="card span7"><h3>Last 30 days</h3><div class="bars bars-30" role="img" aria-label="Daily sales, last 30 days">${x.trend.map((d) => `<div class="b"><span style="height:${(d.total_paise / maxT) * 100}%" title="${d.day} · ${rupee(d.total_paise)}"></span></div>`).join("")}</div>
        <div class="row between tiny"><span>${x.trend[0].day}</span><span>${x.trend[29].day}</span></div></section>
      <section class="card span5"><h3>Collected (entered by you)</h3>
        <div class="kv"><span>Cash entered vs drawer</span><span>${rupee(x.entered.CASH)} · ${diff(x.check.cash_diff_paise)}</span></div>
        <div class="kv"><span>UPI entered vs bills</span><span>${rupee(x.entered.UPI)} · ${diff(x.check.upi_diff_paise)}</span></div>
        <form data-cform="collect" class="form-grid mt">${select("method", "How", [["CASH", "Cash taken from drawer"], ["UPI", "UPI seen in bank app"], ["CARD", "Card settlement"]])}${field("amount", "Amount (₹)", "number", 'required min="1" step="1"')}
          <div class="wide">${field("note", "Note (optional)", "text", 'maxlength="200"')}</div><button class="btn btn-primary" type="submit">Add</button></form>
        ${x.collections.length ? table(["How", "Amount", "By", "Note"], x.collections.map((k) => `<tr><td>${k.method}</td><td>${rupee(k.amount_paise)}</td><td>${h(k.by_name)}</td><td>${h(k.note)}</td></tr>`)) : ""}</section>
    </div>`;
}

export async function openCash(day?: string) {
  try { S.insights = await api(`/counter/insights${day ? "?day=" + day : ""}`); }
  catch (e) { S.insights = null; if (e.code === "INSIGHTS_PIN_NOT_SET") toast("No cash-view PIN yet. Use “Set or change the PIN”.", true); else if (e.code !== "INSIGHTS_LOCKED") fail(e); }
}

export async function cxClick(ds) {
  if (ds.action === "lockCash") { await api("/counter/insights/lock", "POST"); S.insights = null; await nav.go("counter", S.sub); return true; }
  if (ds.action === "setPin") {
    const r = await dialog({ title: "Cash-view PIN", submit: "Save PIN",
      body: `<p class="sub">Only owner and admin can open Cash today, and only with this PIN.</p>${field("current", "Current PIN (leave empty the first time)", "password", 'inputmode="numeric" maxlength="4"')}${field("pin", "New 4-digit PIN", "password", 'required inputmode="numeric" pattern="\\d{4}" maxlength="4"')}` });
    if (!r) return true;
    try { await api("/counter/insights/pin", "PUT", r); toast("PIN saved. Now unlock with it."); } catch (e) { fail(e); }
    return true;
  }
  return false;
}

export async function cxSubmit(form) {
  const f = Object.fromEntries(new FormData(form).entries());
  if (form.dataset.cform === "unlock") {
    try { await api("/counter/insights/unlock", "POST", { pin: f.pin }); await openCash(); await nav.go("counter", S.sub); } catch (e) { fail(e); }
    return true;
  }
  if (form.dataset.cform === "collect") {
    try { await api("/counter/collections", "POST", { day: S.insights?.day, method: f.method, amount_paise: Math.round(Number(f.amount) * 100), note: f.note }); await openCash(S.insights?.day); toast("Saved."); await nav.go("counter", S.sub); } catch (e) { fail(e); }
    return true;
  }
  return false;
}

export const cxCan = { customers: () => can("counter.customers"), cash: () => can("counter.insights") };
