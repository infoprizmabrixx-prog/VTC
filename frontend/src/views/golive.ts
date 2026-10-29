// v1.6 (owner request 27 Oct 2026): Admin Control → Go-live setup. Enter what exists today
// (clients, suppliers, counter customers, beans, opening stock, cash, old dues) from the Excel
// template or by hand; the owner checks it and presses "We're live", which locks the opening figures.

import { api } from "../api.js";
import { errorText } from "../i18n.js";
import { icon } from "../icons.js";
import { S, nav } from "../state.js";
import { confirmBox, dialog, fail, field, h, num, select, table, tag, toast, when } from "../ui.js";

const FORM = { RAW: "Raw beans", ROASTED: "Roasted", GROUND: "Ground" }, PLACE = { "PROD-01": "Production", "CTR-01": "Counter" };
const SIDE = { CLIENT: "Client owes us", SUPPLIER: "We owe supplier", STAFF: "Staff advance" };
const rupee = (p) => "₹" + (Number(p || 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const d = (p) => S.data[p] || [];

export const golivePaths = () => ["/golive", "/masters?kind=product", "/masters?kind=customer", "/masters?kind=supplier", "/team"];

export function goliveTab() {
  const g = S.data["/golive"], st = g.state, setup = st.state === "SETUP", owner = S.me.user.is_owner;
  const del = (what, id) => (setup ? `<button class="btn btn-small btn-quiet" data-gldel="${what}:${id}" aria-label="Remove">${icon("trash-2", 14)}</button>` : "");
  const stockKg = g.stock.reduce((n, x) => n + x.kg, 0);
  const dueSum = (side) => g.dues.filter((x) => x.side === side).reduce((n, x) => n + x.amount_paise, 0);
  return `${setup ? `<div class="hint warn">${icon("triangle-alert", 16)} <b>Not live yet.</b> Enter everything that exists today. Clients, suppliers, customers and beans save straight away; opening stock and old dues wait here until the owner checks them and presses <b>We're live</b>.</div>`
      : `<div class="hint">${icon("circle-check", 16)} <b>Live since ${when(st.confirmed_at)}</b>, confirmed by ${h(st.confirmed_by_name || "the owner")}${st.cash_paise != null ? ` with ${rupee(st.cash_paise)} in the counter drawer` : ""}. Opening figures are locked; fix stock with Count / Correct and dues with payments in Finance.</div>`}
    <div class="grid mt">
      <section class="card span6"><h3>${icon("file-text", 18)} 1 · Excel template</h3>
        <p class="sub">One file with six sheets: Clients, Suppliers, Counter customers, Beans &amp; products, Opening stock, Old dues. Fill it in Excel or Google Sheets (one row per item; the grey “e.g.” row is ignored), then upload it. The portal checks every row first and shows what is wrong before anything is saved.</p>
        <div class="row mt"><button class="btn" data-gl="template">${icon("download", 16)} Download template</button>
          <label class="btn btn-primary">${icon("upload", 16)} Upload filled file<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-glfile hidden/></label></div>
        <div class="row mt">${[["clients", "clients"], ["suppliers", "suppliers"], ["beans", "beans & products"], ["customers", "counter customers"]].map(([k, l]) => `<span class="chip">${num(g.counts[k], 0)} ${l}</span>`).join("")}</div></section>
      <section class="card span6"><h3>${icon("badge-indian-rupee", 18)} 4 · Cash and go live</h3>
        <div class="kv"><span>Opening stock</span><b>${g.stock.length} lines · ${num(stockKg, 3)} kg</b></div>
        <div class="kv"><span>Clients owe us</span><b>${rupee(dueSum("CLIENT"))}</b></div>
        <div class="kv"><span>We owe suppliers</span><b>${rupee(dueSum("SUPPLIER"))}</b></div>
        <div class="kv"><span>Staff advances</span><b>${rupee(dueSum("STAFF"))}</b></div>
        ${setup ? (owner ? `<form data-glform class="mt">${field("cash", "Cash in the counter drawer now (₹)", "number", 'min="0" step="0.01" inputmode="decimal"', "Becomes the counter's opening cash for each day (change it later in Settings)")}
            <button class="btn btn-primary btn-big">${icon("circle-check", 18)} We're live</button></form>`
          : `<p class="hint mt">${icon("lock", 14)} Only the owner presses <b>We're live</b>, after checking these figures.</p>`) : ""}</section>
    </div>
    <section class="card mt"><div class="toolbar"><h3 class="m0">2 · Opening stock</h3>${setup ? `<button class="btn btn-small" data-gl="addstock">${icon("plus", 14)} Add a line</button>` : ""}</div>
      ${table(["Bean / product", "Form", "Bags", "Kg", "Place", "Roasted", ""], g.stock.map((x) => `<tr><td><b>${h(x.product)}</b></td><td>${FORM[x.form]}${x.bag_kind ? ` · ${x.bag_kind.toLowerCase()}` : ""}</td>
        <td>${x.bags ?? "—"}</td><td><b>${num(x.kg, 3)}</b></td><td>${PLACE[x.location]}</td><td>${h(x.roasted_on || "—")}</td><td>${x.lot_id ? tag("DONE", "In stock") : del("stock", x.id)}</td></tr>`),
        "No opening stock yet. Count what is on the shelves and at the counter, then add it here or in the template.")}</section>
    <section class="card mt"><div class="toolbar"><h3 class="m0">3 · Old dues</h3>${setup ? `<button class="btn btn-small" data-gl="adddue">${icon("plus", 14)} Add a due</button>` : ""}</div>
      ${table(["Type", "Who", "Amount", "Since", "Due", "Note", ""], g.dues.map((x) => `<tr><td>${SIDE[x.side]}</td><td><b>${h(x.party)}</b></td><td><b>${rupee(x.amount_paise)}</b></td>
        <td>${h(x.since || "—")}</td><td>${h(x.due_date || "—")}</td><td>${h(x.note)}</td><td>${x.state !== "DRAFT" ? tag("DONE", "In Finance") : del("dues", x.id)}</td></tr>`),
        "No old dues. Add money clients owe you, money you owe suppliers, and advances given to staff.")}</section>`;
}

function showReport(rep: Record<string, any>) {
  return Object.entries<any>(rep).filter(([, v]) => v.ok || v.skipped.length || v.errors.length).map(([sheet, v]) => `<div class="glrep"><b>${h(sheet)}</b>
    <span class="chip">${v.ok} ready</span>${v.skipped.length ? `<span class="chip">${v.skipped.length} already there</span>` : ""}${v.errors.length ? `<span class="chip bad">${v.errors.length} with problems</span>` : ""}
    ${v.errors.length ? `<ul class="glerr">${v.errors.slice(0, 30).map((e: string) => { const [row, code] = e.includes(": ") ? e.split(": ") : ["", e]; return `<li>${h(row)}${row ? ": " : ""}${h(errorText(code))}</li>`; }).join("")}</ul>` : ""}</div>`).join("")
    || '<p class="sub">The file has no rows to import. Fill the sheets below their headings.</p>';
}

async function upload(input: HTMLInputElement) {
  const file = input.files![0];
  input.value = "";
  if (!file) return;
  const data = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.readAsDataURL(file); });
  let check: any;
  try { check = await api("/golive/import", "POST", { data }); } catch (e) { return fail(e); }
  const ready = Object.values<any>(check.report).reduce((n: number, v: any) => n + v.ok, 0);
  const bad = Object.values<any>(check.report).reduce((n: number, v: any) => n + v.errors.length, 0);
  const f = await dialog({ title: `Checked ${file.name}`, submit: ready ? `Save ${ready} row${ready > 1 ? "s" : ""}` : null, wide: true,
    body: `${bad ? `<p class="hint warn">${bad} row${bad > 1 ? "s have" : " has"} a problem and will not be saved. Fix them in the file and upload it again later (rows already saved are skipped).</p>` : ""}${showReport(check.report)}` });
  if (!f) return;
  try {
    const r = await api("/golive/import", "POST", { data, apply: true });
    toast(`Saved ${Object.values<any>(r.report).reduce((n: number, v: any) => n + v.ok, 0)} rows.`);
    await nav.go("admin", S.sub);
  } catch (e) { fail(e); }
}

export async function goliveClick(el) {
  const ds = el.dataset;
  if (el.hasAttribute("data-glfile")) return true;   // the file picker; handled on change
  if (ds.gl === "template") {
    try {
      const res = await fetch("/api/v1/golive/template", { credentials: "same-origin" });
      if (!res.ok) throw new Error("REQUEST_FAILED");
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(await res.blob()), download: "VTC_go_live_template.xlsx" });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { fail(e); }
    return true;
  }
  if (ds.gl === "addstock") {
    const f = await dialog({ title: "Add opening stock", submit: "Add line",
      body: `${select("product", "Bean or product", d("/masters?kind=product").filter((x) => x.state === "ACTIVE").map((x) => [x.name, x.name]))}
        <div class="form-grid">${select("form", "Form", Object.entries(FORM))}${select("place", "Place", Object.entries(PLACE))}
        ${select("bag_kind", "Bag condition (raw)", [["SOUND", "Sound"], ["PARTIAL", "Partial"], ["DAMAGED", "Damaged (waits for checking)"]])}${field("bags", "Bags (raw)", "number", 'min="0" step="1" inputmode="numeric"')}
        ${field("kg", "Kg", "number", 'required min="0.001" step="0.001" inputmode="decimal"')}${field("roasted_on", "Roast date (roasted / ground)", "date")}</div>
        <p class="tiny">Roasted and ground coffee needs its roast date, so the 13-day rest still counts.</p>` });
    if (!f) return true;
    try { await api("/golive/stock", "POST", f); toast("Added."); await nav.go("admin", S.sub); } catch (e) { fail(e); }
    return true;
  }
  if (ds.gl === "adddue") {
    const opts = [...d("/masters?kind=customer").filter((x) => x.state === "ACTIVE").map((x) => [`CLIENT|${x.name}`, `Client owes us · ${x.name}`]),
      ...d("/masters?kind=supplier").filter((x) => x.state === "ACTIVE").map((x) => [`SUPPLIER|${x.name}`, `We owe supplier · ${x.name}`]),
      ...d("/team").map((x) => [`STAFF|${x.full_name}`, `Staff advance · ${x.full_name}`])];
    if (!opts.length) return toast("Add clients or suppliers first (template or Admin Control → Clients & suppliers).", true), true;
    const f = await dialog({ title: "Add an old due", submit: "Add due",
      body: `${select("who", "Who", opts)}<div class="form-grid">${field("amount", "Amount (₹)", "number", 'required min="0.01" step="0.01" inputmode="decimal"')}
        ${field("since", "Since", "date")}${field("due_date", "Due date", "date")}${field("note", "Note", "text", 'maxlength="120"')}</div>` });
    if (!f) return true;
    const [side, name] = f.who.split("|");
    try { await api("/golive/dues", "POST", { side, name, amount: f.amount, since: f.since, due_date: f.due_date, note: f.note }); toast("Added."); await nav.go("admin", S.sub); } catch (e) { fail(e); }
    return true;
  }
  if (ds.gldel) {
    const [what, id] = ds.gldel.split(":");
    try { await api(`/golive/${what}/${id}`, "DELETE"); toast("Removed."); await nav.go("admin", S.sub); } catch (e) { fail(e); }
    return true;
  }
  return false;
}

export async function goliveSubmit(form) {
  const g = S.data["/golive"], cash = form.cash.value;
  if (!(await confirmBox("Go live now?", `${g.stock.length} opening stock lines become real stock, ${g.dues.length} old dues open in Finance${cash !== "" ? `, and ${rupee(Math.round(cash * 100))} becomes the counter's opening cash` : ""}. After this the opening figures can't be edited here.`, "We're live"))) return;
  try {
    const r = await api("/golive/confirm", "POST", { cash_paise: cash === "" ? null : Math.round(Number(cash) * 100) });
    toast(`You're live: ${r.stock_lots} stock lines and ${r.dues} old dues are in.`);
    await nav.go("admin", S.sub);
  } catch (e) { fail(e); }
}

export const goliveChange = (el) => (el.hasAttribute("data-glfile") ? (upload(el), true) : false);
