// Sell: Counter walk-in, Dealer B2B, and Café B2B billing with decimal KG inputs and direct WhatsApp Desktop.
import { api, newKey } from "../api.js";
import { go } from "../app.js";
import { isStation, printBill, requestPrint } from "../print.js";
import { receiptHtml, waLink } from "../receipt.js";
import { dialog, fail, field, select, kg, grams, h, rupee, toast } from "../ui.js";
import { clientDialog } from "./clientform.js";

const up = (x) => Math.floor(x + 0.5);               // same rounding as the server (half up)
const amountOf = (g, rate) => up((g * rate) / 1000);

let C = null;                                         // counter set-up from the server
const blank = () => ({ lines: [], discount: 0, reason: "", name: "", phone: "", client: null });
const carts = { counter: blank(), dealer: blank(), cafe: blank() };
let mode = "counter", cart = carts.counter, clients = [];
let blends = [];
let lookup = null;                                    // { phone, card }
let lastClientBill = null;                            // { found, bill }
let confirmSecret = "";                               // PIN/password typed to add custom line
const search = { counter: "", dealer: "", cafe: "" };
let clientQ = "";
const norm = (x) => String(x || "").toLowerCase();

const subtotal = () => cart.lines.reduce((s, l) => s + l.amount, 0);
const totals = () => {
  const sub = subtotal(), net = sub - cart.discount, total = up(net / 100) * 100;
  return { sub, net, total, round: total - net };
};

const reset = () => (cart = carts[mode] = blank());
let rootEl = null;

export async function show(root, _S, m = "counter") {
  rootEl = root;
  mode = m === "client" ? "dealer" : m;
  cart = carts[mode] || (carts[mode] = blank());
  C = await api("/counter");

  if (mode === "dealer" || mode === "cafe") {
    clients = (await api(`/clients?type=${mode}&context=billing`)).clients.filter((x) => x.active);
  } else {
    clients = [];
  }

  // Load blends
  blends = await api("/blends" + (cart.client ? `?cafe_id=${cart.client}` : ""));

  // Check last client bill if client is selected
  if (cart.client) {
    try { lastClientBill = await api(`/clients/${cart.client}/last-bill`); } catch { lastClientBill = null; }
  } else {
    lastClientBill = null;
  }

  // Re-price cart lines
  cart.lines = cart.lines.map((l) => priced(l)).filter(Boolean);
  render(root);
}

function priced(l) {
  if (l.custom) return l;
  if (l.blend_id) {
    const b = blends.find((x) => x.id === l.blend_id) || C.blends?.find((x) => x.id === l.blend_id);
    if (!b) return null;
    const list = b.base_price_paise;
    const own = (mode === "dealer" || mode === "cafe") && l.own_rate != null && l.own_rate !== list ? l.own_rate : null;
    const rate = own ?? list;
    return {
      blend_id: b.id,
      item_group: "blend",
      name: b.bill_name,
      color_tag: b.color_tag || "#6366f1",
      grams: l.grams,
      rate,
      list,
      own_rate: own,
      amount: amountOf(l.grams, rate)
    };
  }

  const it = C.items.find((i) => i.id === l.item_id);
  if (!it) return null;
  const list = it.price_paise;
  const own = (mode === "dealer" || mode === "cafe") && l.own_rate != null && l.own_rate !== list ? l.own_rate : null;
  const rate = own ?? list;
  return {
    item_id: it.id,
    item_group: it.item_group,
    color_tag: it.color_tag || "#78350f",
    pct: l.pct ?? (it.mix_chicory ? 100 : null),
    grams: l.grams,
    name: it.bill_name,
    rate,
    list,
    own_rate: own,
    amount: amountOf(l.grams, rate)
  };
}

