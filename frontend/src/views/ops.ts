// Operations screens (ported from pilot v0.1). Buttons and fields appear only
// when the person holds the matching permission; the server checks again.

import { api, newKey } from "../api.js";
import { t } from "../i18n.js";
import { S, can, nav, tier } from "../state.js";
import { discussBtn } from "./comms.js";
import { busy } from "../fx.js";
import { pendingTask } from "./pending.js";
import { cardId, cardsClick, cardsSection } from "./stockcards.js";
import { arrangeBar, arrangeClick, customiseLabel, initArrange, toggleArrange, widget } from "../arrange.js";
import { fmtDay, offerBagLabels, offerLabels } from "../labels.js";
import { icon } from "../icons.js";
import { SECTION } from "../shell.js";
import { check, chip, confirmBox, dialog, fail, field, goto, h, num, pageHead, select, table, tag, toast, when } from "../ui.js";

const eyebrow = () => `${S.me.settings.short_name} / ${S.me.user.role_name}`;
const d = (path) => S.data[path] || [];

function metric(title, value, unit, ic, goTo = "") {
  const col = SECTION[goTo]?.color || "#805039";
  return `<section class="card stat ${goTo ? "clickable" : ""}" style="--sec:${col}" ${goTo ? `data-go="${goTo}" role="button" tabindex="0"` : ""}>
    <div class="stat-top"><div class="stat-label">${h(title)}</div><div class="stat-icon" aria-hidden="true">${icon(ic, 20)}</div></div>
    <div class="stat-number">${h(value)}<span class="unit">${h(unit)}</span></div></section>`;
}

const NEXT_GO = { ROAST: "roasting", PACK: "packing", QC: "qc", OUTSIDE: "outside", COUNTER: "counter", DISPATCH: "dispatch", INWARD: "inward", BLEND: "blending", ORDERS: "orders", COUNT: "inventory" };

// ---------------------------------------------------------------- dashboard
const dashboard = {
  paths: () => ["/summary", ...(can("tasks.view_own") ? ["/tasks"] : [])],
  after: initArrange,
  render() {
    const s = S.data["/summary"] || {}, u = S.me.user, p = S.me.prefs;
    const cards: Record<string, [string, string, string, string, string]> = {
      my_tasks: ["My assigned tasks", num(s.tasks), "items", "list-checks", "tasks"],
      incoming: ["Received bags", num(s.received_bags), "bags", "package-plus", "inward"],
      stock: ["Beans in stock", num(s.beans_in_stock), s.beans_low ? `beans · ${s.beans_low} low` : "beans", "warehouse", "inventory"],
      roasts: ["Roasting batches", num(s.roasts), "batches", "flame", "roasting"],
      packing: ["Packing jobs open", num(s.packing), "jobs", "package", "packing"],
      team: ["Active team tasks", num(s.team_tasks), "items", "users", "tasks"],
      review: ["Work to review", num(s.to_review), "tasks", "circle-check", "tasks"],
      holds: ["Quality holds", num(s.held), "lots", "shield-check", "qc"],
      orders: ["Sales orders", num(s.orders), "orders", "shopping-cart", "orders"],
      pending_invoices: ["Invoices to review", num(s.pending_invoices), "receipts", "receipt", "finance"],
      audit: ["Audit activity", "Open", "", "settings", "admin"],
    };
    // Next job: work already started first, then the earliest due, then the oldest.
    const rank = { IN_PROGRESS: 0, BLOCKED: 1, OPEN: 2 };
    const mine = d("/tasks").filter((x) => !["DONE", "SUBMITTED"].includes(x.status) && x.assigned_to === u.id)
      .sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || String(a.due || "9").localeCompare(String(b.due || "9")) || a.id - b.id);
    const next = mine[0];
    const nextCard = tier() === "staff" ? `<section class="card next-job span12" style="--sec:${SECTION[NEXT_GO[next?.kind]]?.color || "#805039"}">
      <div class="eyebrow">${h(t("nextTask"))}</div>
      ${next ? `<h2>${h(next.title)}</h2><p class="sub">${next.target != null ? `${num(next.progress)} of ${num(next.target)} ${h(next.unit || "")} done` : h(next.status.replace("_", " ").toLowerCase())}${next.due ? " · due " + h(next.due) : ""}${next.kind !== "GENERAL" ? " · counts itself as you record the work" : ""}</p>
        <div class="row">${next.target != null && next.progress >= next.target ? `<button class="btn btn-primary btn-big" data-tsubmit="${next.id}">✓ Mark completed</button>`
          : NEXT_GO[next.kind] ? `<button class="btn btn-primary btn-big" data-go="${NEXT_GO[next.kind]}">Start: ${h(t(NEXT_GO[next.kind]))}</button>` : `<button class="btn btn-primary btn-big" data-task="${next.id}">Update progress</button>`}<button class="btn btn-big" data-go="tasks">All my work (${mine.length})</button></div>`
        : `<h2>${h(t("allDone"))}</h2><p class="sub">New work from your manager will appear here.</p>`}
    </section>` : "";
    // v1.5: cards are arranged in place — press and hold one to move it (arrange.js)
    const body = p.widgets.map((id) => {
      if (id === "quick_actions")
        return widget(id, "Quick actions", `<section class="card"><h3>Quick actions</h3><div class="shortcuts">${
          p.shortcuts.map((m) => `<button class="shortcut" data-go="${m}" style="--sec:${SECTION[m]?.color}">${icon(SECTION[m]?.icon, 18)} ${h(t(m))}</button>`).join("") ||
          '<span class="tiny">Choose shortcuts: Customize → Shortcuts &amp; title.</span>'}</div></section>`);
      return cards[id] ? widget(id, cards[id][0], metric(...cards[id])) : "";
    }).join("");
    const hr = new Date().getHours(), hello = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
    return pageHead(`${today} · ${S.me.user.role_name}`, p.welcome || `${hello}, ${u.full_name.split(" ")[0]}`,
      tier() === "staff" ? "Your jobs for today, section by section." : "What is waiting in each section today, then today's numbers.",
      `<button class="btn" data-action="customise">${customiseLabel()}</button>`) +
      `<div class="grid">${nextCard}${pendingTiles()}</div>
      <div class="wwrap ${S.arranging ? "arranging" : ""}" id="wwrap">${arrangeBar()}<div class="grid wgrid" id="wgrid">${body}</div>
        ${body ? "" : '<section class="card"><div class="empty"><b>Your home screen is empty</b>Press Customize, then Add card.</div></section>'}</div>`;
  },
};

