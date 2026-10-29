// Admin Control: People · Roles & permissions · Settings · Audit log.
// Only reachable with system.* permissions (Admin-level only); the server
// re-checks every action and enforces the guard rails.

import { api } from "../api.js";
import { BUILT_IN, LANG_NAMES, WORDING_KEYS, t } from "../i18n.js";
import { MODULES } from "../shell.js";
import { icon as svg } from "../icons.js";
import { S, can, nav } from "../state.js";
import { check, chip, confirmBox, dialog, fail, field, h, initials, pageHead, select, table, tag, toast, when } from "../ui.js";
import { CATALOGUE_TABS, catalogueClick, cataloguePaths, catalogueRender, customRatesSubmit } from "./catalogue.js";
import { goliveChange, goliveClick, golivePaths, goliveTab } from "./golive.js";
import { mayOpen, staffBody, staffClick, staffPage, staffTable } from "./team.js";

const TABS: [string, string, () => boolean][] = [
  ["people", "People", () => can("system.users") || can("system.grants") || can("system.preview_as")],
  ["staff", "Staff details", () => can("team.profiles")],   // v1.5: also inside each person under People
  ["roles", "Roles & permissions", () => can("system.roles")],
  ...CATALOGUE_TABS,
  ["settings", "Settings", () => can("system.settings")],
  ["golive", "Go-live setup", () => can("system.settings")],   // v1.6
  ["audit", "Audit log", () => can("system.audit")],
];
const TIER_LABEL = { admin: "Admin level", manager: "Manager level", staff: "Staff level" };
const KIND_LABEL = { view: "Open", action: "Do", field: "See data" };
const SOURCE_LABEL = { role: "From role", grant: "Extra access", deny: "Removed for this person", owner: "Owner", admin_role: "Admin role", ceiling: "Blocked: admin-only" };

let roleDraft = null; // { id, perms: Set }
let showPlanned = false; // planned-module permissions hidden unless asked
const shown = (x) => x.live || showPlanned;
const plannedToggle = () => `<label class="check small plan-toggle"><input type="checkbox" data-showplanned ${showPlanned ? "checked" : ""}/><span>Show planned permissions (modules not built yet)</span></label>`;

const sub = () => (S.sub ||= { tab: TABS.find(([, , ok]) => ok())?.[0] || "people" });
const tierChip = (tier) => chip(TIER_LABEL[tier], "tier-" + tier);
const catalog = () => S.data["/admin/catalog"];
const permLabel = (k) => catalog()?.permissions.find((p) => p.key === k)?.label || k;
const shortDate = (s) => new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// ------------------------------------------------------------------ loading
export const admin = {
  paths() {
    const s = sub();
    if (s.tab === "people") return ["/admin/users", "/admin/roles", "/admin/catalog", ...(s.person ? [`/admin/users/${s.person}/access`, "/teams", ...(can("system.users") ? [`/admin/users/${s.person}/teams`] : []),
      ...(mayOpen((S.data["/admin/users"] || []).find((x) => x.id === s.person) || { is_owner: 1 }) ? [`/team/${s.person}/profile`] : [])] : [])];
    if (s.tab === "golive") return golivePaths();
    if (s.tab === "staff") return ["/team", ...(s.staff ? [`/team/${s.staff}/profile`] : [])];
    if (s.tab === "roles") return ["/admin/roles", "/admin/catalog"];
    if (s.tab === "settings") return ["/admin/settings", "/admin/catalog", ...(can("qc.configure") ? ["/qc/config"] : [])];
    const cat = cataloguePaths(s.tab);
    if (cat) return cat;
    if (s.tab === "audit") return [`/admin/audit?category=${s.auditCat || ""}&q=${encodeURIComponent(s.auditQ || "")}`];
    return [];
  },
  render() {
    const s = sub();
    const tabs = `<div class="tabs" role="tablist">${TABS.filter(([, , ok]) => ok())
      .map(([k, label]) => `<button role="tab" class="tab ${s.tab === k ? "on" : ""}" data-tab="${k}" aria-selected="${s.tab === k}">${label}</button>`).join("")}</div>`;
    const body = cataloguePaths(s.tab) ? catalogueRender(s.tab)
      : { people: s.person ? personPage : peoplePage, staff: () => (s.staff ? staffPage(s.staff) : `<section class="card">${staffTable(S.data["/team"] || [])}</section>`),
        roles: rolesPage, settings: settingsPage, audit: auditPage, golive: goliveTab }[s.tab]();
    return pageHead(`${S.me.settings.short_name} / ADMIN CONTROL`, t("admin"),
      "People, access, clients, beans, roast profiles, prices and settings — one place. Every change is written to the audit log.") + tabs + body;
  },
};

// ------------------------------------------------------------------ people
function peoplePage() {
  const people = S.data["/admin/users"] || [];
  const active = people.filter((p) => p.active);
  const stats = [
    `${active.length} active`, `${active.filter((p) => p.tier === "admin").length} admin-level`,
    `${people.filter((p) => p.active_grants).length} with personal changes`, `${people.filter((p) => p.locked).length} locked`,
  ];
  return `<div class="toolbar"><div class="row">${stats.map((x) => chip(x)).join("")}</div>${
    can("system.users") ? '<button class="btn btn-primary" data-action="addPerson">+ Add person</button>' : ""}</div>
    <section class="card">${table(["Person", "Role", "Sign-in", "Status", "Personal changes", "Last sign-in", ""], people.map((p) =>
      `<tr class="${p.active ? "" : "muted"}"><td><div class="person"><span class="avatar">${h(initials(p.full_name))}</span><div><b>${h(p.full_name)}</b>${p.is_owner ? " " + chip("OWNER", "owner") : ""}<br><span class="tiny">@${h(p.username)}</span></div></div></td>
       <td>${h(p.role_name)}<br>${tierChip(p.tier)}</td><td>${p.login_type === "pin" ? "Name + PIN" : "Password"}</td>
       <td>${p.locked ? tag("locked", "Locked") : p.active ? tag("active", "Active") : tag("disabled", "Switched off")}</td>
       <td>${p.active_grants ? chip(p.active_grants + " active", "warn") : '<span class="tiny">—</span>'}</td>
       <td>${p.last_login ? when(p.last_login) : '<span class="tiny">Never</span>'}</td>
       <td><button class="btn btn-small" data-person="${p.id}">Manage →</button></td></tr>`))}</section>`;
}

