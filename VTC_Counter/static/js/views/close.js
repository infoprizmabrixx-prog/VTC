// Day close: opening cash + cash sales = what should be in the drawer. Count it, close the day, the day is saved to the folder.
import { api } from "../api.js";
import { refresh } from "../app.js";
import { confirmBox, dialog, fail, field, h, rupee, table, tag, toast, when } from "../ui.js";

export async function show(root, S) {
  const d = await api("/day-close"), x = d.today, k = d.closed;
  const nums = `<div class="kv"><span>Bills today</span><b>${x.bills}${x.cancelled ? ` <span class="tiny">(${x.cancelled} cancelled, not counted)</span>` : ""}</b></div>
    <div class="kv"><span>Total billed</span><b>${rupee(x.total_paise)}</b></div><div class="divider"></div>
    <div class="kv"><span>Opening cash</span><b>${x.opening_paise == null ? "Not set" : rupee(x.opening_paise)}</b></div>
    <div class="kv"><span>+ Cash sales (counter + clients paid now)</span><b>${rupee(x.by_method.CASH)}</b></div>
    ${x.collected.CASH ? `<div class="kv"><span>+ Cash collected from client dues</span><b>${rupee(x.collected.CASH)}</b></div>` : ""}
    <div class="kv total"><span>Cash that should be in the drawer</span><b>${x.expected_paise == null ? "—" : rupee(x.expected_paise)}</b></div>
    <div class="kv"><span>UPI ${rupee(x.by_method.UPI)} · Card ${rupee(x.by_method.CARD)}${x.collected.UPI + x.collected.BANK + x.collected.CHEQUE ? ` · dues by UPI/bank/cheque ${rupee(x.collected.UPI + x.collected.BANK + x.collected.CHEQUE)}` : ""}</span><span class="tiny">not in the drawer</span></div>
    ${x.credit_paise ? `<div class="kv"><span>Given on credit to clients today</span><b class="neg">${rupee(x.credit_paise)}</b></div>` : ""}`;
  const saveLine = d.save ? `<p class="hint mt">Saved to ${h(d.save.folder)} · ${when(d.save.saved_at)}</p>` : "";
  const left = k ? `<section class="card span5"><h3>Today is closed · ${h(d.day)}</h3>${nums}
      <div class="kv"><span>Cash counted</span><b>${rupee(k.counted_paise)}</b></div>
      <div class="kv"><span>Difference</span><b class="${k.difference_paise ? "neg" : ""}">${k.difference_paise ? (k.difference_paise > 0 ? "+" : "−") + rupee(Math.abs(k.difference_paise)) : "None"}</b></div>
      ${k.note ? `<p class="tiny">Note: ${h(k.note)}</p>` : ""}${saveLine}
      ${S.boss ? `<button class="btn btn-danger mt" data-reopen="${k.id}">Reopen today</button>` : ""}</section>`
    : `<section class="card span5"><h3>Close today · ${h(d.day)}</h3>${nums}
      ${d.pending_cancels ? `<div class="hint warn mt">${d.pending_cancels} cancel request${d.pending_cancels > 1 ? "s" : ""} waiting. The owner/admin must decide ${d.pending_cancels > 1 ? "them" : "it"} in Today's bills first.</div>` : ""}
      ${x.expected_paise == null ? `<div class="hint warn mt">Opening cash isn't set. ${S.boss ? "Set it in Setup → Shop & saving." : "Ask the owner to set it."}</div>`
        : `<form class="mt" data-close>${field("counted", "Cash counted in the drawer (₹)", "number", 'required min="0" step="0.01" inputmode="decimal"')}
          <div class="field"><label for="f_note">Note (needed if the cash doesn't match)</label><textarea id="f_note" name="note" rows="2" maxlength="200"></textarea></div>
          <button class="btn btn-primary btn-big btn-block" ${d.pending_cancels ? "disabled" : ""}>Close today</button></form>`}
      <p class="tiny">Closing stops billing for today and saves the day to the owner's folder.</p></section>`;
  const hist = S.boss ? `<section class="card span7"><h3>Closed days</h3>${table(["Day", "Expected", "Counted", "Difference", "Closed by", "State", ""], d.history.map((c) =>
    `<tr><td><b>${h(c.day)}</b></td><td>${rupee(c.expected_paise)}</td><td>${rupee(c.counted_paise)}</td>
     <td><b class="${c.difference_paise ? "neg" : ""}">${c.difference_paise ? (c.difference_paise > 0 ? "+" : "−") + rupee(Math.abs(c.difference_paise)) : "—"}</b>${c.note ? `<br><span class="tiny">${h(c.note)}</span>` : ""}</td>
     <td>${h(c.closed_by_name)}</td><td>${tag(c.state)}${c.seen_by_name ? `<br><span class="tiny">seen by ${h(c.seen_by_name)}</span>` : ""}${c.reopen_reason ? `<br><span class="tiny">${h(c.reopened_by_name)}: ${h(c.reopen_reason)}</span>` : ""}</td>
     <td>${c.state === "DIFFERENCE" && !c.seen_by ? `<button class="btn btn-small" data-seen="${c.id}">Mark seen</button>` : ""}</td></tr>`), "No closed days yet.")}</section>` : "";
  root.innerHTML = `<div class="grid">${left}${hist}</div>`;

  root.onsubmit = async (e) => {
    if (!e.target.matches("[data-close]")) return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const counted = Math.round(Number(f.counted) * 100), diff = counted - x.expected_paise;
    if (diff && !(await confirmBox("Cash doesn't match", `Should be ${rupee(x.expected_paise)}, counted ${rupee(counted)} (${diff > 0 ? "+" : "−"}${rupee(Math.abs(diff))}). The owner will see this difference.`, "Close anyway"))) return;
    try {
      const r = await api("/day-close", "POST", { counted_paise: counted, note: f.note });
      toast(r.save.ok ? `Day closed and saved to ${r.save.folder}` : "Day closed. Saving to the folder failed — the owner should check Setup → Shop & saving.", !r.save.ok);
      refresh();
    } catch (err) { fail(err); }
  };
  root.onclick = async (e) => {
    const b = e.target.closest("[data-reopen],[data-seen]");
    if (!b) return;
    if (b.dataset.reopen) {
      const r = await dialog({ title: "Reopen today?", submit: "Reopen", danger: true,
        body: `<p class="hint warn">The closed count stays in history marked reopened. Close the day again before leaving.</p>
          <div class="field"><label for="f_reason">Reason</label><textarea id="f_reason" name="reason" required minlength="5" rows="2"></textarea></div>` });
      if (!r) return;
      try { await api(`/day-close/${b.dataset.reopen}/reopen`, "POST", r); toast("Today reopened."); refresh(); } catch (err) { fail(err); }
    }
    if (b.dataset.seen) {
      const r = await dialog({ title: "Mark the difference as seen", submit: "Save", body: `<div class="field"><label for="f_note">Note (optional)</label><input id="f_note" name="note" maxlength="200"/></div>` });
      if (!r) return;
      try { await api(`/day-close/${b.dataset.seen}/seen`, "POST", r); refresh(); } catch (err) { fail(err); }
    }
  };
}
