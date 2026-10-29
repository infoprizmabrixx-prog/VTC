// Team & Hierarchy. v1.3: who reports to whom and, for owner/admin, each person's details and
// documents (ID and bank numbers kept as the last 4 only). v1.5 (owner request 27 Oct 2026): the
// hierarchy is a top-down tree chart, and staff details also live in Admin Control (staffPage/staffClick).

import { api } from "../api.js";
import { icon } from "../icons.js";
import { S, can, nav } from "../state.js";
import { confirmBox, dialog, fail, field, h, initials, pageHead, select, table, toast, when } from "../ui.js";

const DOCS = [["AADHAAR", "Aadhaar"], ["PAN", "PAN card"], ["LICENCE", "Driving licence"], ["PHOTO", "Photo"], ["BANK", "Bank passbook / cheque"],
  ["CERTIFICATE", "Certificate"], ["CONTRACT", "Appointment letter / contract"], ["OTHER", "Other"]];
const DOC = Object.fromEntries(DOCS);
const TIER_CLR = { admin: "#805039", manager: "#2f6fd0", staff: "#1e8f6a" };
let zoom = null;   // tree zoom for this visit; null = fit the screen

export const team = {
  paths: () => (S.sub?.staff ? [`/team/${S.sub.staff}/profile`, "/team"] : ["/team"]),
  render() {
    if (S.sub?.staff) return pageHead("Work", "Team & Hierarchy", "Personal details and documents. Owner and admin only; every view is logged.") + staffPage(S.sub.staff);
    const people = S.data["/team"] || [], edit = can("team.hierarchy");
    return pageHead("Work", "Team & Hierarchy", edit ? "Who reports to whom. A person's boss gets their approvals, 'stuck' alerts and maintenance tickets first." : "Who reports to whom in the company.") +
      `<section class="card"><div class="toolbar"><h3 class="m0">Hierarchy</h3><div class="row tree-zoom" role="group" aria-label="Zoom">
          <button class="icon-btn" data-tzoom="-1" aria-label="Zoom out" title="Zoom out">${icon("zoom-out", 18)}</button>
          <button class="btn btn-small" data-tzoom="fit" title="Fit the whole chart on the screen">Fit</button>
          <button class="icon-btn" data-tzoom="1" aria-label="Zoom in" title="Zoom in">${icon("zoom-in", 18)}</button></div></div>
        ${edit ? `<p class="hint">Tap ${icon("network", 13)} on a person to change who they report to.${can("team.profiles") ? ` Tap ${icon("id-card", 13)} for their details and documents.` : ""}</p>` : ""}
        <div class="tree-wrap">${tree(people)}</div></section>` +
      (can("team.profiles") ? `<section class="card mt"><h3>Staff details</h3>${staffTable(people)}</section>` : "");
  },
  after: fitTree,
};

/** Top-down org chart: the company at the top when there is more than one top person. */
function tree(people) {
  const ids = new Set(people.map((p) => p.id)), edit = can("team.hierarchy"), seen = new Set();
  const kids = (id) => people.filter((p) => p.reports_to === id);
  const node = (p) => {
    if (seen.has(p.id)) return "";   // a loop in old data: show each person once
    seen.add(p.id);
    const k = kids(p.id).filter((x) => !seen.has(x.id));
    return `<li><div class="tnode ${p.id === S.me.user.id ? "me" : ""}" style="--tc:${TIER_CLR[p.tier] || "#6b7280"}">
        <span class="avatar">${h(initials(p.full_name))}</span><b>${h(p.full_name)}</b><span class="tiny">${h(p.designation || p.role_name)}${p.is_owner ? " · Owner" : ""}</span>
        ${k.length ? `<span class="tcount">${k.length} report${k.length > 1 ? "s" : ""}</span>` : ""}
        ${(edit && !p.is_owner) || mayOpen(p) ? `<span class="tacts">${edit && !p.is_owner ? `<button class="icon-btn" data-boss="${p.id}" aria-label="Change who ${h(p.full_name)} reports to" title="Change boss">${icon("network", 16)}</button>` : ""}${
          mayOpen(p) ? `<button class="icon-btn" data-staff="${p.id}" aria-label="Details of ${h(p.full_name)}" title="Details & documents">${icon("id-card", 16)}</button>` : ""}</span>` : ""}</div>
      ${k.length ? `<ul>${k.map(node).join("")}</ul>` : ""}</li>`;
  };
  const roots = people.filter((p) => !p.reports_to || !ids.has(p.reports_to));
  const top = roots.map(node).join("") + people.filter((p) => !seen.has(p.id)).map(node).join("");
  return `<div class="tree">${roots.length > 1
    ? `<ul><li><div class="tnode troot"><span class="avatar">${icon("coffee", 18)}</span><b>${h(S.me.settings.short_name)}</b><span class="tiny">Top of the company</span></div><ul>${top}</ul></li></ul>`
    : `<ul>${top}</ul>`}</div>`;
}

