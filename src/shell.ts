// The frame around every screen: side navigation, top bar, idle sign-out.

import { canScan } from "./scan.js";
import { api } from "./api.js";
import { LANG_NAMES, errorText, setLang, t } from "./i18n.js";
import { S, nav } from "./state.js";
import { $, h, initials, toast } from "./ui.js";
import { icon } from "./icons.js";
import { voiceBanner } from "./help.js";

// [key, icon, menu group, section colour] — the colour marks the section everywhere (menu, tiles, panels)
export const MODULES = [
  ["dashboard", "layout-dashboard", "Home", "#805039"], ["tasks", "list-checks", "Work", "#4f5bd5"], ["comms", "message-circle", "Work", "#1f86c9"], ["maintenance", "wrench", "Work", "#6b7280"], ["team", "network", "Work", "#5b6b8a"],
  ["inward", "package-plus", "Operations", "#8a5a3c"], ["inventory", "warehouse", "Operations", "#4b6478"], ["roasting", "flame", "Operations", "#d0612a"],
  ["blending", "blend", "Operations", "#8d4f9e"], ["qc", "shield-check", "Operations", "#2f8a57"], ["outside", "factory", "Operations", "#14897f"],
  ["packing", "package", "Operations", "#b7820f"], ["counter", "store", "Sales", "#1e8f6a"], ["orders", "shopping-cart", "Sales", "#2f6fd0"],
  ["dispatch", "truck", "Sales", "#5a52c7"], ["finance", "wallet", "Management", "#9a7414"], ["masters", "tag", "Management", "#6b5a4e"],
  ["exceptions", "triangle-alert", "Management", "#c4473b"], ["reports", "chart-column", "Management", "#1a86a8"], ["admin", "settings", "Admin", "#6b5a4e"],
];
export const SECTION = Object.fromEntries(MODULES.map(([k, i, , c]) => [k, { icon: i, color: c }]));
const GROUPS = ["Home", "Work", "Operations", "Sales", "Management", "Admin"];

export function renderShell() {
  const me = S.me, u = me.user, st = me.settings;
  document.body.className = (me.prefs.large_text ? "large-text " : "") + `tier-${u.tier}`;
  document.body.dataset.accent = st.accent || "roast";
  const planned = (m) => !me.live_modules.includes(m);
  const navHtml = GROUPS.map((g) => {
    const items = MODULES.filter(([k, , grp]) => grp === g && me.modules.includes(k));
    if (!items.length) return "";
    return `<div class="nav-section">${h(t("grp_" + g))}</div><nav class="nav">${items
      .map(([k, ic, , col]) => `<button class="nav-item ${S.view === k ? "active" : ""}" data-go="${k}" style="--sec:${col}"><span class="nav-symbol">${icon(ic, 19)}</span><span class="nav-label">${h(t(k))}</span>${
        planned(k) ? '<span class="soon">SOON</span>' : ""}${k === "comms" ? '<span class="nav-count" hidden></span>' : `<span class="nav-pend" data-pend="${k}" ${S.pending?.[k]?.count ? "" : "hidden"}>${S.pending?.[k]?.count || ""}</span>`}</button>`)
      .join("")}</nav>`;
  }).join("");
  const langs = st.languages_enabled || ["en"];
  $("app").innerHTML = `<div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="mark" aria-hidden="true">${icon("coffee", 22)}</div><div><strong>${h(st.short_name)}</strong><small>${h(st.tagline)}</small></div></div>
      <div class="role-pill"><b>${h(u.full_name)}</b><span>${h(u.role_name.toUpperCase())}${u.is_owner ? " · OWNER" : ""} · ${h(st.location_label)}</span></div>
      ${navHtml}
      <div class="sidebar-bottom"><span>Pilot · office network</span><button class="side-btn" data-action="logout">${icon("log-out", 16)} ${h(t("logout"))}</button></div>
    </aside>
    <div class="scrim" data-action="menu"></div>
    <div class="shell">
      <header class="topbar">
        <div class="row nowrap"><button class="btn btn-small mobile-menu" data-action="menu" aria-label="Menu">${icon("menu", 20)}</button>
          <span class="crumb">${h(st.company_name)} / <b>${h(t(S.view))}</b></span></div>
        <div class="top-actions">
          ${langs.length > 1 ? `<select id="lang" class="lang-select" aria-label="Language">${langs
            .map((l) => `<option value="${l}" ${me.prefs.lang === l ? "selected" : ""}>${LANG_NAMES[l]}</option>`).join("")}</select>` : ""}
          ${canScan() ? `<button class="bell scan-btn" data-action="scan" aria-label="Scan a label" title="Scan a QR label">${icon("scan-line", 20)}</button>` : ""}
          <button class="bell" data-action="bell" aria-label="Messages and urgent alerts" title="Messages and urgent alerts">${icon("bell", 20)}<span class="bell-badge" data-badge hidden></span></button>
          <button class="avatar" data-action="account" title="${h(t("profile"))}" aria-label="${h(t("profile"))}">${h(initials(u.full_name))}</button>
        </div>
      </header>${voiceBanner()}
      <main class="content" id="content" tabindex="-1"></main>
    </div></div>`;
  $("lang")?.addEventListener("change", async (e) => {
    try {
      me.prefs.lang = e.target.value;
      setLang(me.prefs.lang);
      await api("/me/preferences", "PUT", { ...me.prefs });
      await nav.rerender();
    } catch (err) {
      toast(errorText(err.code), true);
    }
  });
}

// --- idle sign-out (the server enforces it too) -----------------------------
let idleTimer: any, warnTimer: any, idleReset: any;
export function startIdleWatch(onTimeout: () => void) {
  const minutes = S.me?.idle_minutes || 15;
  const reset = () => {
    clearTimeout(idleTimer); clearTimeout(warnTimer);
    if (minutes > 2) warnTimer = setTimeout(() => toast("No activity — you'll be signed out in 1 minute. Tap anywhere to stay."), (minutes - 1) * 60000);
    idleTimer = setTimeout(onTimeout, minutes * 60000);
  };
  stopIdleWatch();
  ["pointerdown", "keydown", "scroll"].forEach((e) => window.addEventListener(e, reset, { passive: true }));
  idleReset = reset;
  reset();
}
export function stopIdleWatch() {
  clearTimeout(idleTimer); clearTimeout(warnTimer);
  if (idleReset) ["pointerdown", "keydown", "scroll"].forEach((e) => window.removeEventListener(e, idleReset));
}
