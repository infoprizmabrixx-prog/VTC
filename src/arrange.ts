// v1.5 (owner request 27 Oct 2026): arrange the home screen in place.
// Press and hold any card (or drag the strip under it while arranging) to lift it; the other
// cards slide aside and it snaps into the grid where you let go. ‹ › move a card without
// dragging, S / M / L makes it small, wide or a full row, ✕ removes it. Changes save by themselves.

import { api } from "./api.js";
import { t } from "./i18n.js";
import { icon } from "./icons.js";
import { S, nav } from "./state.js";
import { check, dialog, fail, field, h, toast } from "./ui.js";

const HOLD_MS = 450, SLOP = 10;
const NEXT = { s: "m", m: "l", l: "s" }, SIZE_NAME = { s: "Small", m: "Medium (wide)", l: "Large (full row)" };
export const sizeOf = (id) => S.me.prefs.sizes?.[id] || (id === "quick_actions" ? "l" : "s");
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const grid = () => document.getElementById("wgrid");
const status = (msg) => { const el = document.querySelector(".ab-status"); if (el) el.textContent = msg; };

/** One card on the home screen, with its arrange strip (shown only while arranging). */
export function widget(id, title, inner) {
  const z = sizeOf(id);
  return `<div class="w-card w${z}" data-w="${h(id)}" data-size="${z}" data-title="${h(title)}">${inner}
    <div class="w-strip" role="group" aria-label="Arrange ${h(title)}"><span class="w-grip" aria-hidden="true">${icon("grip-vertical", 16)}</span>
      <button type="button" class="w-btn" data-wtool="earlier" aria-label="Move ${h(title)} earlier" title="Move earlier">${icon("arrow-left", 15)}</button>
      <button type="button" class="w-btn" data-wtool="later" aria-label="Move ${h(title)} later" title="Move later">${icon("arrow-right", 15)}</button>
      <button type="button" class="w-btn w-size" data-wtool="size" aria-label="${h(title)} size: ${SIZE_NAME[z]}. Change size" title="Size: ${SIZE_NAME[z]}. Tap to change">${z.toUpperCase()}</button>
      <button type="button" class="w-btn w-del" data-wtool="remove" aria-label="Remove ${h(title)}" title="Remove card">${icon("x", 15)}</button></div></div>`;
}

export const arrangeBar = () => `<div class="arrange-bar" role="region" aria-label="Arrange your home screen">
  <div class="ab-txt"><b>${icon("grip-vertical", 16)} Arrange your home screen <span class="ab-status" aria-live="polite"></span></b><span>Press and hold a card, then move it. S / M / L changes its size. Changes save by themselves.</span></div>
  <button type="button" class="btn btn-small" data-wtool="add">${icon("plus", 16)} Add card</button>
  <button type="button" class="btn btn-small" data-wtool="prefs">${icon("settings", 16)} Shortcuts<span class="ab-long">&amp; title</span></button>
  <button type="button" class="btn btn-small btn-primary" data-wtool="done">${icon("circle-check", 16)} Done</button></div>`;

export const customiseLabel = () => (S.arranging ? `${icon("circle-check", 16)} Done` : `${icon("settings", 16)} ${h(t("customize"))}`);

function setMode(on) {
  S.arranging = on;
  document.getElementById("wwrap")?.classList.toggle("arranging", on);
  const b = document.querySelector("[data-action=customise]");
  if (b) b.innerHTML = customiseLabel();
}

export function toggleArrange(on = !S.arranging) {
  if (!grid()) return;
  flip(() => setMode(on));
  if (on) status("");
  else if (pending) flush().then(() => toast("Your home screen is saved."));
}

