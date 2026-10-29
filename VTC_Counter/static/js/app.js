// VTC Counter: start-up, sign-in and the menu. Each screen lives in its own file under views/.
import { api, setSignedOut } from "./api.js";
import { isStation, setStation, startStation } from "./print.js";
import { $, errorText, fail, h, initials, toast } from "./ui.js";
import * as sell from "./views/sell.js";
import * as bills from "./views/bills.js";
import * as clientsView from "./views/clients.js";
import * as close from "./views/close.js";
import * as reports from "./views/reports.js";
import * as setup from "./views/setup.js";

export const S = { me: null, view: "sell" };
const VIEWS = {
  sell: ["Sell", "🛒", sell, () => true],
  clients: ["Clients", "🤝", clientsView, () => true],
  bills: ["Today's bills", "🧾", bills, () => true],
  close: ["Day close", "🔒", close, () => true],
  reports: ["Reports", "📊", reports, () => S.boss],
  setup: ["Setup", "⚙", setup, () => S.boss],
};

// start_counter.bat opens /?station=1 on the PC with the printer: remember this device as the print station
if (new URLSearchParams(location.search).get("station") === "1") { setStation(true); history.replaceState(null, "", "/"); }

setSignedOut(() => showLogin("Please sign in again."));
boot();

async function boot() {
  try { S.me = (await api("/me")).user; } catch { return showLogin(); }
  if (S.me.must_change) return showChangeSecret();
  S.boss = S.me.role !== "cashier";
  window.__vtcMe = S.me;   // who is billing (the "item not in list" box asks for this person's PIN or password)
  const start = location.hash.slice(1);
  go(VIEWS[start] && VIEWS[start][3]() ? start : "sell");
  startStation();
}

export async function go(view) {
  S.view = view;
  if (location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
  shell();
  const root = $("content");
  // each screen sets its own handlers on this element: drop the last screen's, or they would also react here
  root.onclick = root.onchange = root.oninput = root.onsubmit = root.onkeydown = null;
  root.innerHTML = '<div class="loading">Loading…</div>';
  try { await VIEWS[view][2].show(root, S); } catch (e) { root.innerHTML = `<div class="empty">${h(errorText(e.code))}</div>`; if (e.status !== 401) fail(e); }
}
export const refresh = () => go(S.view);

function shell() {
  if ($("content")) return markNav();
  const role = { owner: "OWNER", admin: "ADMIN", cashier: "CASHIER" }[S.me.role];
  $("app").innerHTML = `<div class="app"><aside class="sidebar" id="sidebar">
      <div class="brand"><div class="mark">☕</div><div><strong>VASAVI</strong><small>COUNTER SALES</small></div></div>
      <div class="role-pill"><b>${h(S.me.full_name)}</b><span>${role}${isStation() ? " · PRINT STATION" : ""}</span></div>
      <nav class="nav">${Object.entries(VIEWS).filter(([, v]) => v[3]()).map(([k, [label, sym]]) =>
        `<button class="nav-item" data-go="${k}"><span class="nav-symbol">${sym}</span><span class="nav-label">${label}</span></button>`).join("")}</nav>
      <div class="sidebar-bottom">${isStation() ? "This PC prints the bills" : "Bills print on the counter PC"}<button class="side-btn" data-signout>Sign out</button></div>
    </aside>
    <div class="shell"><header class="topbar"><button class="btn mobile-menu" data-menu aria-label="Menu">☰</button>
      <div class="crumb"><b id="crumb"></b></div>
      <nav class="topnav">${Object.entries(VIEWS).filter(([, v]) => v[3]()).map(([k, [label]]) => `<button class="topnav-btn" data-go="${k}">${label}</button>`).join("")}</nav>
      <div class="row"><span class="avatar">${h(initials(S.me.full_name))}</span></div></header>
      <main class="content" id="content" tabindex="-1"></main></div></div>`;
  $("app").onclick = (e) => {
    const b = e.target.closest("[data-go],[data-signout],[data-menu]");
    if (!b) return;
    if (b.dataset.go) { $("sidebar").classList.remove("open"); go(b.dataset.go); }
    if (b.hasAttribute("data-menu")) $("sidebar").classList.toggle("open");
    if (b.hasAttribute("data-signout")) api("/logout", "POST").finally(() => { S.me = null; showLogin(); });
  };
  markNav();
}
function markNav() {
  document.querySelectorAll("[data-go]").forEach((b) => b.classList.toggle("active", b.dataset.go === S.view));
  $("crumb").textContent = VIEWS[S.view][0];
}

// ------------------------------------------------------------------ sign-in
let mode = "pin", picked = null, pin = "";
async function showLogin(notice = "") {
  picked = null; pin = "";
  let people = [];
  try { people = await api("/login/people"); } catch { /* server not reachable: password form still shows */ }
  if (!people.length) mode = "password";
  $("app").innerHTML = `<div class="login-screen"><section class="login-art"><div class="mini">VASAVI TRADING COMPANY · COUNTER</div>
      <h1>Fresh coffee, quick bills.</h1><p>Tap your name and PIN to start billing. Owner and admin sign in with a password.</p></section>
    <section class="login-side"><div class="login-box">${notice ? `<div class="hint warn">${h(notice)}</div>` : ""}
      <div class="seg">${people.length ? `<button class="seg-btn ${mode === "pin" ? "on" : ""}" data-mode="pin">Cashier · PIN</button>` : ""}
        <button class="seg-btn ${mode === "password" ? "on" : ""}" data-mode="password">Owner / admin</button></div>
      <div id="loginBody"></div></div></section></div>`;
  $("app").querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; showLogin(); }));
  mode === "pin" ? pinPad(people) : passwordForm();
}

