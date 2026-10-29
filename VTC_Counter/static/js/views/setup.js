// Owner/admin set-up: items & blends, bill layout block editor, people & access, shop settings, printer, audit log.
import { api } from "../api.js";
import { refresh } from "../app.js";
import { isStation, printBill, setStation, startStation } from "../print.js";
import { receiptHtml, SAMPLE } from "../receipt.js";
import { check, chip, dialog, fail, field, select, formData, h, rupee, table, toast, when } from "../ui.js";

const TABS = [
  ["items", "Items & Blends"],
  ["layout", "Bill layout"],
  ["people", "People & Access"],
  ["shop", "Shop & Settings"],
  ["device", "Printer"],
  ["audit", "Audit log"]
];

let tab = "items", auditQ = "", printerInfo = null, itemFilter = "all";
const paise = (v) => (v === "" || v == null ? null : Math.round(Number(v) * 100));
const rs = (p) => (p == null ? "" : p / 100);

const GROUPS = [
  ["raw_beans", "Raw Beans (Green)", "#10b981"],
  ["roasted_beans", "Roasted Beans", "#78350f"],
  ["chicory", "Chicory", "#d97706"],
  ["blend", "Blends", "#6366f1"],
  ["tea", "Tea & CTC", "#059669"],
  ["other", "Other / Supplies", "#64748b"]
];

export async function show(root, S) {
  const d = await api("/setup");
  const extra = tab === "shop" ? await api("/saves")
    : tab === "audit" ? await api(`/audit?q=${encodeURIComponent(auditQ)}`)
    : tab === "device" || tab === "layout" ? await api("/printers") : null;

  const body = { items, layout, people, shop, device, audit }[tab](d, extra, S);
  printerInfo = tab === "device" || tab === "layout" ? extra : printerInfo;
  root.innerHTML = `<div class="tabs">${TABS.map(([k, l]) => `<button class="tab ${k === tab ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>${body}`;
  
  root.onclick = (e) => click(e, d, root, S);
  root.onsubmit = (e) => submit(e, d);
  root.oninput = (e) => {
    if (tab === "layout") layoutPreview(root, d);
    if (e.target.matches("[data-auditq]")) auditQ = e.target.value;
  };
  root.onchange = (e) => {
    if (e.target.matches("[data-logo]")) readLogo(e.target, root, d);
    if (tab === "layout") layoutPreview(root, d);
    if (e.target.matches("[data-auditq]")) refresh();
  };
  if (tab === "layout") layoutPreview(root, d);
}

// ------------------------------------------------------------------ Items & Blends
function items(d) {
  const filtered = itemFilter === "all" ? d.items : d.items.filter((i) => (i.item_group || "other") === itemFilter);
  return `
    <div class="seg-tabs">
      <button class="seg-tab-btn ${itemFilter === "all" ? "active" : ""}" data-ifilter="all">All Items (${d.items.length})</button>
      ${GROUPS.filter(([k]) => k !== "blend").map(([k, l]) => `
        <button class="seg-tab-btn ${itemFilter === k ? "active" : ""}" data-ifilter="${k}">
          ${l} (${d.items.filter((i) => (i.item_group || "other") === k).length})
        </button>`).join("")}
    </div>

    <section class="card">
      <div class="toolbar">
        <h3 class="m0">Item Catalog</h3>
        <button class="btn btn-primary btn-small" data-add="1">+ Add New Item</button>
      </div>
      <p class="tiny">Color-coded items help staff instantly distinguish Raw Beans, Roasted Beans, Chicory, and Extras.</p>
      ${table(["Category", "Item Name", "Bill Name", "Price ₹/kg", "GST", "HSN", ""], filtered.map((i) => {
        const grp = GROUPS.find(([k]) => k === i.item_group) || ["other", i.item_group || "Other", i.color_tag || "#64748b"];
        return `<tr class="${i.active ? "" : "muted"}">
          <td><span class="item-tag-badge" style="background:${grp[2]};">${h(grp[1])}</span></td>
          <td><b>${h(i.name)}</b>${i.active ? "" : " " + chip("hidden")}</td>
          <td>${h(i.bill_name)}</td>
          <td>${rupee(i.price_paise)}</td>
          <td>${i.gst_bp == null ? '<span class="tiny">not set</span>' : i.gst_bp / 100 + "%"}</td>
          <td>${h(i.hsn_code || "0901")}</td>
          <td class="nowrap">
            <button class="btn btn-small" data-edit="${i.id}">Edit</button>
            <button class="btn btn-small btn-quiet" data-toggle="${i.id}:${i.active ? 0 : 1}">${i.active ? "Hide" : "Show"}</button>
          </td>
        </tr>`;
      }), "No items found in this category.")}
    </section>

    <section class="card mt-b">
      <div class="toolbar">
        <h3 class="m0">Saved Blends (${d.blends?.length || 0})</h3>
      </div>
      ${table(["Blend Name", "Scope", "Base Price ₹/kg", "GST", "Components", ""], (d.blends || []).map((b) => `
        <tr class="${b.active ? "" : "muted"}">
          <td><b>${h(b.name)}</b></td>
          <td><span class="chip ${b.is_shared ? "" : "tea"}">${b.is_shared ? "Shared Blend" : "Café Blend"}</span></td>
          <td>${rupee(b.base_price_paise)}</td>
          <td>${b.gst_bp / 100}%</td>
          <td>${b.components?.map((c) => `${c.ratio_pct}% ${h(c.item_name)}`).join(", ") || "—"}</td>
          <td class="nowrap">
            <button class="btn btn-small btn-quiet" data-toggle-blend="${b.id}:${b.active ? 0 : 1}">${b.active ? "Hide" : "Show"}</button>
          </td>
        </tr>`), "No blends created yet.")}
    </section>
  `;
}

