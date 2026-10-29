// Business flows (tester Suite 2): drives the real screens as each role, end to end.
// Every step must finish with a success message (or the expected block message).
// Usage: node tests/e2e/flows.js   (uses PORT, WORK env; starts its own fresh server)

const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const WORK = process.env.WORK || "/tmp/vtc-e2e";
const PORT = Number(process.env.PORT || 8792);
const U = `http://127.0.0.1:${PORT}/`;
const results = [];
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const WHO = {
  owner: { user: "owner", pw: "VTC-Owner-Demo26" }, admin: { user: "admin", pw: "VTC-Admin-Demo26" },
  manager: { user: "manager", pw: "VTC-Manager-Demo26" }, roaster: { pin: "2580", name: "Demo Roaster" }, packer: { pin: "1470", name: "Demo Packer" },
};

let p, ctx, browser, flow = "", errs = [];
const settle = async () => { await p.waitForTimeout(200); await p.waitForFunction(() => !document.querySelector(".skeleton"), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(150); };

async function as(role) {
  if (ctx) await ctx.close();
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    window.print = () => (window.__printed = (window.__printed || 0) + 1); window.open = (u) => { window.__opened = String(u); return null; };
    // headless has no voices: act like a phone that speaks
    if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { window.__spoken = (window.__spoken || 0) + 1; setTimeout(() => { u.onstart?.(); u.onend?.(); }, 20); };
  });
  p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(`${flow}: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errs.push(`${flow}: ${m.text()}`));
  await p.goto(U); await p.waitForSelector("[data-mode]");
  const r = WHO[role];
  if (r.pin) { await p.click("[data-mode=pin]"); await p.click(`.name-tile:has-text("${r.name}")`); for (const d of r.pin) await p.click(`.pin-key[data-key="${d}"]`); await p.click('.pin-key[data-key="✓"]'); }
  else { await p.click("[data-mode=password]"); await p.fill("input[name=username]", r.user); await p.fill("input[name=password]", r.pw); await p.click("form button[type=submit]"); }
  await p.waitForSelector("#content"); await settle();
}
async function go(m, tab) {
  await p.evaluate((m) => document.querySelector(`nav [data-go="${m}"]`).click(), m); await settle();
  if (tab) { await p.click(`#content .tabs button:has-text("${tab}")`); await settle(); }
}
const toast = () => p.evaluate(() => ({ text: document.getElementById("toast").textContent.trim(), bad: document.getElementById("toast").className.includes("error") }));
async function clearToast() { await p.evaluate(() => { const t = document.getElementById("toast"); t.className = ""; t.textContent = ""; }); }

