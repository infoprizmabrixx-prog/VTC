// Option crawler (tester Suite 1). Signs in as each role on a fresh database and
// clicks every distinct button on every screen and tab, from a fresh screen state.
// A click must DO something: open a dialog, change the page, show a message,
// start printing or navigate. Anything else is reported as a DEAD option.
//
// Usage:
//   node tests/e2e/crawl.js                    # real server, all roles
//   node tests/e2e/crawl.js --roles owner,packer
//   node tests/e2e/crawl.js --preview <file.html>
// Writes JSON results to $OUT (default ./e2e-crawl.json) and prints a summary.

const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PREVIEW = opt("--preview", null);
const WORK = process.env.WORK || "/tmp/vtc-e2e";
const OUT = process.env.OUT || path.join(WORK, "e2e-crawl.json");
let PORT = Number(process.env.PORT || 8800);
const PER_KIND = Number(opt("--per-kind", 2));

const ROLES = {
  owner: { user: "owner", pw: "VTC-Owner-Demo26", w: 1366, demo: 0 },
  admin: { user: "admin", pw: "VTC-Admin-Demo26", w: 1280, demo: 1 },
  manager: { user: "manager", pw: "VTC-Manager-Demo26", w: 1280, demo: 2 },
  roaster: { pin: "2580", name: "Demo Roaster", w: 820, demo: 3, lang: "te" },
  packer: { pin: "1470", name: "Demo Packer", w: 390, demo: 4 },
};
const pick = (opt("--roles", "") || Object.keys(ROLES).join(",")).split(",");
const findings = [];
const add = (role, where, kind, detail) => findings.push({ role, where, kind, detail });

async function signIn(p, r) {
  if (PREVIEW) {
    await p.waitForSelector(".demo-card", { timeout: 30000 });
    await p.click(`[data-demo='${r.demo}']`);
  } else {
    await p.waitForSelector("[data-mode]");
    if (r.pin) {
      await p.click("[data-mode=pin]"); await p.click(`.name-tile:has-text("${r.name}")`);
      for (const d of r.pin) await p.click(`.pin-key[data-key="${d}"]`);
      await p.click('.pin-key[data-key="✓"]');
    } else {
      await p.click("[data-mode=password]");
      await p.fill("input[name=username]", r.user); await p.fill("input[name=password]", r.pw);
      await p.click("form button[type=submit]");
    }
  }
  await p.waitForSelector("#content", { timeout: 30000 });
  await settle(p);
}

async function settle(p) {
  await p.waitForTimeout(250);
  await p.waitForFunction(() => !document.querySelector(".skeleton"), null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(150);
}

const state = (p) => p.evaluate(() => ({
  content: document.getElementById("content")?.innerHTML.length + ":" + (document.getElementById("content")?.innerText || "").slice(0, 4000),
  hash: location.hash, toast: document.getElementById("toast")?.className + "|" + document.getElementById("toast")?.textContent,
  printed: (window.__printed || 0) + (window.__picker || 0) * 1000 + (window.__downloads || 0) * 100000 + (window.__spoken || 0) * 1e7 + (window.__opened || 0) * 1e9, dialogs: document.querySelectorAll("dialog[open]").length,
  dialogHtml: [...document.querySelectorAll("dialog[open]")].map((d) => d.innerHTML.length + d.innerText).join("|"),
  sidebar: document.getElementById("sidebar")?.className || "",
}));

async function goModule(p, m, tab) {
  await p.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => { d.close(); d.remove(); }));
  if (m === "profile") await p.evaluate(() => document.querySelector("[data-action=account]").click());   // not in the menu
  else await p.evaluate((m) => document.querySelector(`nav [data-go="${m}"]`)?.click(), m);
  await settle(p);
  if (tab != null) {
    await p.evaluate((t) => [...document.querySelectorAll("#content .tabs button")].find((b) => b.innerText.trim().replace(/\(\d+\)/, "").trim() === t)?.click(), tab);
    await settle(p);
  }
}

// Every visible enabled button (and keyboard-clickable card) inside the content area, with a stable key.
const listButtons = (p) => p.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest("[hidden]"); };
  const out = [];
  document.querySelectorAll("#content button, #content [data-go][role=button]").forEach((el) => {
    if (!vis(el) || el.disabled || el.closest(".tabs") || el.getAttribute("aria-current") === "true" || el.getAttribute("aria-pressed") === "true") return;
    const attrs = [...el.attributes].filter((a) => a.name.startsWith("data-") && a.name !== "data-label").map((a) => a.name + "=" + a.value).sort();
    const text = el.innerText.trim().replace(/\s+/g, " ").slice(0, 40);
    const kind = (attrs[0] || "").split("=")[0] + "|" + text.replace(/[\d.,₹#]+/g, "#");
    out.push({ key: attrs.join("&") + "|" + text, kind, text, attrs });
  });
  return out;
});

