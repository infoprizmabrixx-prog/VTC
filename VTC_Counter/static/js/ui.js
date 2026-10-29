// Small building blocks for the counter screens. Everything a person typed goes through h().

export const $ = (id) => document.getElementById(id);
export const h = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const rupee = (p) => (p == null ? "—" : (p < 0 ? "−" : "") + "₹" + (Math.abs(Number(p)) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const rs0 = (p) => (p == null ? "—" : "₹" + Math.round(Number(p) / 100).toLocaleString("en-IN"));
export const kg = (g) => (Number(g || 0) / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 }) + " kg";
export const grams = (g) => (g >= 1000 ? kg(g) : `${g} g`);
export const time = (s) => new Date(s).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
export const when = (s) => (s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
export const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
export const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

const ERRORS = {
  INVALID_CREDENTIALS: "That sign-in didn't match. Check the username and password.",
  WRONG_PIN: "That PIN is wrong.",
  CLIENT_NOT_FOUND: "That client wasn't found. Refresh and choose again.",
  CLIENT_NAME_2_TO_60_LETTERS: "Client name must be 2 to 60 letters.",
  GSTIN_LOOKS_WRONG: "That GSTIN doesn't look right (15 characters, e.g. 36ABCDE1234F1Z5).",
  OPENING_DATE_REQUIRED: "Give the date of the old dues.",
  PAID_MORE_THAN_BILL: "Paid now can't be more than the bill.",
  CLIENT_HAS_OLD_DUES: "This client has old dues. Write a reason to give more credit.",
  INVALID_OVERDUE_DAYS: "Days must be between 1 and 365.",
  CLIENT_AND_COUNTER_PREFIX_MUST_DIFFER: "Client bills and counter bills need different prefixes.",
  ALREADY_CANCELLED: "Already cancelled.",
  DAY_ALREADY_COUNTED: "That cash was already counted in a closed day.",
    CONFIRM_WITH_YOUR_PIN: "That's not your PIN/password. Items typed at the counter need your own PIN to show who added them.",
  ACCOUNT_LOCKED_TRY_LATER: "Too many wrong tries. Wait 10 minutes, or ask the owner to reset it.",
  LOGIN_REQUIRED: "Please sign in again.",
  NETWORK_DOWN: "Can't reach the counter PC. Check that it is on and the Wi-Fi is connected.",
  CHANGE_SECRET_FIRST: "Set your own password first.",
  CURRENT_SECRET_WRONG: "The current password/PIN is not correct.",
  CHOOSE_A_NEW_SECRET: "Choose a password different from the temporary one.",
  PASSWORD_TOO_WEAK: "Use at least 10 characters with letters and numbers.",
  PIN_MUST_BE_4_TO_6_DIGITS: "PIN must be 4 to 6 digits.",
  PIN_TOO_SIMPLE: "That PIN is too easy to guess (like 1111 or 1234). Choose another.",
  OWNER_OR_ADMIN_ONLY: "Only the owner or admin can do this.",
  DAY_CLOSED: "Today is closed. Selling opens again tomorrow, or the owner can reopen today.",
  ITEM_NOT_ON_SALE: "That item is not on this list (Sell or Clients) or is no longer on sale. Refresh the screen.",
  INVALID_WEIGHT: "Enter the weight in grams (1 to 100,000).",
  BEANS_NOT_SOLD_FOR_THIS_COFFEE: "This coffee has no beans price.",
  POWDER_NOT_SOLD_FOR_THIS_COFFEE: "This coffee has no powder price.",
  CHOOSE_BEANS_OR_POWDER: "Choose beans or powder.",
  INVALID_RATIO: "Coffee % must be a whole number from 1 to 100.",
  CHICORY_RATE_NOT_SET: "The chicory rate isn't set. The owner sets it in Setup → Prices & ratios.",
  DISCOUNTS_NOT_SET_UP: "Discounts aren't set up. The owner sets the limit in Setup → Prices & ratios.",
  DISCOUNT_ABOVE_LIMIT: "That discount is above the owner's limit.",
  DISCOUNT_REASON_REQUIRED: "Give a reason for the discount.",
  INVALID_PAYMENT_METHOD: "Choose cash, UPI or card.",
  PAYMENT_MUST_EQUAL_TOTAL: "The payments must add up exactly to the bill total.",
  PAYMENT_REQUIRED: "Add the payment.",
  BILL_NEEDS_ITEMS: "Add at least one item (up to 30).",
  PHONE_LOOKS_WRONG: "That phone number doesn't look right. Use 10 digits, or leave it empty.",
  REASON_REQUIRED: "Give a reason (at least 5 letters).",
  BILL_ALREADY_CANCELLED_OR_WAITING: "This bill is already cancelled or waiting for a decision.",
  ONLY_TODAYS_OPEN_BILLS_CAN_BE_CANCELLED: "Only today's bills can be cancelled, before the day is closed.",
  ALREADY_DECIDED: "Someone already decided this.",
  DECIDE_CANCEL_REQUESTS_FIRST: "Some cancel requests are waiting. The owner/admin must decide them before closing the day.",
  OPENING_CASH_NOT_SET: "Opening cash isn't set. The owner sets it in Setup → Shop & saving.",
  EXPLAIN_THE_DIFFERENCE: "The cash doesn't match. Write what happened (at least 5 letters).",
  DAY_ALREADY_CLOSED: "Today is already closed.",
  ONLY_TODAY_CAN_BE_REOPENED: "Only today can be reopened.",
  INVALID_DISCOUNT_CAP: "Discount limit must be between 0 and 50 %.",
  INVALID_GST_RATE: "GST must be between 0 and 28 %.",
  COFFEE_NEEDS_A_PRICE: "Give the coffee a beans price, a powder rate, or both.",
  NAME_2_TO_40_LETTERS: "Item name must be 2 to 40 letters.",
  BILL_NAME_2_TO_60_LETTERS: "Name on the bill must be 2 to 60 letters.",
  INVALID_AMOUNT: "Enter a valid amount.",
  INVALID_BILL_PREFIX: "Bill prefix: 1 to 8 letters or numbers.",
  ONLY_OWNER_ADDS_ADMINS: "Only the owner can add admins.",
  ONLY_OWNER_CHANGES_ADMINS: "Only the owner can change admins.",
  ONLY_THE_OWNER_CHANGES_THE_OWNER: "Only the owner can change the owner's account.",
  CANNOT_SWITCH_OFF_THIS_ACCOUNT: "This account can't be switched off.",
  USERNAME_3_TO_24: "Username: 3 to 24 small letters, numbers, dot, dash.",
  USERNAME_TAKEN: "That username is taken.",
  LOGO_MUST_BE_PNG_OR_JPG_UNDER_200KB: "Logo must be a PNG or JPG under 200 KB.",
  SHOP_NAME_REQUIRED: "The shop name can't be empty.",
  SAVE_FOLDER_NOT_SET: "No save folder yet. Set it in Setup → Shop & saving.",
  SAVE_FOLDER_NOT_WRITABLE: "Can't write to the save folder. Check the drive is connected and the folder exists.",
  SAVE_FAILED: "Saving failed. Check the save folder and the disk space.",
  INVALID_DATE: "Choose a valid date range.",
};
export const errorText = (code) => ERRORS[code] || `Something went wrong (${code}).`;

let toastTimer;
export function toast(msg, bad = false) {
  const el = $("toast");
  el.textContent = msg;
  el.className = bad ? "show error" : "show";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), bad ? 6000 : 3500);
}
export const fail = (e) => toast(errorText(e?.code || e?.message || e), true);

