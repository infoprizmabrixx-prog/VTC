// Start-up, navigation and one shared event handler for the whole app.

import { api, setSignedOutHandler } from "./api.js";
import { errorText, setLang, setOverrides, t } from "./i18n.js";
import { showChangeSecret, showLogin } from "./login.js";
import { renderShell, startIdleWatch, stopIdleWatch } from "./shell.js";
import { S, nav, usePortalStore } from "./state.js";
import { $, fail, h, labelTables, toast } from "./ui.js";
import { bootLoader, enterPage, startLoader, stopLoader } from "./fx.js";
import { savedBanner } from "./labels.js";
import { openScanner, wedge } from "./scan.js";
import { attachHelp } from "./help.js";
import { loadPending, pendingPanel } from "./views/pending.js";
import { admin, adminChange, adminClick, adminKey, settingsSubmit } from "./views/admin.js";
import { goliveSubmit } from "./views/golive.js";
import { afterRender, bellDialog, refreshBadge, comms, commsClick, commsSubmit, openRecordThread, startPolling, stopPolling } from "./views/comms.js";
import { counter, counterClick, counterInput, counterSubmit } from "./views/counter.js";
import { maintenance, maintenanceClick } from "./views/maintenance.js";
import { team, teamClick } from "./views/team.js";
import { PROFILE_FORMS, profile, profileClick } from "./views/profile.js";
import { VIEWS, handleClick, handleSubmit } from "./views/ops.js";
import { blending, outside, packing, productionClick } from "./views/production.js";
import { dispatch, exceptions, finance, orders, reports, salesClick, salesSubmit } from "./views/sales.js";

const ALL_VIEWS: Record<string, any> = { ...VIEWS, profile, admin, maintenance, team, comms, counter, blending, outside, packing, orders, dispatch, finance, exceptions, reports };

async function refreshMe() {
  S.me = await api("/me");
  usePortalStore.getState().sync({ me: S.me });
  setLang(S.me.prefs.lang);
  try { setOverrides(await api("/i18n")); } catch { /* wording overrides are optional */ }
}

async function load() {
  const view = ALL_VIEWS[S.view];
  const paths: string[] = view?.paths?.() || [];
  const [results] = await Promise.all([Promise.all(paths.map((p: string) => api(p))), loadPending()]);
  S.data = Object.fromEntries(paths.map((p: string, i: number) => [p, results[i]]));
}

let animateNext = false;
async function rerender() {
  renderShell();
  const view = ALL_VIEWS[S.view] || VIEWS.dashboard;
  S.crumb = null;
  const contentEl = $("content");
  if (!contentEl) return;
  contentEl.innerHTML = view.render();
  const panel = pendingPanel(S.view);
  if (panel) contentEl.querySelector(".pagehead")?.insertAdjacentHTML("afterend", panel);
  const saved = savedBanner();
  if (saved) contentEl.querySelector(".pagehead")?.insertAdjacentHTML("afterend", saved);
  // breadcrumb: Company / Screen / tab or sub-page — the screen name takes you back to its start
  const onTab = contentEl.querySelector(".tabs .on") as HTMLElement | null;
  const extra = S.crumb || onTab?.innerText.replace(/\(\d+\)/, "").trim();
  const crumb = document.querySelector(".crumb");
  if (crumb && extra) crumb.innerHTML = `${h(S.me.settings.company_name)} / <button class="crumb-link" data-crumb>${h(t(S.view))}</button> / <b>${h(extra)}</b>`;
  if (S.view === "comms") afterRender();
  labelTables(contentEl);
  attachHelp(contentEl);
  view.after?.();
  if (animateNext) { animateNext = false; enterPage(contentEl); }
  refreshBadge();
}