async function clickByKey(p, key) {
  return p.evaluate((key) => {
    const els = [...document.querySelectorAll("#content button, #content [data-go][role=button]")];
    const el = els.find((el) => {
      const attrs = [...el.attributes].filter((a) => a.name.startsWith("data-") && a.name !== "data-label").map((a) => a.name + "=" + a.value).sort();
      return attrs.join("&") + "|" + el.innerText.trim().replace(/\s+/g, " ").slice(0, 40) === key;
    });
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  }, key);
}

async function exerciseDialog(p, role, where) {
  // click every helper button inside the open dialog (presets, print copies…), never submit/close
  const keys = await p.evaluate(() => [...document.querySelectorAll("dialog[open] button[type=button]")]
    .filter((b) => !b.hasAttribute("data-close") && b.getBoundingClientRect().width > 0)
    .map((b, i) => i));
  const n = keys.length;
  for (let i = 0; i < Math.min(n, 6); i++) {
    await p.evaluate(() => { const t = document.getElementById("toast"); t.className = ""; t.textContent = ""; });
    const before = await state(p);
    const label = await p.evaluate((i) => {
      const b = [...document.querySelectorAll("dialog[open] button[type=button]")].filter((b) => !b.hasAttribute("data-close") && b.getBoundingClientRect().width > 0)[i];
      if (!b) return null; b.click(); return b.innerText.trim().slice(0, 30);
    }, i);
    if (label == null) break;
    await p.waitForTimeout(450);
    const after = await state(p);
    const dlgInputs = await p.evaluate(() => [...document.querySelectorAll("dialog[open] input, dialog[open] select")].map((x) => x.value).join("|"));
    if (JSON.stringify(before) === JSON.stringify(after) && !(await p.evaluate(() => window.__lastInputChange && Date.now() - window.__lastInputChange < 1000)))
      add(role, where, "DEAD_IN_DIALOG", `"${label}" inside the dialog did nothing (${dlgInputs.slice(0, 60)})`);
    if (after.dialogs > before.dialogs) await p.evaluate(() => { const ds = document.querySelectorAll("dialog[open]"); const d = ds[ds.length - 1]; d.querySelector("[data-close]")?.click(); });
  }
}

async function runRole(browser, name) {
  const r = ROLES[name];
  let pid = null;
  PORT += 1;
  if (!PREVIEW) pid = execFileSync(path.join(__dirname, "fresh.sh"), [String(PORT), WORK]).toString().trim().split("\n").pop();
  const ctx = await browser.newContext({ viewport: { width: r.w, height: 900 } });
  try { return await crawlRole(ctx, name, r); } finally { await ctx.close().catch(() => {}); if (pid) try { process.kill(Number(pid)); } catch {} }
}