// Zoho-style section tiles: one per section with work waiting for this person.
function pendingTiles() {
  const pend = S.pending || {};
  const keys = Object.keys(pend).filter((k) => pend[k].count && k !== "dashboard").sort((a, b) => pend[b].count - pend[a].count);
  if (!keys.length) return `<section class="card span12 all-clear"><span class="ac-ic">${icon("sparkles", 28)}</span><div><h3>Nothing pending</h3><p class="sub m0">Every section is clear right now.</p></div></section>`;
  return `<section class="span12"><div class="tiles-head"><h3>Pending by section</h3></div><div class="tiles">${keys.map((k) => {
    const x = pend[k], tasks = x.tasks.filter((t) => t.status !== "SUBMITTED").length, rev = x.tasks.filter((t) => t.may_review).length, dec = x.waiting.reduce((v, w) => v + w.count, 0);
    const bits = [tasks && `${tasks} job${tasks > 1 ? "s" : ""}`, rev && `${rev} to review`, dec && `${dec} waiting`].filter(Boolean).join(" · ");
    return `<button class="tile" data-go="${k}" style="--sec:${SECTION[k]?.color}"><span class="tile-ic">${icon(SECTION[k]?.icon, 22)}</span>
      <span class="tile-n">${x.count}</span><span class="tile-name">${h(t(k))}</span><span class="tile-sub">${h(bits)}</span></button>`;
  }).join("")}</div></section>`;
}

// ---------------------------------------------------------------- inward
const inward = {
  paths: () => ["/inward", "/masters?kind=product"],
  render() {
    const rows = d("/inward"), prods = d("/masters?kind=product").filter((p) => p.state === "ACTIVE");
    const seeInvoice = can("invoice.metadata"), seePay = can("supplier.pay.status");
    const form = can("goods.receive") ? `<section class="card span5"><h3>${h(t("inwardNew"))}</h3>
      <ol class="steps"><li>Choose source</li><li>Choose coffee</li><li>Count bags</li><li>Save</li></ol>
      ${!prods.some((p) => p.nominal_kg) ? `<div class="hint warn">The admin must set an approved kg-per-bag for a bean type (Admin Control → Beans &amp; products) before bags can be recorded.${can("masters.approve") ? goto("admin", "beans", "Open Beans & products") : ""}</div>` : ""}
      <form data-form="inward"><div class="form-grid">
        ${select("source", "Where did it come from?", [["AUCTION", "Auction purchase"], ["OTHER", "Other source"]])}
        ${field("source_name", "Auction / supplier name", "text", 'required maxlength="120"')}
        <div class="wide">${select("product_id", "Which coffee?", prods.map((p) => [p.id, p.name + (p.nominal_kg ? ` · ${p.nominal_kg} kg per bag` : " · kg not set")]))}</div>
        ${field("bags", t("howManyBags"), "number", 'required min="1" step="1" inputmode="numeric"')}
        ${field("damaged", t("anyDamaged") + " (count)", "number", 'required value="0" min="0" step="1" inputmode="numeric"')}
        ${field("partial", "Partial bags (count)", "number", 'value="0" min="0" step="1" inputmode="numeric"', "Opened or not full")}
        ${field("partial_kg", "Partial bags — weighed kg (total)", "number", 'min="0.001" step="0.001" inputmode="decimal"', "Weigh them together on the scale")}
      </div><p class="hint">Sound bags use the approved kg-per-bag. Partial bags use the weight you enter and are usable now. Damaged bags go on hold until someone verifies them.</p>
      <div class="form-actions"><button class="btn btn-primary btn-big" type="submit" ${prods.length ? "" : "disabled"}>${h(t("saveBags"))}</button></div></form></section>` : "";
    const headers = ["Receipt", "Source", "Coffee", "Bags", "Damaged", "Partial", "Kg in", ...(seeInvoice ? ["Invoice"] : []), ...(seePay ? ["Payment"] : []), "Date"];
    return pageHead(eyebrow(), t("inward"), "Count bags at unloading. No weighing at this step.", can("inventory.view") ? '<button class="btn" data-go="inventory">See stock →</button>' : "") +
      `<div class="grid">${form}<section class="card ${form ? "span7" : "span12"}"><h3>Recent receipts</h3>${table(headers, rows.map((x) =>
        `<tr><td><b class="code">${h(x.code || "#" + x.id)}</b></td><td>${h(x.source_name)}<br><span class="tiny">${h(x.source)}</span></td><td>${h(x.product)}</td><td>${x.bags}</td><td>${x.damaged}</td><td>${x.partial ? `${x.partial}<br><span class="tiny">${num(x.partial_kg, 3)} kg weighed</span>` : 0}</td><td>${num(x.nominal_kg, 3)}</td>${
          seeInvoice ? `<td>${tag(x.invoice_status)}</td>` : ""}${seePay ? `<td>${tag(x.payment_status)}</td>` : ""}<td>${when(x.created_at)}${x.reversed_at ? " " + tag("REJECTED", "reversed") : ""}${can("goods.reverse") && !x.reversed_at ? ` <button class="btn btn-small btn-quiet" data-reverse="${x.id}">Reverse</button>` : ""}${discussBtn("receipt", x.id)}</td></tr>`))}</section></div>`;
  },
  async submit(f) {
    const partial = Number(f.partial || 0);
    if (partial && !Number(f.partial_kg)) throw { code: "PARTIAL_KG_REQUIRED" };
    const r = await api("/inward", "POST", { ...f, bags: Number(f.bags), damaged: Number(f.damaged), partial, partial_kg: partial ? Number(f.partial_kg) : null, product_id: Number(f.product_id) }, newKey());
    toast(`${r.code} saved: ${num(r.allocatable_kg, 3)} kg usable, ${num(r.quarantine_kg, 3)} kg on hold.`);
    S.saved = { view: "inward", title: `${r.code} saved`, note: `${r.lots.map((x) => x.code).join(" · ")} — stick a label on every bag.`, receipt: r };
  },
};

// ---------------------------------------------------------------- inventory
const LOC = { "PROD-01": "Production", "CTR-01": "Counter", IN_TRANSIT: "On the way" };
const BAG = { SOUND: "Sound bags", DAMAGED: "Damaged bags", PARTIAL: "Partial bags" };

function lotActions(x) {
  return `${can("inventory.verify_quarantine") && x.status === "QUARANTINE" ? `<button class="btn btn-small" data-verify="${x.id}">Verify kg</button>` : ""}${
    can("inventory.transfer") && x.status === "RELEASED" && x.location === "PROD-01" && x.owner === "VTC" && x.available_kg > 0 ? `<button class="btn btn-small" data-sendctr="${x.id}:${x.available_kg}:${h(x.code || "")}">Send to counter</button>` : ""}${
    can("stock.cycle_count") && x.status === "RELEASED" ? `<button class="btn btn-small btn-quiet" data-count="${x.id}:${h(x.code || "")}">Count</button>` : ""}${
    can("inventory.adjust") && x.owner === "VTC" && ["RELEASED", "QC_HOLD", "QUARANTINE"].includes(x.status) ? `<button class="btn btn-small btn-quiet" data-adjust="${x.id}:${x.kg}">Correct</button>` : ""}<button class="btn btn-small btn-quiet" data-label="${x.id}" aria-label="Print label for ${h(x.code || "")}">${icon("qr-code", 14)} Label</button>${discussBtn("lot", x.id)}`;
}
const lotCode = (x) => `<b class="code">${h(x.code || "#" + x.id)}</b>`;   // v1.4: lots are known by their code
const bagsOf = (x) => (x.nominal_kg && x.bag_kind !== "PARTIAL" ? x.kg / x.nominal_kg : null);