function roleOptions(selected, filterTier) {
  const roles = (S.data["/admin/roles"] || []).filter((r) => r.active && (!filterTier || filterTier(r)));
  return roles.map((r) => [r.id, `${r.name} — ${TIER_LABEL[r.tier]}`, `data-tier="${r.tier}"`]);
}

async function addPerson() {
  const ownerOnly = () => true;   // v1.3: admins and the owner have equal power
  const r = await dialog({
    title: "Add a person", submit: "Add person",
    body: `${field("full_name", "Full name", "text", 'required minlength="2" maxlength="80"')}
      ${field("username", "Username", "text", 'required minlength="3" maxlength="30" pattern="[a-z0-9._\\-]+" autocapitalize="none"', "Small letters/numbers. Used for password sign-in and in the audit log.")}
      ${select("role_id", "Role", roleOptions(null, ownerOnly), "required")}
      <div class="field"><label>How will they sign in?</label><div class="seg" id="ltype">
        <label class="seg-btn"><input type="radio" name="login_type" value="pin" checked/> Tap name + PIN</label>
        <label class="seg-btn"><input type="radio" name="login_type" value="password"/> Password</label></div>
        <small id="ltypeHelp">PIN is for staff-level roles on shared tablets. Managers and admins use a password.</small></div>
      ${field("secret", "Starting PIN (4–6 digits)", "password", 'required autocomplete="new-password"')}
      <p class="hint">Share the starting PIN/password in person. Password users must change it at first sign-in.</p>`,
    onReady(d) {
      const roleSel = d.querySelector("[name=role_id]"), radios = d.querySelectorAll("[name=login_type]");
      const secretLabel = d.querySelector("label[for=f_secret]");
      const sync = () => {
        const tier = roleSel.selectedOptions[0]?.dataset.tier;
        const pinOk = tier === "staff";
        radios[0].disabled = !pinOk;
        if (!pinOk) radios[1].checked = true;
        const isPin = radios[0].checked;
        d.querySelectorAll("#ltype .seg-btn").forEach((l, i) => l.classList.toggle("on", radios[i].checked));
        secretLabel.textContent = isPin ? "Starting PIN (4–6 digits)" : "Starting password (10+ characters, letters and numbers)";
        d.querySelector("[name=secret]").inputMode = isPin ? "numeric" : "text";
      };
      roleSel.addEventListener("change", sync);
      radios.forEach((x) => x.addEventListener("change", sync));
      const staff = [...roleSel.options].find((o) => o.dataset.tier === "staff");
      if (staff) roleSel.value = staff.value;
      sync();
    },
  });
  if (!r) return;
  try {
    const x = await api("/admin/users", "POST", { ...r, role_id: Number(r.role_id) });
    toast(`${r.full_name} added.`);
    S.sub.person = x.id;
    await nav.go("admin", S.sub);
  } catch (e) { fail(e); }
}

function personPage() {
  const a = S.data[`/admin/users/${S.sub.person}/access`];
  const p = (S.data["/admin/users"] || []).find((x) => x.id === S.sub.person);
  if (!a || !p) return '<div class="empty">Person not found.</div>';
  S.crumb = p.full_name;
  const me = S.me.user;
  const protectedWhy = p.is_owner ? "The owner account is protected. Nobody can change its role or switch it off."
    : p.id === me.id ? "This is you. Your own access must be changed by another admin (or the owner)."
    : "";
  const locked = !!protectedWhy;
  const mayUsers = can("system.users") && !locked, mayGrant = can("system.grants") && !locked;
  const cat = catalog();
  const modules = MODULES.map(([k, icon]) => [k, icon]).filter(([k]) => cat.permissions.some((x) => x.module === k && shown(x)));
  const held = new Set(a.perms);
  const activeGrants = Object.fromEntries(a.grants.filter((g) => g.state === "active").map((g) => [g.perm_key, g]));
  const access = modules.map(([mod, icon]) => {
    const perms = cat.permissions.filter((x) => x.module === mod && shown(x));
    const count = perms.filter((x) => held.has(x.key)).length;
    const planned = perms.every((x) => !x.live);
    return `<details class="perm-group" ${count && !planned ? "open" : ""}><summary><span class="nav-symbol">${svg(icon, 16)}</span><b>${h(t(mod))}</b>${planned ? chip("planned", "planned") : ""}<span class="count">${count} of ${perms.length}</span></summary>${perms.map((x) => {
      const has = held.has(x.key), why = a.why[x.key], g = activeGrants[x.key];
      const src = why === "grant" && g ? `Extra access${g.expires_at ? " until " + shortDate(g.expires_at) : ""}` : why ? SOURCE_LABEL[why] : "";
      let action = "";
      if (mayGrant) {
        if (g) action = `<button class="btn btn-small" data-endgrant="${g.id}">End now</button>`;
        else if (has && why === "role") action = `<button class="btn btn-small btn-danger" data-grant="${x.key}:deny">Remove</button>`;
        else if (!has && !(x.admin_only && a.user.tier !== "admin")) action = `<button class="btn btn-small" data-grant="${x.key}:allow">Give</button>`;
      }
      return `<div class="perm-row ${has ? "has" : ""}"><span class="perm-state" aria-label="${has ? "Has access" : "No access"}">${has ? "✓" : "–"}</span>
        <span class="perm-label">${h(x.label)}<span class="perm-meta">${chip(KIND_LABEL[x.kind], "kind")}${x.risk !== "normal" ? chip(x.risk, "risk-" + x.risk) : ""}${!x.live ? chip("planned", "planned") : ""}${src ? chip(src, "src-" + why) : ""}</span></span>${action}</div>`;
    }).join("")}</details>`;
  }).join("");
  const history = a.grants.map((g) => `<tr><td>${when(g.created_at)}</td><td>${g.effect === "allow" ? "Gave" : "Removed"} · ${h(permLabel(g.perm_key))}</td><td>${g.expires_at ? when(g.expires_at) : "No end date"}</td><td>${h(g.reason)}</td><td>${h(g.granted_by_name)}</td><td>${tag(g.state, g.state)}</td></tr>`);
  return `<button class="link-btn" data-action="backPeople">← All people</button>
    <div class="person-head"><span class="avatar big">${h(initials(p.full_name))}</span><div><h2>${h(p.full_name)} ${p.is_owner ? chip("OWNER", "owner") : ""}</h2>
      <div class="row">${chip(p.role_name)}${tierChip(p.tier)}${p.active ? tag("active", "Active") : tag("disabled", "Switched off")}${p.locked ? tag("locked", "Locked") : ""}</div></div>
      ${can("system.preview_as") ? '<button class="btn" data-action="preview">👁 Preview what they see</button>' : ""}</div>
    ${protectedWhy ? `<div class="hint warn">🔒 ${h(protectedWhy)}</div>` : ""}
    <div class="grid mt"><section class="card span4"><h3>Profile & sign-in</h3>
      <div class="kv"><span>Username</span><b>@${h(p.username)}</b></div>
      <div class="kv"><span>Role</span><b>${h(p.role_name)}</b></div>
      <div class="kv"><span>Sign-in</span><b>${p.login_type === "pin" ? "Name + PIN" : "Password"}</b></div>
      <div class="kv"><span>Last sign-in</span><b>${p.last_login ? when(p.last_login) : "Never"}</b></div>
      <div class="kv"><span>Added</span><b>${when(p.created_at)}</b></div>
      ${mayUsers ? `<div class="stack mt">
        <button class="btn" data-action="changeRole">Change role</button>
        <button class="btn" data-action="resetSecret">Reset ${p.login_type === "pin" ? "PIN" : "password"}${p.locked ? " & unlock" : ""}</button>
        <button class="btn" data-action="rename">Rename</button>
        <button class="btn ${p.active ? "btn-danger" : ""}" data-action="toggleActive">${p.active ? "Switch off account" : "Switch account back on"}</button></div>` : ""}
      ${teamsCard(p)}
    </section>
    <section class="card span8"><div class="card-head"><h3>What ${h(p.full_name.split(" ")[0])} can open, do and see</h3><span class="tiny">${a.perms.length} permissions</span></div>
      ${plannedToggle()}<p class="sub">Role permissions plus personal changes. Use <b>Give</b> for extra access (optionally until a date) and <b>Remove</b> to take something away from just this person.</p>
      <div class="perm-list">${access}</div></section></div>
    <section class="card mt"><h3>Personal changes history</h3>${table(["When", "Change", "Until", "Reason", "By", "State"], history, "No personal changes yet — this person has exactly their role's access.")}</section>
    ${!can("team.profiles") ? "" : mayOpen(p) ? `<div class="mt">${staffBody(p.id)}</div>` : `<p class="hint mt">${svg("lock", 14)} The owner's staff details and documents are the owner's own.</p>`}`;
}

