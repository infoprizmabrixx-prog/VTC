// Motion layer (v1.1). Uses Motion's vanilla animate() bundled locally in
// vendor/ so it works on the office Wi-Fi without internet. Rules followed:
// show loaders only after 300 ms, animate transform/opacity only, exits faster
// than entrances, and nothing moves when the device asks for reduced motion.

import { animate, stagger } from "./vendor/motion.min.js";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
let loaderTimer = null, pulse = null;

const SKELETON = `<div class="skeleton" role="status" aria-live="polite"><span class="sr-only">Loading…</span>
  <div class="sk sk-title"></div><div class="sk sk-sub"></div>
  <div class="sk-grid"><div class="sk sk-card"></div><div class="sk sk-card"></div><div class="sk sk-card"></div></div>
  <div class="sk sk-block"></div></div>`;

/** Show a skeleton in `el` if loading takes longer than 300 ms. */
export function startLoader(el) {
  stopLoader();
  loaderTimer = setTimeout(() => {
    if (!el) return;
    progress(true);
    el.innerHTML = SKELETON;
    if (!reduced()) pulse = animate(el.querySelectorAll(".sk"), { opacity: [0.45, 1, 0.45] }, { duration: 1.1, repeat: Infinity, ease: "easeInOut", delay: stagger(0.08) });
  }, 300);
}

export function stopLoader() {
  progress(false);
  clearTimeout(loaderTimer);
  loaderTimer = null;
  pulse?.stop?.();
  pulse = null;
}

/** Gentle entrance for a freshly rendered page: cards rise 8 px and fade in. */
export function enterPage(el) {
  if (!el || reduced()) return;
  const items = [...el.querySelectorAll(".pagehead, .tabs, .card, .pos-tile, .bagcol, .closed-banner, .stockcard, .tile, .tnode")].slice(0, 18);
  if (!items.length) return;
  animate(items, { opacity: [0, 1], transform: ["translateY(8px)", "translateY(0)"] }, { duration: 0.26, delay: stagger(0.025), ease: [0.2, 0, 0, 1] });
  countUp(el);
}

// ---------------------------------------------------------------- v1.3 motion
/** Thin bar at the top while a screen takes longer than 300 ms to load. */
function progress(on) {
  let bar = document.querySelector(".route-bar");
  if (!bar) { bar = document.createElement("div"); bar.className = "route-bar"; bar.setAttribute("aria-hidden", "true"); document.body.appendChild(bar); }
  if (on) {
    bar.classList.add("on");
    if (!reduced()) animate(bar, { transform: ["scaleX(0)", "scaleX(0.85)"], opacity: [1, 1] }, { duration: 1.6, ease: [0.1, 0.6, 0.2, 1] });
  } else if (bar.classList.contains("on")) {
    bar.classList.remove("on");
    if (reduced()) return;
    animate(bar, { transform: "scaleX(1)" }, { duration: 0.12 }).then(() => animate(bar, { opacity: 0 }, { duration: 0.18 }));
  }
}

/** Big numbers on stat cards count up once when a page opens. */
function countUp(el) {
  el.querySelectorAll(".stat-number, .tile-n, .sc-kg").forEach((n) => {
    const node = [...n.childNodes].find((c) => c.nodeType === 3 && /\d/.test(c.textContent));
    if (!node) return;
    const txt = node.textContent.trim(), m = /^(₹)?([\d,]+(?:\.\d+)?)$/.exec(txt);
    if (!m) return;
    const target = Number(m[2].replace(/,/g, "")), dec = (m[2].split(".")[1] || "").length;
    if (!target || target > 1e9) return;
    animate(0, target, { duration: 0.6, ease: [0.2, 0, 0, 1], onUpdate: (v) => (node.textContent = (m[1] || "") + v.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec })) });
  });
}

/** Press feedback: a soft ripple from where the finger or mouse touched a button. */
document.addEventListener("pointerdown", (e) => {
  const b = (e.target as HTMLElement)?.closest?.(".btn, .tile, .nav-item, .stockcard .sc-main") as any;
  if (!b || reduced() || b.disabled) return;
  const r = b.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2;
  const dot = document.createElement("span");
  dot.className = "ripple";
  dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  b.appendChild(dot);
  animate(dot, { transform: ["scale(0)", "scale(1)"], opacity: [0.28, 0] }, { duration: 0.5, ease: [0.2, 0, 0, 1] }).then(() => dot.remove());
}, { passive: true });

/** Brand loader for the first start: three beans hop in turn. */
export function bootLoader(el) {
  if (!el) return;
  el.innerHTML = `<div class="boot" role="status"><div class="beans" aria-hidden="true"><i></i><i></i><i></i></div>VASAVI<span>TRADING COMPANY</span><span class="sr-only">Loading…</span></div>`;
  if (!reduced()) animate(el.querySelectorAll(".beans i"), { transform: ["translateY(0) rotate(0deg)", "translateY(-10px) rotate(-18deg)", "translateY(0) rotate(0deg)"] },
    { duration: 0.9, repeat: Infinity, delay: stagger(0.15), ease: "easeInOut" });
}

/** Dialogs scale in slightly. */
export function enterDialog(d) {
  if (!d || reduced()) return;
  animate(d, { opacity: [0, 1], transform: ["scale(0.97)", "scale(1)"] }, { duration: 0.18, ease: [0.2, 0, 0, 1] });
}

/** A spinner inside a button while its request runs. */
export function busy(btn, on) {
  if (!btn) return;
  btn.classList.toggle("is-busy", on);
  btn.setAttribute("aria-busy", on ? "true" : "false");
}