function beanGroups(rows: any[]): any[] {
  const g: Record<string, any> = {};
  rows.filter((x) => x.bag_kind && x.owner === "VTC" && x.stage === "RAW").forEach((x) => {
    const k = (g[x.product_id] ||= { id: x.product_id, name: x.product, nominal: x.nominal_kg, SOUND: 0, DAMAGED: 0, PARTIAL: 0, lots: [] });
    k[x.bag_kind] += x.kg; k.lots.push(x);
  });
  return Object.values(g).sort((a: any, b: any) => a.name.localeCompare(b.name));
}

function productPage(rows, pid) {
  const card = (S.data["/stock-cards"] || []).find((c) => c.product_id === pid);
  const mine = rows.filter((x) => x.owner === "VTC" && cardId(x) === pid);
  const grp = beanGroups(rows).find((x) => x.id === pid) || (card && { id: pid, name: card.name, nominal: card.nominal_kg, lots: [] });
  if (!grp) return `<div class="empty"><b>No stock left for this bean</b><button class="btn" data-invback>← Back to stock</button></div>`;
  if (card?.label) grp.name = card.label;
  const later = mine.filter((x) => x.stage !== "RAW" || x.location !== "PROD-01");
  S.crumb = grp.name;
  const col = (kind, note) => {
    const lots = grp.lots.filter((x) => x.bag_kind === kind), kg = lots.reduce((v, x) => v + x.kg, 0);
    const bags = kind === "PARTIAL" ? lots.reduce((v, x) => v + (x.bags || 0), 0) : grp.nominal ? kg / grp.nominal : null;
    return `<div class="bagcol"><h4>${BAG[kind]}</h4><div class="big">${num(kg, 3)} kg</div><div class="tiny">${bags != null ? `≈ ${num(bags, 1)} bag${Math.abs(bags - 1) < 0.05 ? "" : "s"} · ` : ""}${note}</div>
      ${lots.map((x) => `<div class="lotcard"><div class="row between">${lotCode(x)}${tag(x.status)}</div><span class="tiny">${h(x.receipt_code || "")} · ${when(x.created_at)} · ${h(LOC[x.location] || x.location)}</span>
        <div><b>${num(x.kg, 3)} kg</b>${x.reserved_kg ? ` <span class="tiny">(${num(x.reserved_kg, 3)} reserved)</span>` : ""}</div><div class="row">${lotActions(x)}</div></div>`).join("") || '<p class="tiny mt">None.</p>'}</div>`;
  };
  return `<div class="toolbar"><button class="btn" data-invback>← All stock</button><span class="sub m0">${grp.nominal ? `${num(grp.nominal, 3)} kg per bag (approved)` : "kg per bag not set"}</span></div>
    <h2 class="mt-b">${h(grp.name)}</h2>
    <div class="bagcols">${col("SOUND", "usable now")}${col("DAMAGED", "on hold until verified")}${col("PARTIAL", "weighed at inward, usable now")}</div>
    ${later.length ? `<section class="card mt"><h3>Roasted, ground &amp; at the counter</h3>${table(["Lot", "Item", "Stage", "Where", "Status", "Balance", ""], later.map((x) =>
      `<tr><td>${lotCode(x)}${x.resting ? `<br><span class="tiny rest">${icon("hourglass", 12)} ready ${fmtDay(x.ready_from)}</span>` : ""}</td><td>${h(x.name)}</td><td>${h(x.stage)}</td><td>${h(LOC[x.location] || x.location)}</td><td>${tag(x.status)}</td><td><b>${num(x.kg, 3)} kg</b></td><td class="nowrap">${lotActions(x)}</td></tr>`))}</section>` : ""}`;
}

const inventory = {
  paths: () => ["/inventory", "/transfers", "/stock-cards", ...(can("stock.cycle_count") || can("stock.cycle_approve") || can("inventory.adjust") || can("inventory.approve_adjust") ? ["/counts"] : [])],
  render() {
    const rows = d("/inventory");
    const head = pageHead(eyebrow(), t("inventory"), "Stock by bean: one card for each bean or product. Blends, packs and customers' coffee are listed below.");
    if (S.sub?.product) return head + productPage(rows, S.sub.product);
    const transfers = d("/transfers");
    const incoming = transfers.filter((x) => x.state === "IN_TRANSIT");
    const other = rows.filter((x) => !(x.owner === "VTC" && cardId(x)));   // blends, packs, customers' own coffee
    return head +
      `${incoming.length ? `<div class="hint warn mt row between">📦 ${incoming.length} transfer${incoming.length > 1 ? "s" : ""} on the way to the counter<span class="row">${incoming.map((x) => `<button class="btn btn-small" data-receive="${x.id}:${x.kg_sent}">Receive ${h(x.transit_code || "#" + x.id)} · ${num(x.kg_sent, 3)} kg</button>`).join("")}</span></div>` : ""}
      ${cardsSection(rows)}
      <section class="card mt"><h3>Blends, packs &amp; customers' coffee</h3><p class="hint">Stock that isn't one single bean. Held, rejected and quarantined lots cannot be used. Reserved stock can't be used twice.</p>${table(
        ["Lot", "Item", "Stage", "Where", "Owner", "Status", "Balance", ""], other.map((x) =>
          `<tr><td>${lotCode(x)}${x.resting ? `<br><span class="tiny rest">${icon("hourglass", 12)} ready ${fmtDay(x.ready_from)}</span>` : ""}</td><td>${h(x.name)}</td><td>${h(x.stage)}</td><td>${h(LOC[x.location] || x.location)}</td><td>${h(x.owner)}</td><td>${tag(x.status)}</td><td><b>${num(x.kg, 3)} kg</b>${x.units ? `<br><span class="tiny">${x.units} packs</span>` : ""}${x.reserved_kg ? `<br><span class="tiny">${num(x.reserved_kg, 3)} kg reserved</span>` : ""}</td><td class="nowrap">${lotActions(x)}</td></tr>`), "Nothing else in stock.")}</section>
      ${countsSection()}
      ${transfers.length ? `<section class="card mt"><h3>Transfers to the counter</h3>${table(["#", "From lot", "Sent", "Received", "State", "Sent by", "Received by"], transfers.map((x) =>
        `<tr><td><b class="code">${h(x.transit_code || "#" + x.id)}</b></td><td>${h(x.lot_code || "")}<br><span class="tiny">${h(x.lot_name)}</span></td><td>${num(x.kg_sent, 3)} kg</td><td>${x.kg_received == null ? "—" : num(x.kg_received, 3) + " kg"}</td><td>${tag(x.state === "RECEIVED" ? "DONE" : x.state === "SHORTAGE" ? "EXCEPTION" : "hold", x.state.replace("_", " "))}</td><td>${h(x.sent_by_name)} · ${when(x.created_at)}</td><td>${h(x.received_by_name || "—")}</td></tr>`))}</section>` : ""}`;
  },
};

