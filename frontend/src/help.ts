// ⓘ explanations and 🔊 read-aloud (v1.2). Buttons are attached automatically to
// page headings, panel headings and form labels that have an entry in helptext.js,
// so screens need no changes. Audio uses the device's own voice (speechSynthesis).

import { HELP } from "./helptext.js";
import { icon } from "./icons.js";
import { S } from "./state.js";
import { dialog, h, toast } from "./ui.js";

const LANGS = { en: "en-IN", te: "te-IN", hi: "hi-IN" };
const NAMES = { en: "English", te: "తెలుగు", hi: "हिन्दी" };
const lang = () => S.me?.prefs?.lang || "en";
const entry = (id, l = lang()) => { const e = HELP[id]; return e && (e[l] || e.en); };
const panels = Object.entries(HELP).filter(([, e]) => e.m);
const findId = (text) => panels.find(([, e]) => e.m.test(text.trim()))?.[0];

const buttons = (id, small = false) => `<span class="hb${small ? " hb-s" : ""}">` +
  `<button type="button" class="hb-btn hb-say" data-say="${id}" aria-label="Listen" title="Listen">${icon("volume-2", small ? 14 : 16)}</button>` +
  `<button type="button" class="hb-btn hb-info" data-help="${id}" aria-label="What is this?" title="What is this?">${icon("info", small ? 14 : 16)}</button></span>`;

/** Add 🔊 and ⓘ to everything in `root` that has an explanation. */
export function attachHelp(root, view = S.view) {
  if (!root) return;
  const h1 = root.querySelector(".pagehead h1");
  if (h1 && !h1.querySelector(".hb") && HELP["screen:" + view]) {
    h1.insertAdjacentHTML("afterbegin", `<span class="hb-lead">${icon(HELP["screen:" + view].i, 26)}</span>`);
    h1.insertAdjacentHTML("beforeend", buttons("screen:" + view));
  }
  root.querySelectorAll("h3, h2.panel-title").forEach((el) => {
    if (el.querySelector(".hb") || el.closest(".modal-form header")) return;
    const id = el.dataset.help || findId(el.textContent);
    if (id) el.insertAdjacentHTML("beforeend", buttons(id, true));
  });
  root.querySelectorAll(".field > label").forEach((el) => {
    if (el.querySelector(".hb")) return;
    const id = findId(el.textContent);
    if (id) el.insertAdjacentHTML("beforeend", buttons(id, true)); // inside the label row; clicks don't reach the input
  });
}

// ---------------------------------------------------------------- speech
// v1.5 (owner report 27 Oct 2026: "the device can't read aloud" on some phones). Phone makers' own
// browsers (Mi, Vivo, Oppo) have no speech at all: say so and offer Chrome. Where speech exists,
// wait for the voices, read sentence by sentence (long text gets cut off on some phones), use the
// speed from My profile, and explain a silent failure instead of doing nothing.
export const canSpeak = () => "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
export const SAMPLE = { en: "Hello. This is how the portal reads help aloud.", te: "నమస్తే. పోర్టల్ సహాయాన్ని ఇలా చదివి వినిపిస్తుంది.", hi: "नमस्ते। पोर्टल मदद को ऐसे पढ़कर सुनाता है।" };

export async function voicesReady() {
  const synth = window.speechSynthesis;
  if (!synth) return [];
  if (!synth.getVoices().length)   // voices load late on Android Chrome
    await new Promise<void>((ok) => { const tm = setTimeout(ok, 1500); synth.addEventListener?.("voiceschanged", () => { clearTimeout(tm); ok(); }, { once: true }); });
  return synth.getVoices();
}
/** Best installed voice for a language: an Indian one first, then one on the device, then any. */
export function voiceFor(l, voices = window.speechSynthesis?.getVoices() || []) {
  const m = voices.filter((v) => v.lang?.replace("_", "-").toLowerCase().startsWith(l));
  return m.find((v) => /-in$/i.test(v.lang.replace("_", "-"))) || m.find((v) => v.localService) || m[0] || null;
}
const chunks = (text) => text.replace(/\n+/g, ". ").split(/(?<=[.!?।])\s+/)
  .flatMap((x) => (x.length > 180 ? x.match(/.{1,180}(\s|$)/g) : [x])).map((x) => x.trim()).filter(Boolean);

