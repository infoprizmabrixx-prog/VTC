import { enterDialog } from "./fx.js";
import { attachHelp } from "./help.js";
// Small building blocks for screens. Everything user-supplied goes through h().

import { errorText, t } from "./i18n.js";

export const $ = (id: string): any => document.getElementById(id);

export const h = (x: any): string =>
  String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));

export const num = (v: any, digits = 2): string => Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: digits });

export const when = (s: any): string =>
  s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

export const initials = (name: any): string =>
  String(name || "?").replace(/\(.*?\)/g, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

let toastTimer: any;
export function toast(msg: string, bad = false) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = bad ? "show error" : "show";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), bad ? 6000 : 3500);
}
export const fail = (err: any) => toast(errorText(err?.code || err?.message || err), true);

const GOOD = ["RELEASED", "ACTIVE", "MATCHED", "PAID", "DONE", "active"];
const BAD = ["REJECTED", "QUARANTINE", "BLOCKED", "EXCEPTION", "revoked", "disabled", "locked"];
export function tag(v: any, label?: any): string {
  const cls = GOOD.includes(v) ? "good" : BAD.includes(v) ? "bad" : "hold";
  return `<span class="tag ${cls}">${h(label ?? String(v).replace(/_/g, " "))}</span>`;
}
export const chip = (text: any, cls = ""): string => `<span class="chip ${cls}">${h(text)}</span>`;

export function pageHead(eyebrow: any, title: any, subtitle = "", actions = ""): string {
  return `<div class="pagehead"><div><div class="eyebrow">${h(eyebrow)}</div><h1>${h(title)}</h1>${
    subtitle ? `<p class="sub">${h(subtitle)}</p>` : ""}</div><div class="row">${actions}</div></div>`;
}

export function table(headers: any[], rows: any[], emptyText?: string): string {
  if (!rows.length)
    return `<div class="empty"><b>${h(t("none"))}</b>${h(emptyText || "New records will appear here after the first entry.")}</div>`;
  return `<div class="tablebox"><table class="data"><thead><tr>${headers.map((x) => `<th>${h(x)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

export function field(name: string, label: string, type = "text", attrs = "", help = ""): string {
  return `<div class="field"><label for="f_${name}">${h(label)}</label><input id="f_${name}" name="${name}" type="${type}" ${attrs}/>${
    help ? `<small>${h(help)}</small>` : ""}</div>`;
}

export function select(name: string, label: string, options: any[], attrs = "", selected: any = ""): string {
  return `<div class="field"><label for="f_${name}">${h(label)}</label><select id="f_${name}" name="${name}" ${attrs}>${options
    .map(([v, l, extra = ""]) => `<option value="${h(v)}" ${String(v) === String(selected) ? "selected" : ""} ${extra}>${h(l)}</option>`)
    .join("")}</select></div>`;
}

export function check(name: string, label: string, checked = false, help = "", attrs = ""): string {
  return `<label class="check"><input type="checkbox" name="${name}" ${checked ? "checked" : ""} ${attrs}/><span><b>${h(label)}</b>${
    help ? `<small>${h(help)}</small>` : ""}</span></label>`;
}

export const formData = (form: HTMLFormElement): Record<string, any> => {
  const out: Record<string, any> = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll("input[type=checkbox][name]").forEach((c: any) => (out[c.name] = c.checked));
  return out;
};

// A modal form. Resolves with the form values, or null if cancelled.
// `body` is HTML for the fields; `onReady(dialog)` can wire extra behaviour.
export function dialog({ title, body, submit = "Save", danger = false, wide = false, onReady }: {
  title: any;
  body: any;
  submit?: string | null;
  danger?: boolean;
  wide?: boolean;
  onReady?: (d: any) => void;
}): Promise<any> {
  return new Promise<any>((resolve) => {
    const d = document.createElement("dialog") as any;
    d.className = "modal" + (wide ? " wide" : "");
    d.innerHTML = `<form method="dialog" class="modal-form"><header><h2>${h(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></header><div class="modal-body">${body}</div><footer><button type="button" class="btn" data-close>${submit ? "Cancel" : "Close"}</button>${
      submit ? `<button type="submit" class="btn ${danger ? "btn-danger-solid" : "btn-primary"}">${h(submit)}</button>` : ""}</footer></form>`;
    document.body.appendChild(d);
    const form = d.querySelector("form") as HTMLFormElement;
    const done = (v: any) => { d.close(); d.remove(); resolve(v); };
    d.querySelectorAll("[data-close]").forEach((b: any) => b.addEventListener("click", () => done(null)));
    d.addEventListener("cancel", (e: Event) => { e.preventDefault(); done(null); });
    form.addEventListener("submit", (e: Event) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      done(formData(form));
    });
    onReady?.(d);
    attachHelp(d);
    d.showModal();
    enterDialog(d);
    (d.querySelector("input:not([type=hidden]),select,textarea") as HTMLElement | null)?.focus();
  });
}

export async function confirmBox(title: any, message: any, submit = "Confirm", danger = false): Promise<boolean> {
  const r = await dialog({ title, body: `<p class="confirm-text">${message}</p>`, submit, danger });
  return r !== null;
}

// On phones, tables become stacked cards; each cell shows its column name.
export function labelTables(root: ParentNode = document) {
  root.querySelectorAll("table.data").forEach((tb) => {
    const heads = [...tb.querySelectorAll("thead th")].map((th) => th.textContent?.trim() || "");
    tb.querySelectorAll("tbody tr").forEach((tr) => [...tr.children].forEach((td, i) => heads[i] && td.setAttribute("data-label", heads[i])));
  });
}

// A button that jumps to another screen and tab, e.g. goto("admin", "prices", "Open Prices").
export const goto = (view: string, tab: string, label: string): string => ` <button type="button" class="btn btn-small" data-goto="${view}:${tab}">${h(label)} →</button>`;
