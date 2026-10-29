import { enterDialog } from "../fx.js";
import { loadPending } from "./pending.js";
// Messages: inbox, threads, announcements with read receipts, voice notes,
// discussion on work records, the alerts bell. (DPR Addendum A)

import { api } from "../api.js";
import { t } from "../i18n.js";
import { S, can, nav } from "../state.js";
import { $, chip, dialog, fail, h, initials, pageHead, select, toast, when } from "../ui.js";

const KIND_LABEL = { announcement: "Announcements", group: "Team groups", direct: "Direct", record: "Work threads" };
const ICON = { announcement: "📣", group: "👥", direct: "💬", record: "🧾" };

// ------------------------------------------------------------------ inbox
export const comms = {
  paths() {
    const s = (S.sub ||= {});
    return ["/comms/inbox", ...(s.conv ? [`/comms/conversations/${s.conv}`] : []), ...(s.oversight ? ["/comms/oversight"] : [])];
  },
  render() {
    const s = S.sub, inbox = S.data["/comms/inbox"] || { conversations: [] };
    const list = Object.keys(KIND_LABEL).map((k) => {
      const items = inbox.conversations.filter((c) => c.kind === k);
      if (!items.length) return "";
      return `<div class="conv-group">${KIND_LABEL[k]}</div>${items.map((c) => `<button class="conv ${s.conv === c.id ? "on" : ""}" data-conv="${c.id}">
        <span class="conv-icon" aria-hidden="true">${ICON[c.kind]}</span>
        <span class="conv-main"><b>${h(c.title)}</b><span class="tiny">${c.last ? h((c.last.author ? c.last.author.split(" ")[0] + ": " : "") + c.last.body) : "No messages yet"}</span></span>
        ${c.unread ? `<span class="badge">${c.unread}</span>` : ""}</button>`).join("")}`;
    }).join("");
    const thread = s.conv ? threadHtml(S.data[`/comms/conversations/${s.conv}`]) : s.oversight ? oversightHtml() :
      `<div class="empty tall"><b>Choose a conversation</b>Announcements, your team groups, direct chats and work threads appear on the left.</div>`;
    return pageHead(`${S.me.settings.short_name} / ${t("comms").toUpperCase()}`, t("comms"),
      "The official channel for work talk. Everything stays with the work it is about.",
      `${can("comms.chat") ? '<button class="btn" data-action="newChat">+ New chat</button>' : ""}${can("comms.oversight") ? '<button class="btn btn-quiet" data-action="oversight">Oversight</button>' : ""}`) +
      `<div class="messenger ${s.conv || s.oversight ? "has-thread" : ""}"><aside class="conv-list">${list || '<div class="empty">No conversations yet.</div>'}</aside><section class="thread-pane">${thread}</section></div>`;
  },
};

function bubble(m, me) {
  const mine = m.author_id === me;
  const voice = m.voice_file_id ? `<audio controls preload="none" src="/api/v1/comms/files/${m.voice_file_id}"></audio>` : "";
  const audience = m.audience && m.audience !== "all" ? chip("to " + m.audience.replace(":", " #"), "kind") : "";
  const receipts = m.receipts ? `<details class="receipts"><summary>Seen by ${m.receipts.seen.length} of ${m.receipts.total}</summary>
      <div class="tiny">${m.receipts.seen.map((x) => `✓ ${h(x.name)}`).join("<br>") || "Nobody yet"}${m.receipts.not_seen.length ? "<br><b>Not yet:</b> " + h(m.receipts.not_seen.join(", ")) : ""}</div></details>` : "";
  return `<div class="msg ${mine ? "mine" : ""} ${m.author_id ? "" : "system"}">
    ${mine ? "" : `<span class="avatar small">${h(initials(m.author || "System"))}</span>`}
    <div class="msg-body"><div class="msg-meta">${mine ? "You" : h(m.author || "System")} · ${when(m.created_at)} ${audience}</div>
      ${m.body ? `<div class="msg-text">${h(m.body).replace(/\n/g, "<br>")}</div>` : ""}${voice}${receipts}</div></div>`;
}

function composer(data, idPrefix = "") {
  if (!data.may_post) return data.oversight ? '<div class="hint warn">Oversight view — read-only, and this read was logged.</div>' : "";
  const isAnn = data.conversation.kind === "announcement";
  const audience = isAnn ? select(idPrefix + "audience", "Send to", [["all", "Everyone"], ...data.roles.map((r) => [`role:${r.id}`, `Role: ${r.name}`]), ...data.teams.map((x) => [`team:${x.id}`, `Team: ${x.name}`])]) : "";
  return `<form class="composer" data-compose="${data.conversation.id}">${audience}
    <div class="compose-row"><textarea name="body" rows="2" maxlength="2000" placeholder="${isAnn ? "Write an announcement…" : "Type a message…"}" aria-label="Message"></textarea>
    ${can("comms.chat") ? `<button type="button" class="btn mic" data-mic="${data.conversation.id}" aria-label="Record voice note" title="Record voice note (up to 2 minutes)">🎤</button>` : ""}
    <button class="btn btn-primary" type="submit">Send</button></div>
    <div class="rec-status tiny" hidden></div></form>`;
}

