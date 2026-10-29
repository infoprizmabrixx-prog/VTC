// v1.4: WhatsApp messages to customers through the free wa.me link — no paid API.
// The link opens WhatsApp on this phone/tablet with the message typed in; staff press Send,
// so it goes from whichever WhatsApp account is signed in on that device.
// The opening and closing lines are editable in Admin Control → Settings → Wording (wa… keys).

import { tl } from "./i18n.js";
import { S } from "./state.js";
import { toast } from "./ui.js";

const rupee = (p) => "₹" + (Number(p || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const day = (d) => new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const word = (key) => tl(key, "en").replaceAll("{company}", S.me.settings.company_name);

/** India-first: 10-digit mobiles get 91 in front; numbers already with a country code are kept. */
export function waNumber(phone) {
  let d = String(phone || "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10) d = "91" + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

export function openWhatsApp(phone, lines) {
  const n = waNumber(phone);
  if (!n) return toast("No valid mobile number saved for this customer.", true);
  window.open(`https://wa.me/${n}?text=${encodeURIComponent(lines.filter((x) => x != null).join("\n"))}`, "_blank", "noopener");
}

export const waBill = (b, phone) => openWhatsApp(phone, [
  word("waBillIntro"), "",
  `Bill ${b.bill_no} · ${day(b.created_at)}`,
  ...b.lines.map((l) => `${l.item_name} — ${Math.round(l.weight_kg * 1000)} g — ${rupee(l.amount_paise)}`),
  b.discount_paise ? `Discount −${rupee(b.discount_paise)}` : null,
  `*Total ${rupee(b.total_paise)}* (paid ${b.payments.map((p) => p.method).join(" + ")})`, "",
  word("waSign"),
]);

export const waOrder = (o) => openWhatsApp(o.customer_phone, [
  word("waOrderIntro"), "",
  `Order #${o.id}: ${o.item}`,
  `Quantity: ${o.quantity_kg} kg (${String(o.form || "").toLowerCase()})`,
  o.price_per_kg_paise ? `Price: ${rupee(o.price_per_kg_paise)}/kg${o.gst_rate_bp ? ` + GST ${o.gst_rate_bp / 100}%` : ""}` : null,
  o.credit_requested ? "Payment: on credit, as agreed" : "Payment: before dispatch",
  "", word("waSign"),
]);

export const waReminder = (i) => openWhatsApp(i.customer_phone, [
  word("waRemindIntro"), "",
  `${i.label || `Invoice ${i.number}`} · ${day(i.created_at)}`,
  `Amount due: *${rupee(i.due_paise)}*${i.due_date ? ` (due ${day(i.due_date)})` : ""}`,
  i.days_late ? `${i.days_late} day${i.days_late > 1 ? "s" : ""} overdue` : null,
  "Please share the UPI / bank reference once paid.", "",
  word("waSign"),
]);
