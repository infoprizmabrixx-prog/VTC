// "Pending here" panel at the top of each section + the per-section menu counts (v1.2).
// Data: GET /pending → { section: { count, tasks[], waiting[] } } for this person.

import { api } from "../api.js";
import { icon } from "../icons.js";
import { SECTION } from "../shell.js";
import { S } from "../state.js";
import { h, num, tag } from "../ui.js";

const STATUS = { OPEN: "not started", IN_PROGRESS: "in progress", BLOCKED: "stuck", SUBMITTED: "waiting for review" };

export async function loadPending() {
  try { S.pending = await api("/pending"); } catch { S.pending = S.pending || {}; }
  paintBadges();
  return S.pending;
}

export function paintBadges() {
  document.querySelectorAll<HTMLElement>("[data-pend]").forEach((el) => {
    const n = S.pending?.[el.dataset.pend!]?.count || 0;
    el.textContent = n > 99 ? "99+" : String(n); el.hidden = !n;
  });
}

/** Panel HTML for a section, or "" when nothing is pending there. */
export function pendingPanel(view: string) {
  const p = S.pending?.[view];
  if (!p || view === "tasks" || view === "dashboard") return "";
  const me = S.me.user.id, sec: any = SECTION[view] || {};
  const rows = p.tasks.map((t) => {
    const pct = t.target ? Math.min(100, (t.progress / t.target) * 100) : null, open = ["OPEN", "IN_PROGRESS", "BLOCKED"].includes(t.status);
    return `<li class="pend-item ${t.status === "BLOCKED" ? "stuck" : ""}">
      <span class="pend-ic">${icon(t.status === "SUBMITTED" ? "hourglass" : t.status === "BLOCKED" ? "circle-alert" : "clipboard-list", 18)}</span>
      <div class="pend-main"><b>${h(t.title)}</b><span class="tiny">${t.mine ? "For you" : h(t.assignee || "Unassigned")}${t.due ? ` · due ${h(t.due)}` : ""} · ${h(STATUS[t.status] || t.status)}</span>
        ${pct != null ? `<div class="bar"><span style="width:${pct}%"></span></div><span class="tiny">${num(t.progress)} of ${num(t.target)} ${h(t.unit)}</span>` : ""}</div>
      <div class="pend-act">${t.may_review ? `<button class="btn btn-small btn-primary" data-treview="${t.id}:1">Approve</button><button class="btn btn-small" data-treview="${t.id}:0">Send back</button>` : ""}${
        open && t.assigned_to === me ? `<button class="btn btn-small ${t.target != null && t.progress >= t.target ? "btn-primary" : ""}" data-tsubmit="${t.id}">${icon("circle-check", 14)} Mark completed</button>` : ""}</div></li>`;
  }).join("");
  const waits = p.waiting.map((w) => `<li class="pend-item wait"><span class="pend-ic">${icon("bell", 18)}</span><div class="pend-main"><b>${w.count} ${h(w.label)}</b><span class="tiny">Waiting below on this screen</span></div></li>`).join("");
  return `<section class="pend-card" style="--sec:${sec.color || "#805039"}" aria-label="Pending here">
    <header class="pend-head"><span class="pend-badge">${icon("hourglass", 18)}</span><h3 data-help="pending">Pending here <span class="pend-n">${p.count}</span></h3></header>
    <ul class="pend-list">${rows}${waits}</ul></section>`;
}

// the task buttons in the panel reuse the My Work handlers; they look tasks up here
export const pendingTask = (id: any) => Object.values<any>(S.pending || {}).flatMap((x: any) => x.tasks).find((t: any) => t.id === Number(id));
export { tag };