function render(root) {
  if (C.day_closed) {
    root.innerHTML = `<div class="closed-banner"><div><b>Today is closed</b><br><span class="sub">Bills were closed at ${new Date(C.day_closed.created_at).toLocaleTimeString("en-IN", { timeStyle: "short" })}. Selling opens again tomorrow${C.is_boss ? ", or reopen today from Day close" : ""}.</span></div>
      <button class="btn" data-go="close">Day close →</button></div>`;
    return;
  }

  const t = totals();
  const q = norm(search[mode]);

  let catalogHtml = "";
  if (mode === "dealer") {
    // 3 distinct groups: Raw Beans, Roasted Beans, Chicory
    const raw = C.items.filter((i) => i.item_group === "raw_beans");
    const roasted = C.items.filter((i) => i.item_group === "roasted_beans");
    const chicory = C.items.filter((i) => i.item_group === "chicory");

    catalogHtml = `
      <div class="sec-title" style="color: #10b981;">1. RAW BEANS (GREEN COFFEE)</div>
      <div class="pos-items">${raw.length ? raw.map(tileItem).join("") : '<div class="empty">No raw beans defined.</div>'}</div>
      
      <div class="sec-title" style="color: #78350f;">2. ROASTED BEANS</div>
      <div class="pos-items">${roasted.length ? roasted.map(tileItem).join("") : '<div class="empty">No roasted beans defined.</div>'}</div>

      <div class="sec-title" style="color: #d97706;">3. CHICORY</div>
      <div class="pos-items">${chicory.length ? chicory.map(tileItem).join("") : '<div class="empty">No chicory items defined.</div>'}</div>
    `;
  } else if (mode === "cafe") {
    // Cafe Blends + Cafe Extras (Tea/Supplies)
    const cafeBlends = blends;
    const extras = C.items.filter((i) => i.item_group !== "raw_beans");

    catalogHtml = `
      <div class="toolbar" style="margin-top:0;">
        <div class="sec-title" style="color: #6366f1; margin:0;">CAFÉ BLENDS (ROASTED RATIOS)</div>
        <button class="btn btn-small btn-primary" data-act="newblend">+ Create Café Blend</button>
      </div>
      <div class="pos-items">${cafeBlends.length ? cafeBlends.map(tileBlend).join("") : '<div class="empty">No blends available. Tap "+ Create Café Blend".</div>'}</div>

      <div class="sec-title" style="color: #059669; margin-top:16px;">CAFÉ EXTRAS & TEA</div>
      <div class="pos-items">${extras.map(tileItem).join("")}</div>
    `;
  } else {
    // Counter walk-in: Shared blends + Standard items
    const sharedBlends = blends.filter((b) => b.is_shared);
    const standardItems = C.items;

    catalogHtml = `
      ${sharedBlends.length ? `
        <div class="sec-title" style="color: #6366f1;">SIGNATURE & SHARED BLENDS</div>
        <div class="pos-items">${sharedBlends.map(tileBlend).join("")}</div>
      ` : ""}
      <div class="sec-title" style="color: #78350f;">INDIVIDUAL COFFEES & SPECIALTIES</div>
      <div class="pos-items">${standardItems.map(tileItem).join("")}
        <button class="pos-tile other" data-act="custom"><b>Item not in list</b><span class="tiny">Type name & price. Needs PIN.</span></button>
      </div>
    `;
  }

  function tileItem(i) {
    const isMatch = !q || norm(i.name + " " + i.bill_name).includes(q);
    const color = i.color_tag || "#78350f";
    return `<button class="pos-tile" data-tile-item="${i.id}" data-find="${h(norm(i.name + " " + i.bill_name))}" ${isMatch ? "" : "hidden"}>
      <span class="item-tag-badge" style="background:${color};">${h(i.item_group ? i.item_group.replace('_', ' ') : 'COFFEE')}</span>
      <b>${h(i.name)}</b>
      <span class="pos-price">${rupee(i.price_paise)}<small>/kg</small></span>
    </button>`;
  }

  function tileBlend(b) {
    const isMatch = !q || norm(b.name + " " + b.bill_name).includes(q);
    const color = b.color_tag || "#6366f1";
    const compDesc = b.components?.map((c) => `${c.ratio_pct}% ${c.item_name || 'Coffee'}`).join(" + ") || "Custom Blend";
    return `<button class="pos-tile" data-tile-blend="${b.id}" data-find="${h(norm(b.name + " " + b.bill_name))}" ${isMatch ? "" : "hidden"}>
      <span class="item-tag-badge" style="background:${color};">${b.is_shared ? 'SHARED BLEND' : 'CAFÉ RECIPE'}</span>
      <b>${h(b.name)}</b>
      <span class="tiny" style="line-height:1.2;">${h(compDesc)}</span>
      <span class="pos-price">${rupee(b.base_price_paise)}<small>/kg</small></span>
    </button>`;
  }

  root.innerHTML = `<div class="pos">
    <section>
      <input type="search" class="item-search" data-isearch placeholder="Search items by name… (Enter selects first match)" value="${h(search[mode])}" autocomplete="off"/>
      ${catalogHtml}
    </section>
    
    <section class="card pos-bill">
      <h3>${mode === "dealer" ? "Dealer Order" : mode === "cafe" ? "Café Order" : "Counter Bill"}</h3>
      ${cart.lines.length ? `<div class="bill-lines">${cart.lines.map((l, i) => `
        <div class="bill-line">
          <button class="line-main" data-edit="${i}" title="Edit weight/rate">
            <span class="item-tag-badge" style="background:${l.color_tag || '#78350f'};">${h(l.item_group || 'item')}</span>
            <b>${h(l.name)}</b>
            <span class="tiny">${l.custom ? `${kg(l.grams)} · added by ${h(l.by)}` : `<b>${kg(l.grams)}</b> × ${rupee(l.rate)}/kg${l.own_rate != null ? ` <span class="neg">(list ${rupee(l.list)})</span>` : ""}`}</span>
          </button>
          <b>${rupee(l.amount)}</b>
          <button class="icon-btn" data-rm="${i}" aria-label="Remove ${h(l.name)}">✕</button>
        </div>`).join("")}</div>`
        : '<div class="empty">Select items on the left to add them to this order.</div>'}

      <div class="kv"><span>Subtotal</span><b>${rupee(t.sub)}</b></div>
      ${cart.discount ? `<div class="kv"><span>Discount · ${h(cart.reason)}</span><b>− ${rupee(cart.discount)}</b></div>` : ""}
      ${t.round && cart.lines.length ? `<div class="kv"><span>Round off</span><b>${t.round > 0 ? "+" : "−"} ${rupee(Math.abs(t.round))}</b></div>` : ""}
      <div class="kv total"><span>${mode === "counter" ? "Total to collect" : "Order Total"}</span><b>${rupee(cart.lines.length ? t.total : 0)}</b></div>

      ${mode === "counter" ? `
        <div class="form-grid mt">
          ${field("c_name", "Customer Name (optional)", "text", `maxlength="40" value="${h(cart.name)}" data-cart="name" autocomplete="off"`)}
          ${field("c_phone", "Phone (for WhatsApp Desktop)", "tel", `maxlength="15" value="${h(cart.phone)}" data-cart="phone" inputmode="tel" autocomplete="off"`)}
        </div>
        ${customerCard()}
      ` : clientBox()}

      <div class="row mt">
        ${cart.lines.length ? `<button class="btn" data-act="discount">Discount</button><button class="btn" data-act="clear">Clear Order</button>` : ""}
        <button class="btn btn-primary btn-big grow" data-act="pay" ${cart.lines.length && (mode === "counter" || cart.client) ? "" : "disabled"}>
          ${mode === "counter" ? `Take Payment ${cart.lines.length ? rupee(t.total) : ""}` : (cart.client ? "Save & Issue Bill" : "Select Client First")}
        </button>
      </div>
    </section>
  </div>`;

  bindEvents(root);
}

