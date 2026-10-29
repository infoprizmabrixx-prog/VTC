// Maintenance tickets (v1.2): anyone with maintenance.raise reports a problem;
// maintenance.manage holders (manager, admin, owner) take it on and resolve it.

import { api } from "../api.js";
import { icon } from "../icons.js";
import { S, can, nav } from "../state.js";
import { chip, dialog, fail, field, h, pageHead, select, table, tag, toast, when } from "../ui.js";

const AREAS = [["ROASTER", "Roaster"], ["GRINDER", "Grinder"], ["PACKING_MACHINE", "Packing machine"], ["SCALE", "Weighing scale"], ["PRINTER", "Printer"],
  ["GAS", "Gas line / cylinder"], ["ELECTRICAL", "Electrical"], ["BUILDING", "Building"], ["VEHICLE", "Vehicle"], ["OTHER", "Other"]];
const AREA = Object.fromEntries(AREAS);
const STATE = { OPEN: "Open", IN_PROGRESS: "Being fixed", RESOLVED: "Fixed", CLOSED: "Closed" };
const URG = (u) => (u === "URGENT" ? tag("hold", "Urgent") : u === "LOW" ? chip("Low") : chip("Normal"));

export const maintenance = {
  paths: () => ["/maintenance"],
  render() {
    const all = S.data["/maintenance"], manage = can("maintenance.manage"), tab = S.sub?.tab === "done" ? "done" : "open";
    const open = all.filter((t) => ["OPEN", "IN_PROGRESS"].includes(t.status)), done = all.filter((t) => !["OPEN", "IN_PROGRESS"].includes(t.status));
    const list = tab === "done" ? done : open;
    return pageHead("Work", "Maintenance", manage ? "Problems with machines or the building. Take each one on, fix it and write what was done." : "Something broken or unsafe? Raise a ticket. The manager sees it at once.",
      can("maintenance.raise") ? `<button class="btn btn-primary" data-action="newTicket">${icon("wrench", 16)} Raise a ticket</button>` : "") +
      `<div class="tabs" role="tablist"><button role="tab" class="tab ${tab === "open" ? "on" : ""}" aria-selected="${tab === "open"}" data-mtab="open">Open (${open.length})</button>
        <button role="tab" class="tab ${tab === "done" ? "on" : ""}" aria-selected="${tab === "done"}" data-mtab="done">Fixed & closed (${done.length})</button></div>
      <section class="card">${table(["#", "Problem", "Where", "Urgency", "Raised", "Who is on it", "State", ""], list.map((t) =>
        `<tr><td>#${t.id}</td><td><b>${h(t.title)}</b>${t.details ? `<br><span class="tiny">${h(t.details)}</span>` : ""}${t.resolution ? `<br><span class="tiny">${icon("circle-check", 12)} ${h(t.resolution)}${t.resolved_by_name ? ` · ${h(t.resolved_by_name)}` : ""}</span>` : ""}</td>
          <td>${h(AREA[t.area] || t.area)}</td><td>${URG(t.urgency)}</td><td class="nowrap">${h(t.raised_by_name)}<br><span class="tiny">${when(t.created_at)}</span></td>
          <td>${h(t.assigned_name || "—")}</td><td>${tag(["RESOLVED", "CLOSED"].includes(t.status) ? "DONE" : t.status === "OPEN" && t.urgency === "URGENT" ? "BLOCKED" : "hold", STATE[t.status])}</td>
          <td class="nowrap">${manage ? `<button class="btn btn-small" data-mupdate="${t.id}">${t.status === "OPEN" ? "Take on" : "Update"}</button>` : ""}</td></tr>`),
        tab === "open" ? "Nothing open. All machines OK." : "No fixed tickets yet.")}</section>`;
  },
};

export async function maintenanceClick(el) {
  const ds = el.dataset;
  if (ds.mtab) return nav.go("maintenance", { tab: ds.mtab }), true;
  if (ds.action === "newTicket") {
    const f = await dialog({ title: "Raise a maintenance ticket", submit: "Raise ticket",
      body: `${field("title", "What is the problem?", "text", 'required minlength="3" maxlength="120" placeholder="e.g. Roaster drum making noise"')}
        <div class="form-grid">${select("area", "Where", AREAS)}${select("urgency", "How urgent", [["NORMAL", "Normal"], ["URGENT", "Urgent — work is stopped / unsafe"], ["LOW", "Low — can wait"]])}</div>
        <div class="field"><label for="f_mdetails">More details (optional)</label><textarea id="f_mdetails" name="details" maxlength="1000" rows="3"></textarea></div>` });
    if (!f) return true;
    try { await api("/maintenance", "POST", f); toast("Ticket raised. The manager is told."); await nav.go("maintenance"); } catch (e) { fail(e); }
    return true;
  }
  if (ds.mupdate) {
    const t = S.data["/maintenance"].find((x) => x.id === Number(ds.mupdate));
    let people = [];
    try { people = (await api("/tasks/options")).people; } catch { /* no assign right: keep current */ }
    const f = await dialog({ title: `Ticket #${t.id}: ${t.title}`, submit: "Save",
      body: `<div class="form-grid">${select("status", "State", Object.entries(STATE), "", t.status === "OPEN" ? "IN_PROGRESS" : t.status)}
        ${people.length ? select("assigned_to", "Who fixes it", [["", t.assigned_name || "Nobody yet"], ...people.map((p) => [p.id, p.full_name])]) : ""}</div>
        ${field("note", "What was done (needed when fixed/closed)", "text", 'maxlength="500"')}` });
    if (!f) return true;
    try { await api(`/maintenance/${t.id}`, "PUT", { status: f.status, note: f.note, assigned_to: f.assigned_to ? Number(f.assigned_to) : null }); toast("Saved."); await nav.go("maintenance", S.sub); } catch (e) { fail(e); }
    return true;
  }
  return false;
}
