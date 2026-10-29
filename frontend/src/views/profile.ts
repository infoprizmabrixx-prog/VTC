// v1.5 (owner request 27 Oct 2026): "My profile", opened from the round initials button.
// Four parts: my contact & emergency, voice & display, security & devices, my team & my work.
// Everyone sees only their own page. ID and bank numbers are never shown here.

import { api } from "../api.js";
import { SAMPLE, canSpeak, noVoice, speakText, voiceFor, voicesReady } from "../help.js";
import { LANG_NAMES, setLang, t } from "../i18n.js";
import { icon } from "../icons.js";
import { S, nav } from "../state.js";
import { check, confirmBox, fail, field, h, initials, pageHead, toast, when } from "../ui.js";

const RATES: [number, string][] = [[0.7, "Slow"], [0.85, "A bit slow"], [0.95, "Normal"], [1.1, "A bit fast"], [1.25, "Fast"]];
const ago = (ts: any) => {
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  return m < 2 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : when(ts);
};
const v = (x) => `value="${h(x || "")}"`;

export const profile = {
  paths: () => ["/me/profile"],
  render() {
    const d = S.data["/me/profile"] || {}, u = S.me.user, p = S.me.prefs, c = d.contact || {}, isPin = u.login_type === "pin";
    const langs = S.me.settings.languages_enabled || ["en"], rate = Number(p.voice_rate) || 0.95, others = (d.sessions || []).filter((x) => !x.this).length;
    const head = `<section class="card prof-head"><span class="prof-av" aria-hidden="true">${h(initials(u.full_name))}</span>
      <div class="prof-who"><h2>${h(u.full_name)}</h2><p class="sub m0">${h(d.designation || u.role_name)}${d.boss ? ` · reports to <b>${h(d.boss.full_name)}</b>` : ""}</p>
        <div class="row mt-s"><span class="chip">${icon("id-card", 13)} ${h(u.role_name)}</span>${u.is_owner ? `<span class="chip">${icon("crown", 13)} Owner</span>` : ""}
          ${(d.teams || []).map((x) => `<span class="chip">${icon("users", 13)} ${h(x)}</span>`).join("")}${d.joined_on ? `<span class="chip">Joined ${h(new Date(d.joined_on).toLocaleDateString("en-IN", { month: "short", year: "numeric" }))}</span>` : ""}</div></div></section>`;

    const contact = `<form class="card span6" data-form="meContact"><h3>${icon("phone", 18)} My contact &amp; emergency</h3>
      <p class="hint">${icon("lock", 14)} Only you, the owner and admins see these. Your ID and bank details are kept by the office, not here.</p>
      <div class="form-grid">${field("phone", "My phone", "tel", `maxlength="15" inputmode="tel" autocomplete="tel" ${v(c.phone)}`)}${field("alt_phone", "Other phone", "tel", `maxlength="15" inputmode="tel" ${v(c.alt_phone)}`)}</div>
      ${field("email", "Email", "email", `maxlength="120" autocomplete="email" ${v(c.email)}`)}
      <div class="form-grid">${field("emergency_name", "Emergency contact name", "text", `maxlength="80" ${v(c.emergency_name)}`, "Who we call if something happens to you at work")}${field("emergency_phone", "Emergency contact phone", "tel", `maxlength="15" inputmode="tel" ${v(c.emergency_phone)}`)}</div>
      <button class="btn btn-primary">${icon("circle-check", 16)} Save my details</button></form>`;

    const voice = `<section class="card span6"><h3>${icon("volume-2", 18)} Voice &amp; display</h3>
      ${langs.length > 1 ? `<div class="field"><label>Language</label><div class="chips">${langs.map((l) => `<button type="button" class="chip-btn ${p.lang === l ? "on" : ""}" data-plang="${l}" aria-pressed="${p.lang === l}">${h(LANG_NAMES[l])}</button>`).join("")}</div></div>` : ""}
      <div class="field"><label>Read-aloud speed</label><div class="chips">${RATES.map(([r, l]) => `<button type="button" class="chip-btn ${Math.abs(r - rate) < 0.03 ? "on" : ""}" data-rate="${r}" aria-pressed="${Math.abs(r - rate) < 0.03}">${l}</button>`).join("")}</div>
        <small>Tap a speed to hear it.</small></div>
      ${canSpeak() ? `<div class="field"><label>Voices on this device</label><div class="vlist">${langs.map((l) => `<div class="vrow"><b>${h(LANG_NAMES[l])}</b><span class="tiny" data-vstat="${l}">Checking…</span>
          <button type="button" class="btn btn-small" data-vtest="${l}">${icon("volume-2", 14)} Test</button></div>`).join("")}</div></div>
        <details class="vhelp"><summary>No Telugu or Hindi voice? Add one (Android)</summary><ol class="help-steps">
          <li>Open the phone's <b>Settings</b> and search for <b>Text-to-speech</b>.</li><li>Choose <b>Speech Services by Google</b> as the engine.</li>
          <li>Tap ⚙ next to it → <b>Install voice data</b> → <b>Telugu (India)</b> or <b>Hindi (India)</b>.</li><li>Come back here and press <b>Test</b>.</li></ol></details>`
        : `<div class="hint warn">${icon("volume-x", 16)} This browser can't read aloud. <button type="button" class="link-btn" data-novoice>How to listen</button></div>`}
      <div class="divider"></div>${check("large", "Large text / easy to read", p.large_text, "Bigger letters and buttons on every screen", "data-plarge")}</section>`;

    const devices = (d.sessions || []).map((x) => `<div class="dev ${x.this ? "this" : ""}"><span class="dev-ic">${icon(/Android|iPhone|iPad/.test(x.device) ? "smartphone" : "monitor", 20)}</span>
      <div class="dev-txt"><span><b>${h(x.device)}</b>${x.this ? ' <span class="tag good">This device</span>' : ""}</span><span class="tiny">${x.device_mode === "shared" ? "Shared device" : "Personal device"} · active ${ago(x.last_seen)} · signed in ${when(x.created_at)}</span></div>
      ${x.this ? "" : `<button type="button" class="btn btn-small" data-revoke="${x.id}">${icon("log-out", 14)} Sign out</button>`}</div>`).join("");
    const security = `<section class="card span6"><h3>${icon("shield-check", 18)} Security &amp; devices</h3>
      <div class="kv"><span>Signs in with</span><b>${isPin ? "PIN" : "Password"}</b></div>
      <div class="kv"><span>This device</span><b>${u.device_mode === "shared" ? "Shared" : "Personal"} · signs out after ${S.me.idle_minutes} min without use</b></div>
      <form class="mt" data-form="meSecret"><h4>Change my ${isPin ? "PIN" : "password"}</h4>
        ${field("current", `Current ${isPin ? "PIN" : "password"}`, "password", `required autocomplete="current-password" ${isPin ? 'inputmode="numeric" maxlength="6"' : ""}`)}
        <div class="form-grid">${field("new", `New ${isPin ? "PIN" : "password"}`, "password", `required autocomplete="new-password" ${isPin ? 'inputmode="numeric" maxlength="6" minlength="4"' : 'minlength="10"'}`, isPin ? "4 to 6 digits, not 1111 or 1234" : "At least 10 letters and numbers")}
          ${field("confirm", "Type it again", "password", `required autocomplete="new-password" ${isPin ? 'inputmode="numeric" maxlength="6"' : ""}`)}</div>
        <button class="btn">${icon("lock", 16)} Change ${isPin ? "PIN" : "password"}</button><p class="tiny">Your other phones and PCs are signed out when you change it.</p></form>
      <div class="divider"></div><div class="row between"><h4 class="m0">Where I'm signed in</h4>${others ? `<button type="button" class="btn btn-small" data-revoke="all">${icon("log-out", 14)} Sign out all others</button>` : ""}</div>
      <div class="devs">${devices}</div><p class="tiny">Don't recognise a device? Sign it out and change your ${isPin ? "PIN" : "password"}.</p></section>`;

    const tiles = (d.work || []).map((w) => `<div class="wtile"><b>${w.count}</b><span>${h(w.label)}</span></div>`).join("");
    const people = (list) => list.map((x) => `<span class="chip">${icon("user-round", 13)} ${h(x.full_name)} · ${h(x.role_name)}</span>`).join("");
    const work = `<section class="card span6"><h3>${icon("briefcase", 18)} My team &amp; my work</h3>
      <div class="kv"><span>Reports to</span><b>${d.boss ? `${h(d.boss.full_name)} · ${h(d.boss.role_name)}` : "Nobody — top of the company"}</b></div>
      ${(d.reports || []).length ? `<div class="field"><label>Reports to me</label><div class="chips">${people(d.reports)}</div></div>` : ""}
      <h4>This month</h4>${tiles ? `<div class="wtiles">${tiles}</div>` : '<p class="tiny">Nothing recorded yet this month.</p>'}
      <h4>What I can do</h4><p class="tiny">Set by the owner or an admin. Ask them if you need more.</p>
      ${(d.access || []).map((a) => `<details class="access"><summary><b>${h(a.area)}</b><span class="tiny">${a.can.length}</span></summary><ul>${a.can.map((x) => `<li>${h(x)}</li>`).join("")}</ul></details>`).join("")}</section>`;

    return pageHead(S.me.settings.short_name, t("profile"), "Your details, voice, sign-ins and work. Only you see this page.") +
      `${head}<div class="grid mt">${contact}${voice}${security}${work}</div>`;
  },
  after() {
    document.querySelector("[data-plarge]")?.addEventListener("change", async (e) => {
      if (await savePref({ large_text: (e.target as HTMLInputElement).checked })) nav.rerender();
    });
    if (canSpeak()) voicesReady().then((voices) => document.querySelectorAll<HTMLElement>("[data-vstat]").forEach((el) => {
      const vc = voiceFor(el.dataset.vstat!, voices);
      el.textContent = vc ? `Ready · ${vc.name}` : voices.length ? "No voice installed — see below" : "No voices found on this device";
      el.classList.toggle("neg", !vc);
    }));
  },
};