function teamsCard(p) {
  const teams = S.data["/teams"] || [], mine = S.data[`/admin/users/${p.id}/teams`];
  if (!mine) return "";
  return `<div class="divider"></div><h3>Team groups</h3><p class="tiny">Decides which team chats they are in and which team announcements reach them.</p>
    <form data-settings="teams" data-person="${p.id}">${teams.map((x) => check("team_" + x.id, x.name, mine.includes(x.id), "", `data-team="${x.id}"`)).join("")}
    <div class="form-actions"><button class="btn btn-small btn-primary">Save teams</button><button type="button" class="btn btn-small" data-action="newTeam">+ New team</button></div></form>`;
}

async function grantDialog(key, effect) {
  const p = (S.data["/admin/users"] || []).find((x) => x.id === S.sub.person);
  const allow = effect === "allow";
  const r = await dialog({
    title: allow ? `Give ${p.full_name.split(" ")[0]} extra access` : `Remove access for ${p.full_name.split(" ")[0]}`,
    submit: allow ? "Give access" : "Remove access", danger: !allow,
    body: `<div class="hint">${h(permLabel(key))}</div>
      ${select("until", "For how long?", [["", "No end date"], ["today", "Until end of today"], ["3", "3 days"], ["7", "1 week"], ["30", "30 days"], ["date", "Until a date I choose…"]])}
      <div class="field" id="untilDate" hidden><label for="f_date">End date</label><input id="f_date" name="date" type="date"/></div>
      <div class="field"><label for="f_reason">Reason (kept in the audit log)</label><textarea id="f_reason" name="reason" required minlength="5" rows="2" placeholder="${allow ? "e.g. Covering QC while manager is on leave" : "e.g. Works only at the counter"}"></textarea></div>`,
    onReady(d) {
      const s = d.querySelector("[name=until]"), box = d.querySelector("#untilDate"), date = d.querySelector("[name=date]");
      s.addEventListener("change", () => { box.hidden = s.value !== "date"; date.required = s.value === "date"; });
    },
  });
  if (!r) return;
  let expires = null;
  const end = new Date();
  if (r.until === "today") { end.setHours(23, 59, 0, 0); expires = end; }
  else if (["3", "7", "30"].includes(r.until)) { end.setDate(end.getDate() + Number(r.until)); end.setHours(23, 59, 0, 0); expires = end; }
  else if (r.until === "date") { expires = new Date(r.date + "T23:59:00"); }
  try {
    await api(`/admin/users/${S.sub.person}/grants`, "POST", { perm_key: key, effect, reason: r.reason, expires_at: expires ? expires.toISOString() : null });
    toast(allow ? "Access given. It works on their next click." : "Access removed for this person.");
    await nav.go("admin", S.sub);
  } catch (e) { fail(e); }
}

async function previewDialog() {
  try {
    const a = await api(`/admin/users/${S.sub.person}/preview`);
    const cat = catalog();
    const widgets = cat.widgets.filter((w) => a.widgets.includes(w.id));
    const hidden = cat.permissions.filter((x) => x.kind === "field" && x.live && !a.perms.includes(x.key));
    const actions = cat.permissions.filter((x) => x.kind === "action" && x.live && a.perms.includes(x.key));
    await dialog({
      title: `What ${a.user.full_name} sees`, submit: null, wide: true,
      body: `<div class="preview"><div class="preview-side"><div class="tiny upper">Their menu</div>${
        MODULES.filter(([k]) => a.modules.includes(k)).map(([k, icon]) => `<div class="preview-nav"><span>${svg(icon, 16)}</span>${h(t(k))}</div>`).join("")}</div>
        <div class="preview-main"><div class="tiny upper">Home screen cards they can use</div><div class="row">${widgets.map((w) => chip(w.title)).join("") || "—"}</div>
        <div class="tiny upper mt">They can</div><ul class="ticks">${actions.map((x) => `<li>${h(x.label)}</li>`).join("") || "<li>Only view</li>"}</ul>
        <div class="tiny upper mt">Hidden from them</div><ul class="crosses">${hidden.map((x) => `<li>${h(x.label)}</li>`).join("") || "<li>Nothing — they can see every sensitive field</li>"}</ul></div></div>
        <p class="tiny mt">Read-only preview. You are not signed in as them. This preview was written to the audit log.</p>`,
    });
  } catch (e) { fail(e); }
}