export const chip = (text, cls = "") => `<span class="chip ${cls}">${h(text)}</span>`;
export function tag(state) {
  const cls = { PAID: "good", BALANCED: "good", APPROVED: "good", CANCELLED: "bad", REJECTED: "bad", DIFFERENCE: "bad" }[state] || "hold";
  return `<span class="tag ${cls}">${h(String(state).replace(/_/g, " "))}</span>`;
}
export function table(heads, rows, empty = "Nothing here yet.") {
  if (!rows.length) return `<div class="empty">${h(empty)}</div>`;
  return `<div class="tablebox"><table class="data"><thead><tr>${heads.map((x) => `<th>${h(x)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
export const field = (name, label, type = "text", attrs = "", help = "") =>
  `<div class="field"><label for="f_${name}">${h(label)}</label><input id="f_${name}" name="${name}" type="${type}" ${attrs}/>${help ? `<small>${h(help)}</small>` : ""}</div>`;
export const select = (name, label, options, selected = "", attrs = "") =>
  `<div class="field"><label for="f_${name}">${h(label)}</label><select id="f_${name}" name="${name}" ${attrs}>${options
    .map(([v, l]) => `<option value="${h(v)}" ${String(v) === String(selected) ? "selected" : ""}>${h(l)}</option>`).join("")}</select></div>`;
export const check = (name, label, checked, help = "") =>
  `<label class="check"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}/><span><b>${h(label)}</b>${help ? `<small>${h(help)}</small>` : ""}</span></label>`;

export const formData = (form) => {
  const out = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll("input[type=checkbox][name]").forEach((c) => (out[c.name] = c.checked));
  return out;
};

// A modal form. Resolves with the values, or null if cancelled. submit=null makes an information box.
export function dialog({ title, body, submit = "Save", danger = false, wide = false, onReady, extra = "" }) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "modal" + (wide ? " wide" : "");
    d.innerHTML = `<form method="dialog" class="modal-form"><header><h2>${h(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></header>
      <div class="modal-body">${body}</div><footer>${extra}<button type="button" class="btn" data-close>${submit ? "Cancel" : "Close"}</button>${
      submit ? `<button type="submit" class="btn ${danger ? "btn-danger-solid" : "btn-primary"}">${h(submit)}</button>` : ""}</footer></form>`;
    document.body.appendChild(d);
    const form = d.querySelector("form");
    const done = (v) => { d.close(); d.remove(); resolve(v); };
    d.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => done(null)));
    d.addEventListener("cancel", (e) => { e.preventDefault(); done(null); });
    form.addEventListener("submit", (e) => { e.preventDefault(); if (form.reportValidity()) done(formData(form)); });
    d.close$ = done;
    onReady?.(d);
    d.showModal();
    d.querySelector("input:not([type=hidden]):not([type=checkbox]),select,textarea")?.focus();
  });
}

export async function confirmBox(title, text, submit = "Confirm", danger = false) {
  return !!(await dialog({ title, body: `<p>${h(text)}</p>`, submit, danger }));
}