function bindEvents(root) {
  root.onclick = async (e) => {
    const b = e.target.closest("[data-tile-item],[data-tile-blend],[data-edit],[data-rm],[data-act],[data-go],[data-pick]");
    if (!b) return;
    if (b.dataset.go) return go(b.dataset.go);
    if (b.dataset.tileItem) return openItemModal(root, Number(b.dataset.tileItem), false);
    if (b.dataset.tileBlend) return openItemModal(root, Number(b.dataset.tileBlend), true);
    if (b.dataset.edit) return editLineModal(root, Number(b.dataset.edit));
    if (b.dataset.rm) { cart.lines.splice(Number(b.dataset.rm), 1); cart.discount = 0; return render(root); }

    const a = b.dataset.act;
    if (a === "clear") { const keep = cart.client; reset(); cart.client = keep; lookup = null; confirmSecret = ""; return render(root); }
    if (b.dataset.pick) {
      cart.client = Number(b.dataset.pick);
      clientQ = "";
      try { lastClientBill = await api(`/clients/${cart.client}/last-bill`); } catch { lastClientBill = null; }
      blends = await api("/blends" + (cart.client ? `?cafe_id=${cart.client}` : ""));
      return render(root);
    }
    if (a === "unpick") { cart.client = null; lastClientBill = null; return render(root); }
    if (a === "newclient") {
      const id = await clientDialog(null, mode === "cafe" ? "cafe" : "dealer");
      if (id) {
        clients = (await api(`/clients?type=${mode}&context=billing`)).clients.filter((x) => x.active);
        cart.client = id;
      }
      return render(root);
    }
    if (a === "newblend") return newBlendModal(root);
    if (a === "repeat_last") return repeatLastOrder(root);
    if (a === "custom") return customLineModal(root);
    if (a === "discount") return discountModal(root);
    if (a === "pay") return payModal(root);
    if (a === "same") return sameAgain(root);
  };

  root.onkeydown = (e) => {
    if (e.key !== "Enter" || !e.target.matches("[data-isearch]")) return;
    e.preventDefault();
    const firstItem = root.querySelector("[data-tile-item]:not([hidden])");
    const firstBlend = root.querySelector("[data-tile-blend]:not([hidden])");
    if (firstItem) openItemModal(root, Number(firstItem.dataset.tileItem), false);
    else if (firstBlend) openItemModal(root, Number(firstBlend.dataset.tileBlend), true);
  };

  root.oninput = (e) => {
    if (e.target.matches("[data-isearch]")) {
      const q = norm(search[mode] = e.target.value);
      root.querySelectorAll("[data-tile-item],[data-tile-blend]").forEach((t) => (t.hidden = !!q && !t.dataset.find.includes(q)));
      return;
    }
    if (e.target.matches("[data-csearch]")) {
      const q = norm(clientQ = e.target.value);
      root.querySelectorAll("[data-pick]").forEach((t) => (t.hidden = !!q && !t.dataset.find.includes(q)));
      return;
    }
    const k = e.target.dataset.cart;
    if (!k) return;
    cart[k] = e.target.value;
    if (k === "phone") phoneLookup(root, e.target.value);
  };
}

// ------------------------------------------------------------------ Client picker
const pickedClient = () => clients.find((x) => x.id === cart.client);
const overdue = (cl) => C.overdue_days != null && cl && cl.oldest_days > C.overdue_days;