async function personAction(action) {
  const p = (S.data["/admin/users"] || []).find((x) => x.id === S.sub.person);
  const put = async (body, msg) => {
    try { await api(`/admin/users/${p.id}`, "PUT", body); toast(msg); await nav.go("admin", S.sub); } catch (e) { fail(e); }
  };
  if (action === "rename") {
    const r = await dialog({ title: "Rename", body: field("full_name", "Full name", "text", `required minlength="2" maxlength="80" value="${h(p.full_name)}"`) });
    if (r) await put(r, "Name updated.");
  } else if (action === "changeRole") {
    const ownerOnly = () => true;
    const r = await dialog({ title: `Change ${p.full_name}'s role`, submit: "Change role",
      body: `${select("role_id", "New role", roleOptions(null, ownerOnly), "", p.role_id)}<p class="hint">Their access changes on their next click. Personal changes (extra / removed access) stay.</p>` });
    if (r) await put({ role_id: Number(r.role_id) }, "Role changed.");
  } else if (action === "toggleActive") {
    if (p.active && !(await confirmBox("Switch off account?", `${h(p.full_name)} will be signed out on every device and can't sign in until switched back on. Their history stays.`, "Switch off", true))) return;
    await put({ active: !p.active }, p.active ? "Account switched off." : "Account switched back on.");
  } else if (action === "resetSecret") {
    const isPin = p.login_type === "pin";
    const r = await dialog({ title: `Reset ${isPin ? "PIN" : "password"} for ${p.full_name}`, submit: "Reset",
      body: `${field("secret", isPin ? "New PIN (4–6 digits)" : "Temporary password (10+ characters, letters and numbers)", "password", `required autocomplete="new-password" ${isPin ? 'inputmode="numeric"' : ""}`)}
        <p class="hint">They will be signed out everywhere${isPin ? "" : " and must choose their own password at next sign-in"}. Any lock is cleared.</p>` });
    if (!r) return;
    try { await api(`/admin/users/${p.id}/secret`, "POST", { secret: r.secret }); toast("Reset done."); await nav.go("admin", S.sub); } catch (e) { fail(e); }
  }
}

// ------------------------------------------------------------------ roles
function rolesPage() {
  const roles = S.data["/admin/roles"] || [];
  const s = sub();
  if (!s.role || !roles.some((r) => r.id === s.role)) s.role = (roles.find((r) => r.key === "manager") || roles[0])?.id;
  const role = roles.find((r) => r.id === s.role);
  if (!roleDraft || roleDraft.id !== role.id) roleDraft = { id: role.id, perms: new Set(role.permissions) };
  const list = roles.map((r) => `<button class="role-card ${r.id === role.id ? "on" : ""} ${r.active ? "" : "muted"}" data-role="${r.id}" ${r.id === role.id ? 'aria-current="true"' : ""}>
      <div class="row between"><b>${h(r.name)}</b>${r.locked ? "🔒" : ""}</div>
      <div class="row">${tierChip(r.tier)}${r.is_system ? "" : chip("custom")}${r.active ? "" : chip("off", "bad")}</div>
      <span class="tiny">${r.people} ${r.people === 1 ? "person" : "people"} · ${r.permissions.length} permissions</span></button>`).join("");
  const cat = catalog();
  const editable = !role.locked && (S.me.user.is_owner || role.id !== S.me.user.role_id);
  const nameable = can("system.roles");   // v1.3: any role, built-in too, can be renamed
  const lockReason = role.locked ? "The Admin role always has every permission so the business can never be locked out."
    : !editable ? "You can't change the access of the role you are in." : "";
  const modules = MODULES.filter(([k]) => cat.permissions.some((x) => x.module === k && shown(x)));
  const matrix = modules.map(([mod, icon]) => {
    const perms = cat.permissions.filter((x) => x.module === mod && shown(x));
    const on = perms.filter((x) => roleDraft.perms.has(x.key)).length;
    const planned = perms.every((x) => !x.live);
    const settable = perms.filter((x) => !(x.admin_only && role.tier !== "admin"));
    const allOn = settable.every((x) => roleDraft.perms.has(x.key)), noneOn = !perms.some((x) => roleDraft.perms.has(x.key));
    return `<details class="perm-group" ${!planned ? "open" : ""}><summary><span class="nav-symbol">${svg(icon, 16)}</span><b>${h(t(mod))}</b>${planned ? chip("planned module", "planned") : ""}<span class="count">${on} of ${perms.length}</span>${
      editable ? `<span class="group-btns"><button class="link-btn" data-all="${mod}:1" ${allOn ? "disabled" : ""}>All</button><button class="link-btn" data-all="${mod}:0" ${noneOn ? "disabled" : ""}>None</button></span>` : ""}</summary>${perms.map((x) => {
      const blocked = x.admin_only && role.tier !== "admin";
      const checked = role.locked || roleDraft.perms.has(x.key);
      return `<label class="perm-row ${checked ? "has" : ""} ${blocked ? "blocked" : ""}"><input type="checkbox" class="switch" data-perm="${x.key}" ${checked ? "checked" : ""} ${!editable || blocked ? "disabled" : ""}/>
        <span class="perm-label">${h(x.label)}<span class="perm-meta">${chip(KIND_LABEL[x.kind], "kind")}${x.risk !== "normal" ? chip(x.risk, "risk-" + x.risk) : ""}${!x.live ? chip("planned", "planned") : ""}${x.dpr ? `<span class="tiny">${x.dpr}</span>` : ""}${blocked ? chip("admin level only", "src-ceiling") : ""}</span></span></label>`;
    }).join("")}</details>`;
  }).join("");
  const original = new Set(role.permissions);
  const added = [...roleDraft.perms].filter((k) => !original.has(k)), removed = [...original].filter((k) => !roleDraft.perms.has(k));
  const dirty = added.length + removed.length;
  return `<div class="grid"><section class="span4 role-col"><div class="toolbar"><h3 class="m0">Roles</h3>${can("system.roles") ? '<button class="btn btn-small btn-primary" data-action="newRole">+ New role</button>' : ""}</div>
      <div class="role-list">${list}</div>
      <p class="hint mt"><b>Levels</b> set the ceiling: only Admin-level roles can ever hold Admin Control or approve master data. Staff-level roles get the guided screens and may use PIN sign-in.</p></section>
    <section class="card span8 role-editor"><div class="card-head"><div><h2 class="m0">${h(role.name)}</h2><div class="row mt-s">${tierChip(role.tier)}<span class="tiny">${role.people} ${role.people === 1 ? "person" : "people"} in this role</span></div></div>
      ${nameable || (!role.is_system && editable) ? `<div class="row">${nameable ? '<button class="btn btn-small" data-action="renameRole">Rename</button>' : ""}${!role.is_system && editable ? `<button class="btn btn-small ${role.active ? "btn-danger" : ""}" data-action="toggleRole">${role.active ? "Switch off" : "Switch on"}</button>` : ""}</div>` : ""}</div>
      <p class="sub">${h(role.description || "No description.")}${nameable ? ' <button class="link-btn" data-action="describeRole">Edit</button>' : ""}</p>
      ${lockReason ? `<div class="hint warn">🔒 ${h(lockReason)}</div>` : ""}
      <div class="legend">${chip("Open", "kind")} can open the screen · ${chip("Do", "kind")} can take the action · ${chip("See data", "kind")} can see that sensitive information · ${chip("planned", "planned")} saved now, works when the module is built</div>${plannedToggle()}
      <div class="perm-list">${matrix}</div>
      ${dirty ? `<div class="savebar"><span><b>${dirty} unsaved change${dirty > 1 ? "s" : ""}</b> · affects ${role.people} ${role.people === 1 ? "person" : "people"} on their next click</span><span class="row"><button class="btn" data-action="undoRole">Undo</button><button class="btn btn-primary" data-action="saveRole">Review & save</button></span></div>` : ""}
    </section></div>`;
}