function countsSection() {
  const rows = (S.data["/counts"] || []).slice(0, 15);
  if (!rows.length) return "";
  const mayDecide = (k) => k.state === "PENDING" && can(k.kind === "ADJUST" ? "inventory.approve_adjust" : "stock.cycle_approve") && k.counted_by !== S.me.user.id;
  return `<section class="card mt"><h3>Stock counts &amp; corrections</h3>${table(["Lot", "Type", "Book", "Counted / new", "Difference", "By", "State", ""], rows.map((k) =>
    `<tr><td><b class="code">${h(k.lot_code || "#" + k.lot_id)}</b><br><span class="tiny">${h(k.lot_name)}</span></td><td>${k.kind === "ADJUST" ? "Correction" : "Count"}</td><td>${num(k.book_kg, 3)}</td><td>${num(k.counted_kg, 3)}</td><td><b>${k.variance_kg > 0 ? "+" : ""}${num(k.variance_kg, 3)}</b></td><td>${h(k.counted_by_name)}</td>
     <td>${tag(k.state === "APPLIED" || k.state === "MATCHED" ? "DONE" : k.state === "REJECTED" ? "REJECTED" : "hold", k.state)}</td>
     <td>${mayDecide(k) ? `<button class="btn btn-small" data-countdecide="${k.id}:1">Apply</button> <button class="btn btn-small btn-danger" data-countdecide="${k.id}:0">Reject</button>` : h(k.note || "")}</td></tr>`))}</section>`;
}

// ---------------------------------------------------------------- roasting
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const rsub = () => { const x = (S.sub ||= {}); x.day ||= istToday(); x.month ||= x.day.slice(0, 7); return x; };