function clientBox() {
  const cl = pickedClient();
  if (!cl) {
    const q = norm(clientQ), find = (x) => norm(`${x.name} ${x.contact || ""} ${x.phone || ""}`);
    return `<div class="field mt"><label for="f_client">Select ${mode === "cafe" ? "Café" : "Dealer"}</label><div class="row nowrap">
        <input id="f_client" type="search" class="grow" data-csearch placeholder="Search by name or phone…" value="${h(clientQ)}" autocomplete="off"/>
        <button type="button" class="btn btn-small" data-act="newclient">+ New ${mode === "cafe" ? "Café" : "Dealer"}</button></div>
      <div class="client-pick">${clients.length ? clients.map((x) => `<button type="button" class="pick-row" data-pick="${x.id}" data-find="${h(find(x))}" ${q && !find(x).includes(q) ? "hidden" : ""}>
          <b>${h(x.name)}</b><span class="tiny">${h(x.phone || "")}${x.has_overdue ? ` · <span class="neg">OVERDUE</span>` : ""}</span></button>`).join("") : '<p class="tiny">No clients found. Click + New.</p>'}</div></div>`;
  }

  const repeatBtn = lastClientBill?.found ? `
    <button type="button" class="btn btn-small" style="background:#e0e7ff; color:#3730a3;" data-act="repeat_last">
      ↻ Repeat last order (${lastClientBill.bill.bill_no})
    </button>
  ` : "";

  return `<div class="row mt"><span class="tiny upper grow">${mode === "cafe" ? "Café" : "Dealer"} Selected</span>
      ${repeatBtn}
      <button type="button" class="btn btn-small" data-act="unpick">Change</button>
    </div>
    <div class="cx-card ${overdue(cl) ? "due-bad" : ""}">
      <div class="cx-top"><b>${h(cl.name)}</b>${cl.gstin ? `<span class="tiny">GSTIN ${h(cl.gstin)}</span>` : ""}</div>
      <div class="tiny">${h(cl.address || "No address saved")} · Ph: ${h(cl.phone || "—")}</div>
      ${cl.has_overdue ? `<div class="hint warn mt-s">Oldest unpaid bill is ${cl.oldest_days} days old (exceeds ${C.overdue_days} day limit). Continuing requires a note.</div>` : ""}
    </div>`;
}

function repeatLastOrder(root) {
  if (!lastClientBill?.bill?.lines) return;
  for (const l of lastClientBill.bill.lines) {
    if (l.blend_id) {
      const p = priced({ blend_id: l.blend_id, grams: l.grams, own_rate: l.rate_paise });
      if (p) cart.lines.push(p);
    } else if (l.item_id) {
      const p = priced({ item_id: l.item_id, pct: l.coffee_pct, grams: l.grams, own_rate: l.rate_paise });
      if (p) cart.lines.push(p);
    }
  }
  toast("Last order lines loaded! Weigh again before taking payment.");
  render(root);
}

// ------------------------------------------------------------------ Customer phone lookup
async function phoneLookup(root, v) {
  const d = v.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  if (d.length !== 10) { if (lookup) { lookup = null; render(root); } return; }
  if (lookup?.phone === d) return;
  try {
    const card = await api(`/customers/lookup?phone=${d}`);
    lookup = { phone: d, card };
    if (card.found && card.name && !cart.name) cart.name = card.name;
    render(root);
  } catch (e) { fail(e); }
}

function customerCard() {
  const c = lookup?.card;
  if (!c) return "";
  if (!c.found) return `<div class="cx-card new">New customer · ${h(c.phone_masked)} · saved with this bill</div>`;
  const last = c.last;
  return `<div class="cx-card"><div class="cx-top"><b>${h(c.name || "Returning customer")}</b><span class="chip">${c.visits} visit${c.visits === 1 ? "" : "s"}</span><span class="tiny">${h(c.phone_masked)}</span></div>
    ${last ? `<div class="tiny">Last bill ${h(last.bill_no)} · ${rupee(last.total_paise)}: ${last.lines.map((l) => `${h(l.item_name)} ${kg(l.grams)}`).join(", ")}</div>
    <button class="btn btn-small mt-s" data-act="same">↻ Same again</button>` : ""}</div>`;
}

function sameAgain(root) {
  for (const l of lookup.card.last.lines) {
    const p = priced({ item_id: l.item_id, pct: l.coffee_pct, grams: l.grams });
    if (p) cart.lines.push(p);
  }
  cart.discount = 0;
  toast("Previous items added at today's rate.");
  render(root);
}