async function saveRole() {
  const role = S.data["/admin/roles"].find((r) => r.id === roleDraft.id);
  const original = new Set(role.permissions);
  const added = [...roleDraft.perms].filter((k) => !original.has(k)), removed = [...original].filter((k) => !roleDraft.perms.has(k));
  const ok = await confirmBox(`Save changes to “${h(role.name)}”?`,
    `${added.length ? `<b>Adding</b><ul class="ticks">${added.map((k) => `<li>${h(permLabel(k))}</li>`).join("")}</ul>` : ""}${
      removed.length ? `<b>Removing</b><ul class="crosses">${removed.map((k) => `<li>${h(permLabel(k))}</li>`).join("")}</ul>` : ""}
    <p class="tiny">${role.people} ${role.people === 1 ? "person" : "people"} will get this on their next click.</p>`, "Save role");
  if (!ok) return;
  try {
    await api(`/admin/roles/${role.id}`, "PUT", { permissions: [...roleDraft.perms] });
    roleDraft = null;
    toast("Role saved.");
    await nav.go("admin", S.sub);
  } catch (e) { fail(e); }
}

async function newRole() {
  const roles = S.data["/admin/roles"] || [];
  const tiers = [["staff", "Staff level — guided screens, PIN allowed"], ["manager", "Manager level — team screens, password"],
    ["admin", "Admin level — can be given Admin Control"]];
  const r = await dialog({ title: "New role", submit: "Create role",
    body: `${field("name", "Role name", "text", 'required minlength="2" maxlength="40" placeholder="e.g. Packer, Counter cashier"')}
      ${select("tier", "Level", tiers)}
      ${select("copy_from", "Start with permissions from", [["", "Nothing (start empty)"], ...roles.filter((x) => x.active).map((x) => [x.id, x.name])])}
      <div class="field"><label>Description (optional)</label><textarea name="description" rows="2" maxlength="160"></textarea></div>` });
  if (!r) return;
  try {
    const x = await api("/admin/roles", "POST", { ...r, copy_from: r.copy_from ? Number(r.copy_from) : null });
    S.sub.role = x.id;
    roleDraft = null;
    toast("Role created. Now choose its permissions.");
    await nav.go("admin", S.sub);
  } catch (e) { fail(e); }
}

async function roleMeta(action) {
  const role = S.data["/admin/roles"].find((r) => r.id === roleDraft.id);
  let body = null;
  if (action === "renameRole") {
    const r = await dialog({ title: "Rename role", body: field("name", "Role name", "text", `required minlength="2" maxlength="40" value="${h(role.name)}"`) });
    if (r) body = r;
  } else if (action === "describeRole") {
    const r = await dialog({ title: "Role description", body: `<div class="field"><label>Description</label><textarea name="description" rows="3" maxlength="160">${h(role.description)}</textarea></div>` });
    if (r) body = r;
  } else if (action === "toggleRole") {
    body = { active: !role.active };
  }
  if (!body) return;
  try { await api(`/admin/roles/${role.id}`, "PUT", body); toast("Role updated."); await nav.go("admin", S.sub); } catch (e) { fail(e); }
}

// ------------------------------------------------------------------ settings
const ACCENT_COLORS = { roast: "#5d3826", espresso: "#2e1b12", copper: "#a0522d", forest: "#2f5d46", plum: "#5b3550" };