async function itemDialog(it = null) {
  const curGroup = it?.item_group || "roasted_beans";
  const curColor = it?.color_tag || "#78350f";
  const r = await dialog({
    title: it ? `Edit ${it.name}` : "Add Item",
    submit: it ? "Save" : "Add",
    body: `
      <div class="form-grid">
        ${select("item_group", "Category Group", GROUPS.filter(([k]) => k !== "blend").map(([k, l]) => [k, l]), curGroup)}
        ${field("hsn_code", "HSN Code", "text", `maxlength="10" value="${h(it?.hsn_code || "0901")}" placeholder="0901"`)}
      </div>
      ${field("name", "Item Name (displayed on buttons)", "text", `required minlength="2" maxlength="40" value="${h(it?.name || "")}"`)}
      ${field("bill_name", "Printed Name on Invoice", "text", `required minlength="2" maxlength="60" value="${h(it?.bill_name || "")}"`)}
      <div class="form-grid">
        ${field("price", "Selling Price ₹/kg", "number", `required min="0.01" step="0.01" value="${rs(it?.price_paise)}"`)}
        ${field("gst", "GST %", "number", `min="0" max="28" step="0.01" value="${it?.gst_bp == null ? "5" : it.gst_bp / 100}"`, "Inclusive GST rate")}
      </div>
      <div class="field">
        <label for="f_col">Button Badge Color</label>
        <input id="f_col" name="color_tag" type="color" value="${curColor}" style="height:40px; padding:2px; width:100px;"/>
      </div>
    `,
    onReady(d) {
      const n = d.querySelector("[name=name]"), bn = d.querySelector("[name=bill_name]");
      const grp = d.querySelector("[name=item_group]"), col = d.querySelector("[name=color_tag]");
      let touched = !!it;
      bn.addEventListener("input", () => (touched = true));
      n.addEventListener("input", () => { if (!touched) bn.value = n.value; });
      grp.addEventListener("change", () => {
        const found = GROUPS.find(([k]) => k === grp.value);
        if (found) col.value = found[2];
      });
    }
  });

  if (!r) return;
  const body = {
    name: r.name,
    bill_name: r.bill_name,
    price_paise: paise(r.price),
    gst_bp: r.gst === "" ? null : Math.round(Number(r.gst) * 100),
    item_group: r.item_group,
    color_tag: r.color_tag,
    hsn_code: r.hsn_code.trim(),
    mix_chicory: 0
  };
  try {
    await api(it ? `/items/${it.id}` : "/items", it ? "PUT" : "POST", body);
    toast(it ? "Item updated." : "Item added.");
    refresh();
  } catch (e) { fail(e); }
}