// Fill every empty required field in the open dialog (or a form) with a sensible value, then apply overrides.
async function fill(scope, over = {}) {
  await p.evaluate(({ scope, over, today }) => {
    const root = document.querySelector(scope);
    const set = (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    root.querySelectorAll("input, select, textarea").forEach((el) => {
      if (el.type === "hidden" || el.type === "checkbox" || el.type === "radio" || el.closest("[hidden]")) return;
      if (el.name in over) return;
      if (el.value !== "" || !el.required) return;
      if (el.tagName === "SELECT") { const o = [...el.options].find((o) => o.value); if (o) set(el, o.value); }
      else if (el.type === "number") { const min = Number(el.min || 1), max = el.max ? Number(el.max) : null; set(el, String(max != null ? Math.min(Math.max(min, 1), max) : Math.max(min, 1))); }
      else if (el.type === "date") set(el, today);
      else set(el, "Tester check note");
    });
    for (const [k, v] of Object.entries(over)) {
      const el = root.querySelector(`[name="${k}"]`);
      if (!el) continue;
      if (el.type === "checkbox") { el.checked = !!v; el.dispatchEvent(new Event("change", { bubbles: true })); }
      else if (el.type === "radio") { const r = root.querySelector(`[name="${k}"][value="${v}"]`); r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
      else set(el, String(v));
    }
  }, { scope, over, today });
}

// One step: click something, fill the dialog it opens, submit, expect success.
async function step(name, click, over = {}, { expectBad = false, noDialog = false, after = null } = {}) {
  await clearToast();
  let ok = true, note = "";
  try {
    if (typeof click === "string") await p.click(click); else await click();
    await p.waitForTimeout(350);
    if (!noDialog) {
      await p.waitForSelector("dialog[open]", { timeout: 5000 });
      await fill("dialog[open]", over);
      await p.click("dialog[open] footer button[type=submit]");
    }
    await p.waitForTimeout(700); await settle();
    const t = await toast();
    if (await p.$("dialog[open] footer button[type=submit]")) { const inv = await p.evaluate(() => [...document.querySelectorAll("dialog[open] :invalid")].map((x) => x.name).join(",")); ok = false; note = `dialog did not close (invalid: ${inv}) ${t.text}`; await p.evaluate(() => document.querySelector("dialog[open] [data-close]")?.click()); }
    else if (expectBad ? !t.bad : t.bad) { ok = false; note = t.text || "no message"; }
    else note = t.text;
    if (ok && after) { const r = await after(); if (r !== true) { ok = false; note = r; } }
  } catch (e) { ok = false; note = e.message.split("\n")[0]; await p.evaluate(() => document.querySelectorAll("dialog[open] [data-close]").forEach((b) => b.click())).catch(() => {}); }
  results.push({ flow, step: name, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${flow} · ${name}${note ? " — " + note : ""}`);
  return ok;
}
async function submitForm(name, formSel, over = {}, opts = {}) {
  return step(name, async () => { await fill(formSel, over); await p.click(`${formSel} button[type=submit], ${formSel} button:not([type])`); }, {}, { ...opts, noDialog: true });
}
const shot = async (n) => { fs.mkdirSync(path.join(WORK, "shots"), { recursive: true }); await p.screenshot({ path: path.join(WORK, "shots", n + ".png"), fullPage: true }); };
const has = (text) => async () => ((await p.textContent("#content")).includes(text) ? true : `screen does not show "${text}"`);

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const pid = execFileSync(path.join(__dirname, "fresh.sh"), [String(PORT), WORK]).toString().trim().split("\n").pop();
  browser = await chromium.launch();
  try {
    // F0 sign-in / sign-out and wrong PIN
    flow = "F0 sign-in";
    await as("roaster");
    await step("sign out", async () => p.evaluate(() => document.querySelector("[data-action=logout]").click()), {}, { noDialog: true, after: async () => { await p.waitForTimeout(500); return (await p.$("[data-mode]")) ? true : "still signed in"; } });
    await step("wrong PIN is refused with a message", async () => { await p.click("[data-mode=pin]"); await p.click('.name-tile:has-text("Demo Packer")'); for (const d of "9999") await p.click(`.pin-key[data-key="${d}"]`); await p.click('.pin-key[data-key="✓"]'); }, {}, { noDialog: true, expectBad: true });

    // F1 Admin Control masters
    flow = "F1 admin masters";
    await as("owner"); await go("admin", "Beans & products");
    await step("add bean type", "[data-madd=product]", { name: "Monsooned Malabar (test)", category: "GREEN_COFFEE", nominal_kg: 50 }, { after: has("Monsooned Malabar (test)") });
    await step("edit bean", async () => p.click("tr:has-text('Monsooned Malabar (test)') [data-medit]"), { nominal_kg: 60 }, { after: has("60 kg") });
    await step("switch bean off", async () => p.click("tr:has-text('Monsooned Malabar (test)') [data-mtoggle]"), {}, { noDialog: true, after: has("switched off") });
    await go("admin", "Clients & suppliers");
    await step("add client", "[data-madd=customer]", { name: "Tester Café", phone: "90000 11111" }, { after: has("Tester Café") });
    await step("add supplier", "[data-madd=supplier]", { name: "Tester Supplier" }, { after: has("Tester Supplier") });
    await go("admin", "Roast profiles");
    await step("add roast profile", "[data-action=addProfile]", { name: "Tester profile", notes: "210C" }, { after: has("Tester profile") });
    await go("admin", "Prices");
    await step("add counter item", "[data-action=newItem]", { name: "Tester 60/40", kind: "coffee_ground", price: 640, coffee_pct: 60 }, { after: has("Tester 60/40") });
    await step("change a price", async () => p.click("tr:has-text('Tester 60/40') [data-edititem]"), { price: 660 }, { after: has("₹660.00") });
    await submitForm("save custom blend rates", "form[data-settings=custom]", { custom_coffee_rate: 900, custom_chicory_rate: 300 });
    await as("manager"); await go("admin", "Clients & suppliers");
    await step("manager suggests a client (draft)", "[data-madd=customer]", { name: "Manager Draft Café" }, { after: has("Manager Draft Café") });
    await as("owner"); await go("admin", "Clients & suppliers");
    await step("owner approves draft", async () => p.click("tr:has-text('Manager Draft Café') [data-mapprove]"), {}, { noDialog: true });

    // F2 inward with partial bags and bean page
    flow = "F2 inward";
    await as("roaster"); await go("inward");
    await submitForm("receive 6 bags: 1 damaged, 1 partial", "form[data-form=inward]", { source: "AUCTION", source_name: "Tester Auction", product_id: await p.$$eval("form[data-form=inward] [name=product_id] option", (o) => o.find((x) => x.textContent.includes("Robusta")).value), bags: 6, damaged: 1, partial: 1, partial_kg: 30 });
    await go("inventory");
    await step("open bean page", async () => p.click(".stockcard [data-invproduct] >> nth=0"), {}, { noDialog: true, after: async () => ((await p.$$(".bagcol")).length === 3 ? true : "bean page has no 3 columns") });
    await as("owner"); await go("inventory");
    await step("verify damaged kg", async () => { await p.click(".stockcard:has-text('Robusta') [data-invproduct]"); await settle(); await p.click("[data-verify] >> nth=0"); }, { verified_kg: 48 });

    // F3 work-linked task with review
    flow = "F3 tasks";
    await as("manager"); await go("tasks");
    await step("assign 1 roasting batch to roaster", async () => { await p.click("[data-action=newTask]"); await p.waitForSelector("dialog[open] [name=kind]"); await p.selectOption("dialog[open] [name=kind]", "ROAST"); const v = await p.$$eval("dialog[open] [name=assigned_to] option", (o) => o.find((x) => x.textContent.includes("Roaster")).value); await p.selectOption("dialog[open] [name=assigned_to]", v); }, { target: 1 }, { after: has("Roast 1 batches") });
    await as("roaster"); await go("roasting");
    await submitForm("roast 2 lots with a profile", "form[data-form=roasting]", { kg_1: 10, output_kg: 8.4, duration_min: 15 });
    await go("tasks");
    await step("mark completed", async () => p.click("tr:has-text('Roast 1') [data-tsubmit]"), {});
    await as("manager"); await go("tasks");
    await step("send back", async () => { await p.click("[data-tfilter=review]"); await settle(); await p.click("[data-treview$=':0'] >> nth=0"); }, { note: "Please weigh output again" });
    await as("roaster"); await go("tasks");
    await step("complete again", async () => p.click("tr:has-text('Roast 1') [data-tsubmit]"), {});
    await as("manager"); await go("tasks");
    await step("approve", async () => { await p.click("[data-tfilter=review]"); await settle(); await p.click("[data-treview$=':1'] >> nth=0"); }, {});

    // F4 QC and calendar
    flow = "F4 QC + calendar";
    await as("owner"); await go("qc");
    await step("release held batch", "[data-qc$=':RELEASED'] >> nth=0", { note: "Colour checked" });
    await go("roasting");
    await step("calendar previous month", '[data-calmonth="-1"]', {}, { noDialog: true });
    await step("calendar next month", '[data-calmonth="1"]', {}, { noDialog: true });
    await step("open today on calendar", `[data-calday="${today}"]`, {}, { noDialog: true, after: has("today") });

    // F5 grind → counter
    flow = "F5 grind + transfer";
    await as("roaster"); await go("blending");
    await go("blending", "Grinding");
    await step("grind roasted coffee", "[data-action=newGrind]", { input_kg: 5, output_kg: 4.9 });
    await go("inventory");
    await p.click(".stockcard:has-text('Ground') [data-invproduct] >> nth=0"); await settle();   // v1.3: ground coffee sits under its bean card
    await step("send ground coffee to counter", "tr:has-text('GROUND') [data-sendctr] >> nth=0", { kg: 2 });
    await as("manager"); await go("counter");
    await step("receive short at counter", "[data-receive] >> nth=0", { kg: 1.9 });

    // F6 counter selling
    flow = "F6 counter";
    await as("roaster"); await go("counter");
    await step("add price-list item 500 g", async () => { await p.click(".pos-tile:not(.other) >> nth=0"); await p.click("dialog[open] [data-g='500']"); }, {}, { after: async () => ((await p.$$(".bill-line")).length ? true : "item not in bill") });
    await step("add Others 80/20", async () => { await p.click("[data-action=customBlend]"); await p.click("dialog[open] [data-pct='80']"); }, { grams: 250 }, { after: async () => ((await p.$$(".bill-line")).length === 2 ? true : "custom line missing") });
    await step("pay split cash + UPI", async () => { await p.click("[data-action=pay]"); await p.waitForSelector("dialog[open]"); await p.check("dialog[open] input[value=SPLIT]"); const tot = await p.evaluate(() => Number(document.querySelector("dialog[open] h2").textContent.replace(/[^\d.]/g, ""))); await p.fill("dialog[open] [name=cash_part]", String(Math.floor(tot / 2))); await p.dispatchEvent("dialog[open] [name=cash_part]", "input"); }, {}, { after: async () => ((await p.$("dialog[open] [data-copies]")) ? true : "no copies choice after sale") });
    await step("print customer + office copy", "dialog[open] [data-copies='2']", {}, { noDialog: true, after: async () => ((await p.evaluate(() => window.__printed)) ? true : "print not started") });
    await p.evaluate(() => document.querySelector("dialog[open] [data-close]")?.click());
    await go("counter", "Today's bills");
    await step("reprint a bill", async () => { await p.click("[data-bill] >> nth=0"); await p.waitForSelector("dialog[open] [data-reprint]"); await p.click("dialog[open] [data-reprint='1']"); }, {}, { noDialog: true, after: async () => { await p.evaluate(() => document.querySelector("dialog[open] [data-close]")?.click()); return (await p.evaluate(() => window.__printed)) ? true : "reprint did not print"; } });
    await step("ask for a refund", "[data-askrefund] >> nth=0", { amount: 10, reason: "Customer returned 10 rupees worth" });
    await as("manager"); await go("counter", "Today's bills");
    await step("approve refund", "[data-refund$=':1'] >> nth=0", {}, { noDialog: true });

    // F7 close today's bills
    flow = "F7 day close";
    await as("roaster"); await go("counter", "Today's bills");
    await step("close today's bills", async () => { await p.click("button:has-text(\"Close today's bills →\")"); await settle(); const exp = await p.evaluate(() => document.querySelector(".kv.total b").textContent.replace(/[₹,]/g, "")); await fill("form[data-cform=close]", { counted: exp }); await p.click("form[data-cform=close] button:not([type=button])"); }, {}, { noDialog: true });
    await step("selling is locked", async () => go("counter", "Sell"), {}, { noDialog: true, after: has("Counter closed for today") });
    await step("day register prints", async () => { await go("counter", "Day close"); await p.click("[data-register] >> nth=0"); await p.waitForSelector("dialog[open] [data-preg]"); await p.click("dialog[open] [data-preg]"); }, {}, { noDialog: true, after: async () => { await p.evaluate(() => document.querySelector("dialog[open] [data-close]")?.click()); return (await p.evaluate(() => window.__printed)) ? true : "register did not print"; } });
    await as("admin"); await go("counter", "Day close");
    await step("admin reopens", "[data-reopen]", { reason: "Closed early by mistake" });
    await step("selling works again", async () => go("counter", "Sell"), {}, { noDialog: true, after: async () => ((await p.$("[data-additem]")) ? true : "still locked") });

    // F8 blending + packing
    flow = "F8 blend + pack";
    await as("owner"); await go("blending", "Blend jobs");
    await step("run confidential blend", async () => {
      await p.click("[data-action=newBlend]"); await p.waitForSelector("dialog[open] [name=recipe_id]"); await p.click("dialog[open] footer button[type=submit]"); await p.waitForTimeout(500);
      await p.evaluate(() => document.querySelectorAll("dialog[open] select").forEach((el) => { const o = [...el.options].find((o) => o.value); if (o) { el.value = o.value; el.dispatchEvent(new Event("change", { bubbles: true })); } }));
    }, { kg_0: 0.7, kg_1: 0.3, output_kg: 0.98 });
    await as("manager"); await go("packing");
    await submitForm("create packing ticket", "form[data-form=packTicket]", { product_name: "Tester blend", packs_target: 4, pack_g: 250 });
    await as("packer"); await go("packing");
    await step("record packing", async () => { await p.click("[data-packrun] >> nth=0"); await p.waitForSelector("dialog[open] [name=source_lot_id]"); const v = await p.$$eval("dialog[open] [name=source_lot_id] option", (o) => o.find((x) => /RST-|ROASTED|Roasted/.test(x.textContent))?.value || o[0].value); await p.selectOption("dialog[open] [name=source_lot_id]", v); }, { input_kg: 1.05, good_packs: 4, rejected_packs: 0 });
    await as("owner"); await go("packing");
    await step("QA release packs", "[data-packqa] >> nth=0", { note: "Seal and label checked" });

    // F9 outside roasting
    flow = "F9 outside";
    await as("roaster"); await go("outside");
    await step("roast customer coffee", "[data-oroast] >> nth=0", { input_kg: 20, output_kg: 16.8 });
    await step("return to customer", "[data-oreturn] >> nth=0", { kg: 16.8, note: "Handed to café driver" });
    await as("manager"); await go("outside");
    await step("record payment", "[data-opaid] >> nth=0", {}, { noDialog: true });

    // F10 orders → dispatch → invoice → collection
    flow = "F10 orders";
    await as("manager"); await go("orders");
    await step("create order", "[data-action=newOrder]", { item: "Tester roasted beans", quantity_kg: 3 });
    await as("owner"); await go("orders");
    await step("set price", "[data-oprice] >> nth=0", { price: 520, gst: 5 });
    await as("manager"); await go("orders");
    await step("confirm order", "[data-oconfirm] >> nth=0", {}, { noDialog: true });
    await as("owner"); await go("orders");
    await step("record customer payment (pay-first order)", "[data-oadvance] >> nth=0", { amount: 1638, reference: "UPI-ADV" });
    await step("credit decision (dealer order)", "[data-ocredit] >> nth=0", { approve: "1", note: "Known customer" });
    await as("roaster"); await go("dispatch");
    await step("dispatch", "[data-dispatch] >> nth=0", { mode: "RAPIDO", booking_ref: "RPD-T", handover_to: "Rider T", rest_ok: true });
    await step("confirm delivery", "[data-deliver] >> nth=0", { pod_note: "Signed by café" });
    await as("owner"); await go("orders");
    await step("open invoice", "[data-invoice] >> nth=0", {}, { noDialog: true, after: async () => { const ok = await p.$("dialog[open] .doc"); await p.evaluate(() => document.querySelector("dialog[open] [data-close]")?.click()); return ok ? true : "invoice did not open"; } });
    await as("manager"); await go("finance");
    await step("record collection", "[data-collect] >> nth=0", { amount: 100, method: "UPI", reference: "UPI-T" });
    await as("owner"); await go("finance");
    await step("verify collection", "[data-verifycol$=':1'] >> nth=0", {}, { noDialog: true });

    // F11 supplier payment + Tally
    flow = "F11 payables + Tally";
    await as("owner"); await go("finance", "Supplier payables");
    await step("approve supplier payment", "[data-decidepay$=':1'] >> nth=0", {}, { noDialog: true });
    await go("finance", "Tally export");
    await submitForm("export to Tally", "form[data-fform=tally]", { from: today, to: today });
    await p.evaluate(() => document.querySelectorAll("dialog[open] [data-close]").forEach((b) => b.click()));
    await step("mark Tally accepted", "[data-tallyres$=':1'] >> nth=0", { note: "Imported fine" });

    // F12 messages
    flow = "F12 messages";
    await as("roaster"); await go("comms");
    await step("open team group and post", async () => { await p.click("[data-conv] >> nth=1"); await settle(); await p.fill("form[data-compose] textarea, form[data-compose] input[name=body]", "Batch 3 on the drum"); await p.click("form[data-compose] button[type=submit], form[data-compose] button:not([type])"); }, {}, { noDialog: true, after: has("Batch 3 on the drum") });
    await step("new chat to manager", "[data-action=newChat]", {}, { noDialog: false });
    await go("roasting");
    await step("discuss a roast", "[data-discuss] >> nth=0", {}, { noDialog: true, after: async () => ((await p.$("dialog[open], #content [data-compose]")) ? true : "thread did not open") });
    await p.evaluate(() => document.querySelector("dialog[open] [data-close]")?.click());
    let bellOk = false;
    await step("bell opens alerts", async () => { await p.click("[data-action=bell]"); await p.waitForTimeout(500); bellOk = !!(await p.$("dialog[open]")); await p.evaluate(() => document.querySelectorAll("dialog[open] [data-close]").forEach((b) => b.click())); }, {}, { noDialog: true, after: async () => (bellOk ? true : "bell did nothing") });

    // F13 admin people & roles
    flow = "F13 admin";
    await as("owner"); await go("admin", "People");
    await step("add staff person", "[data-action=addPerson]", { full_name: "Tester Staff", username: "tester.staff", login_type: "pin", secret: "4826" });
    await step("lands on the new person's page", async () => {}, {}, { noDialog: true, after: has("Tester Staff") });
    await step("give personal access until a date", "[data-grant$=':allow'] >> nth=0", { reason: "Covering for leave", until: today });
    await step("preview what they see", "[data-action=preview]", {}, { noDialog: true, after: async () => { const ok = await p.$("dialog[open]"); await p.evaluate(() => document.querySelector("dialog[open] [data-close]")?.click()); return ok ? true : "preview did not open"; } });
    await go("admin", "Settings");
    await submitForm("save business values", "form[data-settings=business]", {});
    await go("admin", "Audit log");
    await step("audit has entries", async () => {}, {}, { noDialog: true, after: has("TASK_APPROVED") });

    // F14 counts + exceptions links
    flow = "F14 counts + exceptions";
    await as("owner"); await go("inventory");
    await step("decide a count difference", "[data-countdecide$=':0'] >> nth=0", { note: "Recount needed, rejecting" });
    await go("exceptions");
    await step("exception opens its screen", async () => p.click("#content [data-go] >> nth=0"), {}, { noDialog: true, after: async () => ((await p.evaluate(() => location.hash)) !== "#exceptions" ? true : "exception link did not open its screen") });

    // F15 dashboard customise
    flow = "F15 dashboard";
    await as("packer"); await go("dashboard");
    // v1.5: press and hold a card, move it, let go; S/M/L size; ✕ remove; Done. Saves by itself.
    const cards = () => p.$$eval("#wgrid > .w-card", (x) => x.map((c) => c.dataset.w + ":" + c.dataset.size));
    const before15 = await cards();
    let expected15 = null;
    await step("press and hold a card, move it to the end", async () => {
      const box = (sel) => p.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, tx: r.left + r.width * 0.85, ty: r.top + r.height * 0.85 }; }, sel);
      const a = await box("#wgrid > .w-card:nth-child(1) > .card"); await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.waitForTimeout(650);
      const b = await box("#wgrid > .w-card:last-child > .card");   // measured with the card already lifted
      for (let i = 1; i <= 12; i++) { await p.mouse.move(a.x + (b.tx - a.x) * i / 12, a.y + (b.ty - a.y) * i / 12); await p.waitForTimeout(30); }
      await p.waitForTimeout(200); await p.mouse.up(); await p.waitForTimeout(400);
    }, {}, { noDialog: true, after: async () => { const now = await cards(); return now[now.length - 1] === before15[0] ? true : `order is ${now.join(",")}`; } });
    const small = (await cards()).find((c) => c.endsWith(":s"))?.split(":")[0];
    await step("make a small card wide", `#wgrid > .w-card[data-w="${small}"] [data-wtool=size]`, {}, { noDialog: true, after: async () => ((await cards()).includes(small + ":m") ? true : "size did not change") });
    const gone = (await cards())[0].split(":")[0];
    await step("remove a card", "#wgrid > .w-card:nth-child(1) [data-wtool=remove]", {}, { noDialog: true, after: async () => { const now = await cards(); expected15 = now; return !now.some((c) => c.startsWith(gone + ":")) ? true : "card still there"; } });
    await step("done, and it is saved", "[data-wtool=done]", {}, { noDialog: true, after: async () => { await p.waitForTimeout(600); await p.reload(); await p.waitForSelector("#wgrid"); await settle(); const now = await cards(); return JSON.stringify(now) === JSON.stringify(expected15) ? true : `after reload: ${now.join(",")} expected ${expected15.join(",")}`; } });
    await shot("dashboard-arranged");
    // F16 returning counter customer (v1.2)
    flow = "F16 counter customer";
    await as("roaster"); await go("counter");
    await step("phone shows last bill", async () => { await p.fill("input[name=cust_phone]", "9000000001"); await p.dispatchEvent("input[name=cust_phone]", "input"); await p.waitForTimeout(800); await settle(); },
      {}, { noDialog: true, after: async () => ((await p.textContent("#content")).match(/Last bill/) && !(await p.textContent("#content")).includes("9000000001") ? true : "no masked last-bill card") });
    await shot("counter-customer");
    await as("owner"); await go("counter", "Customers");
    await step("owner sees full customer list", async () => {}, {}, { noDialog: true, after: has("9000000001") });

    // F17 cash today PIN (v1.2)
    flow = "F17 cash today";
    await go("counter", "Cash today");
    await submitForm("wrong PIN refused", "form[data-cform=unlock]", { pin: "1111" }, { expectBad: true });
    await submitForm("right PIN opens", "form[data-cform=unlock]", { pin: "4826" }, { after: has("Cash that should be in the drawer") });
    await submitForm("owner adds collection", "form[data-cform=collect]", { method: "CASH", amount: 300 }, { after: has("Cash entered vs drawer") });
    await shot("cash-today");
    await step("lock again", "[data-action=lockCash]", {}, { noDialog: true, after: has("Cash today is locked") });

    // F18 roasting month record (v1.2)
    flow = "F18 roast month";
    await as("roaster"); await go("roasting"); await shot("roasting-day");
    await p.click("[data-rtab=month]"); await settle();
    await submitForm("end reading", "form[data-form=meter]", { start_reading: 6605, end_reading: 6640 }, { after: has("32 more batches") });
    await submitForm("gas cylinder", "form[data-form=cylinder]", { kg: 19 });
    await shot("roasting-month");

    // F19 maintenance ticket (v1.2)
    flow = "F19 maintenance";
    await as("packer"); await go("maintenance");
    await step("staff raises ticket", "[data-action=newTicket]", { title: "Scale 2 shows wrong weight", area: "SCALE", urgency: "URGENT" }, { after: has("Scale 2 shows wrong weight") });
    await as("manager"); await go("maintenance");
    await step("resolve needs a note", "[data-mupdate] >> nth=0", { status: "RESOLVED", note: "" }, { expectBad: true });
    await step("manager resolves", "[data-mupdate] >> nth=0", { status: "RESOLVED", note: "Recalibrated with test weight" });
    await go("maintenance", "Fixed"); await shot("maintenance");
    await step("fixed list shows it", async () => {}, {}, { noDialog: true, after: has("Recalibrated") });
    // F20 stock cards (v1.3)
    flow = "F20 stock cards";
    await as("owner"); await go("inventory");
    await step("no grand total, cards shown", async () => {}, {}, { noDialog: true, after: async () => ((await p.$$(".stockcard")).length >= 2 && !(await p.textContent("#content")).includes("Free to use") ? true : "cards missing or total shown") });
    await p.click("[data-sc=edit]"); await settle();
    await step("rename a card", "[data-sc^='edit:'] >> nth=0", { label: "House Arabica", low_kg: 5 }, { after: has("House Arabica") });
    await step("remove a card", "[data-sc^='hide:'] >> nth=0", {}, { noDialog: true, after: has("Removed cards") });
    await step("bring it back", "[data-sc^='show:'] >> nth=0", {}, { noDialog: true });
    await shot("stock-cards");

    // F21 hierarchy + staff details (v1.3)
    flow = "F21 team";
    await go("team"); await shot("team");
    await step("set who the packer reports to", '.tnode:has-text("Demo Packer") [data-boss]', { reports_to: "" }, { after: has("Demo Packer") });
    await step("open staff details", '[data-staff] >> nth=-1', {}, { noDialog: true, after: has("Documents") });
    await step("edit details, ID kept as last 4", "[data-profedit]", { designation: "Packer (sample)", aadhaar: "123412341234", ifsc: "HDFC0001234" }, { after: has("•••• 1234") });

    // F22 roles + delivery apps (v1.3)
    flow = "F22 roles & dispatch";
    await as("admin"); await go("admin", "Roles");
    await p.click('.role-list button:has-text("Staff")').catch(() => {}); await settle();
    await step("admin renames a built-in role", "[data-action=renameRole]", { name: "Floor Team" }, { after: has("Floor Team") });
    await go("dispatch");
    const hb = await p.$("[data-dispatch]:not([disabled])");
    let rides = 0;
    if (hb) await step("delivery app buttons", async () => { await hb.click(); await p.waitForTimeout(400); rides = (await p.$$("dialog[open] [data-ride]")).length; await p.click("dialog[open] [data-close] >> nth=0"); }, {}, { noDialog: true, after: async () => (rides === 2 ? true : "no Rapido/Uber buttons") });
    // F23 codes, labels, scanning (v1.4)
    flow = "F23 codes & scan";
    await as("roaster"); await go("inward");
    await submitForm("stock input gets a code", "form[data-form=inward]", { source: "AUCTION", source_name: "Code Auction", product_id: await p.$$eval("form[data-form=inward] [name=product_id] option", (o) => o.find((x) => x.value).value), bags: 3, damaged: 0, partial: 0 },
      { after: async () => (/IN-\d{6}-\d{2} saved/.test(await p.textContent(".saved-banner")) ? true : "no saved banner with the IN- code") });
    await step("print bag labels", "[data-baglabels]", {}, { after: async () => ((await p.evaluate(() => window.__printed || 0)) > 0 && (await p.$$("#print-area .qr-label")).length === 3 ? true : "3 bag labels not printed") });
    const raw = await p.evaluate(() => document.querySelector(".saved-banner .tiny").textContent.split(" ")[0]);
    await step("scan by typing a code", async () => { await p.click("[data-action=scan]"); await p.waitForTimeout(300); await p.fill("dialog[open] [name=code]", raw.toLowerCase() + "/2"); await p.click("dialog[open] footer button[type=submit]"); await p.waitForTimeout(700); },
      {}, { noDialog: true, after: async () => { const t = await p.textContent("dialog[open]"); await p.click("dialog[open] [data-close] >> nth=0"); return t.includes(raw) && t.includes("Bag 2 of 3") ? true : "lot sheet missing code or bag"; } });
    await step("handheld scanner anywhere", async () => { await p.evaluate(() => document.activeElement?.blur()); await p.keyboard.type(raw, { delay: 5 }); await p.keyboard.press("Enter"); await p.waitForTimeout(700); },
      {}, { noDialog: true, after: async () => { const ok = (await p.textContent("dialog[open] h2").catch(() => "")) === raw; if (ok) await p.click("dialog[open] [data-act=count]"); return ok ? true : "handheld scan did not open the lot"; } });
    await step("count from the scan sheet", async () => {}, { counted_kg: 150, note: "Scanned and weighed" }, { noDialog: false });

    // F24 WhatsApp (v1.4)
    flow = "F24 whatsapp";
    await as("owner"); await go("finance");
    const rem = await p.$("[data-waremind]");
    if (rem) await step("payment reminder opens WhatsApp", async () => rem.click(), {}, { noDialog: true, after: async () => ((await p.evaluate(() => window.__opened || "")).startsWith("https://wa.me/91") ? true : "no wa.me link") });
    await go("orders");
    const wo = await p.$("[data-waorder]");
    if (wo) await step("order confirmation opens WhatsApp", async () => wo.click(), {}, { noDialog: true, after: async () => (decodeURIComponent(await p.evaluate(() => window.__opened || "")).includes("is confirmed") ? true : "no order message") });

    // F25 My profile (v1.5)
    flow = "F25 my profile";
    await as("packer");
    await step("initials button opens My profile", "[data-action=account]", {}, { noDialog: true, after: has("Where I'm signed in") });
    await submitForm("save my emergency contact", "form[data-form=meContact]", { emergency_name: "Packer's sister (sample)", emergency_phone: "90000 22222" }, { after: async () => ((await p.inputValue("[name=emergency_name]")) === "Packer's sister (sample)" ? true : "not kept") });
    await submitForm("bad phone is refused", "form[data-form=meContact]", { phone: "12" }, { expectBad: true });
    await step("read-aloud speed", "[data-rate='1.1']", {}, { noDialog: true, after: async () => ((await p.$("[data-rate='1.1'].on")) ? true : "speed not chosen") });
    await submitForm("new PIN must be typed twice the same", "form[data-form=meSecret]", { current: "1470", new: "8642", confirm: "8640" }, { expectBad: true });
    await shot("my-profile");

    // F26 staff details in Admin Control + tree (v1.5)
    flow = "F26 staff details";
    await as("admin"); await go("admin", "Staff details");
    await step("open a person from the staff list", "#content [data-staff] >> nth=1", {}, { noDialog: true, after: has("Documents") });
    await step("edit from Admin Control", "[data-profedit]", { designation: "Shift lead (sample)" }, { after: has("Shift lead (sample)") });
    await go("admin", "People");
    await step("People → person shows staff details", '#content tr:has-text("Demo Packer") [data-person]', {}, { noDialog: true, after: has("Staff details") });
    await go("admin", "People");
    await step("the owner's record stays the owner's", '#content tr:has-text("Owner (Demo)") [data-person]', {}, { noDialog: true, after: async () => ((await p.textContent("#content")).includes("are the owner's own") && !(await p.$("[data-profedit]")) ? true : "admin can open the owner's staff record") });
    await go("team");
    await step("hierarchy is a tree chart", async () => {}, {}, { noDialog: true, after: async () => ((await p.$$(".tree ul ul .tnode")).length >= 2 ? true : "no tree") });
    await step("zoom the tree", "[data-tzoom='-1']", {}, { noDialog: true, after: async () => (Number(await p.evaluate(() => document.querySelector(".tree").style.zoom)) < 1 ? true : "zoom unchanged") });
    await shot("team-tree");

    // F27 go-live setup (v1.6)
    flow = "F27 go-live";
    await as("admin"); await go("admin", "Go-live setup");
    await step("add an opening stock line", "[data-gl=addstock]", { form: "RAW", kg: 120, bags: 3 }, { after: has("120") });
    await step("add an old due", "[data-gl=adddue]", { amount: 1500 }, { after: has("₹1,500") });
    await step("admin can't go live", async () => {}, {}, { noDialog: true, after: has("Only the owner presses") });
    await as("owner"); await go("admin", "Go-live setup");
    await step("owner goes live", async () => { await p.fill("[data-glform] [name=cash]", "2000"); await p.click("[data-glform] button"); await p.waitForSelector("dialog[open]"); await p.click("dialog[open] footer button[type=submit]"); }, {}, { noDialog: true, after: has("Live since") });
    await go("finance", "Old dues");
    await step("old due shows in Finance", async () => {}, {}, { noDialog: true, after: has("₹1,500") });
  } catch (e) {
    results.push({ flow, step: "runner", ok: false, note: e.message.split("\n")[0] }); console.log("CRASH", flow, e.message.split("\n")[0]);
  } finally {
    await browser.close();
    try { process.kill(Number(pid)); } catch {}
  }
  const failed = results.filter((r) => !r.ok);
  errs.forEach((e) => console.log("JS:", e));
  fs.writeFileSync(path.join(WORK, `flows-${Date.now()}.json`), JSON.stringify({ results, errs }, null, 1));
  console.log(`\n${results.length - failed.length}/${results.length} steps passed, ${errs.length} script errors`);
  process.exit(failed.length || errs.length ? 1 : 0);
})();