let lastView: string | null = null;
async function go(view?: any, sub?: any) {
  if (!S.me.modules.includes(view) && view !== "profile") view = "dashboard";   // everyone has their own profile
  if (view !== S.view) { S.sub = null; S.saved = null; }
  if (sub !== undefined) S.sub = sub;
  S.view = view;
  S.arranging = false;
  usePortalStore.getState().sync({ view: S.view, arranging: false });
  const changed = view !== lastView;
  if (changed) startLoader($("content"));
  try {
    await load();
  } catch (e: any) {
    stopLoader();
    if (e.status === 401) return;
    fail(e);
    S.data = {};
  }
  stopLoader();
  animateNext = changed;
  lastView = view;
  await rerender();
  document.getElementById("sidebar")?.classList.remove("open");
  if (location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
}

Object.assign(nav, { go, refreshMe, rerender });

export async function enter() {
  try {
    await refreshMe();
  } catch (e: any) {
    return showLogin(enter, e.code && e.code !== "LOGIN_REQUIRED" ? errorText(e.code) : "");
  }
  if (S.me.user.must_change_secret) return showChangeSecret(S.me, enter);
  startIdleWatch(() => signOut(errorText("SESSION_IDLE")));
  startPolling();
  const start = location.hash.slice(1);
  await go(S.me.modules.includes(start) || start === "profile" ? start : "dashboard");
}

async function signOut(message = "") {
  stopIdleWatch();
  stopPolling();
  try { await api("/logout", "POST"); } catch { /* already signed out */ }
  S.me = null;
  usePortalStore.getState().sync({ me: null });
  showLogin(enter, message);
}

setSignedOutHandler((code: string) => {
  if (!S.me) return;
  stopIdleWatch();
  stopPolling();
  S.me = null;
  usePortalStore.getState().sync({ me: null });
  showLogin(enter, errorText(code));
});

let booted = false;
export function bootPortal() {
  if (booted) return;
  booted = true;

  // ---- one listener for every click / submit / change in the app -------------
  document.addEventListener("click", async (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const el = target?.closest("button, [data-go], [data-action]") as HTMLElement | null;
    if (!el || !S.me || el.closest("dialog")) return;
    if ((el as HTMLButtonElement).type === "submit" && (el as HTMLButtonElement).form) return; // handled by the submit listener
    if (el.dataset.action === "menu") return document.getElementById("sidebar")?.classList.toggle("open");
    if (el.dataset.action === "logout") return signOut();
    if (el.dataset.action === "account") return go("profile");
    if (el.dataset.action === "bell") return bellDialog();
    if (el.dataset.action === "scan") return openScanner();
    if (el.dataset.discuss) { const [ty, id] = el.dataset.discuss.split(":"); return openRecordThread(ty, Number(id)); }
    if (el.hasAttribute("data-crumb")) return go(S.view, null);
    if (el.dataset.goto) { const [v, tab] = el.dataset.goto.split(":"); return go(v, { tab }); }
    if (el.dataset.go) return go(el.dataset.go);
    if (S.view === "admin" && (await adminClick(el))) return;
    if (S.view === "comms" && (await commsClick(el))) return;
    if (S.view === "maintenance" && (await maintenanceClick(el))) return;
    if (S.view === "team" && (await teamClick(el))) return;
    if (S.view === "profile" && (await profileClick(el))) return;
    if (["counter", "inventory"].includes(S.view) && (await counterClick(el))) return;
    if (["blending", "outside", "packing"].includes(S.view) && (await productionClick(el))) return;
    if (["orders", "dispatch", "finance", "exceptions", "reports"].includes(S.view) && (await salesClick(el))) return;
    await handleClick(el);
  });

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (!S.me) return;
    wedge(e);   // a handheld QR scanner typing a code anywhere on the page opens that lot
    const target = e.target as HTMLElement | null;
    if (e.key === "Enter" && target?.matches("[data-go][role=button]")) return go(target.dataset.go);
    if (S.view === "admin") adminKey(e);
  });

  document.addEventListener("submit", async (e: SubmitEvent) => {
    const form = e.target as HTMLFormElement | null;
    if (!form || !S.me || form.closest("dialog") || form.closest(".login-screen")) return;
    e.preventDefault();
    if (form.dataset.settings) return settingsSubmit(form, e.submitter as HTMLElement | null);
    if (form.hasAttribute("data-glform")) return goliveSubmit(form);
    if (form.dataset.compose) return commsSubmit(form);
    if (form.dataset.cform) return counterSubmit(form);
    if (form.dataset.fform) return salesSubmit(form);
    await handleSubmit(form, { ...ALL_VIEWS, packTicket: packing, ...PROFILE_FORMS });
  });

  document.addEventListener("change", (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (S.me && S.view === "admin") adminChange(target as HTMLInputElement);
    if (S.me && S.view === "counter") counterInput(target as HTMLInputElement);
  });
  document.addEventListener("input", (e: Event) => {
    const target = e.target as HTMLInputElement | null;
    if (S.me && S.view === "counter" && target?.dataset?.cart) counterInput(target);
  });

  window.addEventListener("offline", () => toast("You're offline. Nothing can be saved until the Wi-Fi is back.", true));
  window.addEventListener("online", () => toast("Back online."));

  bootLoader($("app"));
  enter();
}