// ------------------------------------------------------------------ Bill Layout
const SWITCHES = [
  ["show_time", "Date and Time"],
  ["show_cashier", "Cashier Name"],
  ["show_customer_name", "Customer Name"],
  ["show_customer_phone", "Customer Phone"],
  ["highlight_customer", "Highlight Customer / Client Box (Bold)"],
  ["show_hsn", "Print HSN Codes on line items"],
  ["show_tax_split", "Show Detailed Tax Breakdown (Taxable + CGST + SGST / IGST)"],
  ["show_gst", "Show GST Totals"],
  ["show_payments", "Show PAID BY Settlement & Cash Tendered/Change"]
];

let logoDraft;
function layout(d) {
  const L = d.settings.layout;
  logoDraft = L.logo;
  return `
    <div class="grid">
      <section class="card span7">
        <h3>Bill Layout Customizer</h3>
        <form data-form="layout">
          <div class="form-grid">
            ${field("shop_name", "Shop Name (Header)", "text", `required maxlength="60" value="${h(L.shop_name)}"`)}
            ${field("phone", "Contact Phone", "text", `maxlength="40" value="${h(L.phone)}"`)}
            <div class="wide">${field("address", "Shop Address", "text", `maxlength="160" value="${h(L.address)}"`)}</div>
            ${field("gstin", "Shop GSTIN", "text", `maxlength="20" value="${h(L.gstin)}"`)}
            ${field("footer", "Footer Notice", "text", `maxlength="120" value="${h(L.footer)}"`)}
          </div>

          <div class="form-grid mt">
            <div class="field">
              <label>Thermal Logo</label>
              <input type="file" accept="image/png,image/jpeg" data-logo aria-label="Upload logo"/>
              ${L.logo ? '<button type="button" class="btn btn-small btn-quiet mt-s" data-nologo>Remove logo</button>' : ""}
            </div>
            ${select("logo_size", "Logo Display Size", [["small", "Small (Subtle)"], ["medium", "Medium (Standard)"], ["large", "Large (Prominent)"]], L.logo_size || "medium")}
          </div>

          <div class="tiny upper mt">Invoice Section Toggles</div>
          ${SWITCHES.map(([k, l]) => check(k, l, L[k] !== false)).join("")}

          <div class="row mt">
            <button class="btn btn-primary">Save Layout</button>
            <button type="button" class="btn" data-testprint>🖨 Print Test Receipt</button>
          </div>
        </form>
      </section>

      <section class="card span5">
        <h3>Live Preview</h3>
        <div class="receipt-preview" id="lp"></div>
      </section>
    </div>
  `;
}

function draftLayout(root, d) {
  const f = root.querySelector("[data-form=layout]");
  const v = formData(f);
  return {
    ...d.settings.layout,
    ...Object.fromEntries(["shop_name", "address", "phone", "gstin", "footer", "logo_size"].map((k) => [k, v[k]])),
    ...Object.fromEntries(SWITCHES.map(([k]) => [k, !!v[k]])),
    logo: logoDraft
  };
}

function layoutPreview(root, d) {
  const box = root.querySelector("#lp");
  if (box) box.innerHTML = receiptHtml(SAMPLE, draftLayout(root, d), { taxApproved: d.settings.tax_approved });
}

function readLogo(input, root, d) {
  const f = input.files[0];
  if (!f) return;
  if (!/^image\/(png|jpeg)$/.test(f.type) || f.size > 200 * 1024) {
    input.value = "";
    return toast("Logo must be under 200 KB.", true);
  }
  const rd = new FileReader();
  rd.onload = () => { logoDraft = rd.result; layoutPreview(root, d); };
  rd.readAsDataURL(f);
}