// ------------------------------------------------------------------ Add item/blend with Decimal KG input
async function openItemModal(root, id, isBlend = false, editIndex = null) {
  const item = isBlend ? blends.find((b) => b.id === id) : C.items.find((i) => i.id === id);
  if (!item) return;

  const old = editIndex != null ? cart.lines[editIndex] : null;
  const listRate = isBlend ? item.base_price_paise : item.price_paise;
  let ownRate = old?.own_rate != null ? old.own_rate : listRate;

  // Preset buttons in KG
  const kgPresets = (mode === "counter")
    ? [0.25, 0.5, 1, 2, 5]
    : [1, 2, 5, 10, 25, 50];

  const initialKg = old ? (old.grams / 1000) : "";

  const r = await dialog({
    title: `${old ? "Edit" : "Add"} ${item.name}`,
    submit: old ? "Update Item" : "Add to Order",
    body: `
      <div class="tiny upper">Weight in Kilograms (KG)</div>
      <div class="kg-preset-grid">
        ${kgPresets.map((x) => `<button type="button" class="kg-btn" data-kg="${x}">${x} kg</button>`).join("")}
      </div>
      
      <div class="form-grid">
        <div class="field">
          <label for="f_kg">Weight (KG)</label>
          <input id="f_kg" name="kg" type="number" min="0.001" max="1000" step="0.001" inputmode="decimal" required value="${initialKg}" placeholder="e.g. 0.5 or 25"/>
        </div>
        <div class="field">
          <label for="f_rs">…or Rupee value (₹)</label>
          <input id="f_rs" name="rupees" type="number" min="1" step="1" inputmode="numeric" placeholder="Target ₹"/>
        </div>
      </div>

      ${(mode === "dealer" || mode === "cafe") ? `
        <div class="field">
          <label for="f_own">Price per KG for this client (₹)</label>
          <input id="f_own" name="own_rate" type="number" min="0.01" step="0.01" inputmode="decimal" value="${(ownRate / 100).toFixed(2)}"/>
          <small>List price is ${rupee(listRate)}/kg. Changed rate will be remembered for this client.</small>
        </div>
      ` : ""}

      <div class="line-calc" id="calc"></div>
    `,
    onReady(d) {
      const kgIn = d.querySelector("[name=kg]");
      const rsIn = d.querySelector("[name=rupees]");
      const ownIn = d.querySelector("[name=own_rate]");
      const out = d.querySelector("#calc");

      const getActiveRate = () => {
        if (ownIn && ownIn.value) {
          return Math.round(Number(ownIn.value) * 100);
        }
        return listRate;
      };

      const updateCalc = () => {
        const rate = getActiveRate();
        const kVal = parseFloat(kgIn.value) || 0;
        const gVal = Math.round(kVal * 1000);
        const cost = amountOf(gVal, rate);
        out.innerHTML = `Rate: <b>${rupee(rate)}/kg</b> · Weight: <b>${kg(gVal)}</b> · Total: <b>${rupee(cost)}</b>`;
      };

      d.querySelectorAll("[data-kg]").forEach((b) => b.addEventListener("click", () => {
        kgIn.value = b.dataset.kg;
        rsIn.value = "";
        updateCalc();
      }));

      kgIn.addEventListener("input", () => { rsIn.value = ""; updateCalc(); });
      if (ownIn) ownIn.addEventListener("input", updateCalc);

      rsIn.addEventListener("input", () => {
        const targetRs = parseFloat(rsIn.value) || 0;
        const rate = getActiveRate();
        if (targetRs > 0 && rate > 0) {
          const gramsTarget = (targetRs * 100 * 1000) / rate;
          kgIn.value = (gramsTarget / 1000).toFixed(3);
          updateCalc();
        }
      });

      updateCalc();
    }
  });

  if (!r) return;
  const enteredKg = parseFloat(r.kg);
  if (!enteredKg || enteredKg <= 0) return toast("Please enter a valid weight in kg.", true);
  const totalGrams = Math.round(enteredKg * 1000);

  const ownRateEntered = r.own_rate ? Math.round(Number(r.own_rate) * 100) : null;
  const line = isBlend
    ? priced({ blend_id: item.id, grams: totalGrams, own_rate: ownRateEntered })
    : priced({ item_id: item.id, grams: totalGrams, own_rate: ownRateEntered });

  if (!line) return toast("Failed to price line.", true);

  if (editIndex != null) cart.lines[editIndex] = line;
  else cart.lines.push(line);

  cart.discount = 0;
  render(rootEl);
}

function editLineModal(root, idx) {
  const l = cart.lines[idx];
  if (l.custom) return customLineModal(root, idx);
  if (l.blend_id) return openItemModal(root, l.blend_id, true, idx);
  return openItemModal(root, l.item_id, false, idx);
}

// ------------------------------------------------------------------ Blend Builder Modal
async function newBlendModal(root) {
  const roastedItems = C.items.filter((i) => i.item_group === "roasted_beans");
  if (roastedItems.length < 2) {
    return toast("Add at least 2 roasted bean items in Setup before building a blend.", true);
  }

  const r = await dialog({
    title: "Build New Café Blend",
    submit: "Save Blend",
    wide: true,
    body: `
      <div class="form-grid">
        ${field("blend_name", "Blend Name", "text", 'required maxlength="40" placeholder="e.g. Signature Gold"')}
        ${field("base_price", "Selling Price per KG (₹)", "number", 'required min="1" step="0.01" inputmode="decimal" placeholder="e.g. 550"')}
      </div>
      <div class="field">
        <label>Ratio Composition (Must sum to 100%)</label>
        <div id="compList" style="display:grid; gap:8px;">
          ${roastedItems.map((it, idx) => `
            <div class="row nowrap">
              <span class="grow"><b>${h(it.name)}</b> (${rupee(it.price_paise)}/kg)</span>
              <input type="number" data-cid="${it.id}" min="0" max="100" step="5" value="${idx === 0 ? "70" : idx === 1 ? "30" : "0"}" style="width:90px;" placeholder="%"/>
              <span>%</span>
            </div>
          `).join("")}
        </div>
        <div class="row mt-s"><b>Total: </b><span id="pctTotal">100%</span></div>
      </div>
    `,
    onReady(d) {
      const inputs = d.querySelectorAll("[data-cid]");
      const totalSpan = d.querySelector("#pctTotal");
      const calcTotal = () => {
        let sum = 0;
        inputs.forEach((inp) => sum += parseInt(inp.value) || 0);
        totalSpan.textContent = `${sum}%`;
        totalSpan.style.color = sum === 100 ? "green" : "red";
      };
      inputs.forEach((inp) => inp.addEventListener("input", calcTotal));
      calcTotal();
    }
  });

  if (!r) return;
  const comps = [];
  let tot = 0;
  roastedItems.forEach((it) => {
    const el = document.querySelector(`[data-cid="${it.id}"]`);
    const pct = parseInt(el?.value) || 0;
    if (pct > 0) {
      comps.push({ item_id: it.id, ratio_pct: pct });
      tot += pct;
    }
  });

  if (tot !== 100) return toast("Ratio percentages must add up to exactly 100%.", true);

  try {
    const res = await api("/blends", "POST", {
      name: r.blend_name,
      bill_name: r.blend_name,
      base_price_paise: Math.round(Number(r.base_price) * 100),
      is_shared: !cart.client,
      cafe_id: cart.client || null,
      components: comps,
    });
    toast(`Blend "${r.blend_name}" created!`);
    blends = await api("/blends" + (cart.client ? `?cafe_id=${cart.client}` : ""));
    render(root);
  } catch (e) { fail(e); }
}

