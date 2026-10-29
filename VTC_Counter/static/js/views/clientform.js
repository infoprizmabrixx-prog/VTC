// Add or edit a client (dealer, café, hotel, shop that buys from us).
import { api } from "../api.js";
import { dialog, fail, field, select, h, toast } from "../ui.js";

export async function clientDialog(cl = null, defaultType = "dealer") {
  const me = window.__vtcMe || {}, boss = me.role !== "cashier";
  const curType = cl?.client_type || defaultType;
  const curState = cl?.state_code || "36";
  const r = await dialog({ title: cl ? `Edit ${cl.name}` : "New Client", submit: cl ? "Save" : "Add Client",
    body: `
      <div class="form-grid">
        ${select("client_type", "Client Category", [["dealer", "Dealer (Raw beans, Roasted beans, Chicory)"], ["cafe", "Café (Blends & Café extras)"]], curType)}
        ${select("state_code", "Place of Supply", [["36", "Telangana (State code 36 — CGST + SGST)"], ["other", "Out of State (IGST Invoice)"]], curState === "36" ? "36" : "other")}
      </div>
      ${field("name", "Business name", "text", `required minlength="2" maxlength="60" value="${h(cl?.name || "")}" autocomplete="off"`)}
      <div class="form-grid">
        ${field("contact", "Contact person", "text", `maxlength="60" value="${h(cl?.contact || "")}" autocomplete="off"`)}
        ${field("phone", "Phone (for WhatsApp Desktop)", "tel", `maxlength="15" inputmode="tel" value="${h(cl?.phone || "")}" autocomplete="off"`)}
      </div>
      ${field("address", "Address", "text", `maxlength="200" value="${h(cl?.address || "")}" autocomplete="off"`)}
      <div class="form-grid">
        ${field("gstin", "GSTIN (optional)", "text", `maxlength="15" value="${h(cl?.gstin || "")}" autocapitalize="characters" autocomplete="off"`, "15 chars e.g. 36ABCDE1234F1Z5")}
        ${field("credit_limit", "Credit Limit (₹, optional)", "number", `min="0" step="1" value="${cl?.credit_limit_paise ? cl.credit_limit_paise / 100 : ""}"`, "Max credit allowed")}
      </div>
      <div class="form-grid">
        ${field("opening", "Old dues before this app (₹)", "number", `min="0" step="0.01" value="${cl?.opening_paise ? cl.opening_paise / 100 : ""}" ${cl && !boss ? "readonly" : ""}`, cl && !boss ? "Only owner/admin can change old dues" : "Starting outstanding balance")}
        ${field("opening_date", "Old dues as of", "date", `value="${h(cl?.opening_date || "")}" ${cl && !boss ? "readonly" : ""}`, "Date of oldest unpaid bill")}
      </div>` });
  if (!r) return null;
  const body = {
    name: r.name,
    contact: r.contact,
    phone: r.phone,
    address: r.address,
    gstin: r.gstin.trim().toUpperCase(),
    client_type: r.client_type,
    state_code: r.state_code === "other" ? "00" : "36",
    credit_limit_paise: r.credit_limit ? Math.round(Number(r.credit_limit) * 100) : null,
  };
  if (!cl || boss) Object.assign(body, { opening_paise: r.opening === "" ? 0 : Math.round(Number(r.opening) * 100), opening_date: r.opening_date || null });
  try {
    const res = await api(cl ? `/clients/${cl.id}` : "/clients", cl ? "PUT" : "POST", body);
    toast(cl ? "Client saved." : "Client added.");
    return cl ? cl.id : res.id;
  } catch (e) { fail(e); return null; }
}