// ------------------------------------------------------------------ People & Access
function people(d, _x, S) {
  const owner = S.me.role === "owner";
  return `
    <section class="card">
      <div class="toolbar">
        <h3 class="m0">Users & Permission Switches</h3>
        <div class="row">
          <button class="btn btn-primary btn-small" data-person="cashier">+ Add Cashier</button>
          ${owner ? '<button class="btn btn-small" data-person="admin">+ Add Admin</button>' : ""}
        </div>
      </div>
      <p class="tiny">Owner can control whether each cashier/admin can view debt ledgers ("Who owes") or manage the client directory.</p>
      ${table(["Name", "Role", "Who Owes Access", "Client Dir Access", "State", ""], d.people.map((p) => {
        const mine = p.id === S.me.id;
        const canTouch = (p.role === "cashier" || owner) && !mine;
        return `
          <tr class="${p.active ? "" : "muted"}">
            <td><b>${h(p.full_name)}</b>${mine ? " " + chip("you") : ""}</td>
            <td>${h(p.role.toUpperCase())}</td>
            <td>
              ${p.role === "owner" ? chip("Full", "good") : `
                <button class="btn btn-small ${p.can_view_dues ? "btn-primary" : "btn-quiet"}" 
                  ${owner ? `data-toggle-dues="${p.id}:${p.can_view_dues ? 0 : 1}"` : "disabled"}>
                  ${p.can_view_dues ? "✓ Enabled" : "✕ Disabled"}
                </button>
              `}
            </td>
            <td>
              ${p.role === "owner" ? chip("Full", "good") : `
                <button class="btn btn-small ${p.can_manage_clients ? "btn-primary" : "btn-quiet"}" 
                  ${owner ? `data-toggle-clients="${p.id}:${p.can_manage_clients ? 0 : 1}"` : "disabled"}>
                  ${p.can_manage_clients ? "✓ Enabled" : "✕ Disabled"}
                </button>
              `}
            </td>
            <td>${p.active ? "Active" : "Disabled"}</td>
            <td class="nowrap">
              ${canTouch || mine ? `<button class="btn btn-small" data-reset="${p.id}:${p.login}">Reset ${p.login === "pin" ? "PIN" : "Password"}</button>` : ""}
              ${canTouch ? ` <button class="btn btn-small btn-quiet" data-active="${p.id}:${p.active ? 0 : 1}">${p.active ? "Deactivate" : "Activate"}</button>` : ""}
            </td>
          </tr>
        `;
      }))}
    </section>
  `;
}

