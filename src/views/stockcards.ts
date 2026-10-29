// v1.3 stock cards: one card per bean/product instead of grand totals.
// Owner/admin (inventory.cards) can rename, colour, hide, pin and reorder cards.

import { api } from "../api.js";
import { icon } from "../icons.js";
import { S, can, nav } from "../state.js";
import { check, dialog, fail, field, h, num, select, toast } from "../ui.js";
import { fmtDay } from "../labels.js";

const DEFAULT_COLOUR = "#8a5a3c";
const pretty = (v) => String(v).replace(/_/g, " ").toLowerCase().replace(/^./, (x) => x.toUpperCase());
export const cardId = (x) => x.bean_id || x.product_id || null;

// kg per card, split the way the floor talks about it
export function cardStock(rows) {
  const m = {};
  rows.filter((x) => x.owner === "VTC" && cardId(x)).forEach((x) => {
    const k = (m[cardId(x)] ||= { SOUND: 0, DAMAGED: 0, PARTIAL: 0, ROASTED: 0, GROUND: 0, COUNTER: 0, HELD: 0, usable: 0, RESTING: 0, ready: null, lots: 0 });
    k.lots += 1;
    if (x.location === "CTR-01") k.COUNTER += x.kg;
    else if (x.stage === "RAW") k[x.bag_kind || "SOUND"] += x.kg;
    else if (x.stage === "GROUND") k.GROUND += x.kg;
    else k.ROASTED += x.kg;
    if (x.status === "RELEASED" && x.resting) { k.RESTING += x.available_kg; k.ready = !k.ready || x.ready_from < k.ready ? x.ready_from : k.ready; }   // v1.4
    else if (x.status === "RELEASED") k.usable += x.available_kg; else if (x.status !== "IN_TRANSIT") k.HELD += x.kg;
  });
  return m;
}

const line = (label, kg, cls = "") => (kg > 0.0005 ? `<div class="sc-line ${cls}"><span>${label}</span><b>${num(kg, 3)} kg</b></div>` : "");