// ------------------------------------------------------------------ Custom Line Modal
async function customLineModal(root, editIndex = null) {
  const old = editIndex != null ? cart.lines[editIndex] : null, me = window.__vtcMe || {};
  const pin = me.login !== "password";
  const r = await dialog({ title: old ? "Edit Custom Item" : "Add Item Not In List", submit: old ? "Update" : "Add",
    body: `
      <p class="hint">Ad-hoc entry. Recorded under your name for accountability.</p>
      ${field("name", "Name on bill", "text", `required minlength="2" maxlength="60" value="${h(old?.name || "")}" autocomplete="off"`)}
      <div class="form-grid">
        ${field("amount", "Amount in ₹", "number", `required min="0.01" step="0.01" inputmode="decimal" value="${old ? old.amount / 100 : ""}"`)}
        ${field("kg", "Weight in KG (optional)", "number", `min="0" max="100" step="0.001" inputmode="decimal" value="${old?.grams ? old.grams / 1000 : ""}"`)}
      </div>
      ${field("gst", "GST % (optional)", "number", `min="0" max="28" step="0.01" value="${old?.gst_bp == null ? "" : old.gst_bp / 100}"`)}
      ${field("secret", pin ? "Enter Your PIN" : "Enter Password", "password", `required autocomplete="off" ${pin ? 'inputmode="numeric" maxlength="6"' : ""}`, "Confirms your authorization")}` });
  if (!r) return;

  try { await api("/me/check", "POST", { secret: r.secret }); } catch (e) { return fail(e); }
  confirmSecret = r.secret;

  const totalGrams = r.kg ? Math.round(Number(r.kg) * 1000) : 0;
  const line = {
    custom: true,
    item_group: "custom",
    color_tag: "#64748b",
    name: r.name.trim(),
    amount: Math.round(Number(r.amount) * 100),
    grams: totalGrams,
    gst_bp: r.gst === "" ? null : Math.round(Number(r.gst) * 100),
    by: me.full_name || "Staff",
    rate: 0
  };

  if (editIndex != null) cart.lines[editIndex] = line;
  else cart.lines.push(line);

  cart.discount = 0;
  render(root);
}

// ------------------------------------------------------------------ Discount
async function discountModal(root) {
  if (C.discount_cap_pct == null) return toast("Discounts are not enabled in settings.", true);
  const max = Math.floor((subtotal() * C.discount_cap_pct) / 100);
  if (max < 100) return toast(`Discount limit (${C.discount_cap_pct}%) is under ₹1 on this bill.`, true);

  const r = await dialog({ title: "Apply Discount", submit: "Apply",
    body: `<p class="hint">Max allowed (${C.discount_cap_pct}%): <b>${rupee(max)}</b></p>
      ${field("amount", "Discount (₹)", "number", `required min="1" max="${Math.floor(max / 100)}" step="1" inputmode="numeric" value="${cart.discount ? cart.discount / 100 : ""}"`)}
      ${field("reason", "Reason for discount", "text", `required minlength="3" maxlength="120" value="${h(cart.reason)}"`)}` });
  if (!r) return;
  cart.discount = Math.round(Number(r.amount) * 100);
  cart.reason = r.reason.trim();
  render(root);
}

// ------------------------------------------------------------------ Payment & Bill Completion
const linesPayload = () => cart.lines.map((l) => {
  if (l.custom) {
    return { custom: { name: l.name, amount_paise: l.amount, grams: l.grams, gst_bp: l.gst_bp } };
  }
  if (l.blend_id) {
    return {
      blend_id: l.blend_id,
      grams: l.grams,
      ...(l.own_rate != null ? { rate_paise: l.own_rate } : {})
    };
  }
  return {
    item_id: l.item_id,
    coffee_pct: l.pct,
    grams: l.grams,
    ...(l.own_rate != null ? { rate_paise: l.own_rate } : {})
  };
});