// ------------------------------------------------------------------ Shop & Settings
function shop(d, sv) {
  const st = d.settings;
  return `
    <div class="grid">
      <section class="card span6">
        <h3>Store Settings & Numbering</h3>
        <form data-form="shop">
          ${field("opening", "Morning Drawer Opening Cash (₹)", "number", `min="0" step="0.01" value="${rs(st.opening_cash_paise)}"`, "Used to calculate drawer cash discrepancy at day close")}
          
          <div class="form-grid">
            ${field("prefix", "Counter Bill Prefix", "text", `required maxlength="8" value="${h(st.bill_prefix)}"`, "e.g. CTR")}
            ${field("cprefix", "Legacy Client Prefix", "text", `required maxlength="8" value="${h(st.client_bill_prefix)}"`, "e.g. CLI")}
          </div>
          
          <div class="form-grid">
            ${field("dprefix", "Dealer Bill Prefix", "text", `required maxlength="8" value="${h(st.dealer_bill_prefix || "DLR")}"`, "e.g. DLR")}
            ${field("cfprefix", "Café Bill Prefix", "text", `required maxlength="8" value="${h(st.cafe_bill_prefix || "CAF")}"`, "e.g. CAF")}
          </div>

          <div class="form-grid mt">
            ${field("cap", "Cashier Max Discount Limit (%)", "number", `min="0" max="50" step="0.5" value="${st.discount_cap_pct ?? ""}"`, "Empty = discounts disabled")}
            ${field("overdue", "Delinquent Debt Alert Threshold (Days)", "number", `min="1" max="365" step="1" value="${st.overdue_days ?? ""}"`, "Warn cashier during billing if unpaid bills exceed days")}
          </div>

          ${check("tax", "GST configuration approved by accountant", st.tax_approved, "Removes 'Tax pending approval' notice from bills")}
          <button class="btn btn-primary mt">Save Store Settings</button>
        </form>
      </section>

      <section class="card span6">
        <h3>Automated Daily Backup Folder</h3>
        <form data-form="folder">
          ${field("folder", "Daily Backup Destination Folder", "text", `value="${h(sv.folder)}" placeholder="D:\\VTC Counter Saves"`, "Database snapshot, Excel workbook, and PDF report are archived here upon day close.")}
          <p>${sv.folder ? (sv.folder_ok ? chip("Folder Accessible", "good") : chip("Folder Not Writable", "bad")) : chip("Destination Not Configured", "warn")}</p>
          <div class="row">
            <button class="btn btn-primary">Update Backup Path</button>
            <button type="button" class="btn" data-savenow>Backup Current Data Now</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function device(d, pr) {
  const st = d.settings, direct = pr.method === "direct";
  return `
    <div class="grid">
      <section class="card span7">
        <h3>Thermal Printer Hardware</h3>
        <form data-form="printer">
          <div class="field">
            <label for="f_method">Printing Protocol</label>
            <select id="f_method" name="method">
              ${[["auto", `Automatic (${direct ? "Direct ESC/POS Driver" : "Browser Spool"})`], ["direct", "Direct Hardware Print (Recommended: ATPOS 80mm)"], ["browser", "Browser Print Window"]].map(([v, l]) =>
                `<option value="${v}" ${st.print_method === v ? "selected" : ""}>${h(l)}</option>`).join("")}
            </select>
          </div>
          ${pr.available ? `
            <div class="field">
              <label for="f_printer">Windows Printer Device</label>
              <select id="f_printer" name="printer">
                <option value="">Default Windows Printer (${h(pr.default || "Default")})</option>
                ${pr.printers.map((n) => `<option value="${h(n)}" ${st.printer_name === n ? "selected" : ""}>${h(n)}</option>`).join("")}
              </select>
            </div>
          ` : '<p class="hint warn">Direct hardware printer daemon is running on counter host.</p>'}
          <div class="field">
            <label for="f_cols">Columns (Paper Width)</label>
            <select id="f_cols" name="cols">
              ${[[48, "48 columns — 80 mm standard roll"], [42, "42 columns — 80 mm condensed"], [32, "32 columns — 58 mm small roll"]].map(([v, l]) =>
                `<option value="${v}" ${st.print_cols === v ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </div>
          <div class="row mt">
            <button class="btn btn-primary">Save Printer Settings</button>
            <button type="button" class="btn" data-testprint>🖨 Print Alignment Test</button>
          </div>
        </form>
      </section>
      <section class="card span5">
        <h3>Client Station Mode</h3>
        ${check("station", "Serve as print station for other terminals", isStation(), "Enables browser print listener if using non-Windows tablets")}
      </section>
    </div>
  `;
}

function audit(_d, rows) {
  return `
    <div class="toolbar">
      <input class="search" type="search" placeholder="Filter audit trail (e.g. BILL_SAVED, CLIENT, PRICE)..." value="${h(auditQ)}" data-auditq/>
    </div>
    <section class="card">
      ${table(["Timestamp", "User", "Operation", "Details"], rows.map((a) =>
        `<tr>
          <td class="nowrap">${when(a.created_at)}</td>
          <td><b>${h(a.who || "System")}</b></td>
          <td>${h(a.action)}</td>
          <td>${h(a.subject)} ${h(a.info)}</td>
        </tr>`), "No audit records found.")}
    </section>
  `;
}

// ------------------------------------------------------------------ Event handlers
async function click(e, d, root, S) {
  const b = e.target.closest("[data-tab],[data-ifilter],[data-add],[data-edit],[data-toggle],[data-toggle-blend],[data-toggle-dues],[data-toggle-clients],[data-nologo],[data-testprint],[data-person],[data-reset],[data-active],[data-savenow],[name=station]");
  if (!b) return;

  try {
    if (b.dataset.tab) { tab = b.dataset.tab; return refresh(); }
    if (b.dataset.ifilter) { itemFilter = b.dataset.ifilter; return refresh(); }
    if (b.dataset.add) return itemDialog();
    if (b.dataset.edit) return itemDialog(d.items.find((i) => i.id == b.dataset.edit));
    if (b.dataset.toggle) {
      const [id, on] = b.dataset.toggle.split(":");
      await api(`/items/${id}`, "PUT", { active: on === "1" });
      return refresh();
    }
    if (b.dataset.toggleBlend) {
      const [id, on] = b.dataset.toggleBlend.split(":");
      await api(`/blends/${id}`, "PUT", { active: on === "1" });
      return refresh();
    }
    if (b.dataset.toggleDues) {
      const [id, on] = b.dataset.toggleDues.split(":");
      await api(`/people/${id}`, "PUT", { can_view_dues: on === "1" });
      toast("Permission updated.");
      return refresh();
    }
    if (b.dataset.toggleClients) {
      const [id, on] = b.dataset.toggleClients.split(":");
      await api(`/people/${id}`, "PUT", { can_manage_clients: on === "1" });
      toast("Permission updated.");
      return refresh();
    }
    if (b.hasAttribute("data-nologo")) {
      logoDraft = "";
      b.remove();
      return layoutPreview(root, d);
    }
    if (b.hasAttribute("data-testprint")) {
      const lay = tab === "layout" ? draftLayout(root, d) : d.settings.layout;
      if (printerInfo?.method === "direct") {
        const pick = root.querySelector("[name=printer]");
        const r = await api("/printers/test", "POST", { layout: lay, ...(pick ? { printer_name: pick.value } : {}) });
        return r.ok ? toast("Test receipt printed.") : toast(`Printer error: ${r.error}`, true);
      }
      return printBill({ ...SAMPLE, created_at: new Date().toISOString() }, lay, { label: "TEST PRINT", taxApproved: d.settings.tax_approved });
    }
    if (b.dataset.person) return personDialog(b.dataset.person);
    if (b.dataset.reset) {
      const [id, login] = b.dataset.reset.split(":"), pin = login === "pin";
      const r = await dialog({
        title: pin ? "Reset PIN" : "Reset Password",
        submit: "Save",
        body: `${field("secret", pin ? "New PIN (4–6 digits)" : "New Password (10+ characters)", "password", `required ${pin ? 'inputmode="numeric" maxlength="6"' : 'minlength="10"'}`)}`
      });
      if (!r) return;
      await api(`/people/${id}`, "PUT", { new_secret: r.secret });
      toast("Credentials updated.");
      return refresh();
    }
    if (b.dataset.active) {
      const [id, on] = b.dataset.active.split(":");
      await api(`/people/${id}`, "PUT", { active: on === "1" });
      return refresh();
    }
    if (b.hasAttribute("data-savenow")) {
      const r = await api("/saves/run", "POST");
      toast(`Backup saved to ${r.folder}`);
      return refresh();
    }
    if (b.name === "station") {
      setStation(b.checked);
      if (b.checked) startStation();
    }
  } catch (err) { fail(err); }
}

async function personDialog(role) {
  const r = await dialog({
    title: role === "cashier" ? "Add Cashier" : "Add Admin",
    submit: "Create Account",
    body: `
      ${field("full_name", "Full Name", "text", 'required minlength="2" maxlength="40"')}
      ${role === "cashier"
        ? field("pin", "PIN (4–6 digits)", "password", 'required inputmode="numeric" pattern="\\d{4,6}" maxlength="6"')
        : `${field("username", "Username", "text", 'required minlength="3" maxlength="24"')}${field("password", "Temporary Password", "password", 'required minlength="10"')}`}
      <div class="tiny upper mt">Initial Permissions</div>
      ${check("can_view_dues", "Can view Who owes & outstanding ledgers", role === "admin")}
      ${check("can_manage_clients", "Can manage and add new clients", role === "admin")}
    `
  });
  if (!r) return;
  try {
    await api("/people", "POST", {
      role,
      full_name: r.full_name,
      pin: r.pin,
      username: r.username,
      password: r.password,
      can_view_dues: !!r.can_view_dues,
      can_manage_clients: !!r.can_manage_clients
    });
    toast("User account created.");
    refresh();
  } catch (e) { fail(e); }
}

async function submit(e, d) {
  const f = e.target.closest("[data-form]");
  if (!f) return;
  e.preventDefault();
  const v = formData(f);
  try {
    if (f.dataset.form === "layout") {
      await api("/layout", "PUT", {
        ...Object.fromEntries(["shop_name", "address", "phone", "gstin", "footer", "logo_size"].map((k) => [k, v[k]])),
        ...Object.fromEntries(SWITCHES.map(([k]) => [k, !!v[k]])),
        logo: logoDraft
      });
    }
    if (f.dataset.form === "shop") {
      await api("/settings", "PUT", {
        opening_cash_paise: paise(v.opening),
        bill_prefix: v.prefix,
        client_bill_prefix: v.cprefix,
        dealer_bill_prefix: v.dprefix,
        cafe_bill_prefix: v.cfprefix,
        discount_cap_pct: v.cap === "" ? null : Number(v.cap),
        overdue_days: v.overdue === "" ? null : Number(v.overdue),
        tax_approved: !!v.tax
      });
    }
    if (f.dataset.form === "folder") await api("/settings", "PUT", { save_folder: v.folder });
    if (f.dataset.form === "printer") {
      await api("/settings", "PUT", {
        print_method: v.method,
        print_cols: Number(v.cols),
        ...(v.printer !== undefined ? { printer_name: v.printer } : {})
      });
    }
    toast("Settings saved successfully.");
    refresh();
  } catch (err) { fail(err); }
}
