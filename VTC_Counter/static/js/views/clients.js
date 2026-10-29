// Clients: Bill Dealer, Bill Café, Who owes, and Client Directory.
import { api } from "../api.js";
import { refresh } from "../app.js";
import { chip, dialog, fail, field, h, rupee, table, toast, when } from "../ui.js";
import { clientDialog } from "./clientform.js";
import * as sell from "./sell.js";

let tab = "dealer";
let duesFilter = "all";
let listFilter = "all";

const age = (r, od) => `${r.oldest_days ? `<span class="${od != null && r.oldest_days > od ? "neg" : ""}">${r.oldest_days} days</span>` : "—"}`;

export async function show(root, S) {
  const tabs = [
    ["dealer", "Bill Dealer"],
    ["cafe", "Bill Café"],
  ];
  if (S.me?.can_view_dues || S.boss) tabs.push(["dues", "Who owes"]);
  if (S.me?.can_manage_clients || S.boss) tabs.push(["list", "Client directory"]);

  // If active tab was hidden by permissions, fall back to dealer
  if (!tabs.some(([k]) => k === tab)) tab = "dealer";

  root.innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === tab ? "on" : ""}" data-ctab="${k}">${l}</button>`).join("")}</div><div id="cbody"></div>`;
  root.querySelectorAll("[data-ctab]").forEach((b) => (b.onclick = () => { tab = b.dataset.ctab; refresh(); }));
  const body = root.querySelector("#cbody");
  
  if (tab === "dealer") return sell.show(body, S, "dealer");
  if (tab === "cafe") return sell.show(body, S, "cafe");
  if (tab === "dues") return dues(body, S);
  return list(body, S);
}

// ------------------------------------------------------------------ who owes
async function dues(root, S) {
  const url = duesFilter === "all" ? "/dues" : `/dues?type=${duesFilter}`;
  const d = await api(url), t = d.totals, od = d.overdue_days;
  root.innerHTML = `
    <div class="seg-tabs">
      <button class="seg-tab-btn ${duesFilter === "all" ? "active" : ""}" data-dfilter="all">All Market Dues</button>
      <button class="seg-tab-btn ${duesFilter === "dealer" ? "active" : ""}" data-dfilter="dealer">Dealer Dues</button>
      <button class="seg-tab-btn ${duesFilter === "cafe" ? "active" : ""}" data-dfilter="cafe">Café Dues</button>
    </div>
    <div class="grid mt-b">
      <section class="card stat-due span4"><div class="tiny upper">Total dues in market</div><div class="due-big">${rupee(t.balance_paise)}</div>
        ${t.advance_paise ? `<div class="tiny">Advances with us: ${rupee(t.advance_paise)}</div>` : ""}</section>
      <section class="card span8"><div class="tiny upper">Aging analysis</div><div class="aging">
        ${[["0_30", "0–30 days"], ["31_60", "31–60 days"], ["61_90", "61–90 days"], ["90_plus", "Over 90 days"]].map(([k, l], i) =>
          `<div class="age-cell a${i}"><span>${l}</span><b>${rupee(t[k])}</b></div>`).join("")}</div>
        ${od == null ? `<p class="tiny">${S.boss ? "Configure overdue warning in Setup to flag delinquent accounts." : ""}</p>` : `<p class="tiny">Overdue warning threshold: ${od} days.</p>`}</section></div>
    <div class="toolbar"><h3 class="m0">Market Outstandings (${d.clients.length})</h3>${S.boss ? '<button class="btn btn-small" data-xl>⬇ Export Dues Excel</button>' : ""}</div>
    <section class="card">${table(["Client", "Type", "Balance", "0–30", "31–60", "61–90", "90+", "Oldest", ""], d.clients.map((r) =>
      `<tr><td><b>${h(r.name)}</b>${r.phone ? `<br><span class="tiny">${h(r.phone)}</span>` : ""}</td>
       <td><span class="chip ${r.client_type === "cafe" ? "tea" : ""}">${h(r.client_type ? r.client_type.toUpperCase() : "DEALER")}</span></td>
       <td><b class="${r.balance_paise > 0 ? "neg" : ""}">${r.balance_paise < 0 ? "Advance " + rupee(-r.balance_paise) : rupee(r.balance_paise)}</b></td>
       <td>${rupee(r.buckets["0_30"])}</td><td>${rupee(r.buckets["31_60"])}</td><td>${rupee(r.buckets["61_90"])}</td><td>${rupee(r.buckets["90_plus"])}</td><td>${age(r, od)}</td>
       <td class="nowrap"><button class="btn btn-small btn-primary" data-collect="${r.id}">Collect</button> <button class="btn btn-small" data-open="${r.id}">Statement</button>
         ${r.phone && r.balance_paise > 0 ? ` <button class="btn btn-small wa" data-remind="${r.id}">WhatsApp</button>` : ""}</td></tr>`), "No dues outstanding.")}</section>`;
  
  root.querySelectorAll("[data-dfilter]").forEach((b) => (b.onclick = () => { duesFilter = b.dataset.dfilter; refresh(); }));
  root.onclick = (e) => clientActions(e, S, d.clients);
}