function fitTree() {
  const wrap = document.querySelector<HTMLElement>(".tree-wrap"), t = wrap?.querySelector<HTMLElement>(".tree") as any;
  if (!t || !wrap) return;
  t.style.zoom = 1;
  const fit = Math.max(0.45, Math.min(1, (wrap.clientWidth - 4) / t.scrollWidth));
  const z = (t.style.zoom = zoom ?? fit);
  if (z >= 1) wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2;   // centred when it fits
  const btn = (k: string) => document.querySelector<HTMLButtonElement>(`[data-tzoom="${k}"]`)!;   // nothing to do = greyed out
  if (btn("fit")) btn("fit").disabled = zoom === null;
  if (btn("-1")) btn("-1").disabled = z <= 0.4;
  if (btn("1")) btn("1").disabled = z >= 1.6;
}

// v1.5: admins equal the owner except over the owner account — the owner's record is the owner's own
export const mayOpen = (p) => can("team.profiles") && (!p.is_owner || S.me.user.is_owner);

export function staffTable(people) {
  const boss = (p) => people.find((x) => x.id === p.reports_to)?.full_name || "—";
  return `<p class="hint">${icon("lock", 14)} Owner and admin only. Every view is recorded in the audit log.</p>${table(["Person", "Role", "Reports to", ""], people.map((p) =>
    `<tr><td><b>${h(p.full_name)}</b>${p.designation ? `<br><span class="tiny">${h(p.designation)}</span>` : ""}</td><td>${h(p.role_name)}</td><td>${h(boss(p))}</td>
      <td>${mayOpen(p) ? `<button class="btn btn-small" data-staff="${p.id}">${icon("id-card", 14)} Details &amp; documents</button>` : `<span class="tiny">${icon("lock", 12)} Owner's own record</span>`}</td></tr>`))}`;
}

/** One person's details and documents (Team page, Admin Control → Staff details, and People → person). */
export function staffBody(uid) {
  const d = S.data[`/team/${uid}/profile`];
  if (!d) return "";
  const p = d.profile || {}, kv = (label, v) => `<div class="kv"><span>${label}</span><span>${v ? h(v) : "—"}</span></div>`;
  const masked = (v) => (v ? "•••• " + v : "");
  return `<div class="grid"><section class="card span6"><div class="row between"><h3 class="m0">${icon("id-card", 18)} Staff details</h3><button class="btn btn-small" data-profedit="${uid}">${icon("pencil", 14)} Edit details</button></div>
      ${kv("Job title", p.designation)}${kv("Phone", p.phone)}${kv("Other phone", p.alt_phone)}${kv("Email", p.email)}${kv("Address", p.address)}
      ${kv("Date of birth", p.dob)}${kv("Joined on", p.joined_on)}${kv("Emergency contact", [p.emergency_name, p.emergency_phone].filter(Boolean).join(" · "))}
      ${kv("Aadhaar", masked(p.aadhaar_last4))}${kv("PAN", masked(p.pan_last4))}${kv("Bank", [p.bank_name, masked(p.bank_last4), p.ifsc].filter(Boolean).join(" · "))}
      ${kv("Notes", p.notes)}<p class="tiny mt">${icon("lock", 12)} ID and bank numbers are saved as the last 4 only. The full number stays on the scanned document. Every view is logged.</p></section>
    <section class="card span6"><div class="row between"><h3 class="m0">${icon("file-text", 18)} Documents</h3><button class="btn btn-small btn-primary" data-docadd="${uid}">${icon("upload", 14)} Upload</button></div>
      ${table(["Document", "Added", ""], d.documents.map((x) => `<tr><td><b>${h(DOC[x.kind] || x.kind)}</b>${x.label ? `<br><span class="tiny">${h(x.label)}</span>` : ""}</td>
        <td class="nowrap">${when(x.created_at)}<br><span class="tiny">${h(x.uploaded_by_name)} · ${Math.round(x.bytes / 1024)} KB</span></td>
        <td class="nowrap"><a class="btn btn-small" href="/api/v1/team/documents/${x.id}" target="_blank" rel="noopener">${icon("eye", 14)} View</a> <button class="btn btn-small btn-quiet" data-docdel="${x.id}" aria-label="Remove">${icon("trash-2", 14)}</button></td></tr>`), "No documents yet.")}</section></div>`;
}

export function staffPage(uid) {
  const u = S.data[`/team/${uid}/profile`]?.user;
  if (!u) return '<div class="empty">Person not found.</div>';
  S.crumb = u.full_name;
  return `<button class="link-btn" data-staffback>← All staff</button><div class="person-head"><span class="avatar big">${h(initials(u.full_name))}</span><div><h2>${h(u.full_name)}</h2></div></div>${staffBody(uid)}`;
}

const reload = () => nav.go(S.view, S.sub);

