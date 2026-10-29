// Owner/admin reports: totals per day, kg per item, coffee/chicory out, discounts by cashier, cancelled bills, customers, Excel.
import { api } from "../api.js";
import { refresh } from "../app.js";
import { chip, fail, h, istToday, kg, rupee, table, toast, when } from "../ui.js";

let range = null, showCustomers = false;

const monthStart = (d) => d.slice(0, 8) + "01";
const lastMonth = () => {
  const [y, m] = istToday().split("-").map(Number);
  const a = new Date(Date.UTC(m === 1 ? y - 1 : y, (m + 10) % 12, 1)), b = new Date(Date.UTC(y, m - 1, 0));
  return [a.toISOString().slice(0, 10), b.toISOString().slice(0, 10)];
};

export async function show(root) {
  range ||= [monthStart(istToday()), istToday()];
  const r = await api(`/reports?from=${range[0]}&to=${range[1]}`);
  const cust = showCustomers ? await api("/customers") : null;
  const t = r.totals;
  root.innerHTML = `<div class="toolbar"><div class="row">
      <button class="btn btn-small" data-q="today">Today</button><button class="btn btn-small" data-q="month">This month</button><button class="btn btn-small" data-q="last">Last month</button>
      <input type="date" class="search" data-from value="${r.from}" aria-label="From"/> to <input type="date" class="search" data-to value="${r.to}" aria-label="To"/></div>
      <div class="row">
        <button class="btn btn-primary" data-pdf>⬇ Download PDF</button>
        <button class="btn btn-primary" data-excel>⬇ Excel</button>
      </div></div>
    <div class="row mt-b">${chip(`${t.bills} bills`)}${chip(`${rupee(t.total_paise)} total`)}${chip(`Counter ${rupee(t.counter_paise)}`)}${chip(`Clients ${rupee(t.client_paise)}`)}
      ${t.credit_paise ? chip(`On credit ${rupee(t.credit_paise)}`, "warn") : ""}${t.collected_paise ? chip(`Dues collected ${rupee(t.collected_paise)}`) : ""}${chip(`Cash ${rupee(t.CASH)}`)}${chip(`UPI ${rupee(t.UPI)}`)}${chip(`Card ${rupee(t.CARD)}`)}
      ${chip(`Discounts ${rupee(t.discount_paise)}`, t.discount_paise ? "warn" : "")}${chip(`GST incl. ${rupee(t.gst_paise)}`)}${t.cancelled ? chip(`${t.cancelled} cancelled`, "bad") : ""}</div>
    <div class="grid">
      <section class="card span12"><h3>By day</h3>${table(["Day", "Bills", "Total", "Counter", "Clients", "On credit", "Dues collected", "Cash", "UPI", "Card", "Discount", "GST incl.", "Round off", "Cancelled"], r.days.map((d) =>
        `<tr><td class="nowrap"><b>${h(d.day)}</b></td><td>${d.bills}</td><td><b>${rupee(d.total_paise)}</b></td><td>${rupee(d.counter_paise)}</td><td>${rupee(d.client_paise)}</td>
         <td class="${d.credit_paise ? "neg" : ""}">${rupee(d.credit_paise)}</td><td>${rupee(d.collected_paise)}</td><td>${rupee(d.CASH)}</td><td>${rupee(d.UPI)}</td><td>${rupee(d.CARD)}</td>
         <td>${rupee(d.discount_paise)}</td><td>${rupee(d.gst_paise)}</td><td>${rupee(d.round_off_paise)}</td><td>${d.cancelled || ""}</td></tr>`), "No bills in these days.")}</section>
      <section class="card span7"><h3>Items sold</h3>${table(["Item", "Kg", "Amount"], r.items.map((i) =>
        `<tr><td>${h(i.item_name)}</td><td class="nowrap">${kg(i.grams)}</td><td>${rupee(i.amount_paise)}</td></tr>`), "Nothing sold.")}</section>
      <section class="card span5"><h3>What went out</h3>
        <div class="kv"><span>Coffee in chicory mixes</span><b>${kg(r.usage.coffee_g)}</b></div>
        <div class="kv"><span>Chicory in mixes</span><b>${kg(r.usage.chicory_g)}</b></div>
        <div class="kv"><span>Other items (beans, tea…)</span><b>${kg(r.usage.plain_g)}</b></div>
        <p class="tiny">Compare with what production sent to the counter to spot loss.</p></section>
      <section class="card span6"><h3>By cashier</h3>${table(["Cashier", "Bills", "Total", "Discounted bills", "Discount given"], r.by_cashier.map((c) =>
        `<tr><td><b>${h(c.cashier)}</b></td><td>${c.bills}</td><td>${rupee(c.total_paise)}</td><td>${c.discounted_bills}</td><td class="${c.discount_paise ? "neg" : ""}">${rupee(c.discount_paise)}</td></tr>`), "No bills.")}</section>
      <section class="card span6"><h3>Every discount</h3>${table(["Day", "Bill", "Cashier", "Discount", "Reason"], r.discounts.map((x) =>
        `<tr><td class="nowrap">${h(x.day)}</td><td>${h(x.bill_no)}</td><td>${h(x.cashier)}</td><td>${rupee(x.discount_paise)}</td><td>${h(x.discount_reason)}</td></tr>`), "No discounts.")}</section>
      <section class="card span6"><h3>Dues collected</h3>${table(["Day", "Client", "Amount", "How", "By"], r.collections.map((x) =>
        `<tr><td class="nowrap">${h(x.day)}</td><td>${h(x.client)}</td><td>${rupee(x.amount_paise)}</td><td>${x.method}${x.reference ? `<br><span class="tiny">${h(x.reference)}</span>` : ""}</td><td>${h(x.by_name)}</td></tr>`), "No dues collected.")}</section>
      <section class="card span6"><h3>Client prices different from the list</h3>${table(["Day", "Bill", "Client", "Item", "List", "Given"], r.price_changes.map((x) =>
        `<tr><td class="nowrap">${h(x.day)}</td><td>${h(x.bill_no)}</td><td>${h(x.client)}</td><td>${h(x.item_name)}</td><td>${rupee(x.list_rate_paise)}</td><td><b>${rupee(x.rate_paise)}</b></td></tr>`), "All client bills used list prices.")}</section>
      <section class="card span12"><h3>Items added at the counter</h3>${table(["Day", "Bill", "Item typed by cashier", "Weight", "Amount", "Added by"], r.added.map((x) =>
        `<tr><td class="nowrap">${h(x.day)}</td><td>${h(x.bill_no)}</td><td>${h(x.item_name)}</td><td>${x.grams ? kg(x.grams) : "—"}</td><td>${rupee(x.amount_paise)}</td><td><b>${h(x.added_by || "")}</b></td></tr>`),
        "None. Items not in the list, typed at the counter, show here with who added them.")}</section>
      ${r.cancelled.length ? `<section class="card span12"><h3>Cancelled bills</h3>${table(["Day", "Bill", "Amount", "Reason", "Asked by", "Approved by"], r.cancelled.map((x) =>
        `<tr><td>${h(x.day)}</td><td>${h(x.bill_no)}</td><td>${rupee(x.total_paise)}</td><td>${h(x.reason)}</td><td>${h(x.requested_by)}</td><td>${h(x.decided_by || "")}</td></tr>`))}</section>` : ""}
      <section class="card span12"><div class="toolbar"><h3 class="m0">Customers</h3>${cust ? "" : '<button class="btn btn-small" data-cust>Show customer list</button>'}</div>
        ${cust ? table(["Name", "Phone", "Visits", "Spent", "First seen", "Last seen"], cust.map((c) =>
          `<tr><td>${h(c.name || "—")}</td><td class="nowrap">${h(c.phone)}</td><td>${c.visits}</td><td>${rupee(c.spent_paise)}</td><td>${when(c.first_seen)}</td><td>${when(c.last_seen)}</td></tr>`), "No customers yet.")
          : '<p class="tiny">Full phone numbers. Opening the list is written in the audit log.</p>'}</section>
    </div>`;

  root.onclick = async (e) => {
    const b = e.target.closest("[data-q],[data-excel],[data-pdf],[data-cust]");
    if (!b) return;
    if (b.dataset.q) { range = b.dataset.q === "today" ? [istToday(), istToday()] : b.dataset.q === "month" ? [monthStart(istToday()), istToday()] : lastMonth(); return refresh(); }
    if (b.hasAttribute("data-cust")) { showCustomers = true; return refresh(); }
    if (b.hasAttribute("data-pdf")) {
      try {
        const res = await fetch(`/api/reports.pdf?from=${range[0]}&to=${range[1]}`, { credentials: "same-origin" });
        if (!res.ok) throw Object.assign(new Error(), { code: (await res.json().catch(() => ({}))).error || "REQUEST_FAILED" });
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(await res.blob()), download: `VTC_report_${range[0]}_to_${range[1]}.pdf` });
        a.click();
        toast("PDF report saved to your Downloads folder.");
      } catch (err) { fail(err); }
      return;
    }
    try {
      const res = await fetch(`/api/reports.xlsx?from=${range[0]}&to=${range[1]}`, { credentials: "same-origin" });
      if (!res.ok) throw Object.assign(new Error(), { code: (await res.json().catch(() => ({}))).error || "REQUEST_FAILED" });
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(await res.blob()), download: `VTC_counter_${range[0]}_to_${range[1]}.xlsx` });
      a.click();
      toast("Excel saved to your Downloads folder.");
    } catch (err) { fail(err); }
  };
  root.onchange = (e) => {
    if (!e.target.matches("[data-from],[data-to]")) return;
    const a = root.querySelector("[data-from]").value, z = root.querySelector("[data-to]").value;
    if (a && z && a <= z) { range = [a, z]; refresh(); }
  };
}