async function savePref(patch) {
  const next = { ...S.me.prefs, ...patch };
  try { await api("/me/preferences", "PUT", next); } catch (e) { fail(e); return false; }
  S.me.prefs = next;
  return true;
}

// forms on this page (routed by data-form through handleSubmit)
export const PROFILE_FORMS = {
  meContact: { async submit(f) { await api("/me/profile", "PUT", f); toast("Your details are saved."); } },
  meSecret: { async submit(f) {
    if (f.new !== f.confirm) throw { code: "SECRETS_DONT_MATCH" };
    await api("/me/secret", "POST", { current: f.current, new: f.new });
    toast("Changed. Your other devices were signed out.");
  } },
};

export async function profileClick(el) {
  const ds = el.dataset;
  if (ds.plang) {
    if (await savePref({ lang: ds.plang })) { setLang(ds.plang); await nav.rerender(); }
    return true;
  }
  if (ds.rate) {
    if (await savePref({ voice_rate: Number(ds.rate) })) {
      document.querySelectorAll("[data-rate]").forEach((b) => { const on = b === el; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
      if (!canSpeak()) return toast("Speed saved."), true;
      const voices = await voicesReady(), l = SAMPLE[S.me.prefs.lang] && !(voices.length && !voiceFor(S.me.prefs.lang, voices)) ? S.me.prefs.lang : "en";
      speakText(SAMPLE[l], l, { key: "rate" + ds.rate });   // hear the new speed (in English if this language has no voice here)
    }
    return true;
  }
  if (ds.vtest) {
    if (!canSpeak()) return noVoice(), true;
    toast(`Testing the ${LANG_NAMES[ds.vtest]} voice…`);
    const voices = await voicesReady();
    if (voices.length && !voiceFor(ds.vtest, voices)) return toast(`No ${LANG_NAMES[ds.vtest]} voice on this device yet. See “Add one” below.`, true), true;
    speakText(SAMPLE[ds.vtest], ds.vtest, { key: "test-" + ds.vtest, btn: el });
    return true;
  }
  if (ds.revoke) {
    const all = ds.revoke === "all";
    if (!(await confirmBox(all ? "Sign out all other devices?" : "Sign out this device?", all ? "Every other phone and PC signed in as you must sign in again. This device stays signed in." : "That device must sign in again.", "Sign out"))) return true;
    try {
      const r = await api("/me/sessions/revoke", "POST", all ? { all: true } : { id: Number(ds.revoke) });
      toast(`${r.signed_out} device${r.signed_out === 1 ? "" : "s"} signed out.`);
      await nav.go("profile");
    } catch (e) { fail(e); }
    return true;
  }
  return false;
}