function threadHtml(data) {
  if (!data) return '<div class="empty">This conversation is not available.</div>';
  const me = S.me.user.id, c = data.conversation;
  const sub = c.kind === "group" ? `${data.members.length} members: ${data.members.join(", ")}` : c.kind === "record" ? "Discussion attached to this record" : c.kind === "announcement" ? "Official notices · read receipts" : "Direct chat";
  return `<header class="thread-head"><button class="btn btn-small back-btn" data-action="closeConv">←</button><div><h2>${ICON[c.kind]} ${h(c.title)}</h2><div class="tiny">${h(sub)}</div></div>
      ${c.kind === "record" ? `<button class="btn btn-small" data-openrecord="${c.record_type}">Open ${h(c.record_type)} →</button>` : ""}</header>
    <div class="privacy tiny">🔒 ${h(data.notice)}</div>
    <div class="msgs" id="msgs">${data.messages.map((m) => bubble(m, me)).join("") || '<div class="empty">No messages yet. Say hello.</div>'}</div>
    ${composer(data)}`;
}

function oversightHtml() {
  const rows = S.data["/comms/oversight"] || [];
  return `<header class="thread-head"><button class="btn btn-small back-btn" data-action="closeConv">←</button><div><h2>Oversight</h2><div class="tiny">Every conversation you open from here is written to the audit log.</div></div></header>
    <div class="stack">${rows.map((r) => `<button class="conv" data-conv="${r.id}"><span class="conv-icon">${ICON[r.kind]}</span><span class="conv-main"><b>${h(r.title)}</b><span class="tiny">${r.messages} messages · last ${when(r.last_at)}</span></span></button>`).join("") || '<div class="empty">No conversations yet.</div>'}</div>`;
}

export function afterRender() {
  const box = $("msgs");
  if (box) box.scrollTop = box.scrollHeight;
}

// ------------------------------------------------------------------ record threads (dialog)
export async function openRecordThread(type, id) {
  try {
    const { id: cid } = await api(`/comms/record/${type}/${id}`);
    let data = await api(`/comms/conversations/${cid}`);
    const d = document.createElement("dialog");
    d.className = "modal wide thread-modal";
    const paint = () => {
      d.innerHTML = `<div class="modal-form"><header><h2>💬 ${h(data.conversation.title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></header>
        <div class="modal-body"><div class="privacy tiny">🔒 ${h(data.notice)}</div><div class="msgs" id="dlgMsgs">${data.messages.map((m) => bubble(m, S.me.user.id)).join("") || '<div class="empty">No discussion yet. Start it.</div>'}</div>${composer(data, "d_")}</div><footer><button type="button" class="btn" data-close>Close</button></footer></div>`;
      d.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => { d.close(); d.remove(); }));
      const f = d.querySelector("form[data-compose]");
      f?.addEventListener("submit", async (e) => {
        e.preventDefault();
        await sendFrom(f);
        data = await api(`/comms/conversations/${cid}`);
        paint();
      });
      d.querySelector("[data-mic]")?.addEventListener("click", (e) => recordVoice(e.currentTarget, async () => { data = await api(`/comms/conversations/${cid}`); paint(); }));
      const box = d.querySelector("#dlgMsgs");
      box.scrollTop = box.scrollHeight;
    };
    document.body.appendChild(d);
    d.addEventListener("cancel", () => d.remove());
    paint();
    d.showModal();
    enterDialog(d);
  } catch (e) { fail(e); }
}

export const discussBtn = (type, id) => (can("comms.read") ? ` <button class="btn btn-small btn-quiet" data-discuss="${type}:${id}" title="Discuss" aria-label="Discuss">💬</button>` : "");

// ------------------------------------------------------------------ sending
async function sendFrom(form, voiceId = null) {
  const body = form.querySelector("[name=body]").value.trim();
  const aud = form.querySelector("select")?.value;
  if (!body && !voiceId) return;
  await api(`/comms/conversations/${form.dataset.compose}/messages`, "POST", { body, voice_file_id: voiceId, audience: aud });
  form.reset();
}

let recorder = null;
async function recordVoice(btn, after) {
  const form = btn.closest("form"), status = form.querySelector(".rec-status");
  if (recorder) { recorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("Voice notes need a phone or browser with microphone support.", true);
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { return toast("Microphone permission was refused. Allow it in the browser settings to send voice notes.", true); }
  const type = ["audio/webm", "audio/mp4", "audio/ogg"].find((x) => MediaRecorder.isTypeSupported?.(x)) || "";
  const chunks = [];
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  let secs = 0;
  const tick = setInterval(() => { secs++; status.textContent = `● Recording ${secs}s — tap 🎤 again to send (max 120s)`; if (secs >= 120) recorder?.stop(); }, 1000);
  status.hidden = false;
  btn.classList.add("recording");
  recorder.onstop = async () => {
    clearInterval(tick);
    stream.getTracks().forEach((x) => x.stop());
    btn.classList.remove("recording");
    recorder = null;
    status.textContent = "Sending voice note…";
    try {
      const blob = new Blob(chunks, { type: chunks[0]?.type || type || "audio/webm" });
      const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(blob); });
      const { id } = await api("/comms/voice", "POST", { mime: blob.type, data: b64 });
      await sendFrom(form, id);
      status.hidden = true;
      await after();
    } catch (e) { status.hidden = true; fail(e); }
  };
  recorder.start();
}