async function crawlRole(ctx, name, r) {
  await ctx.addInitScript(() => {
    window.print = () => { window.__printed = (window.__printed || 0) + 1; };
    const ic = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () { if (this.type === "file") { window.__picker = (window.__picker || 0) + 1; return; } return ic.call(this); };
    const ac = HTMLAnchorElement.prototype.click;
    // new tabs (delivery apps, documents) are counted instead of opened
    window.open = () => { window.__opened = (window.__opened || 0) + 1; return null; };
    document.addEventListener("click", (e) => { const a = e.target.closest?.("a[target=_blank]"); if (a) { e.preventDefault(); window.__opened = (window.__opened || 0) + 1; } }, true);
    // read-aloud is not observable headless: count speak() calls instead
    if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { window.__spoken = (window.__spoken || 0) + 1; setTimeout(() => { u.onstart?.(); u.onend?.(); }, 20); };
    HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads = (window.__downloads || 0) + 1; return; } return ac.call(this); };
    document.addEventListener("input", () => (window.__lastInputChange = Date.now()), true);
  });
  const p = await ctx.newPage();
  let where = "sign-in";
  p.on("pageerror", (e) => add(name, where, "JS_ERROR", e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/401|status of 4\d\d/.test(m.text())) add(name, where, "CONSOLE_ERROR", m.text()); });
  p.on("response", (res) => { if (res.status() >= 500) add(name, where, "SERVER_500", res.url()); });
  await p.goto(PREVIEW ? "file://" + path.resolve(PREVIEW) : `http://127.0.0.1:${PORT}/`);
  if (PREVIEW) await p.evaluate(() => localStorage.clear()).then(() => p.reload());
  await signIn(p, r);
  let clicks = 0;

  // header controls
  where = "header";
  for (const sel of ["[data-action=bell]"]) {
    await p.click(sel); await p.waitForTimeout(400);
    if (!(await p.$("dialog[open]"))) add(name, where, "DEAD", `${sel} opened nothing`);
    else { await exerciseDialog(p, name, `header ${sel}`); await p.evaluate(() => document.querySelector("dialog[open] [data-close]")?.click()); }
    clicks++;
  }
  // v1.5: the initials button opens My profile (a page, not a dialog)
  await p.click("[data-action=account]"); await settle(p); clicks++;
  if ((await p.evaluate(() => location.hash)) !== "#profile") add(name, where, "DEAD", "initials button did not open My profile");
  if (r.w < 900) {
    await p.click(".mobile-menu"); await p.waitForTimeout(300);
    if (!(await p.evaluate(() => document.getElementById("sidebar").classList.contains("open")))) add(name, where, "DEAD", "phone menu button did not open the menu");
    await p.evaluate(() => document.getElementById("sidebar").classList.remove("open"));
  }
  if (r.lang) {
    await p.selectOption("#lang", r.lang); await settle(p);
    const raw = await p.evaluate(() => (document.body.innerText.match(/\b[a-z]+[A-Z][a-zA-Z]+\b/g) || []).filter((w) => !/^(iPhone|eKYC)$/.test(w)));
    if (raw.length) add(name, "language " + r.lang, "RAW_KEY", raw.slice(0, 5).join(", "));
  }

  const modules = [...(await p.$$eval("nav [data-go]", (a) => [...new Set(a.map((x) => x.dataset.go))])), "profile"];
  for (const m of modules) {
    where = m;
    await goModule(p, m);
    const head = await p.evaluate(() => !!document.querySelector("#content h1"));
    if (!head) add(name, m, "NO_HEADING", "screen has no page heading");
    const tabs = [null, ...(await p.$$eval("#content .tabs button", (b) => b.map((x) => x.innerText.trim().replace(/\(\d+\)/, "").trim())))];
    for (const tab of [...new Set(tabs)]) {
      where = m + (tab ? ` › ${tab}` : "");
      await goModule(p, m, tab);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 2) add(name, where, "SIDEWAYS_SCROLL", `${overflow}px wider than the screen`);
      const btns = await listButtons(p);
      const seen = {};
      for (const b of btns) {
        seen[b.kind] = (seen[b.kind] || 0) + 1;
        if (seen[b.kind] > PER_KIND) continue;
        if (b.attrs.some((a) => a.startsWith("data-action=logout"))) continue;
        if (b.attrs.some((a) => a.startsWith("data-plang="))) continue;   // switching language would rename every later button
        await goModule(p, m, tab);
        await p.evaluate(() => { const t = document.getElementById("toast"); t.className = ""; t.textContent = ""; });
        const before = await state(p);
        const found = await clickByKey(p, b.key);
        if (!found) continue; // item changed state after an earlier click
        clicks++;
        await p.waitForTimeout(500);
        await settle(p);
        const after = await state(p);
        const label = `"${b.text || b.attrs[0]}"`;
        if (after.toast.includes("error") && after.toast !== before.toast) add(name, where, "ERROR_MESSAGE", `${label} → ${after.toast.split("|")[1]}`);
        const changed = before.content !== after.content || before.hash !== after.hash || before.toast !== after.toast ||
          after.printed > before.printed || after.dialogs > 0 || before.sidebar !== after.sidebar;
        const blocked = !changed && (await p.evaluate((key) => {
          const el = [...document.querySelectorAll("#content button")].find((x) => x.innerText.trim().replace(/\s+/g, " ").slice(0, 40) === key.split("|").pop());
          return !!(el && el.form && !el.form.checkValidity() && (el.type === "submit" || !el.getAttribute("type")));
        }, b.key));
        if (!changed && !blocked) add(name, where, "DEAD", `${label} did nothing`);
        if (after.dialogs > 0) {
          const empty = await p.evaluate(() => (document.querySelector("dialog[open] .modal-body")?.innerText || "").trim().length < 3 && !document.querySelector("dialog[open] .modal-body input, dialog[open] .modal-body select"));
          if (empty) add(name, where, "EMPTY_DIALOG", `${label} opened an empty dialog`);
          await exerciseDialog(p, name, `${where} › ${label}`);
        }
      }
    }
  }
  return clicks;
}

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const browser = await chromium.launch();
  const totals = {};
  for (const name of pick) {
    const t0 = Date.now();
    try { totals[name] = await runRole(browser, name); }
    catch (e) { add(name, "runner", "CRASH", e.message.split("\n")[0]); }
    console.log(`${name}: ${totals[name] || 0} clicks in ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify({ totals, findings }, null, 1));
  console.log(`\n${findings.length} findings`);
  for (const f of findings) console.log(`[${f.role}] ${f.where} · ${f.kind} · ${f.detail}`);
})();