function pinPad(people) {
  const body = $("loginBody");
  if (!picked) {
    body.innerHTML = `<h2>Tap your name</h2><div class="name-grid">${people.map((p) =>
      `<button class="name-tile" data-pick="${p.id}"><span class="avatar big">${h(initials(p.full_name))}</span><span>${h(p.full_name)}</span></button>`).join("")}</div>`;
    body.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => { picked = people.find((p) => p.id == b.dataset.pick); pinPad(people); }));
    return;
  }
  body.innerHTML = `<button class="link-btn" data-back>← Not ${h(picked.full_name)}?</button><h2>Enter your PIN</h2>
    <div class="pin-dots">${Array.from({ length: 6 }, (_, i) => `<span class="dot ${i < pin.length ? "on" : ""}"></span>`).join("")}</div>
    <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "✓"].map((k) =>
      `<button class="pin-key ${k === "✓" ? "go" : ""}" data-key="${k}" aria-label="${k === "⌫" ? "Delete" : k === "✓" ? "Sign in" : k}">${k}</button>`).join("")}</div>`;
  body.querySelector("[data-back]").addEventListener("click", () => { picked = null; pin = ""; pinPad(people); });
  body.querySelectorAll("[data-key]").forEach((b) => b.addEventListener("click", async () => {
    const k = b.dataset.key;
    if (k === "⌫") pin = pin.slice(0, -1);
    else if (k !== "✓") { if (pin.length < 6) pin += k; }
    else {
      if (pin.length < 4) return toast("PIN must be 4 to 6 digits.", true);
      try { await api("/login/pin", "POST", { user_id: picked.id, pin }); return boot(); } catch (e) { pin = ""; fail(e); }
    }
    pinPad(people);
  }));
}

function passwordForm() {
  $("loginBody").innerHTML = `<form id="pwForm" class="login-form"><h2>Owner / admin sign-in</h2>
    <div class="field"><label for="username">Username</label><input id="username" name="username" autocomplete="username" autocapitalize="none" required/></div>
    <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required/></div>
    <button class="btn btn-primary btn-block">Sign in →</button></form>`;
  $("pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/login", "POST", { username: f.get("username"), password: f.get("password") }); boot(); } catch (err) { fail(err); }
  });
}

function showChangeSecret() {
  const isPin = S.me.login === "pin";
  $("app").innerHTML = `<div class="login-screen single"><section class="login-side"><form id="secretForm" class="login-box login-form">
    <div class="eyebrow">FIRST SIGN-IN</div><h2>Set your own ${isPin ? "PIN" : "password"}</h2>
    <p class="sub">The ${isPin ? "PIN" : "password"} you were given is temporary. Choose one only you know, and write it down somewhere safe.</p>
    <div class="field"><label for="cur">Temporary ${isPin ? "PIN" : "password"}</label><input id="cur" name="current" type="password" required/></div>
    <div class="field"><label for="n1">New ${isPin ? "PIN (4–6 digits)" : "password (10+ characters, letters and numbers)"}</label><input id="n1" name="new" type="password" required/></div>
    <div class="field"><label for="n2">Type it again</label><input id="n2" name="again" type="password" required/></div>
    <button class="btn btn-primary btn-block">Save and continue</button></form></section></div>`;
  $("secretForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    if (f.new !== f.again) return toast("The two entries don't match.", true);
    try { await api("/me/secret", "POST", { current: f.current, new: f.new }); toast("Saved. Welcome!"); boot(); } catch (err) { fail(err); }
  });
}