/** Staff details buttons, wherever they appear. */
export async function staffClick(el) {
  const ds = el.dataset;
  if (ds.staff) return nav.go(S.view, { ...(S.sub || {}), staff: Number(ds.staff) }), true;
  if (el.hasAttribute("data-staffback")) return nav.go(S.view, { ...(S.sub || {}), staff: null }), true;
  if (ds.profedit) {
    const uid = Number(ds.profedit), p = S.data[`/team/${uid}/profile`].profile || {}, v = (k) => `value="${h(p[k] || "")}"`;
    const f = await dialog({ title: "Edit details", submit: "Save details", wide: true,
      body: `<div class="form-grid">${field("designation", "Job title", "text", `maxlength="60" ${v("designation")}`)}${field("joined_on", "Joined on", "date", v("joined_on"))}
        ${field("phone", "Phone", "tel", `maxlength="15" ${v("phone")}`)}${field("alt_phone", "Other phone", "tel", `maxlength="15" ${v("alt_phone")}`)}
        ${field("email", "Email", "email", `maxlength="120" ${v("email")}`)}${field("dob", "Date of birth", "date", v("dob"))}
        <div class="wide">${field("address", "Address", "text", `maxlength="300" ${v("address")}`)}</div>
        ${field("emergency_name", "Emergency contact name", "text", `maxlength="80" ${v("emergency_name")}`)}${field("emergency_phone", "Emergency contact phone", "tel", `maxlength="15" ${v("emergency_phone")}`)}
        ${field("aadhaar", "Aadhaar number", "text", `maxlength="14" inputmode="numeric" autocomplete="off" placeholder="${p.aadhaar_last4 ? "saved: •••• " + h(p.aadhaar_last4) : ""}"`, "Only the last 4 digits are saved")}
        ${field("pan", "PAN", "text", `maxlength="10" autocomplete="off" placeholder="${p.pan_last4 ? "saved: •••• " + h(p.pan_last4) : ""}"`, "Only the last 4 characters are saved")}
        ${field("bank_name", "Bank name", "text", `maxlength="60" ${v("bank_name")}`)}${field("bank_account", "Bank account number", "text", `maxlength="20" inputmode="numeric" autocomplete="off" placeholder="${p.bank_last4 ? "saved: •••• " + h(p.bank_last4) : ""}"`, "Only the last 4 digits are saved")}
        ${field("ifsc", "IFSC", "text", `maxlength="11" ${v("ifsc")}`)}<div class="wide">${field("notes", "Notes", "text", `maxlength="500" ${v("notes")}`)}</div></div>` });
    if (f) { try { await api(`/team/${uid}/profile`, "PUT", f); toast("Details saved."); await reload(); } catch (e) { fail(e); } }
    return true;
  }
  if (ds.docadd) {
    const f = await dialog({ title: "Upload a document", submit: "Upload",
      body: `${select("kind", "Which document", DOCS)}${field("label", "Note (optional)", "text", 'maxlength="80" placeholder="e.g. front and back"')}
        <div class="field"><label for="f_docfile">File (PDF or photo, up to 8 MB)</label><input id="f_docfile" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required/></div>` });
    const file = f?.file;
    if (f && file instanceof Blob) {
      if (file.size > 8e6) return toast("File is larger than 8 MB.", true), true;
      const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(file); });
      try { await api(`/team/${ds.docadd}/documents`, "POST", { kind: f.kind, label: f.label, mime: file.type, data: b64 }); toast("Document saved."); await reload(); } catch (e) { fail(e); }
    }
    return true;
  }
  if (ds.docdel) {
    if (!(await confirmBox("Remove this document?", "It disappears from this page. The removal is recorded in the audit log.", "Remove", true))) return true;
    try { await api(`/team/documents/${ds.docdel}`, "DELETE"); toast("Removed."); await reload(); } catch (e) { fail(e); }
    return true;
  }
  return false;
}

export async function teamClick(el: HTMLElement) {
  const ds = el.dataset;
  if (ds.tzoom) {
    const t = document.querySelector<HTMLElement>(".tree") as any, now = Number(t?.style.zoom) || 1;
    zoom = ds.tzoom === "fit" ? null : Math.max(0.4, Math.min(1.6, Math.round((now + Number(ds.tzoom) * 0.15) * 100) / 100));
    fitTree();
    return true;
  }
  if (ds.boss) {
    const people = S.data["/team"], p = people.find((x) => x.id === Number(ds.boss));
    const f = await dialog({ title: `${p.full_name} reports to…`, submit: "Save",
      body: `${select("reports_to", "Boss", [["", "Nobody (top of a branch)"], ...people.filter((x) => x.id !== p.id).map((x) => [x.id, `${x.full_name} · ${x.role_name}`])], "", p.reports_to || "")}
        <p class="hint">Their approvals, 'stuck' alerts and maintenance tickets go to this person first.</p>` });
    if (f) { try { await api(`/team/${p.id}/reports-to`, "PUT", { reports_to: f.reports_to ? Number(f.reports_to) : null }); toast("Hierarchy updated."); await nav.go("team", null); } catch (e) { fail(e); } }
    return true;
  }
  return staffClick(el);
}