const BROWSER = [["MiuiBrowser", "Mi Browser"], ["VivoBrowser", "Vivo Browser"], ["HeyTapBrowser", "Oppo Browser"], ["OppoBrowser", "Oppo Browser"], ["SamsungBrowser", "Samsung Internet"], ["; wv)", "This app's built-in browser"]];
const browserName = () => BROWSER.find(([k]) => navigator.userAgent.includes(k))?.[1] || "This browser";
const android = () => /Android/i.test(navigator.userAgent), iphone = () => /iPhone|iPad/i.test(navigator.userAgent);

/** Shown when the browser has no speech at all: how to get the voice (Chrome), and that ⓘ still works. */
export async function noVoice() {
  const url = location.origin + location.pathname;
  const intent = `intent://${location.host}${location.pathname}#Intent;scheme=${location.protocol.replace(":", "")};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent("https://play.google.com/store/apps/details?id=com.android.chrome")};end`;
  await dialog({ title: "No voice in this browser", submit: null,
    body: `<div class="novoice"><p class="sub m0">${h(browserName())} on this ${iphone() ? "iPhone" : "phone"} can't read aloud. ${android() ? "Chrome can: open the portal in Chrome and sign in once there." : iphone() ? "Safari can: open the portal in Safari and sign in once there." : "Open the portal in Chrome or Edge to listen."}</p>
      ${android() ? `<a class="btn btn-primary btn-big" href="${h(intent)}">${icon("external-link", 18)} Open in Chrome</a>` : ""}
      <div class="field"><label for="f_vurl">Or copy this link into ${iphone() ? "Safari" : "Chrome"}</label><div class="row nowrap"><input id="f_vurl" readonly value="${h(url)}"/><button type="button" class="btn" data-copyurl>${icon("copy", 16)} Copy</button></div></div>
      ${android() ? `<p class="tiny">${icon("sparkles", 13)} Then in Chrome tap ⋮ → <b>Add to Home screen</b>: the portal icon will always open in Chrome.</p>` : ""}
      <p class="tiny">${icon("info", 13)} Until then, ⓘ shows every explanation on the screen.</p></div>`,
    onReady(d) {
      d.querySelector("[data-copyurl]").addEventListener("click", async () => {
        const input = d.querySelector("#f_vurl");
        try { await navigator.clipboard.writeText(url); } catch { input.select(); document.execCommand?.("copy"); }   // no clipboard API on plain http
        toast("Link copied.");
      });
    } });
}

const TROUBLE = {
  "not-allowed": "The phone blocked the sound. Tap 🔊 once more.",
  "language-unavailable": "This phone has no voice for that language. Add one in the phone's Settings → Text-to-speech.",
  "voice-unavailable": "This phone has no voice for that language. Add one in the phone's Settings → Text-to-speech.",
};
const trouble = (code) => toast(TROUBLE[code] || "No sound? Turn up the media volume. Still silent: in the phone's Settings → Text-to-speech, choose “Speech Services by Google”.", true);

let current = null;   // what is being read now: { key, btn, started }
function stop() {
  window.speechSynthesis?.cancel();
  if (current) mark(current.btn, false);
  current = null;
}
/** Read `text` aloud in language `l`. Pressing the same button again stops it. */
export function speakText(text, l = "en", { key = text, btn = null } = {}) {
  if (!canSpeak()) return noVoice();
  const synth = window.speechSynthesis, again = current?.key === key;
  stop();
  if (again) return;
  const voice = voiceFor(l), parts = chunks(text), me = (current = { key, btn, started: false });
  mark(btn, true);
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part);
    u.lang = LANGS[l] || l;
    if (voice) u.voice = voice;
    u.rate = Number(S.me?.prefs?.voice_rate) || 0.95;
    u.onstart = () => (me.started = true);
    if (i === parts.length - 1) u.onend = () => current === me && stop();
    u.onerror = (e) => { if (current !== me) return; stop(); if (!["interrupted", "canceled"].includes(e.error)) trouble(e.error); };
    synth.speak(u);
  });
  setTimeout(() => { if (current === me && !me.started && !synth.speaking) { stop(); trouble("silent"); } }, 4000);
}