function settingsPage() {
  const data = S.data["/admin/settings"], st = data.settings, cat = catalog();
  const roles = data.dashboard_defaults;
  const s = sub();
  s.dashRole ||= roles[0]?.role_id;
  const dr = roles.find((r) => r.role_id === s.dashRole) || roles[0];
  const qc = S.data["/qc/config"];
  const overrides = {};
  data.i18n_overrides.forEach((o) => ((overrides[o.key] ||= {})[o.lang] = o.text));
  const q = (s.wordQ || "").toLowerCase();
  const words = WORDING_KEYS.filter((k) => !q || k.includes(q) || BUILT_IN.en[k].toLowerCase().includes(q));
  const shortcutModules = MODULES.map(([k]) => k).filter((k) => !["dashboard", "admin"].includes(k));
  return `<div class="grid">
    <section class="card span6"><h3>Branding</h3><form data-settings="branding">
      ${field("company_name", "Company name", "text", `required maxlength="60" value="${h(st.company_name)}"`)}
      <div class="form-grid">${field("short_name", "Short name (menu)", "text", `required maxlength="24" value="${h(st.short_name)}"`)}${field("tagline", "Line under the name", "text", `required maxlength="24" value="${h(st.tagline)}"`)}</div>
      ${field("location_label", "Location label", "text", `required maxlength="24" value="${h(st.location_label)}"`, "Shown under each person's name, e.g. PROD-01")}
      <div class="field"><label>Main colour</label><div class="swatches">${data.accents.map((a) =>
        `<label class="swatch" title="${a}"><input type="radio" name="accent" value="${a}" ${st.accent === a ? "checked" : ""}/><span style="background:${ACCENT_COLORS[a]}"></span>${a}</label>`).join("")}</div></div>
      <div class="form-actions"><button class="btn btn-primary">Save branding</button></div></form></section>

    <section class="card span6"><h3>Languages & auto sign-out</h3><form data-settings="general">
      <div class="tiny upper">Languages people can choose</div><div class="row gap-l">${Object.entries(LANG_NAMES).map(([k, n]) =>
        check("lang_" + k, n, st.languages_enabled.includes(k), "", k === "en" ? "disabled" : "")).join("")}</div>
      ${select("default_language", "Default language for new people", Object.entries(LANG_NAMES), "", st.default_language)}
      <div class="form-grid">${field("idle_shared_min", "Shared tablet: sign out after (minutes idle)", "number", `required min="2" max="60" value="${st.idle_shared_min}"`)}
        ${field("idle_personal_min", "Personal phone/PC: sign out after (minutes idle)", "number", `required min="15" max="720" value="${st.idle_personal_min}"`)}</div>
      <p class="hint">PIN sign-ins count as shared unless the person ticks “my own phone”. The server enforces these limits.</p>
      <div class="form-actions"><button class="btn btn-primary">Save</button></div></form></section>

    <section class="card span6"><h3>Home screen defaults</h3>
      <p class="sub">The starting layout for each role. People only ever see cards their access allows.</p>
      ${select("dash_role", "Role", roles.map((r) => [r.role_id, r.role_name]), 'data-dashrole', dr?.role_id)}
      <form data-settings="dashboard"><div class="two-col"><div><div class="tiny upper">Cards</div>${cat.widgets.map((w) =>
        check("w_" + w.id, w.title, dr.widgets.includes(w.id), "", `data-widget="${w.id}"`)).join("")}</div>
        <div><div class="tiny upper">Shortcuts (up to 7)</div>${shortcutModules.map((m) => check("s_" + m, t(m), dr.shortcuts.includes(m), "", `data-shortcut="${m}"`)).join("")}</div></div>
      <div class="form-actions"><button class="btn" name="mode" value="save">Save default</button><button class="btn btn-primary" name="mode" value="push">Save & apply to everyone in role</button></div></form></section>

    <section class="card span6"><h3>Rules & limits</h3>
      ${qc ? `<form data-settings="qc"><div class="tiny upper">Roast QC auto-release (O-13)</div>
        <div class="form-grid">${field("min_pct", "Approved minimum loss %", "number", `min="0" max="100" step="0.01" value="${h(qc.roast_loss_min_pct ?? "")}" required`)}${field("max_pct", "Approved maximum loss %", "number", `min="0" max="100" step="0.01" value="${h(qc.roast_loss_max_pct ?? "")}" required`)}</div>
        ${check("checks_approved", "These are ALL the checks needed for auto-release", qc.roast_checks_approved === "true", "Untick = every batch goes to quality hold")}
        <div class="form-actions"><button class="btn btn-primary">Save QC range</button><button class="btn" type="button" data-action="clearQC">Remove range</button></div></form>` : '<p class="tiny">QC range needs the “Set the approved roast-loss QC range” permission.</p>'}
      <div class="divider"></div><div class="tiny upper">Coming with their modules (values must come from you — none are invented)</div>
      <ul class="plain">${["Manager stock-correction limit (O-03)", "Customer credit limits & due days (O-08)", "Counter discount & refund caps (O-16/O-24)", "Packing weight tolerance (O-11/O-12)"].map((x) => `<li>${chip("planned", "planned")} ${x}</li>`).join("")}</ul></section>

    <section class="card span6"><h3>Messages</h3><form data-settings="messages">
      <div class="form-grid">${field("quiet_start_hour", "Quiet hours start (0–23)", "number", `min="0" max="23" required value="${st.quiet_start_hour}"`)}${field("quiet_end_hour", "Quiet hours end (0–23)", "number", `min="0" max="23" required value="${st.quiet_end_hour}"`)}</div>
      <p class="tiny">Inside quiet hours, normal alerts wait until morning. Critical ones still arrive. Same start and end = no quiet hours.</p>
      ${field("voice_retention_days", "Keep voice notes for (days)", "number", `min="7" max="3650" required value="${st.voice_retention_days}"`, "Text messages are kept with their work record.")}
      ${check("staff_can_message_admins", "Staff may message admins directly", st.staff_can_message_admins, "Off = staff reach their manager and their team groups only")}
      <div class="form-actions"><button class="btn btn-primary">Save</button></div></form></section>

    <section class="card span6"><h3>Business values</h3><p class="sub">Real, approved numbers only. Empty = that action stays blocked with “ask admin to set this”. Nothing is guessed.</p>
      <form data-settings="business">
      ${field("company_address", "Address on bills", "text", `maxlength="200" value="${h(st.company_address || "")}"`)}
      <div class="form-grid">${field("company_gstin", "GSTIN", "text", `maxlength="20" value="${h(st.company_gstin || "")}"`)}
        ${field("discount_cap_pct", "Counter discount cap (%)", "number", `min="0" max="50" step="0.01" value="${st.discount_cap_pct ?? ""}"`, "O-16 · empty = no discounts")}
        ${field("counter_opening_float_paise", "Counter opening cash (₹)", "number", `min="0" step="0.01" value="${st.counter_opening_float_paise != null ? st.counter_opening_float_paise / 100 : ""}"`)}
        ${field("refund_manager_cap_paise", "Manager refund limit (₹)", "number", `min="0" step="0.01" value="${st.refund_manager_cap_paise != null ? st.refund_manager_cap_paise / 100 : ""}"`, "O-24 · above this, admin only")}
        ${field("correction_manager_cap_kg", "Manager stock-correction limit (kg)", "number", `min="0" step="0.001" value="${st.correction_manager_cap_kg ?? ""}"`, "O-03 · above this, admin only")}
        ${field("roast_rest_days", "Roasted coffee rests (days)", "number", `required min="0" max="60" step="1" value="${st.roast_rest_days ?? 13}"`, "Labels show 'Ready from'; selling or dispatching earlier is warned. Low-stock levels are set per bean card in Inventory.")}
        ${field("bill_prefix", "Counter bill prefix", "text", `required maxlength="8" value="${h(st.bill_prefix)}"`)}${field("invoice_prefix", "Invoice prefix", "text", `required maxlength="8" value="${h(st.invoice_prefix)}"`)}</div>
      ${check("tax_setup_approved", "Accountant has approved GST/HSN/invoice setup (O-17)", st.tax_setup_approved, "Until ticked, invoices and bills print “Tax details pending accountant approval”")}
      <div class="form-actions"><button class="btn btn-primary">Save business values</button></div></form></section>

    <details class="card span12 wording" ${s.wordQ ? "open" : ""}><summary class="card-head"><h3 class="m0">Wording (English · తెలుగు · हिन्दी) <span class="tiny">${WORDING_KEYS.length} phrases · ${data.i18n_overrides.length} changed</span></h3><span class="link-btn">Show / hide</span></summary>
      <div class="row mt"><input class="search" type="search" placeholder="Search wording… (Enter)" value="${h(s.wordQ || "")}" data-wordsearch/></div>
      <p class="sub">Replace any built-in word with the one your staff actually use (DPR O-27 asks for staff-checked Telugu). Leave a box empty to use the built-in text. Saves when you leave the box.</p>
      ${table(["Key", "English", "తెలుగు", "हिन्दी"], words.map((k) => `<tr><td class="tiny">${k}</td>${["en", "te", "hi"].map((l) =>
        `<td><input class="word" data-word="${l}:${k}" value="${h(overrides[k]?.[l] || "")}" placeholder="${h(BUILT_IN[l][k] || "")}" ${st.languages_enabled.includes(l) ? "" : "disabled"}/></td>`).join("")}</tr>`))}
    </details></div>`;
}

