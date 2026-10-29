// Admin Control → Clients & suppliers · Beans & products · Roast profiles · Prices (v1.1).
// One place for everything the business adds or prices. Managers may suggest
// drafts; only admin-level people (masters.approve) activate or change records.

import { api } from "../api.js";
import { S, can, nav } from "../state.js";
import { dialog, fail, field, h, num, select, table, tag, toast } from "../ui.js";
import { itemDialog, pricesTable } from "./counter.js";

const rupee = (p) => (p == null ? "Not set" : "₹" + (Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const CATEGORY = { GREEN_COFFEE: "Green coffee beans", CHICORY: "Chicory", TEA: "Tea", PACKAGING: "Packaging", OTHER: "Other", "": "—" };
const mastersOk = () => can("masters.create_draft") || can("masters.approve");

export const CATALOGUE_TABS: [string, string, () => boolean][] = [
  ["clients", "Clients & suppliers", mastersOk],
  ["beans", "Beans & products", mastersOk],
  ["profiles", "Roast profiles", () => can("masters.approve")],
  ["prices", "Prices", () => can("system.settings")],
];

export function cataloguePaths(tab) {
  if (tab === "clients") return ["/masters?kind=customer", "/masters?kind=supplier"];
  if (tab === "beans") return ["/masters?kind=product"];
  if (tab === "profiles") return ["/roast-profiles"];
  if (tab === "prices") return ["/counter/setup", "/admin/settings", "/masters?kind=product"];
  return null;
}

const approver = () => can("masters.approve");
const stateTag = (x) => tag(x.state === "ACTIVE" ? "DONE" : x.state === "DRAFT" ? "hold" : "REJECTED", x.state === "INACTIVE" ? "switched off" : x.state.toLowerCase());
const rowActions = (x) => approver() ? (x.state === "DRAFT" ? `<button class="btn btn-small btn-primary" data-mapprove="${x.id}">Approve</button>`
  : `<button class="btn btn-small" data-medit="${x.id}">Edit</button> <button class="btn btn-small btn-quiet" data-mtoggle="${x.id}:${x.state === "ACTIVE" ? 0 : 1}">${x.state === "ACTIVE" ? "Switch off" : "Switch on"}</button>`) : "";

function clientsPage() {
  const sec = (kind, title, empty) => {
    const rows = S.data[`/masters?kind=${kind}`] || [];
    return `<section class="card span6"><div class="row between"><h3>${title}</h3><button class="btn btn-primary btn-small" data-madd="${kind}">+ ${approver() ? "Add" : "Suggest"}</button></div>${table(
      ["Name", "Contact", "Status", ""], rows.map((x) => `<tr class="${x.state === "INACTIVE" ? "muted" : ""}"><td><b>${h(x.name)}</b><br><span class="tiny">#${x.id}</span></td>
        <td>${h([x.phone, x.address].filter(Boolean).join(" · ") || "—")}</td><td>${stateTag(x)}</td><td class="nowrap">${rowActions(x)}</td></tr>`), empty)}</section>`;
  };
  return `${approver() ? "" : '<p class="hint">You can suggest new records. They stay as drafts until an admin approves them (O-05).</p>'}
    <div class="grid">${sec("customer", "Clients (cafés, dealers, outside-roast customers)", "No clients yet.")}${sec("supplier", "Suppliers & auction houses", "No suppliers yet.")}</div>`;
}

function beansPage() {
  const rows = S.data["/masters?kind=product"] || [];
  return `<div class="toolbar"><p class="sub m0">Every bean type and stock item. The kg-per-bag is used at Stock Inward — enter the real, confirmed bag weight.</p>
    <button class="btn btn-primary" data-madd="product">+ ${approver() ? "Add bean / product" : "Suggest a product"}</button></div>
    <section class="card">${table(["Name", "Type", "kg per bag", "Status", ""], rows.map((x) =>
      `<tr class="${x.state === "INACTIVE" ? "muted" : ""}"><td><b>${h(x.name)}</b><br><span class="tiny">Code <b class="code">${h(x.code || "—")}</b></span></td><td>${h(CATEGORY[x.category || ""])}</td>
       <td>${x.nominal_kg ? num(x.nominal_kg, 3) + " kg" : '<span class="tiny">not set</span>'}</td><td>${stateTag(x)}</td><td class="nowrap">${rowActions(x)}</td></tr>`), "No beans or products yet.")}</section>`;
}

function profilesPage() {
  const rows = S.data["/roast-profiles"] || [];
  return `<div class="toolbar"><p class="sub m0">The roaster picks one of these on every batch. Switched-off profiles stay on old batches.</p>
    <button class="btn btn-primary" data-action="addProfile">+ Add roast profile</button></div>
    <section class="card">${table(["Profile", "Notes", "Status", ""], rows.map((p) =>
      `<tr class="${p.active ? "" : "muted"}"><td><b>${h(p.name)}</b></td><td>${h(p.notes || "—")}</td><td>${tag(p.active ? "DONE" : "REJECTED", p.active ? "in use" : "switched off")}</td>
       <td class="nowrap"><button class="btn btn-small" data-pedit="${p.id}">Edit</button> <button class="btn btn-small btn-quiet" data-ptoggle="${p.id}:${p.active ? 0 : 1}">${p.active ? "Switch off" : "Switch on"}</button></td></tr>`),
      "No profiles yet. Until you add one, roasters can record batches without a profile.")}</section>`;
}

function pricesPage() {
  const st = S.data["/admin/settings"].settings, setup = S.data["/counter/setup"];
  const prods = (S.data["/masters?kind=product"] || []).filter((p) => p.state === "ACTIVE");
  const chic = prods.filter((p) => p.category === "CHICORY");
  const opts = (chic.length ? chic : prods).map((p) => [p.id, p.name]);
  return `<div class="grid"><section class="card span12"><div class="row between"><h3>Counter price list</h3><button class="btn btn-primary btn-small" data-action="newItem">+ Add item</button></div>
      <p class="tiny">Bills keep the price used at the time. Every change is a new version in the audit log.</p>${pricesTable(setup)}</section>
    <section class="card span6"><h3>"Others" — custom coffee : chicory</h3>
      <p class="sub">When a customer asks for a ratio that isn't on the list (e.g. 80/20), the bill price is worked out from these two rates.</p>
      <form data-settings="custom">
        <div class="form-grid">${field("custom_coffee_rate", "Pure coffee powder ₹/kg", "number", `min="0.01" step="0.01" value="${st.custom_coffee_rate_paise == null ? "" : st.custom_coffee_rate_paise / 100}"`)}
        ${field("custom_chicory_rate", "Chicory ₹/kg", "number", `min="0.01" step="0.01" value="${st.custom_chicory_rate_paise == null ? "" : st.custom_chicory_rate_paise / 100}"`)}</div>
        ${select("custom_chicory_product_id", "Chicory is taken from stock of", [["", "Choose…"], ...opts], "", st.custom_chicory_product_id || "")}
        <p class="tiny">Example 80/20 = 80% × coffee rate + 20% × chicory rate. A manager can change the price on one bill, with a reason that is logged.</p>
        <div class="form-actions"><button class="btn btn-primary">Save rates</button></div></form></section></div>`;
}

export function catalogueRender(tab) {
  return { clients: clientsPage, beans: beansPage, profiles: profilesPage, prices: pricesPage }[tab]();
}

async function masterDialog(kind, x = null) {
  const isProd = kind === "product";
  const r = await dialog({ title: x ? `Edit ${x.name}` : isProd ? "Add bean / product" : kind === "customer" ? "Add client" : "Add supplier", submit: "Save",
    body: `${field("name", "Name", "text", `required minlength="2" maxlength="110" value="${h(x?.name || "")}"`)}
      ${isProd ? `${select("category", "Type", Object.entries(CATEGORY).filter(([k]) => k), "", x?.category || "GREEN_COFFEE")}
        ${field("nominal_kg", "Approved kg per bag", "number", `min="0.001" step="0.001" value="${x?.nominal_kg ?? ""}"`, "Leave empty if it isn't bought in bags. Changing it affects only future receipts.")}
        ${field("code", "Short code on labels (2–6 letters/numbers)", "text", `maxlength="6" pattern="[A-Za-z0-9]{2,6}" autocapitalize="characters" value="${h(x?.code || "")}" placeholder="e.g. ROBAB"`, x ? "Changing it affects only new lots; old codes stay as printed." : "Leave empty and the portal suggests one from the name.")}` : ""}
      ${!isProd && can("customer.contacts") ? `${field("phone", "Phone", "tel", `maxlength="20" value="${h(x?.phone || "")}"`)}${field("address", "Address", "text", `maxlength="200" value="${h(x?.address || "")}"`)}` : ""}` });
  if (!r) return;
  const body = { name: r.name, ...(isProd ? { category: r.category, nominal_kg: r.nominal_kg || null, code: (r.code || "").toUpperCase() } : {}), ...(r.phone !== undefined ? { phone: r.phone, address: r.address } : {}) };
  try {
    if (x) await api(`/masters/${x.id}`, "PUT", body);
    else { const res = await api("/masters", "POST", { kind, ...body }); toast(res.state === "ACTIVE" ? "Added and active." : "Draft saved — an admin will approve it."); }
    if (x) toast("Saved.");
    await nav.go("admin", S.sub);
  } catch (e) { fail(e); }
}

async function profileDialog(p = null) {
  const r = await dialog({ title: p ? `Edit ${p.name}` : "Add roast profile", submit: "Save",
    body: `${field("name", "Profile name", "text", `required minlength="2" maxlength="60" value="${h(p?.name || "")}"`, "e.g. City+, Medium filter, Dark South Indian")}
      ${field("notes", "Notes (temperature, time, colour target)", "text", `maxlength="200" value="${h(p?.notes || "")}"`)}` });
  if (!r) return;
  try { await api(p ? `/roast-profiles/${p.id}` : "/roast-profiles", p ? "PUT" : "POST", r); toast("Saved."); await nav.go("admin", S.sub); } catch (e) { fail(e); }
}

const findMaster = (id) => ["product", "customer", "supplier"].flatMap((k) => S.data[`/masters?kind=${k}`] || []).find((x) => x.id === Number(id));

export async function catalogueClick(btn) {
  const ds = btn.dataset;
  if (ds.madd) return masterDialog(ds.madd), true;
  if (ds.medit) { const x = findMaster(ds.medit); return masterDialog(x.kind, x), true; }
  if (ds.mapprove) { try { await api(`/masters/${ds.mapprove}/approve`, "POST"); toast("Approved and active."); await nav.go("admin", S.sub); } catch (e) { fail(e); } return true; }
  if (ds.mtoggle) { const [id, on] = ds.mtoggle.split(":"); try { await api(`/masters/${id}`, "PUT", { active: on === "1" }); toast(on === "1" ? "Switched on." : "Switched off. History is kept."); await nav.go("admin", S.sub); } catch (e) { fail(e); } return true; }
  if (ds.action === "addProfile") return profileDialog(), true;
  if (ds.pedit) return profileDialog((S.data["/roast-profiles"] || []).find((p) => p.id === Number(ds.pedit))), true;
  if (ds.ptoggle) { const [id, on] = ds.ptoggle.split(":"); try { await api(`/roast-profiles/${id}`, "PUT", { active: on === "1" }); await nav.go("admin", S.sub); } catch (e) { fail(e); } return true; }
  if (ds.action === "newItem") return itemDialog(), true;
  if (ds.edititem) return itemDialog(S.data["/counter/setup"].items.find((i) => i.id === Number(ds.edititem))), true;
  if (ds.toggleitem) { const [id, on] = ds.toggleitem.split(":"); try { await api(`/counter/items/${id}`, "PUT", { active: on === "1" }); await nav.go("admin", S.sub); } catch (e) { fail(e); } return true; }
  return false;
}

export async function customRatesSubmit(form) {
  const f = Object.fromEntries(new FormData(form).entries());
  const money = (v) => (v === "" ? null : Math.round(Number(v) * 100));
  try {
    await api("/admin/settings", "PUT", { custom_coffee_rate_paise: money(f.custom_coffee_rate), custom_chicory_rate_paise: money(f.custom_chicory_rate),
      custom_chicory_product_id: f.custom_chicory_product_id ? Number(f.custom_chicory_product_id) : null });
    toast("Custom blend rates saved.");
    await nav.go("admin", S.sub);
  } catch (e) { fail(e); }
}