function calendar(month, days, selected) {
  const [y, m] = month.split("-").map(Number), first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }), today = istToday();
  const cells = [...Array(first)].map(() => '<div class="cal-d empty"></div>').concat([...Array(count)].map((_, i) => {
    const day = `${month}-${String(i + 1).padStart(2, "0")}`, x = days[day];
    return `<button class="cal-d ${x ? "has" : ""} ${day === selected ? "on" : ""} ${day === today ? "today" : ""}" data-calday="${day}" aria-label="${day}${x ? `, ${x.batches} batches` : ""}">
      <span class="cal-n">${i + 1}</span>${x ? `<span class="cal-x">${x.batches} batch${x.batches > 1 ? "es" : ""}</span><span class="cal-x">${num(x.output_kg, 1)} kg out</span>` : ""}</button>`;
  }));
  return `<div class="row between mt-b"><button class="btn btn-small" data-calmonth="-1" aria-label="Previous month">‹</button><b>${h(name)}</b><button class="btn btn-small" data-calmonth="1" aria-label="Next month">›</button></div>
    <div class="cal">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="cal-h">${d}</div>`).join("")}${cells.join("")}</div>`;
}

const roasting = {
  paths: () => { const x = rsub(); return x.tab === "month" ? [`/roasts/month-record?month=${x.month}`] : [`/roasts?day=${x.day}`, `/roasts?month=${x.month}`, ...(can("roast.execute") ? ["/inventory", "/roast-profiles"] : [])]; },
  render() {
    const tabs = `<div class="tabs"><button class="tab ${rsub().tab !== "month" ? "on" : ""}" data-rtab="day">Day &amp; calendar</button><button class="tab ${rsub().tab === "month" ? "on" : ""}" data-rtab="month">Monthly record</button></div>`;
    if (rsub().tab === "month") return pageHead(eyebrow(), t("roasting"), "The month at a glance: batches, the roaster's batch counter, gas used per roast.") + tabs + monthRecord();
    const x = rsub(), rows = d(`/roasts?day=${x.day}`), cal = S.data[`/roasts?month=${x.month}`] || { days: {} };
    const lots = d("/inventory").filter((l) => l.status === "RELEASED" && l.stage === "RAW" && l.owner === "VTC" && l.location === "PROD-01");
    const profiles = d("/roast-profiles").filter((p) => p.active);
    const opts = [["", "Choose a raw lot"], ...lots.map((l) => [l.id, `${l.code || "#" + l.id} · ${l.product}${l.bag_kind ? " · " + BAG[l.bag_kind] : ""} — ${num(l.available_kg, 3)} kg`])];
    const comp = (i: number, req = false) => `<div class="component"><div class="component-n">${i}</div>${select("lot_" + i, i === 1 ? "Coffee lot" : "Second coffee lot (optional)", opts, req ? "required" : "")}${field("kg_" + i, "Weighed kg", "number", `${req ? "required" : ""} min="0.001" step="0.001" inputmode="decimal"`)}</div>`;
    const profileField = profiles.length ? select("profile_id", "Roast profile", [["", "Choose…"], ...profiles.map((p) => [p.id, p.name + (p.notes ? ` — ${p.notes}` : "")])], "required")
      : `<div class="hint">${can("masters.approve") ? "Add roast profiles so roasters can pick one." + goto("admin", "profiles", "Open Roast profiles") : "No roast profiles yet — the owner adds them in Admin Control."}</div>`;
    const form = can("roast.execute") ? `<section class="card span5"><h3>${h(t("newRoast"))}</h3>
      <div class="hint warn">Use today's scale readings. Without an approved QC range, every batch goes to quality hold for review.</div>
      <form data-form="roasting">${comp(1, true)}${comp(2)}
        <div class="form-grid">${field("output_kg", "Roasted output (kg)", "number", 'required min="0.001" step="0.001" inputmode="decimal"')}${field("duration_min", "Roast time (minutes)", "number", 'required min="1" step="1" inputmode="numeric"')}
        <div class="wide">${profileField}</div></div>
        ${check("abnormal", "Something went wrong in this batch", false, "Always sends the batch to quality hold")}
        <div class="field"><label for="f_notes">Operator notes</label><textarea id="f_notes" name="notes" rows="2" maxlength="400"></textarea></div>
        <div class="form-actions"><button class="btn btn-primary btn-big" type="submit" ${lots.length ? "" : "disabled"}>Record finished batch</button></div></form></section>` : "";
    const tot = rows.reduce((a, r) => [a[0] + r.input_kg, a[1] + r.output_kg], [0, 0]);
    const dayName = new Date(x.day + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
    const loss = tot[0] ? ((tot[0] - tot[1]) / tot[0]) * 100 : 0, avgMin = rows.length ? rows.reduce((v, r) => v + r.duration_min, 0) / rows.length : 0;
    const held = rows.filter((r) => r.qc_status === "QC_HOLD").length;
    const kpi = (ic, val, label, extra = "") => `<div class="rk">${icon(ic, 20)}<b>${val}</b><span>${label}</span>${extra}</div>`;
    const strip = `<div class="roast-kpis" aria-label="Roasting at a glance">${kpi("flame", rows.length, x.day === istToday() ? "batches today" : "batches that day")}${kpi("bean", num(tot[0], 1) + " kg", "green coffee in")}${kpi("coffee", num(tot[1], 1) + " kg", "roasted out")}
      ${kpi("gauge", tot[0] ? num(loss, 1) + "%" : "—", "weight loss", `<div class="lossbar" title="0–25%"><i style="width:${Math.min(100, (loss / 25) * 100)}%"></i></div>`)}${kpi("clock", rows.length ? num(avgMin, 0) + " min" : "—", "average roast time")}${kpi("shield-check", held, "waiting for quality check")}</div>`;
    return pageHead(eyebrow(), t("roasting"), "Weighed input and output; loss is calculated for you. Pick any date on the calendar to see that day.") + tabs + strip +
      `<div class="grid">${form}<section class="card ${form ? "span7" : "span12"}"><h3>Roasting calendar</h3>${calendar(x.month, cal.days, x.day)}</section>
      <section class="card span12"><div class="row between"><h3>${h(dayName)}${x.day === istToday() ? " · today" : ""}</h3><span class="row">${chip(`${rows.length} batches`)}${chip(`${num(tot[0], 3)} kg in`)}${chip(`${num(tot[1], 3)} kg out`)}${tot[0] ? chip(`${num(((tot[0] - tot[1]) / tot[0]) * 100)}% loss`) : ""}</span></div>${table(
        ["Batch", "Roaster", "Coffee in", "Output", "Loss", "Time", "Profile", "Quality"], rows.map((r) =>
          `<tr><td><b class="code">${h(r.code || "#" + r.id)}</b><br><span class="tiny">${new Date(r.created_at).toLocaleTimeString("en-IN", { timeStyle: "short" })}</span></td><td>${h(r.roaster || "—")}</td><td><span class="tiny">${h(r.inputs || "")}</span><br><b>${num(r.input_kg, 3)} kg</b></td><td>${num(r.output_kg, 3)} kg</td><td>${num(r.input_kg ? (r.loss_kg / r.input_kg) * 100 : 0)}%</td><td>${r.duration_min} min</td><td>${h(r.profile || "—")}</td><td>${tag(r.qc_status)}${r.abnormal ? " " + chip("flagged", "warn") : ""}${discussBtn("roast", r.id)}</td></tr>`), "No batches roasted on this day.")}</section></div>`;
  },
  async submit(f) {
    const inputs = [1, 2].filter((i) => f["lot_" + i] && f["kg_" + i]).map((i) => ({ lot_id: Number(f["lot_" + i]), kg: Number(f["kg_" + i]) }));
    const r = await api("/roasts", "POST", { inputs, output_kg: Number(f.output_kg), duration_min: Number(f.duration_min), profile_id: f.profile_id ? Number(f.profile_id) : null, notes: f.notes, abnormal: !!f.abnormal }, newKey());
    rsub().day = istToday(); rsub().month = istToday().slice(0, 7);
    toast(`Batch ${r.code} saved · ${r.loss_pct}% loss · ${r.qc_status === "QC_HOLD" ? "sent to quality hold" : "released"}`);
    S.saved = { view: "roasting", title: `Batch ${r.code} saved`, note: `${num(r.output_kg, 3)} kg roasted · ${r.loss_pct}% loss. Label the container.`, lot_id: r.lot_id };
  },
};

function monthRecord() {
  const x = rsub(), m = S.data[`/roasts/month-record?month=${x.month}`];
  if (!m) return "";
  const name = new Date(x.month + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const kpi = (ic, val, label) => `<div class="rk">${icon(ic, 20)}<b>${val}</b><span>${label}</span></div>`;
  const gap = m.meter_gap == null ? "" : m.meter_gap === 0 ? '<div class="hint">The counter matches the batches recorded.</div>'
    : `<div class="hint warn">The roaster's counter shows ${Math.abs(m.meter_gap)} ${m.meter_gap > 0 ? "more" : "fewer"} batches than were recorded here. Check for missed entries.</div>`;
  return `<div class="row between mt-b"><button class="btn btn-small" data-calmonth="-1" aria-label="Previous month">‹</button><h2 class="m0">${h(name)}</h2><button class="btn btn-small" data-calmonth="1" aria-label="Next month">›</button></div>
    <div class="roast-kpis">${kpi("flame", m.batches, "batches recorded")}${kpi("gauge", m.meter_count ?? "—", "batches by roaster counter")}${kpi("bean", num(m.input_kg, 0) + " kg", "green coffee roasted")}
      ${kpi("coffee", m.loss_pct == null ? "—" : num(m.loss_pct, 1) + "%", "average weight loss")}${kpi("fuel", num(m.gas_kg, 1) + " kg", "gas fitted this month")}${kpi("flame", m.gas_kg_per_roast == null ? "—" : num(m.gas_kg_per_roast, 2) + " kg", "gas per roast")}</div>
    ${gap}
    <div class="grid"><section class="card span6 mt-card"><h3>Roaster batch counter</h3>
      <p class="sub">Note the number on the roaster's batch counter on the 1st and on the last day of the month.</p>
      <form data-form="meter" class="form-grid">${field("start_reading", "Reading at month start", "number", `min="0" step="1" value="${m.start_reading ?? ""}" inputmode="numeric"`)}${field("end_reading", "Reading at month end", "number", `min="0" step="1" value="${m.end_reading ?? ""}" inputmode="numeric"`)}
        <div class="form-actions wide"><button class="btn btn-primary" type="submit" ${can("roast.execute") ? "" : "disabled"}>Save readings</button></div></form></section>
    <section class="card span6"><h3>Gas cylinders</h3>
      <form data-form="cylinder" class="form-grid">${field("fitted_on", "Date fitted", "date", `required value="${istToday()}"`)}${field("kg", "Gas in cylinder (kg)", "number", 'required min="0.5" max="100" step="0.5" value="19" inputmode="decimal"', "Commercial cylinder is usually 19 kg")}
        <div class="wide">${field("note", "Note (optional)", "text", 'maxlength="120"')}</div><div class="form-actions wide"><button class="btn btn-primary" type="submit" ${can("roast.execute") ? "" : "disabled"}>${icon("plus", 14)} Add cylinder</button></div></form>
      ${table(["Date", "Kg", "By", "Note"], m.cylinders.map((c) => `<tr><td>${h(c.fitted_on)}</td><td>${num(c.kg, 1)}</td><td>${h(c.by_name)}</td><td>${h(c.note)}</td></tr>`), "No cylinders recorded this month.")}
      ${m.gas_kg_per_100kg != null ? `<p class="tiny mt">${num(m.gas_kg_per_100kg, 2)} kg of gas per 100 kg of green coffee.</p>` : ""}</section></div>`;
}