async function settingsSubmit(form, submitter) {
  const kind = form.dataset.settings;
  if (kind === "custom") return customRatesSubmit(form);
  const fd = Object.fromEntries(new FormData(form).entries());
  try {
    if (kind === "branding") {
      await api("/admin/settings", "PUT", { company_name: fd.company_name, short_name: fd.short_name, tagline: fd.tagline, location_label: fd.location_label, accent: fd.accent });
    } else if (kind === "general") {
      const langs = ["en", ...["te", "hi"].filter((l) => form.querySelector(`[name=lang_${l}]`).checked)];
      await api("/admin/settings", "PUT", { languages_enabled: langs, default_language: fd.default_language, idle_shared_min: Number(fd.idle_shared_min), idle_personal_min: Number(fd.idle_personal_min) });
    } else if (kind === "dashboard") {
      const widgets = [...form.querySelectorAll("[data-widget]:checked")].map((x) => x.dataset.widget);
      const shortcuts = [...form.querySelectorAll("[data-shortcut]:checked")].map((x) => x.dataset.shortcut);
      if (shortcuts.length > 7) return toast("Choose up to 7 shortcuts.", true);
      const push = submitter?.value === "push";
      if (push && !(await confirmBox("Apply to everyone?", "Everyone in this role gets this layout now. Their personal layouts are replaced.", "Apply now"))) return;
      const r = await api(`/admin/dashboard-defaults/${sub().dashRole}`, "PUT", { widgets, shortcuts, apply_now: push });
      return toast(push ? `Applied to ${r.pushed} ${r.pushed === 1 ? "person" : "people"} with a personal layout (others already use the default).` : "Default saved for new people.");
    } else if (kind === "messages") {
      await api("/admin/settings", "PUT", { quiet_start_hour: Number(fd.quiet_start_hour), quiet_end_hour: Number(fd.quiet_end_hour),
        voice_retention_days: Number(fd.voice_retention_days), staff_can_message_admins: form.querySelector("[name=staff_can_message_admins]").checked });
    } else if (kind === "business") {
      const rupees = (v) => (v === "" ? null : Math.round(Number(v) * 100));
      const numOrNull = (v) => (v === "" ? null : Number(v));
      await api("/admin/settings", "PUT", { company_address: fd.company_address, company_gstin: fd.company_gstin, bill_prefix: fd.bill_prefix, invoice_prefix: fd.invoice_prefix,
        discount_cap_pct: numOrNull(fd.discount_cap_pct), counter_opening_float_paise: rupees(fd.counter_opening_float_paise),
        refund_manager_cap_paise: rupees(fd.refund_manager_cap_paise), correction_manager_cap_kg: numOrNull(fd.correction_manager_cap_kg),
        roast_rest_days: Number(fd.roast_rest_days), tax_setup_approved: form.querySelector("[name=tax_setup_approved]").checked });
    } else if (kind === "teams") {
      const ids = [...form.querySelectorAll("[data-team]:checked")].map((x) => Number(x.dataset.team));
      await api(`/admin/users/${form.dataset.person}/teams`, "PUT", { team_ids: ids });
      toast("Teams saved.");
      return nav.go("admin", S.sub);
    } else if (kind === "qc") {
      await api("/qc/config", "PUT", { min_pct: Number(fd.min_pct), max_pct: Number(fd.max_pct), checks_approved: !!form.querySelector("[name=checks_approved]").checked });
    }
    toast("Saved. Everyone sees it on their next click.");
    await nav.refreshMe();
    await nav.go("admin", S.sub);
  } catch (e) { fail(e); }
}

// ------------------------------------------------------------------ audit
const ACTION_TEXT = {
  LOGIN: "Signed in", LOGIN_FAILED: "Failed sign-in", USER_CREATED: "Added person", USER_UPDATED: "Changed person",
  USER_SECRET_RESET: "Reset PIN/password", OWN_SECRET_CHANGED: "Changed own PIN/password", ACCESS_GRANTED: "Gave access",
  ACCESS_REMOVED: "Removed access", ACCESS_OVERRIDE_ENDED: "Ended personal change", PREVIEW_AS: "Previewed access",
  ROLE_CREATED: "Created role", ROLE_UPDATED: "Changed role", SETTINGS_CHANGED: "Changed settings", WORDING_CHANGED: "Changed wording",
  DASHBOARD_DEFAULT_SET: "Set home screen default", DASHBOARD_EDIT: "Edited own home screen", ROAST_QC_CONFIG_CHANGED: "Set QC range",
  ROAST_QC_CONFIG_CLEARED: "Removed QC range", RECEIPT_POSTED: "Received bags", ROAST_COMPLETED: "Recorded roast", QC_DECISION: "QC decision",
  MASTER_CREATED: "Added master record", MASTER_APPROVED: "Approved master record", TASK_CREATED: "Assigned work", TASK_UPDATED: "Updated work",
  PACK_DRAFT_CREATED: "Created packing ticket", PACK_PROGRESS: "Updated packing", ORDER_DRAFT_CREATED: "Created order draft",
  RECEIPT_FINANCE_UPDATED: "Updated invoice/payment", QUARANTINE_VERIFIED: "Verified quarantined kg",
};