// ------------------------------------------------------------------ client directory
async function list(root, S) {
  const url = listFilter === "all" ? "/clients" : `/clients?type=${listFilter}`;
  const d = await api(url), od = d.overdue_days;
  root.innerHTML = `
    <div class="seg-tabs">
      <button class="seg-tab-btn ${listFilter === "all" ? "active" : ""}" data-lfilter="all">All Clients (${d.clients.length})</button>
      <button class="seg-tab-btn ${listFilter === "dealer" ? "active" : ""}" data-lfilter="dealer">Dealers</button>
      <button class="seg-tab-btn ${listFilter === "cafe" ? "active" : ""}" data-lfilter="cafe">Cafés</button>
    </div>
    <div class="toolbar"><h3 class="m0">Directory</h3>
      <div class="row">
        <button class="btn btn-primary btn-small" data-new="dealer">+ Add Dealer</button>
        <button class="btn btn-primary btn-small" data-new="cafe">+ Add Café</button>
      </div>
    </div>
    <section class="card">${table(["Client Name", "Type", "Contact", "GSTIN", "Balance", "Oldest", ""], d.clients.map((r) =>
      `<tr class="${r.active ? "" : "muted"}">
       <td><b>${h(r.name)}</b>${r.active ? "" : " " + chip("hidden")}${r.address ? `<br><span class="tiny">${h(r.address)}</span>` : ""}</td>
       <td><span class="chip ${r.client_type === "cafe" ? "tea" : ""}">${h(r.client_type ? r.client_type.toUpperCase() : "DEALER")}</span></td>
       <td>${h(r.contact)}${r.phone ? `<br><span class="tiny">${h(r.phone)}</span>` : ""}</td>
       <td>${h(r.gstin) || "—"}${r.state_code && r.state_code !== "36" ? ' <span class="chip">IGST</span>' : ""}</td>
       <td><b class="${r.balance_paise > 0 ? "neg" : ""}">${r.balance_paise < 0 ? "Advance " + rupee(-r.balance_paise) : rupee(r.balance_paise)}</b></td><td>${age(r, od)}</td>
       <td class="nowrap"><button class="btn btn-small" data-edit="${r.id}">Edit</button> <button class="btn btn-small" data-open="${r.id}">Statement</button>
         ${S.boss ? ` <button class="btn btn-small btn-quiet" data-active="${r.id}:${r.active ? 0 : 1}">${r.active ? "Hide" : "Show"}</button>` : ""}</td></tr>`),
      "No clients found in this category.")}</section>`;

  root.querySelectorAll("[data-lfilter]").forEach((b) => (b.onclick = () => { listFilter = b.dataset.lfilter; refresh(); }));
  root.onclick = (e) => clientActions(e, S, d.clients);
}

// ------------------------------------------------------------------ actions shared by both lists
async function clientActions(e, S, rows) {
  const b = e.target.closest("[data-collect],[data-open],[data-remind],[data-xl],[data-new],[data-edit],[data-active]");
  if (!b) return;
  try {
    if (b.dataset.collect) return collectDialog(rows.find((r) => r.id == b.dataset.collect));
    if (b.dataset.open) return statementDialog(Number(b.dataset.open), S);
    if (b.dataset.remind) {
      const r = await api(`/clients/${b.dataset.remind}/reminder`);
      return remindDialog(r);
    }
    if (b.hasAttribute("data-xl")) return download("/api/dues.xlsx", `VTC_client_dues.xlsx`);
    if (b.dataset.new) { if (await clientDialog(null, b.dataset.new)) refresh(); return; }
    if (b.dataset.edit) { if (await clientDialog(rows.find((r) => r.id == b.dataset.edit))) refresh(); return; }
    if (b.dataset.active) { const [id, on] = b.dataset.active.split(":"); await api(`/clients/${id}`, "PUT", { active: on === "1" }); return refresh(); }
  } catch (err) { fail(err); }
}

async function collectDialog(cl) {
  const r = await dialog({ title: `Collect from ${cl.name}`, submit: "Save payment",
    body: `<div class="kv"><span>${cl.balance_paise < 0 ? "Advance with us" : "Balance due"}</span><b class="${cl.balance_paise > 0 ? "neg" : ""}">${rupee(Math.abs(cl.balance_paise))}</b></div>
      <div class="form-grid mt">${field("amount", "Amount received (₹)", "number", `required min="0.01" step="0.01" inputmode="decimal" value="${cl.balance_paise > 0 ? cl.balance_paise / 100 : ""}"`)}
        <div class="field"><label for="f_m">Payment Mode</label><select id="f_m" name="method"><option value="CASH">Cash (goes in today's drawer)</option><option value="UPI">UPI</option>
          <option value="BANK">Bank transfer</option><option value="CHEQUE">Cheque</option></select></div></div>
      ${field("reference", "UTR / cheque no. (optional)", "text", 'maxlength="60" autocomplete="off"')}
      ${field("note", "Note (optional)", "text", 'maxlength="200" autocomplete="off"')}
      <p class="tiny">Collections settle the oldest unpaid bills first.</p>` });
  if (!r) return;
  try {
    const res = await api(`/clients/${cl.id}/collect`, "POST", { amount_paise: Math.round(Number(r.amount) * 100), method: r.method, reference: r.reference, note: r.note });
    toast(`Saved. ${cl.name}'s balance is now ${res.balance_paise < 0 ? "an advance of " + rupee(-res.balance_paise) : rupee(res.balance_paise)}.`);
    refresh();
  } catch (e) { fail(e); }
}