const meter = { async submit(f) { await api("/roasts/meter", "PUT", { month: rsub().month, start_reading: f.start_reading, end_reading: f.end_reading }); toast("Readings saved."); } };
const cylinder = { async submit(f) { await api("/roasts/cylinders", "POST", { fitted_on: f.fitted_on, kg: Number(f.kg), note: f.note }); toast("Cylinder added."); } };

// ---------------------------------------------------------------- QC
const qc = {
  paths: () => ["/qc"],
  render() {
    const rows = d("/qc");
    return pageHead(eyebrow(), t("qc"), "Release or reject held batches. Being a manager does not include this automatically.") +
      `<section class="card">${can("roast.qc_release") ? "" : '<p class="hint">You can see quality status. Releasing or rejecting needs the “Release or reject a held batch” permission.</p>'}${table(
        ["Batch", "Input → output", "Loss", "Status", "Decision"], rows.map((x) =>
          `<tr><td><b class="code">${h(x.code || "#" + x.id)}</b>${x.abnormal ? " " + chip("flagged", "warn") : ""}</td><td>${num(x.input_kg, 3)} → ${num(x.output_kg, 3)} kg</td><td>${num((x.loss_kg / x.input_kg) * 100)}%</td><td>${tag(x.qc_status)}</td><td>${
            can("roast.qc_release") && x.qc_status === "QC_HOLD" ? `<button class="btn btn-small" data-qc="${x.id}:RELEASED">Release</button> <button class="btn btn-small btn-danger" data-qc="${x.id}:REJECTED">Reject</button>` : "—"}${discussBtn("roast", x.id)}</td></tr>`))}</section>`;
  },
};

// ---------------------------------------------------------------- tasks
const STATUS_LABEL = { OPEN: "not started", IN_PROGRESS: "in progress", BLOCKED: "stuck", SUBMITTED: "waiting for review", DONE: "approved" };
const tsub = () => (S.sub ||= { filter: "open" });

const tasks = {
  paths: () => ["/tasks"],
  render() {
    const all = d("/tasks"), me = S.me.user.id, f = tsub().filter;
    const review = all.filter((x) => x.may_review);
    const lists = { open: all.filter((x) => x.status !== "DONE"), review, mine: all.filter((x) => x.assigned_to === me && x.status !== "DONE"), done: all.filter((x) => x.status === "DONE") };
    const rows = lists[f] || lists.open;
    const filters = [["open", "Open"], ["review", `To review (${review.length})`], ["mine", "My work"], ["done", "Approved"]];
    return pageHead(eyebrow(), t("tasks"), "Work linked to roasting, packing, QC, outside roasting, counter and dispatch counts itself. When done, the person marks it completed and the assigner approves.",
      can("tasks.assign") ? '<button class="btn btn-primary" data-action="newTask">+ Assign work</button>' : "") +
      `<div class="tabs">${filters.map(([k, l]) => `<button class="tab ${f === k ? "on" : ""}" data-tfilter="${k}">${l}</button>`).join("")}</div>
      <section class="card">${table(["Work", "Who", "Progress", "Status", ""], rows.map((x) => {
        const mine = x.assigned_to === me, open = ["OPEN", "IN_PROGRESS", "BLOCKED"].includes(x.status);
        const mayUpdate = open && (can("tasks.update_any") || (can("tasks.update_own") && mine));
        const pct = x.target ? Math.min(100, (x.progress / x.target) * 100) : null;
        return `<tr><td><b>${h(x.title)}</b><br><span class="tiny">${h(x.kind_label)}${x.due ? ` · due ${h(x.due)}` : ""} · by ${h(x.assigned_by || "—")}</span>
            ${x.submit_note ? `<br><span class="tiny">Note: ${h(x.submit_note)}</span>` : ""}${x.review_note ? `<br><span class="tiny">${x.status === "DONE" ? "Approved" : "Sent back"} by ${h(x.reviewed_by_name || "")}: ${h(x.review_note)}</span>` : ""}</td>
          <td>${h(x.assignee || "Unassigned")}</td>
          <td>${num(x.progress)}${x.target != null ? ` / ${num(x.target)} ${h(x.unit || "")}` : ""}${pct != null ? `<div class="bar"><span style="width:${pct}%"></span></div>` : ""}</td>
          <td>${tag(x.status === "DONE" ? "DONE" : x.status === "BLOCKED" ? "REJECTED" : "hold", STATUS_LABEL[x.status] || x.status)}</td>
          <td class="nowrap">${x.may_review ? `<button class="btn btn-small btn-primary" data-treview="${x.id}:1">Approve</button> <button class="btn btn-small btn-danger" data-treview="${x.id}:0">Send back</button> ` : ""}${
            mayUpdate && x.kind === "GENERAL" ? `<button class="btn btn-small" data-task="${x.id}">Update</button> ` : ""}${
            mayUpdate && x.kind !== "GENERAL" ? `<button class="btn btn-small btn-quiet" data-tstuck="${x.id}:${x.status === "BLOCKED" ? 0 : 1}">${x.status === "BLOCKED" ? "Not stuck now" : "I'm stuck"}</button> ` : ""}${
            open && mine ? `<button class="btn btn-small ${x.target != null && x.progress >= x.target ? "btn-primary" : ""}" data-tsubmit="${x.id}">✓ Mark completed</button> ` : ""}${discussBtn("task", x.id)}</td></tr>`;
      }), f === "review" ? "Nothing waiting for your review." : "No work here.")}</section>`;
  },
};

export const VIEWS = { dashboard, inward, inventory, roasting, qc, tasks, meter, cylinder };