async function say(id, l = lang(), btn = null) {
  if (!canSpeak()) return noVoice();
  if (current?.key === id) return stop();
  mark(btn, true);   // answer the tap at once: voices can take a moment to load
  const voices = await voicesReady();
  let [title, text] = entry(id, l);
  if (l !== "en" && voices.length && !voiceFor(l, voices)) {
    // no Telugu/Hindi voice installed on this device: read the English text instead of noise
    [title, text] = entry(id, "en");
    toast(`No ${NAMES[l]} voice on this device, reading in English. My profile → Voice & display shows how to add one.`);
    l = "en";
  }
  speakText(`${title}. ${text}`, l, { key: id, btn });
}
const mark = (btn, on) => { if (!btn?.isConnected) return; btn.classList.toggle("on", on); btn.innerHTML = btn.dataset.sayhere != null ? `${icon(on ? "volume-x" : "volume-2", 16)} ${on ? "Stop" : "Listen"}` : icon(on ? "volume-x" : "volume-2", btn.closest(".hb-s") ? 14 : 16); };

// ---------------------------------------------------------------- ⓘ window
async function explain(id, l = lang()) {
  const e = HELP[id];
  const [title, text] = entry(id, l), [lead, ...steps] = text.split("\n");
  await dialog({ title, submit: null, body: `<div class="help-body">
      <div class="help-top"><span class="help-icon">${icon(e.i || "info", 28)}</span><p class="help-lead">${h(lead)}</p></div>
      ${steps.length ? `<ol class="help-steps">${steps.map((s) => `<li>${h(s)}</li>`).join("")}</ol>` : ""}
      <div class="row mt"><button type="button" class="btn btn-primary" data-sayhere>${icon("volume-2", 16)} Listen</button>
        <span class="help-langs">${Object.keys(NAMES).filter((k) => e[k]).map((k) => `<button type="button" class="chip-btn ${k === l ? "on" : ""}" data-hl="${k}">${NAMES[k]}</button>`).join("")}</span></div></div>`,
    onReady(d) {
      d.querySelector("[data-sayhere]").addEventListener("click", (ev) => say(id, l, ev.currentTarget));
      d.querySelectorAll("[data-hl]").forEach((b) => b.addEventListener("click", () => { stop(); d.querySelector("[data-close]").click(); explain(id, b.dataset.hl); }));
    } });
  stop();
}

// One listener for the whole page, dialogs included (help buttons also appear on form labels in dialogs).
document.addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement)?.closest?.("[data-help], [data-say], [data-novoice], [data-novoice-x]") as HTMLElement | null;
  if (!b) return;
  ev.preventDefault(); ev.stopPropagation();
  if (b.dataset.help) explain(b.dataset.help);
  else if (b.dataset.say) say(b.dataset.say, lang(), b);
  else if (b.hasAttribute("data-novoice")) noVoice();
  else { bannerClosed = true; try { localStorage.setItem("vtc-novoice-seen", "1"); } catch { /* private mode */ } b.closest(".voice-banner")?.remove(); }
}, true);
window.speechSynthesis?.getVoices(); // voices load lazily on some browsers

/** One-time strip under the top bar on browsers without speech (dismissed for good with ✕). */
let bannerClosed = false;
export function voiceBanner() {
  let seen = bannerClosed;
  try { seen ||= localStorage.getItem("vtc-novoice-seen") === "1"; } catch { /* private mode */ }
  return canSpeak() || seen ? "" : `<div class="voice-banner" role="status">${icon("volume-x", 18)}<span>${h(browserName())} can't read aloud. </span>
    <button type="button" class="link-btn" data-novoice>How to listen</button><button type="button" class="icon-btn" data-novoice-x aria-label="Dismiss">${icon("x", 16)}</button></div>`;
}
