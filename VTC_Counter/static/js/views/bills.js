// Today's bills: view, reprint (marked DUPLICATE), ask to cancel; owner/admin decide cancellations.
import { api } from "../api.js";
import { refresh } from "../app.js";
import { requestPrint } from "../print.js";
import { receiptHtml, waLink } from "../receipt.js";
import { chip, dialog, fail, h, istToday, rupee, table, tag, time, toast } from "../ui.js";

let day = null;

export async function show(root, S) {
  const [data, C] = await Promise.all([api(`/bills${day ? "?day=" + day : ""}`), api("/counter")]);
  const isToday = data.day === istToday(), open = isToday && !data.closed;
  const pend = S.boss && data.pending_cancels.length ? `<section class="card mt-b"><h3>Cancel requests waiting for you</h3>${table(["Bill", "Amount", "Reason", "Asked by", ""],
    data.pending_cancels.map((x) => `<tr><td><b>${h(x.bill_no)}</b></td><td>${rupee(x.total_paise)}</td><td>${h(x.reason)}</td><td>${h(x.requested_by_name)}</td>
      <td class="nowrap"><button class="btn btn-small" data-decide="${x.id}:1">Cancel the bill</button> <button class="btn btn-small btn-quiet" data-decide="${x.id}:0">Keep the bill</button></td></tr>`))}</section>` : "";
  root.innerHTML = `${pend}
    <div class="toolbar"><div class="row">${chip(`${data.totals.bills} bills`)}${chip(`${rupee(data.totals.total_paise)} total`)}${data.closed ? chip("Day closed", "warn") : ""}</div>
      ${S.boss ? `<input type="date" class="search" value="${data.day}" max="${istToday()}" data-day aria-label="Day"/>` : `<span class="tiny">Today · ${data.day}</span>`}</div>
    <section class="card">${table(["Bill", "Time", "Cashier", "Paid by", "Total", "Status", ""], data.bills.map((b) =>
      `<tr class="${b.status === "CANCELLED" ? "muted" : ""}"><td><b>${h(b.bill_no)}</b>${b.customer_name || b.customer_phone ? `<br><span class="tiny">${h(b.customer_name)} ${h(b.customer_phone)}</span>` : ""}</td>
       <td>${time(b.created_at)}</td><td>${h(b.cashier)}</td><td>${h(b.methods || "")}</td><td><b>${rupee(b.total_paise)}</b>${b.discount_paise ? `<br><span class="tiny">disc. ${rupee(b.discount_paise)}</span>` : ""}</td>
       <td>${tag(b.status)}${b.due_paise ? `<br><span class="tiny neg">credit ${rupee(b.due_paise)}</span>` : ""}</td><td class="nowrap"><button class="btn btn-small" data-view="${b.id}">View / reprint</button>
       ${open && b.status === "PAID" ? ` <button class="btn btn-small btn-danger" data-cancel="${b.id}">${S.boss ? "Cancel" : "Ask to cancel"}</button>` : ""}</td></tr>`), "No bills on this day.")}</section>`;

  root.onchange = (e) => { if (e.target.matches("[data-day]")) { day = e.target.value || null; refresh(); } };
  root.onclick = async (e) => {
    const b = e.target.closest("[data-view],[data-cancel],[data-decide]");
    if (!b) return;
    if (b.dataset.view) return view(Number(b.dataset.view), C, S);
    if (b.dataset.cancel) {
      const r = await dialog({ title: S.boss ? "Cancel this bill?" : "Ask to cancel this bill", submit: S.boss ? "Cancel bill" : "Send to owner", danger: true,
        body: `<p class="hint">${S.boss ? "The bill stays in the records marked CANCELLED. Make a new correct bill if needed." : "The owner or admin must approve. The bill stays in the records."}</p>
          <div class="field"><label for="f_reason">Reason</label><textarea id="f_reason" name="reason" required minlength="5" maxlength="200" rows="2"></textarea></div>` });
      if (!r) return;
      try { const x = await api(`/bills/${b.dataset.cancel}/cancel`, "POST", { reason: r.reason }); toast(x.state === "CANCELLED" ? "Bill cancelled." : "Sent to the owner for approval."); refresh(); } catch (err) { fail(err); }
      return;
    }
    if (b.dataset.decide) {
      const [id, yes] = b.dataset.decide.split(":");
      const r = await dialog({ title: yes === "1" ? "Cancel the bill" : "Keep the bill", submit: yes === "1" ? "Cancel bill" : "Keep bill", danger: yes === "1",
        body: `<div class="field"><label for="f_note">Note (optional)</label><input id="f_note" name="note" maxlength="200"/></div>` });
      if (!r) return;
      try { await api(`/cancels/${id}/decide`, "POST", { approve: yes === "1", note: r.note }); toast(yes === "1" ? "Bill cancelled." : "Bill kept."); refresh(); } catch (err) { fail(err); }
    }
  };
}

async function view(id, C, S) {
  try {
    const b = await api(`/bills/${id}`);
    await dialog({ title: `Bill ${b.bill_no}`, submit: null,
      body: `<div class="receipt-preview">${receiptHtml(b, C.layout, { taxApproved: C.tax_approved })}</div>
        ${b.cancel ? `<p class="hint mt">${b.cancel.state === "REQUESTED" ? "Cancel asked" : b.cancel.state === "APPROVED" ? "Cancelled" : "Cancel refused"} · ${h(b.cancel.reason)} · by ${h(b.cancel.requested_by_name)}${b.cancel.decided_by_name ? `, decided by ${h(b.cancel.decided_by_name)}` : ""}</p>` : ""}
        ${b.lines.some((l) => l.list_rate_paise != null) ? `<p class="hint mt">Client price: ${b.lines.filter((l) => l.list_rate_paise != null).map((l) => `${h(l.item_name)} at ${rupee(l.rate_paise)}/kg (list ${rupee(l.list_rate_paise)})`).join("; ")}</p>` : ""}
        ${b.credit_reason ? `<p class="hint warn mt">Credit given despite old dues: ${h(b.credit_reason)}</p>` : ""}
        ${b.lines.some((l) => l.form === "custom") ? `<p class="hint warn mt">Typed at the counter: ${b.lines.filter((l) => l.form === "custom").map((l) => `${h(l.item_name)} ${rupee(l.amount_paise)} — added by <b>${h(l.added_by_name || "?")}</b>`).join("; ")}</p>` : ""}
        <p class="tiny mt">Reprints are marked DUPLICATE.</p>
        <div class="row"><button type="button" class="btn btn-primary" data-p="customer">🖨 Reprint</button><button type="button" class="btn" data-p="office">🖨 Office copy</button>
        ${(b.client?.phone || b.customer_phone) ? `<a class="btn wa" href="${waLink(b, C.layout, b.client?.phone || b.customer_phone)}">📲 WhatsApp Desktop Bill</a>` : ""}</div>`,
      onReady(d) { d.querySelectorAll("[data-p]").forEach((x) => x.addEventListener("click", () => { requestPrint(b.id, x.dataset.p); x.disabled = true; })); } });
  } catch (e) { fail(e); }
}