// ---------------------------------------------------------------- actions
// v1.4: shared with the scan sheet (scan.js), so a scanned label offers the same actions.
export async function sendToCounter(id, max, code = "") {
  const r = await dialog({ title: `Send ${code || "lot #" + id} to the counter`, submit: "Send",
    body: `${field("kg", `Kg to send (up to ${num(max, 3)})`, "number", `required min="0.001" max="${max}" step="0.001"`)}${field("note", "Note (optional)", "text", 'maxlength="200"')}<p class="tiny">The counter confirms what arrives. Someone other than you must receive it.</p>` });
  if (!r) return;
  try {
    const x = await api("/transfers", "POST", { lot_id: Number(id), kg: Number(r.kg), note: r.note }, newKey());
    toast("On its way. The counter has been alerted.");
    S.saved = { view: S.view, title: "Sent to the counter", note: "It shows in Counter Sales after someone at the counter presses Receive (not the person who sent it). Label the container so they can scan it in.", lot_id: x.lot_id };
    await nav.go(S.view, S.sub);
  } catch (e) { fail(e); }
}

export async function countLot(id, code = "") {
  const r = await dialog({ title: `Count ${code || "lot #" + id}`, submit: "Save count",
    body: `<p class="sub">Weigh or count what is physically there. Don't look at the book figure first.</p>${field("counted_kg", "Kg counted", "number", 'required min="0" step="0.001" inputmode="decimal"')}${field("note", "How you counted", "text", 'maxlength="200"')}` });
  if (!r) return;
  try { const x = await api(`/lots/${id}/count`, "POST", { counted_kg: Number(r.counted_kg), note: r.note }); toast(x.state === "MATCHED" ? "Matches the book. Thank you." : `Difference of ${x.variance_kg} kg sent for approval.`); await nav.go(S.view, S.sub); } catch (e) { fail(e); }
}