async function payModal(root) {
  const t = totals(), key = newKey();
  const cl = pickedClient();

  if (mode === "dealer" || mode === "cafe") {
    // Client settlement modal
    let settlement = "credit";
    const r = await dialog({
      title: `${cl.name} · Total ${rupee(t.total)}`,
      submit: "Save & Print Invoice",
      extra: '<button type="button" class="btn btn-quiet" data-noprint>Save, No Print</button>',
      wide: true,
      body: `
        <div class="seg wide-seg">
          <button type="button" class="seg-btn on" data-settle="credit">Full Credit</button>
          <button type="button" class="seg-btn" data-settle="part">Part Payment</button>
          <button type="button" class="seg-btn" data-settle="full">Full Payment</button>
        </div>

        <div id="payInputs" hidden class="form-grid mt">
          ${field("paid", "Amount Paid Now (₹)", "number", 'min="0.01" step="0.01" inputmode="decimal"')}
          ${select("pm", "Payment Mode", [["CASH", "Cash"], ["UPI", "UPI"], ["BANK", "Bank Transfer"], ["CHEQUE", "Cheque"]])}
        </div>
        <div id="pRef" hidden>
          ${field("reference", "UTR / Bank Reference (optional)", "text", 'maxlength="40" autocomplete="off"')}
        </div>

        <div id="cashTenderBox" hidden class="form-grid mt">
          ${field("tendered", "Cash Received From Client (₹)", "number", 'min="0" step="1" inputmode="numeric"')}
          <div class="field"><label>Change to Return</label><b id="changeDue" class="due-big" style="font-size:20px;">₹0.00</b></div>
        </div>

        <div class="kv mt"><span>This Invoice Credit Balance</span><b id="dueAmt">${rupee(t.total)}</b></div>
        <div id="oldWarning" ${overdue(cl) ? "" : "hidden"}>
          <div class="hint warn">Client has overdue bills. Explain why extra credit is sanctioned:</div>
          ${field("credit_reason", "Credit Sanction Note", "text", 'maxlength="200" autocomplete="off"')}
        </div>
        <input type="hidden" name="settlement" value="credit"/>
        <input type="hidden" name="print" value="1"/>
      `,
      onReady(d) {
        const paidIn = d.querySelector("[name=paid]");
        const pmIn = d.querySelector("[name=pm]");
        const tenIn = d.querySelector("[name=tendered]");
        const chgOut = d.querySelector("#changeDue");
        const dueOut = d.querySelector("#dueAmt");
        const payBox = d.querySelector("#payInputs");
        const refBox = d.querySelector("#pRef");
        const cashBox = d.querySelector("#cashTenderBox");
        const oldBox = d.querySelector("#oldWarning");
        const crIn = d.querySelector("[name=credit_reason]");

        const sync = () => {
          d.querySelector("[name=settlement]").value = settlement;
          d.querySelectorAll("[data-settle]").forEach((b) => b.classList.toggle("on", b.dataset.settle === settlement));
          payBox.hidden = settlement === "credit";
          refBox.hidden = settlement === "credit" || pmIn.value === "CASH";
          cashBox.hidden = settlement === "credit" || pmIn.value !== "CASH";

          if (settlement === "full") {
            paidIn.value = (t.total / 100).toFixed(2);
            paidIn.readOnly = true;
          } else if (settlement === "part") {
            paidIn.readOnly = false;
          } else {
            paidIn.value = "";
          }

          const pVal = Math.round(Number(paidIn.value || 0) * 100);
          const dueVal = Math.max(0, t.total - pVal);
          dueOut.textContent = rupee(dueVal);

          if (pmIn.value === "CASH" && tenIn.value) {
            const tenVal = Math.round(Number(tenIn.value) * 100);
            const diff = tenVal - pVal;
            chgOut.textContent = rupee(Math.max(0, diff));
          } else {
            chgOut.textContent = "₹0.00";
          }

          oldBox.hidden = !(overdue(cl) && dueVal > 0);
          crIn.required = overdue(cl) && dueVal > 0;
          if (crIn.required) crIn.minLength = 5;
        };

        d.querySelectorAll("[data-settle]").forEach((b) => b.addEventListener("click", () => { settlement = b.dataset.settle; sync(); }));
        paidIn.addEventListener("input", sync);
        pmIn.addEventListener("change", sync);
        tenIn.addEventListener("input", sync);

        d.querySelector("[data-noprint]").addEventListener("click", () => {
          d.querySelector("[name=print]").value = "0";
          d.querySelector("form").requestSubmit();
        });
        sync();
      }
    });

    if (!r) return;
    const paidPaise = r.settlement === "credit" ? 0 : Math.round(Number(r.paid || 0) * 100);
    if (paidPaise > t.total) return toast("Payment cannot exceed total.", true);

    const payments = paidPaise ? [{ method: r.pm, amount_paise: paidPaise, reference: r.pm === "CASH" ? "" : r.reference || "" }] : [];
    const tenPaise = r.pm === "CASH" && r.tendered ? Math.round(Number(r.tendered) * 100) : null;
    const chgPaise = tenPaise != null ? Math.max(0, tenPaise - paidPaise) : null;

    try {
      const bill = await api("/bills", "POST", {
        client_id: cl.id,
        lines: linesPayload(),
        discount_paise: cart.discount,
        discount_reason: cart.reason,
        payments,
        tendered_paise: tenPaise,
        change_paise: chgPaise,
        credit_reason: r.credit_reason || "",
        ...(cart.lines.some((l) => l.custom) ? { confirm_secret: confirmSecret } : {})
      }, key);

      reset();
      confirmSecret = "";
      clients = (await api(`/clients?type=${mode}&context=billing`)).clients.filter((x) => x.active);
      render(root);
      if (r.print === "1") requestPrint(bill.id);
      afterSale(bill, chgPaise, bill.client?.phone || "", r.print === "1");
    } catch (e) { fail(e); }
    return;
  }

  // Counter Walk-in payment modal
  let payMethod = "CASH";
  const r = await dialog({
    title: `Collect ${rupee(t.total)}`,
    submit: "Complete & Print",
    extra: '<button type="button" class="btn btn-quiet" data-noprint>Complete, No Print</button>',
    body: `
      <div class="seg wide-seg">
        ${[["CASH", "Cash"], ["UPI", "UPI"], ["CARD", "Card"], ["SPLIT", "Cash + UPI"]].map(([m, l]) =>
          `<button type="button" class="seg-btn ${m === payMethod ? "on" : ""}" data-m="${m}">${l}</button>`).join("")}
      </div>
      <div id="pCash">
        ${field("tendered", "Cash Received (₹)", "number", 'min="0" step="1" inputmode="numeric"')}
        <p class="change" id="change"></p>
      </div>
      <div id="pSplit" hidden class="form-grid">
        ${field("cash_part", "Cash Part (₹)", "number", 'min="0" step="1" inputmode="numeric"')}
        ${field("upi_part", "UPI Part (₹)", "number", "readonly")}
      </div>
      <div id="pRef" hidden>
        ${field("reference", "UTR / Card Auth No.", "text", 'maxlength="40" autocomplete="off"')}
      </div>
      <input type="hidden" name="method" value="CASH"/>
      <input type="hidden" name="print" value="1"/>
    `,
    onReady(d) {
      const sync = () => {
        d.querySelector("[name=method]").value = payMethod;
        d.querySelectorAll("[data-m]").forEach((b) => b.classList.toggle("on", b.dataset.m === payMethod));
        d.querySelector("#pCash").hidden = payMethod !== "CASH";
        d.querySelector("#pSplit").hidden = payMethod !== "SPLIT";
        d.querySelector("#pRef").hidden = payMethod === "CASH";
        d.querySelector("[name=cash_part]").required = payMethod === "SPLIT";
      };

      d.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => { payMethod = b.dataset.m; sync(); }));
      const ten = d.querySelector("[name=tendered]"), ch = d.querySelector("#change");
      ten.addEventListener("input", () => {
        const c = Math.round(ten.value * 100) - t.total;
        ch.innerHTML = ten.value ? (c >= 0 ? `Change to return: <b>${rupee(c)}</b>` : `Short by <b>${rupee(-c)}</b>`) : "";
      });

      const cp = d.querySelector("[name=cash_part]"), upi = d.querySelector("[name=upi_part]");
      cp.addEventListener("input", () => (upi.value = Math.max(0, (t.total - Math.round(cp.value * 100)) / 100)));

      d.querySelector("[data-noprint]").addEventListener("click", () => {
        d.querySelector("[name=print]").value = "0";
        d.querySelector("form").requestSubmit();
      });
      sync();
    }
  });

  if (!r) return;
  let payments;
  if (r.method === "SPLIT") {
    const cash = Math.round(Number(r.cash_part || 0) * 100), upi = t.total - cash;
    if (cash <= 0 || upi <= 0) return toast("Enter valid cash and UPI amounts.", true);
    payments = [{ method: "CASH", amount_paise: cash }, { method: "UPI", amount_paise: upi, reference: r.reference || "" }];
  } else {
    payments = [{ method: r.method, amount_paise: t.total, reference: r.method === "CASH" ? "" : r.reference || "" }];
  }

  const tenPaise = r.method === "CASH" && r.tendered ? Math.round(Number(r.tendered) * 100) : null;
  const chgPaise = tenPaise != null ? Math.max(0, tenPaise - t.total) : null;

  try {
    const bill = await api("/bills", "POST", {
      lines: linesPayload(),
      discount_paise: cart.discount,
      discount_reason: cart.reason,
      customer_name: cart.name,
      customer_phone: cart.phone,
      payments,
      tendered_paise: tenPaise,
      change_paise: chgPaise,
      ...(cart.lines.some((l) => l.custom) ? { confirm_secret: confirmSecret } : {})
    }, key);

    const phone = cart.phone;
    reset();
    lookup = null;
    confirmSecret = "";
    render(root);
    if (r.print === "1") requestPrint(bill.id);
    afterSale(bill, chgPaise, phone, r.print === "1");
  } catch (e) { fail(e); }
}