// FLIP: note where every card is, make the change, then slide each card from its old place.
const running = new WeakMap();
function flip(change: () => void) {
  const g = grid();
  if (!g) return change();
  const els = [...g.children] as HTMLElement[], first = new Map(els.map((e) => [e, e.getBoundingClientRect()]));
  els.forEach((e) => running.get(e)?.cancel());
  change();
  if (reduced()) return;
  const gr = g.getBoundingClientRect();
  for (const e of [...g.children] as HTMLElement[]) {
    const a = first.get(e);
    if (!a) continue;
    const dx = a.left - (gr.left + e.offsetLeft), dy = a.top - (gr.top + e.offsetTop);
    if (Math.abs(dx) + Math.abs(dy) > 1)
      running.set(e, e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" }));
  }
}

// ---- saving: snapshot the layout straight after each change, send it a moment later ----
let pending: any = null, saveTimer: any = null;
function queueSave() {
  const cards = [...grid()!.querySelectorAll<HTMLElement>(":scope > .w-card")];
  pending = S.me.prefs = { ...S.me.prefs, widgets: cards.map((c) => c.dataset.w), sizes: Object.fromEntries(cards.map((c) => [c.dataset.w, c.dataset.size])) };
  status("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
}
async function flush() {
  clearTimeout(saveTimer);
  const body = pending;
  pending = null;
  if (!body) return;
  try { await api("/me/preferences", "PUT", body); status("Saved"); } catch (e) { status("Not saved"); fail(e); }
}

// ---- press, lift, drag, drop ----
let press = null, drag = null, blockUntil = 0;

function cancelPress() {
  if (!press) return;
  clearTimeout(press.timer);
  press.card.classList.remove("pressing");
  press = null;
}

function onDown(e) {
  if (drag || press || e.button > 0 || !e.isPrimary) return;
  const card = e.target.closest(".w-card");
  if (!card || card.parentElement !== grid() || e.target.closest("[data-wtool], a, input, select, textarea")) return;
  press = { card, id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  if (S.arranging && e.target.closest(".w-strip")) { e.preventDefault(); return lift(); }   // the strip is a drag handle
  card.classList.add("pressing");
  press.timer = setTimeout(lift, HOLD_MS);
}

function onMove(e) {
  if (press && e.pointerId === press.id) {
    press.x = e.clientX; press.y = e.clientY;
    if (Math.hypot(press.x - press.x0, press.y - press.y0) > SLOP) {
      if (press.type === "mouse" && S.arranging) return lift();   // mouse while arranging: just drag
      cancelPress();   // the finger is scrolling the page
    }
  } else if (drag && e.pointerId === drag.id) { drag.x = e.clientX; drag.y = e.clientY; }
}

function lift() {
  const p = press;
  cancelPress();
  if (!p?.card.isConnected) return;
  const wrap = document.getElementById("wwrap"), card = p.card, r = card.getBoundingClientRect(), ph = document.createElement("div");
  try { navigator.vibrate?.(12); } catch { /* no vibration motor */ }
  flip(() => {
    if (!S.arranging) setMode(true);
    ph.className = `w-ph w${card.dataset.size}`;
    card.replaceWith(ph);
    wrap.appendChild(card);   // stays inside #wwrap so its touch listener keeps the page from scrolling
    card.classList.add("lifted");
    Object.assign(card.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px` });
    ph.style.minHeight = `${card.offsetHeight}px`;
  });
  drag = { card, ph, id: p.id, type: p.type, ox: p.x - r.left, oy: p.y - r.top, x: p.x, y: p.y, left: r.left, top: r.top };
  status("Move the card, then let go.");
  frame();
}

function frame() {
  if (!drag) return;
  const { card, x, y } = drag;
  card.style.transform = `translate(${x - drag.ox - drag.left}px, ${y - drag.oy - drag.top}px)`;
  const top = 140, bottom = innerHeight - 90;   // near the edge: scroll the page
  const v = y < top ? -Math.min(18, (top - y) / 4) : y > bottom ? Math.min(18, (y - bottom) / 4) : 0;
  if (v) window.scrollBy(0, v);
  place(x, y);
  drag.raf = requestAnimationFrame(frame);
}

/** Move the empty slot to where the finger is: before or after the card under it. */
function place(x: number, y: number) {
  const g = grid()!, ph = drag.ph, gr = g.getBoundingClientRect(), kids = [...g.children] as HTMLElement[];
  let target: HTMLElement | null = null, after = false;
  for (const el of kids) {
    const l = gr.left + el.offsetLeft, tp = gr.top + el.offsetTop, w = el.offsetWidth, hh = el.offsetHeight;
    if (x < l || x > l + w || y < tp || y > tp + hh) continue;
    if (el === ph) return;
    target = el;
    after = w > gr.width * 0.75 ? y > tp + hh / 2 : x > l + w / 2;
    break;
  }
  if (!target) {   // past the last card (below it, or beside it on the last row): go last
    const last = kids[kids.length - 1], lt = gr.top + last.offsetTop;
    if (!(y > lt + last.offsetHeight || (y > lt && x > gr.left + last.offsetLeft + last.offsetWidth))) return;
    target = last; after = true;
  }
  const ref = after ? target.nextElementSibling : target;
  if (ref === ph || target === ph) return;
  flip(() => g.insertBefore(ph, ref));
}

function drop() {
  const d = drag;
  drag = null;
  cancelAnimationFrame(d.raf);
  blockUntil = performance.now() + 450;   // swallow the tap the browser sends after letting go
  const g = grid(), gr = g.getBoundingClientRect();
  const done = () => {
    d.card.classList.remove("lifted");
    d.card.removeAttribute("style");
    d.ph.replaceWith(d.card);
    status("");
    queueSave();
  };
  if (reduced()) return done();
  const a = d.card.animate([{ transform: d.card.style.transform }, { transform: `translate(${gr.left + d.ph.offsetLeft - d.left}px, ${gr.top + d.ph.offsetTop - d.top}px)` }],
    { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
  a.finished.then(() => { done(); a.cancel(); }, done);
}

function end(e) {
  const touch = e.type.startsWith("touch");
  if (press && (touch || e.pointerId === press.id)) cancelPress();
  if (drag && (touch || e.pointerId === drag.id)) drop();
}

window.addEventListener("pointermove", onMove, { passive: true });
window.addEventListener("pointerup", end);
window.addEventListener("touchend", end);
window.addEventListener("touchcancel", end);
window.addEventListener("pointercancel", (e) => {
  if (press && e.pointerId === press.id) cancelPress();
  else if (drag && e.pointerId === drag.id && drag.type !== "touch") drop();   // touch: touchend finishes it
});
// While arranging, a tap on a card must not open its section.
window.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (drag || performance.now() < blockUntil || (S.arranging && t?.closest?.("#wgrid .w-card") && !t?.closest("[data-wtool]"))) {
    e.preventDefault(); e.stopPropagation();
  }
}, true);
window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (!S.arranging || t?.closest?.("dialog")) return;
  if (e.key === "Escape") return toggleArrange(false);
  if ((e.key === "Enter" || e.key === " ") && t?.closest?.("#wgrid .w-card") && !t?.closest("[data-wtool]")) { e.preventDefault(); e.stopPropagation(); }
}, true);

/** Wire the freshly rendered dashboard (called after every render). */
export function initArrange() {
  const wrap = document.getElementById("wwrap");
  if (!wrap) return;
  wrap.addEventListener("pointerdown", onDown);
  // Must exist before a touch starts, or the browser scrolls instead of letting the card move.
  wrap.addEventListener("touchmove", (e) => {
    if (!drag) return;
    e.preventDefault();
    const tt = e.touches[0];
    if (tt) { drag.x = tt.clientX; drag.y = tt.clientY; }
  }, { passive: false });
  wrap.addEventListener("contextmenu", (e) => { if (press || drag || S.arranging) e.preventDefault(); });
}

// ---- the buttons ----
const order = (): HTMLElement[] => [...grid()!.querySelectorAll<HTMLElement>(":scope > .w-card")];

async function savePrefs(patch) {
  if (grid()) queueSave();
  clearTimeout(saveTimer);
  pending = null;
  const next = { ...S.me.prefs, ...patch };
  try { await api("/me/preferences", "PUT", next); } catch (e) { status("Not saved"); fail(e); return false; }
  S.me.prefs = next;
  status("Saved");
  return true;
}

async function addCard() {
  const have = new Set(order().map((c) => c.dataset.w)), options = S.me.available_widgets.filter((x) => !have.has(x.id));
  if (!options.length) return toast("Every card you can use is already on your home screen.");
  const f = await dialog({ title: "Add a card", submit: "Add card",
    body: `${options.map((x, i) => `<label class="check"><input type="radio" name="w" value="${h(x.id)}" ${i ? "" : "checked"}/><span><b>${h(x.title)}</b></span></label>`).join("")}
      <p class="tiny">It goes at the end. Then press and hold it to move it.</p>` });
  if (!f?.w || !(await savePrefs({ widgets: [...order().map((c) => c.dataset.w), f.w] }))) return;
  await nav.rerender();
  const el = grid()?.querySelector(`[data-w="${CSS.escape(f.w)}"]`);
  el?.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
  el?.classList.add("w-new");
}

async function prefsDialog() {
  const p = S.me.prefs, choices = S.me.modules.filter((m) => !["dashboard", "admin", "reports"].includes(m));
  const f = await dialog({ title: "Shortcuts & title", submit: "Save",
    body: `${field("welcome", "Welcome title (optional)", "text", `maxlength="75" value="${h(p.welcome)}" placeholder="My coffee workday"`)}
      <h3>Quick action shortcuts (up to 7)</h3>${choices.map((k) => check("sc_" + k, t(k), p.shortcuts.includes(k), "", `data-shortcut="${k}"`)).join("")}
      <p class="tiny">Large text and read-aloud speed are in My profile → Voice &amp; display.</p>`,
    onReady(d) {
      const boxes = [...d.querySelectorAll("[data-shortcut]")];
      const limit = () => { const n = boxes.filter((b) => b.checked).length; boxes.forEach((b) => (b.disabled = !b.checked && n >= 7)); };
      boxes.forEach((b) => b.addEventListener("change", limit));
      limit();
    } });
  if (f && (await savePrefs({ welcome: f.welcome.trim(), shortcuts: choices.filter((k) => f["sc_" + k]) }))) {
    toast("Saved.");
    await nav.rerender();
  }
}

export async function arrangeClick(btn) {
  const act = btn.dataset.wtool, card = btn.closest(".w-card"), g = grid();
  if (act === "done") return toggleArrange(false), true;
  if (act === "add") return addCard(), true;
  if (act === "prefs") return prefsDialog(), true;
  if (!card || !g) return true;
  if (act === "earlier" || act === "later") {
    const sib = act === "earlier" ? card.previousElementSibling : card.nextElementSibling;
    if (!sib) return status(act === "earlier" ? "Already first." : "Already last."), true;
    flip(() => g.insertBefore(card, act === "earlier" ? sib : sib.nextElementSibling));
    btn.focus({ preventScroll: true });
    queueSave();
    status(`Moved to place ${order().indexOf(card) + 1} of ${order().length}. Saving…`);
  } else if (act === "size") {
    const z = NEXT[card.dataset.size];
    flip(() => { card.classList.replace(`w${card.dataset.size}`, `w${z}`); card.dataset.size = z; });
    btn.textContent = z.toUpperCase();
    btn.title = `Size: ${SIZE_NAME[z]}. Tap to change`;
    btn.setAttribute("aria-label", `${card.dataset.title} size: ${SIZE_NAME[z]}. Change size`);
    status(`Size: ${SIZE_NAME[z]}. Saving…`);
    queueSave();
  } else if (act === "remove") {
    if (!reduced()) await card.animate([{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.92 }], { duration: 160, easing: "ease-in" }).finished;
    flip(() => card.remove());
    queueSave();
    toast(`“${card.dataset.title}” removed. Bring it back with Add card.`);
  }
  return true;
}