// ------------------------------------------------------------------ bell
export async function bellDialog() {
  try {
    const list = await api("/alerts");
    const r = await dialog({
      title: "🔔 Alerts", submit: list.some((a) => !a.read_at) ? "Mark all as read" : null, wide: false,
      body: list.length ? `<div class="alert-list">${list.map((a) => `<button type="button" class="alert-row ${a.read_at ? "" : "unread"} sev-${a.severity}" data-alertgo="${a.view || ""}" data-alertid="${a.id}">
          <span class="sev-dot" aria-hidden="true"></span><span><b>${h(a.title)}</b>${a.body ? `<br><span class="tiny">${h(a.body)}</span>` : ""}<br><span class="tiny">${when(a.created_at)}</span></span></button>`).join("")}</div>`
        : '<div class="empty">No alerts. Things that need you will appear here.</div>',
      onReady(d) {
        d.querySelectorAll("[data-alertgo]").forEach((b) => b.addEventListener("click", async () => {
          await api("/alerts/read", "POST", { ids: [Number(b.dataset.alertid)] }).catch(() => {});
          d.close(); d.remove();
          if (b.dataset.alertgo && S.me.modules.includes(b.dataset.alertgo)) nav.go(b.dataset.alertgo);
          refreshBadge();
        }));
      },
    });
    if (r !== null) { await api("/alerts/read", "POST", { ids: "all" }); toast("All alerts marked as read."); }
    refreshBadge();
  } catch (e) { fail(e); }
}

export async function refreshBadge() {
  try {
    const b = await api("/comms/badge");
    const total = b.messages + b.alerts;
    document.querySelectorAll<HTMLElement>("[data-badge]").forEach((el) => { el.textContent = total > 99 ? "99+" : String(total); el.hidden = !total; });
    const nm = document.querySelector<HTMLElement>('.nav-item[data-go="comms"] .nav-count');
    if (nm) { nm.textContent = String(b.messages); nm.hidden = !b.messages; }
    return b;
  } catch { return null; }
}

let poller;
export function startPolling() {
  clearInterval(poller);
  refreshBadge();
  poller = setInterval(async () => {
    const before = document.querySelector("[data-badge]")?.textContent;
    const [b] = await Promise.all([refreshBadge(), loadPending()]);
    if (b && S.view === "comms" && S.sub?.conv && String(b.messages + b.alerts) !== before && !document.querySelector("form[data-compose] textarea:focus")) nav.go("comms", S.sub);
  }, 20000);
}
export const stopPolling = () => clearInterval(poller);

// ------------------------------------------------------------------ events
export async function commsClick(el) {
  const ds = el.dataset;
  if (ds.conv) { S.sub = { conv: Number(ds.conv) }; await nav.go("comms", S.sub); return true; }
  if (ds.action === "closeConv") { S.sub = {}; await nav.go("comms", S.sub); return true; }
  if (ds.action === "oversight") { S.sub = { oversight: true }; await nav.go("comms", S.sub); return true; }
  if (ds.mic) { recordVoice(el, () => nav.go("comms", S.sub)); return true; }
  if (ds.openrecord) {
    const map = { roast: "roasting", lot: "inventory", receipt: "inward", pack: "packing", order: "orders", task: "tasks", sale: "counter", outside: "outside", blend: "blending", transfer: "inventory" };
    nav.go(map[ds.openrecord] || "dashboard"); return true;
  }
  if (ds.action === "newChat") {
    try {
      const people = await api("/comms/contacts");
      if (!people.length) return toast("There is nobody you can start a direct chat with.", true), true;
      const r = await dialog({ title: "New direct chat", submit: "Open chat", body: select("user_id", "Who?", people.map((p) => [p.id, `${p.full_name} · ${p.role_name}`])) +
        (S.me.user.tier === "staff" ? '<p class="hint">Staff chat with their manager. Use your team group for everyone else.</p>' : "") });
      if (!r) return true;
      const { id } = await api("/comms/direct", "POST", { user_id: Number(r.user_id) });
      S.sub = { conv: id };
      await nav.go("comms", S.sub);
    } catch (e) { fail(e); }
    return true;
  }
  return false;
}

export async function commsSubmit(form) {
  try {
    await sendFrom(form);
    await nav.go("comms", S.sub);
  } catch (e) { fail(e); }
}