// ------------------------------------------------------------------ Post-sale Dialog with Direct WhatsApp Desktop
async function afterSale(bill, change, phone, printed) {
  const desktopWa = phone ? waLink(bill, C.layout, phone) : null;

  await dialog({
    title: `Bill ${bill.bill_no} Saved Successfully`,
    submit: null,
    wide: true,
    body: `
      ${change != null && change >= 0 ? `<div class="change-big">Change Returned: <b>${rupee(change)}</b></div>` : ""}
      <div class="receipt-preview">${receiptHtml(bill, C.layout, { taxApproved: C.tax_approved })}</div>
      <p class="tiny mt">${printed ? (C.print_method === "direct" ? "Sent to thermal printer." : "Printed.") : "Not printed."}</p>
      <div class="row mt">
        ${printed ? "" : '<button type="button" class="btn btn-primary" data-p="customer">🖨 Print Bill</button>'}
        <button type="button" class="btn" data-p="office">🖨 Office Copy</button>
        ${desktopWa ? `<a class="btn wa" href="${h(desktopWa)}">📲 Send via WhatsApp Desktop</a>` : ""}
      </div>
    `,
    onReady(d) {
      d.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => {
        requestPrint(bill.id, b.dataset.p);
        b.disabled = true;
      }));
    }
  });
}

export const testPrint = (bill, layout, taxApproved) => printBill(bill, layout, { label: "TEST PRINT", taxApproved });