function auditPage() {
  const s = sub();
  const rows = S.data[`/admin/audit?category=${s.auditCat || ""}&q=${encodeURIComponent(s.auditQ || "")}`] || [];
  const f = (k, l) => `<button class="seg-btn ${(s.auditCat || "") === k ? "on" : ""}" data-auditcat="${k}" ${(s.auditCat || "") === k ? 'aria-pressed="true"' : 'aria-pressed="false"'}>${l}</button>`;
  return `<div class="toolbar"><div class="seg">${f("", "Everything")}${f("access", "Access & security")}${f("operations", "Operations")}</div>
      <input class="search" type="search" placeholder="Search person, action or detail… (Enter)" value="${h(s.auditQ || "")}" data-auditsearch/></div>
    <section class="card">${table(["When", "Who", "What", "Record", "Details"], rows.map((r) =>
      `<tr><td class="nowrap">${when(r.created_at)}</td><td>${h(r.person)}</td><td>${r.category === "access" ? chip("access", "kind") + " " : ""}${h(ACTION_TEXT[r.action] || r.action)}</td><td class="tiny">${h(r.subject)}</td><td>${h(r.info)}</td></tr>`), "No matching entries.")}
      <p class="tiny mt">Showing the latest 300 entries. Entries can't be edited or deleted.</p></section>`;
}

// ------------------------------------------------------------------ events
export async function adminClick(btn) {
  const ds = btn.dataset, s = sub();
  if (ds.tab) { S.sub = { tab: ds.tab }; roleDraft = null; return nav.go("admin", S.sub), true; }
  if (await staffClick(btn)) return true;
  if (s.tab === "golive" && (await goliveClick(btn))) return true;
  if (await catalogueClick(btn)) return true;
  if (ds.person) { s.person = Number(ds.person); return nav.go("admin", s), true; }
  if (ds.action === "backPeople") { s.person = null; return nav.go("admin", s), true; }
  if (ds.action === "addPerson") return addPerson(), true;
  if (ds.action === "newTeam") {
    const r = await dialog({ title: "New team group", submit: "Create", body: field("name", "Team name", "text", 'required minlength="2" maxlength="40"') });
    if (!r) return true;
    try { await api("/admin/teams", "POST", r); toast("Team created with its own group chat."); await nav.go("admin", s); } catch (e) { fail(e); }
    return true;
  }
  if (ds.action === "preview") return previewDialog(), true;
  if (["rename", "changeRole", "toggleActive", "resetSecret"].includes(ds.action)) return personAction(ds.action), true;
  if (ds.grant) { const [k, e] = ds.grant.split(":"); return grantDialog(k, e), true; }
  if (ds.endgrant) {
    if (!(await confirmBox("End this personal change now?", "The person goes back to their role's access for this permission.", "End now"))) return true;
    try { await api(`/admin/grants/${ds.endgrant}`, "DELETE"); toast("Ended."); await nav.go("admin", s); } catch (e) { fail(e); }
    return true;
  }
  if (ds.role) { s.role = Number(ds.role); roleDraft = null; return nav.rerender(), true; }
  if (ds.all) {
    const [mod, on] = ds.all.split(":"), role = S.data["/admin/roles"].find((r) => r.id === roleDraft.id);
    catalog().permissions.filter((x) => x.module === mod && shown(x) && !(x.admin_only && role.tier !== "admin")).forEach((x) =>
      on === "1" ? roleDraft.perms.add(x.key) : roleDraft.perms.delete(x.key));
    return nav.rerender(), true;
  }
  if (ds.action === "undoRole") { roleDraft = null; return nav.rerender(), true; }
  if (ds.action === "saveRole") return saveRole(), true;
  if (ds.action === "newRole") return newRole(), true;
  if (["renameRole", "describeRole", "toggleRole"].includes(ds.action)) return roleMeta(ds.action), true;
  if (ds.auditcat !== undefined) { s.auditCat = ds.auditcat; return nav.go("admin", s), true; }
  if (ds.action === "clearQC") {
    if (!(await confirmBox("Remove the QC range?", "Every new roast batch will go to quality hold until a range is set again.", "Remove", true))) return true;
    try { await api("/qc/config", "PUT", { clear: true }); toast("QC range removed."); await nav.go("admin", s); } catch (e) { fail(e); }
    return true;
  }
  return false;
}

export function adminChange(el) {
  if (goliveChange(el)) return true;
  if (el.hasAttribute("data-showplanned")) { showPlanned = el.checked; nav.rerender(); return true; }
  if (el.dataset.perm) {
    el.checked ? roleDraft.perms.add(el.dataset.perm) : roleDraft.perms.delete(el.dataset.perm);
    const y = window.scrollY;
    nav.rerender().then(() => window.scrollTo(0, y));
    return true;
  }
  if (el.hasAttribute("data-dashrole")) { sub().dashRole = Number(el.value); nav.rerender(); return true; }
  if (el.dataset.word) {
    const [lang, key] = el.dataset.word.split(":");
    api("/admin/i18n", "PUT", { lang, key, text: el.value })
      .then(async () => { toast(el.value ? "Wording saved." : "Built-in wording restored."); await nav.refreshMe(); })
      .catch(fail);
    return true;
  }
  return false;
}

export function adminKey(e) {
  const el = e.target;
  if (e.key === "Enter" && el.hasAttribute("data-auditsearch")) { sub().auditQ = el.value; nav.go("admin", S.sub); return true; }
  if (e.key === "Enter" && el.hasAttribute("data-wordsearch")) { sub().wordQ = el.value; nav.rerender(); return true; }
  return false;
}

export { settingsSubmit };