export async function handleClick(btn) {
  const ds = btn.dataset;
  if (ds.action === "customise") return toggleArrange(), true;
  if (ds.wtool) return arrangeClick(btn);
  if (ds.invproduct) return nav.go("inventory", { product: Number(ds.invproduct) }), true;
  if (ds.sc) return cardsClick(ds);
  if (btn.hasAttribute("data-invback")) return nav.go("inventory", null), true;
  if (ds.rtab) { const x = rsub(); x.tab = ds.rtab === "month" ? "month" : null; return nav.go("roasting", x), true; }
  if (ds.calday) { const x = rsub(); x.day = ds.calday; return nav.go("roasting", x), true; }
  if (ds.calmonth) {
    const x = rsub(), [y, m] = x.month.split("-").map(Number), dt = new Date(Date.UTC(y, m - 1 + Number(ds.calmonth), 1));
    x.month = dt.toISOString().slice(0, 7);
    return nav.go("roasting", x), true;
  }
  if (ds.tfilter) { tsub().filter = ds.tfilter; return nav.rerender(), true; }
  if (ds.tsubmit) {
    const task = d("/tasks").find((x) => x.id == ds.tsubmit) || pendingTask(ds.tsubmit);
    const short = task && task.target != null && task.progress < task.target;
    const r = await dialog({ title: `Mark completed: ${task?.title || ""}`, submit: "Send for review",
      body: `${short ? `<div class="hint warn">Only ${num(task.progress)} of ${num(task.target)} ${h(task.unit || "")} are recorded. Say why it is complete anyway.</div>` : `<p class="sub">${task?.target != null ? `${num(task.progress)} of ${num(task.target)} ${h(task.unit || "")} recorded. ` : ""}The person who gave you this work will review and approve it.</p>`}
        <div class="field"><label>Note ${short ? "(required)" : "(optional)"}</label><textarea name="note" rows="2" maxlength="300" ${short ? 'required minlength="5"' : ""}></textarea></div>` });
    if (!r) return true;
    try { await api(`/tasks/${ds.tsubmit}/submit`, "POST", r); toast("Sent for review."); await nav.go(S.view, S.sub); } catch (e) { fail(e); }
    return true;
  }
  if (ds.treview) {
    const [id, ok] = ds.treview.split(":");
    const r = await dialog({ title: ok === "1" ? "Approve this work" : "Send it back", submit: ok === "1" ? "Approve" : "Send back", danger: ok !== "1",
      body: `<div class="field"><label>${ok === "1" ? "Note (optional)" : "What still needs doing?"}</label><textarea name="note" rows="2" maxlength="300" ${ok === "1" ? "" : 'required minlength="5"'}></textarea></div>` });
    if (!r) return true;
    try { await api(`/tasks/${id}/review`, "POST", { approve: ok === "1", note: r.note }); toast(ok === "1" ? "Approved and closed." : "Sent back to the person."); await nav.go(S.view, S.sub); } catch (e) { fail(e); }
    return true;
  }
  if (ds.tstuck) {
    const [id, on] = ds.tstuck.split(":");
    try { await api(`/tasks/${id}`, "PUT", { status: on === "1" ? "BLOCKED" : "IN_PROGRESS" }); toast(on === "1" ? "Your manager has been alerted." : "Marked as moving again."); await nav.go(S.view, S.sub); } catch (e) { fail(e); }
    return true;
  }
  if (ds.qc) {
    const [id, decision] = ds.qc.split(":");
    const r = await dialog({ title: `${decision === "RELEASED" ? "Release" : "Reject"} batch #${id}`, submit: decision === "RELEASED" ? "Release batch" : "Reject batch", danger: decision !== "RELEASED",
      body: `<div class="field"><label>Reason / what you checked</label><textarea name="note" required minlength="5" rows="3"></textarea></div>` });
    if (!r) return true;
    try { await api(`/qc/${id}/decision`, "POST", { decision, note: r.note }); toast("Quality decision saved."); await nav.go(S.view); } catch (e) { fail(e); }
    return true;
  }
  if (ds.task) {
    const task = (S.data["/tasks"] || []).find((x) => x.id == ds.task);
    if (!task) return true;
    const body = task.target != null
      ? field("progress", `How many done? (target ${num(task.target)})`, "number", `required min="0" max="${task.target}" step="any" value="${task.progress}" inputmode="decimal"`)
      : `${field("progress", "Progress", "number", `min="0" step="any" value="${task.progress}"`)}${select("status", "Status", [["IN_PROGRESS", "Working on it"], ["BLOCKED", "Stuck — " + t("needHelp")]], "", task.status)}<p class="tiny">When it's finished, use “Mark completed”.</p>`;
    const r = await dialog({ title: task.title, body, submit: "Save progress" });
    if (!r) return true;
    try { await api(`/tasks/${task.id}`, "PUT", { progress: Number(r.progress || 0), status: r.status || "IN_PROGRESS" }); toast("Progress saved."); await nav.go(S.view, S.sub); } catch (e) { fail(e); }
    return true;
  }
  if (ds.sendctr) { const [id, max, code] = ds.sendctr.split(":"); return sendToCounter(id, max, code), true; }
  if (ds.count) { const [id, code] = ds.count.split(":"); return countLot(id, code), true; }
  if (ds.label) return offerLabels(Number(ds.label), { copies: S.saved?.lot_id === Number(ds.label) ? S.saved.copies || 1 : 1 }), true;
  if (btn.hasAttribute("data-baglabels")) return offerBagLabels(S.saved.receipt), true;
  if (btn.hasAttribute("data-savedclose")) return (S.saved = null), nav.rerender(), true;
  if (ds.adjust) {
    const [id, kg] = ds.adjust.split(":");
    const r = await dialog({ title: `Correct lot #${id}`, submit: "Send for approval",
      body: `<p class="sub">Book balance ${num(kg, 3)} kg.</p>${field("delta", "Change (kg, use minus for less)", "number", 'required step="0.001"')}<div class="field"><label>Reason</label><textarea name="reason" required minlength="5" rows="2" placeholder="Spillage, moisture loss, found extra bag…"></textarea></div><p class="tiny">Someone else approves it. Managers only within the admin's limit.</p>` });
    if (!r) return true;
    try { await api(`/lots/${id}/adjust`, "POST", { delta_kg: Number(r.delta), reason: r.reason }); toast("Correction sent for approval."); await nav.go("inventory"); } catch (e) { fail(e); }
    return true;
  }
  if (ds.countdecide) {
    const [id, ok] = ds.countdecide.split(":");
    const r = await dialog({ title: ok === "1" ? "Apply this difference" : "Reject this difference", submit: ok === "1" ? "Apply" : "Reject", danger: ok !== "1", body: `<div class="field"><label>Note</label><textarea name="note" required minlength="5" rows="2"></textarea></div>` });
    if (!r) return true;
    try { await api(`/counts/${id}/decide`, "POST", { approve: ok === "1", note: r.note }); toast("Saved."); await nav.go("inventory"); } catch (e) { fail(e); }
    return true;
  }
  if (ds.reverse) {
    const r = await dialog({ title: `Reverse receipt #${ds.reverse}`, submit: "Reverse receipt", danger: true, body: `<p class="hint warn">Only possible while none of its stock has been used. The receipt stays in history, marked reversed.</p><div class="field"><label>Reason</label><textarea name="reason" required minlength="5" rows="2"></textarea></div>` });
    if (!r) return true;
    try { await api(`/inward/${ds.reverse}/reverse`, "POST", r); toast("Receipt reversed."); await nav.go("inward"); } catch (e) { fail(e); }
    return true;
  }
  if (ds.verify) {
    const r = await dialog({ title: `Verify quarantined lot #${ds.verify}`, submit: "Post verified kg",
      body: `<p class="hint warn">Enter what you physically checked. This posts an audited adjustment.</p>${field("verified_kg", "Usable kg actually verified", "number", 'required min="0" step="0.001"')}<div class="field"><label>Evidence / reason</label><textarea name="reason" required minlength="5" rows="2"></textarea></div>` });
    if (!r) return true;
    try { await api(`/lots/${ds.verify}/verify`, "POST", { verified_kg: Number(r.verified_kg), reason: r.reason }); toast("Verified quantity posted."); await nav.go("inventory"); } catch (e) { fail(e); }
    return true;
  }
  if (ds.action === "newTask") {
    try {
      const o = await api("/tasks/options");
      const tomorrowish = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
      const r = await dialog({ title: "Assign work", submit: "Assign",
        body: `${select("kind", "Type of work", o.kinds.map((k) => [k.key, k.label + (k.unit ? ` (counts ${k.unit})` : "")]), "", "ROAST")}
          ${select("assigned_to", "Who?", [["", "Choose a person"], ...o.people.map((p) => [p.id, `${p.full_name} · ${p.role_name}`])], "required")}
          <p class="tiny" id="whoNote"></p>
          <div id="linkPack" hidden>${select("pack_ref", "Packing ticket (optional)", [["", "Any packing"], ...o.pack_jobs.map((j) => [j.id, `#${j.id} ${j.product_name} ${j.pack_g} g · ${j.packs_done}/${j.packs_target}`])])}</div>
          <div id="linkOrder" hidden>${select("order_ref", "Order (optional)", [["", "Any dispatch"], ...o.orders.map((x) => [x.id, `#${x.id} ${x.customer} · ${x.item} ${x.quantity_kg} kg`])])}</div>
          <div class="form-grid">${field("target", "How many?", "number", 'min="1" step="1" inputmode="numeric"', "")}${field("due", "Due date", "date", `value="${tomorrowish}"`)}</div>
          ${field("title", "Title (optional for linked work)", "text", 'maxlength="120"', "Left empty, it is written for you, e.g. “Roast 5 batches”")}`,
        onReady(dl) {
          const kind = dl.querySelector("[name=kind]"), who = dl.querySelector("[name=assigned_to]"), note = dl.querySelector("#whoNote");
          const tgt = dl.querySelector("[name=target]"), tl = dl.querySelector("[name=title]");
          const sync = () => {
            const k = kind.value, info = o.kinds.find((x) => x.key === k), p = o.people.find((x) => String(x.id) === who.value);
            dl.querySelector("#linkPack").hidden = k !== "PACK"; dl.querySelector("#linkOrder").hidden = k !== "DISPATCH";
            tgt.required = k !== "GENERAL"; tl.required = k === "GENERAL";
            tgt.previousElementSibling.textContent = k === "GENERAL" ? "Target count (optional)" : `How many ${info.unit}?`;
            note.textContent = p && !p.can.includes(k) ? `⚠ ${p.full_name} isn't allowed to do ${info.label.toLowerCase()} — give them the permission first, or choose someone else.` : k === "GENERAL" ? "General work: the person updates progress themselves." : `Counts itself each time this person records ${info.label.toLowerCase()} work.`;
          };
          kind.addEventListener("change", sync); who.addEventListener("change", sync); sync();
        } });
      if (!r) return true;
      const ref = r.kind === "PACK" ? r.pack_ref : r.kind === "DISPATCH" ? r.order_ref : "";
      await api("/tasks", "POST", { kind: r.kind, assigned_to: r.assigned_to ? Number(r.assigned_to) : null, target: r.target === "" ? null : Number(r.target), due: r.due || null, title: r.title, ref_id: ref ? Number(ref) : null });
      toast("Work assigned. They've been alerted.");
      await nav.go("tasks", S.sub);
    } catch (e) { fail(e); }
    return true;
  }
  return false;
}

export async function handleSubmit(form: HTMLFormElement, views: Record<string, any> = VIEWS) {
  const view = views[form.dataset.form!];
  if (!view?.submit) return false;
  const f: Record<string, any> = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll<HTMLInputElement>("input[type=checkbox][name]").forEach((c) => (f[c.name] = c.checked));
  const btn = form.querySelector<HTMLButtonElement>("[type=submit],button:not([type])");
  btn && (btn.disabled = true);
  busy(btn, true);
  try {
    await view.submit(f);
    await nav.go(S.view, S.sub);
  } catch (e) {
    fail(e);
    btn && (btn.disabled = false);
    busy(btn, false);
  }
  return true;
}

export { confirmBox };
