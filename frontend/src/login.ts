// Sign-in screens: tap-your-name + PIN for staff tablets, password for others,
// and the forced "set your own password" screen.

import { api } from "./api.js";
import { errorText, t } from "./i18n.js";
import { $, h, initials, toast } from "./ui.js";

let mode = "pin";
let picked = null;
let pin = "";
let notice = "";

export function showLogin(onSignedIn, message = "") {
  notice = message;
  picked = null;
  pin = "";
  document.body.className = "";
  api("/login/pin-people")
    .then((people) => render(people, onSignedIn))
    .catch(() => render([], onSignedIn));
}

function render(people, onSignedIn) {
  if (!people.length) mode = "password";
  $("app").innerHTML = `<div class="login-screen">
    <section class="login-art">
      <div class="mini">VASAVI TRADING COMPANY · IN-HOUSE PORTAL</div>
      <h1>From green beans to great business.</h1>
      <p>One place for the whole team: work, stock, roasting and messages. Everyone sees exactly what they need.</p>
    </section>
    <section class="login-side">
      <div class="login-box">
        ${notice ? `<div class="hint warn" role="status">${h(notice)}</div>` : ""}
        <div class="seg" role="tablist">
          ${people.length ? `<button class="seg-btn ${mode === "pin" ? "on" : ""}" data-mode="pin">Staff · PIN</button>` : ""}
          <button class="seg-btn ${mode === "password" ? "on" : ""}" data-mode="password">Password</button>
        </div>
        <div id="loginBody"></div>
      </div>
    </section></div>`;
  $("app").querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => { mode = b.dataset.mode; picked = null; pin = ""; render(people, onSignedIn); }));
  if (mode === "pin") renderPin(people, onSignedIn);
  else renderPassword(onSignedIn);
}

function renderPin(people, onSignedIn) {
  const body = $("loginBody");
  if (!picked) {
    body.innerHTML = `<h2>${h(t("tapName"))}</h2><div class="name-grid">${people
      .map((p) => `<button class="name-tile" data-pick="${p.id}"><span class="avatar big">${h(initials(p.full_name))}</span><span>${h(p.full_name)}</span></button>`)
      .join("")}</div>`;
    body.querySelectorAll("[data-pick]").forEach((b) =>
      b.addEventListener("click", () => { picked = people.find((p) => p.id == b.dataset.pick); pin = ""; renderPin(people, onSignedIn); }));
    return;
  }
  const dots = Array.from({ length: 6 }, (_, i) => `<span class="dot ${i < pin.length ? "on" : ""}"></span>`).join("");
  body.innerHTML = `<button class="link-btn" data-back>← Not ${h(picked.full_name)}?</button>
    <h2>${h(t("enterPin"))}</h2><div class="pin-dots" aria-live="polite" aria-label="${pin.length} digits entered">${dots}</div>
    <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "✓"]
      .map((k) => `<button class="pin-key ${k === "✓" ? "go" : ""}" data-key="${k}" aria-label="${k === "⌫" ? "Delete" : k === "✓" ? "Sign in" : k}">${k}</button>`)
      .join("")}</div>
    <label class="check small"><input type="checkbox" id="personalDevice"/><span>This is my own phone (stay signed in longer)</span></label>`;
  body.querySelector("[data-back]").addEventListener("click", () => { picked = null; renderPin(people, onSignedIn); });
  const submit = async () => {
    if (pin.length < 4) return toast(errorText("PIN_MUST_BE_4_TO_6_DIGITS"), true);
    try {
      await api("/login/pin", "POST", { user_id: picked.id, pin, personal_device: $("personalDevice").checked });
      onSignedIn();
    } catch (e) {
      pin = "";
      renderPin(people, onSignedIn);
      toast(errorText(e.code), true);
    }
  };
  body.querySelectorAll("[data-key]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.key;
      if (k === "⌫") pin = pin.slice(0, -1);
      else if (k === "✓") return submit();
      else if (pin.length < 6) pin += k;
      const keepChecked = $("personalDevice").checked;
      renderPin(people, onSignedIn);
      $("personalDevice").checked = keepChecked;
    }));
}

function renderPassword(onSignedIn) {
  $("loginBody").innerHTML = `<form id="pwForm" class="login-form"><h2>Sign in to your workspace</h2>
    <div class="field"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required autocapitalize="none"/></div>
    <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required/></div>
    <label class="check small"><input type="checkbox" name="shared"/><span>This is a shared device (signs out sooner)</span></label>
    <button class="btn btn-primary btn-block" type="submit">${h(t("signIn"))} →</button></form>`;
  $("pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("/login", "POST", { username: f.get("username"), password: f.get("password"), shared_device: !!f.get("shared") });
      onSignedIn();
    } catch (err) {
      toast(errorText(err.code), true);
    }
  });
}

export function showChangeSecret(me, onDone) {
  const isPin = me.user.login_type === "pin";
  $("app").innerHTML = `<div class="login-screen single"><section class="login-side"><form id="secretForm" class="login-box login-form">
    <div class="eyebrow">FIRST SIGN-IN</div><h2>Set your own ${isPin ? "PIN" : "password"}</h2>
    <p class="sub">The ${isPin ? "PIN" : "password"} you were given was temporary. Choose one only you know.</p>
    <div class="field"><label for="cur">Temporary ${isPin ? "PIN" : "password"}</label><input id="cur" name="current" type="password" required/></div>
    <div class="field"><label for="new1">New ${isPin ? "PIN (4–6 digits)" : "password (10+ characters, letters and numbers)"}</label><input id="new1" name="new" type="password" required ${isPin ? 'inputmode="numeric"' : ""}/></div>
    <div class="field"><label for="new2">Type it again</label><input id="new2" name="again" type="password" required/></div>
    <button class="btn btn-primary btn-block">Save and continue</button></form></section></div>`;
  $("secretForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    if (f.new !== f.again) return toast("The two entries don't match.", true);
    try {
      await api("/me/secret", "POST", { current: f.current, new: f.new });
      toast("Saved. Welcome!");
      onDone();
    } catch (err) {
      toast(errorText(err.code), true);
    }
  });
}