async function statementDialog(cid, S) {
  const d = await api(`/clients/${cid}`), cl = d.client, sm = d.summary;
  await dialog({ title: `${cl.name} — statement`, submit: null, wide: true,
    body: `<div class="row">${chip(sm.balance_paise < 0 ? `Advance ${rupee(-sm.balance_paise)}` : `Balance ${rupee(sm.balance_paise)}`, sm.balance_paise > 0 ? "bad" : "")}
        ${sm.oldest_days ? chip(`Oldest unpaid ${sm.oldest_days} days`, d.overdue_days != null && sm.oldest_days > d.overdue_days ? "bad" : "") : ""}
        ${cl.phone ? chip(cl.phone) : ""}${cl.gstin ? chip("GSTIN " + cl.gstin) : ""}</div>
      ${table(["Date", "Details", "Charged", "Received", "Balance"], d.statement.map((r) =>
        `<tr><td class="nowrap">${h(r.day)}</td><td>${h(r.what)}</td><td>${r.debit ? rupee(r.debit) : ""}</td><td>${r.credit ? rupee(r.credit) : ""}</td><td><b>${rupee(r.balance)}</b></td></tr>`), "No bills or payments yet.")}
      ${d.collections.length ? `<h3 class="mt">Payments received</h3>${table(["When", "Amount", "How", "Reference", "Entered by", ""], d.collections.map((k) =>
        `<tr class="${k.cancelled_at ? "muted" : ""}"><td class="nowrap">${when(k.created_at)}</td><td>${rupee(k.amount_paise)}</td><td>${k.method}</td><td>${h(k.reference)}</td><td>${h(k.by_name)}</td>
         <td>${k.cancelled_at ? `<span class="tiny">cancelled: ${h(k.cancel_reason)}</span>` : S.boss ? `<button type="button" class="btn btn-small btn-danger" data-undo="${k.id}">Cancel</button>` : ""}</td></tr>`))}` : ""}
      <div class="row mt"><button type="button" class="btn btn-primary" data-pdf>⬇ Statement PDF</button>
        ${cl.phone && sm.balance_paise > 0 ? '<button type="button" class="btn wa" data-wa>WhatsApp Desktop Reminder</button>' : ""}</div>`,
    onReady(dl) {
      dl.querySelector("[data-pdf]").onclick = () => download(`/api/clients/${cid}/statement.pdf`, `Statement_${cl.name.replace(/\W+/g, "_")}.pdf`);
      dl.querySelector("[data-wa]")?.addEventListener("click", async () => { try { remindDialog(await api(`/clients/${cid}/reminder`)); } catch (e) { fail(e); } });
      dl.querySelectorAll("[data-undo]").forEach((b) => (b.onclick = async () => {
        const r = await dialog({ title: "Cancel this payment?", submit: "Cancel payment", danger: true,
          body: `<p class="hint">Use this only if the payment was entered by mistake. It stays in the records marked cancelled.</p>
            <div class="field"><label for="f_r">Reason</label><input id="f_r" name="reason" required minlength="5" maxlength="200"/></div>` });
        if (!r) return;
        try { await api(`/collections/${b.dataset.undo}/cancel`, "POST", r); toast("Payment cancelled."); dl.close$?.(null); refresh(); } catch (e) { fail(e); }
      }));
    } });
}

async function remindDialog(r) {
  const waLinkDesktop = r.phone ? `whatsapp://send?phone=${r.phone.length === 10 ? '91' + r.phone : r.phone}&text=${encodeURIComponent(r.text)}` : null;
  await dialog({ title: "WhatsApp Desktop Reminder", submit: null,
    body: `<p class="hint">${h(r.text)}</p>${waLinkDesktop ? `<a class="btn wa" href="${h(waLinkDesktop)}">Open in WhatsApp Desktop</a>` : "<p>No phone number saved for this client.</p>"}` });
}

async function download(url, name) {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw Object.assign(new Error(), { code: (await res.json().catch(() => ({}))).error || "REQUEST_FAILED" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(await res.blob()), download: name });
    a.click();
    toast(`${name} saved to your Downloads folder.`);
  } catch (e) { fail(e); }
}