export function cardsSection(rows) {
  const all = S.data["/stock-cards"] || [], stock = cardStock(rows), edit = !!S.sub?.edit && can("inventory.cards");
  const shown = all.filter((c) => !c.hidden && (stock[c.product_id] || c.pinned));
  const tools = can("inventory.cards") ? `<div class="row">${edit ? `<button class="btn btn-small" data-sc="add">${icon("plus", 14)} Add card</button>` : ""}
    <button class="btn btn-small ${edit ? "btn-primary" : ""}" data-sc="edit">${icon(edit ? "circle-check" : "pencil", 14)} ${edit ? "Done" : "Edit cards"}</button></div>` : "";
  const cards = shown.map((c, i) => {
    const s = stock[c.product_id] || {}, have = (s.usable || 0) + (s.RESTING || 0), low = c.low_kg != null && have < c.low_kg;
    const days = c.used_30_kg >= 0.05 ? Math.floor(have / (c.used_30_kg / 30)) : null;   // at the last 30 days' pace
    return `<article class="stockcard ${low ? "low" : ""}" style="--sc:${h(c.color || DEFAULT_COLOUR)}">
      <button class="sc-main" ${edit ? 'tabindex="-1"' : `data-invproduct="${c.product_id}"`} aria-label="Open ${h(c.label || c.name)}">
        <div class="sc-top"><span class="sc-ic">${icon("bean", 20)}</span><div><b>${h(c.label || c.name)}</b><span class="tiny">${c.code ? `<span class="code">${h(c.code)}</span> · ` : ""}${c.category ? h(pretty(c.category)) : ""}</span></div>${low ? '<span class="tag bad">Low</span>' : ""}</div>
        <div class="sc-usable"><span class="tiny">Usable now</span><span class="sc-kg">${num(s.usable || 0, 1)}<small> kg</small></span></div>
        <div class="sc-days ${days != null && low ? "neg" : ""}">${icon("clock", 13)} ${days == null ? "No use in the last 30 days" : days > 365 ? "More than a year left" : `≈ ${days} day${days === 1 ? "" : "s"} left at the last 30 days' use`}</div>
        ${line("Raw · sound", s.SOUND)}${line("Raw · partial", s.PARTIAL)}${line("Raw · damaged", s.DAMAGED, "neg")}${line("Roasted", s.ROASTED)}${line("Ground", s.GROUND)}${line("At the counter", s.COUNTER)}${line("On hold", s.HELD, "neg")}${s.RESTING > 0.0005 ? `<div class="sc-line rest"><span>${icon("hourglass", 12)} Resting · ready ${fmtDay(s.ready)}</span><b>${num(s.RESTING, 3)} kg</b></div>` : ""}
        ${!s.lots ? '<p class="tiny">No stock now.</p>' : ""}${c.low_kg != null ? `<p class="tiny">Low below ${num(c.low_kg, 1)} kg</p>` : ""}</button>
      ${edit ? `<div class="sc-edit"><button class="icon-btn" data-sc="up:${i}" aria-label="Move earlier" ${i ? "" : "disabled"}>${icon("arrow-up", 16)}</button><button class="icon-btn" data-sc="down:${i}" aria-label="Move later" ${i < shown.length - 1 ? "" : "disabled"}>${icon("arrow-down", 16)}</button>
        <button class="icon-btn" data-sc="edit:${c.product_id}" aria-label="Edit card">${icon("pencil", 16)}</button><button class="icon-btn" data-sc="hide:${c.product_id}" aria-label="Remove card">${icon("eye-off", 16)}</button></div>` : ""}</article>`;
  }).join("");
  const hidden = edit ? all.filter((c) => c.hidden) : [];
  return `<section class="mt"><div class="toolbar"><h3 class="m0">Stock by bean</h3>${tools}</div>
    <p class="hint">One card per bean or product. Tap a card to see its lots.${edit ? " Use the arrows to reorder, ✎ to rename or set a low-stock level, and the eye to remove a card." : ""}</p>
    <div class="stockcards">${cards || '<div class="empty"><b>No stock cards to show.</b></div>'}</div>
    ${hidden.length ? `<p class="tiny mt">Removed cards: ${hidden.map((c) => `<button class="link-btn" data-sc="show:${c.product_id}">${h(c.label || c.name)} ↺</button>`).join(" · ")}</p>` : ""}</section>`;
}

async function save(pid, body, msg = "Saved.") {
  try { await api(`/stock-cards/${pid}`, "PUT", body); toast(msg); await nav.go("inventory", S.sub); } catch (e) { fail(e); }
}

export async function cardsClick(ds) {
  if (!ds.sc) return false;
  const [act, arg] = ds.sc.split(":"), all = S.data["/stock-cards"] || [];
  if (act === "edit" && arg == null) return nav.go("inventory", S.sub?.edit ? null : { edit: 1 }), true;
  if (act === "hide") return save(Number(arg), { hidden: true, pinned: false }, "Card removed. Bring it back from 'Removed cards'."), true;
  if (act === "show") return save(Number(arg), { hidden: false, pinned: true }, "Card is back."), true;
  if (act === "up" || act === "down") {
    const stock = cardStock(S.data["/inventory"] || []);
    const ids = all.filter((c) => !c.hidden && (stock[c.product_id] || c.pinned)).map((c) => c.product_id), i = Number(arg), j = act === "up" ? i - 1 : i + 1;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await api("/stock-cards/order", "POST", { ids }); await nav.go("inventory", S.sub); } catch (e) { fail(e); }
    return true;
  }
  if (act === "edit") {
    const c = all.find((x) => x.product_id === Number(arg));
    const f = await dialog({ title: `Card: ${c.name}`, submit: "Save card",
      body: `${field("label", "Name on the card", "text", `maxlength="60" value="${h(c.label)}" placeholder="${h(c.name)}"`, "Leave empty to use the bean's own name")}
        <div class="form-grid">${field("color", "Card colour", "color", `value="${h(c.color || DEFAULT_COLOUR)}"`)}${field("low_kg", "Low-stock warning below (kg)", "number", `min="0" step="0.1" value="${c.low_kg ?? ""}"`, "Empty = no warning")}</div>
        ${check("pinned", "Show this card even when there is no stock", !!c.pinned)}` });
    if (f) await save(c.product_id, { label: f.label, color: f.color, low_kg: f.low_kg, pinned: !!f.pinned });
    return true;
  }
  if (act === "add") {
    const stock = cardStock(S.data["/inventory"] || []);
    const options = all.filter((c) => c.hidden || !(stock[c.product_id] || c.pinned));
    if (!options.length) return toast("Every bean already has a card. Add new beans in Admin Control → Beans & products."), true;
    const f = await dialog({ title: "Add a stock card", submit: "Add card",
      body: `${select("pid", "Bean or product", options.map((c) => [c.product_id, c.name + (c.category ? ` · ${c.category}` : "")]))}<p class="hint">New beans are added in Admin Control → Beans &amp; products.</p>` });
    if (f) await save(Number(f.pid), { hidden: false, pinned: true }, "Card added.");
    return true;
  }
  return false;
}
