// Blending & grinding, outside (customer-owned) roasting, packing into
// finished goods. (DPR §7, §8)

import { api, newKey } from "../api.js";
import { t } from "../i18n.js";
import { S, can, nav } from "../state.js";
import { check, chip, dialog, fail, field, h, num, pageHead, select, table, tag, toast, when } from "../ui.js";
import { discussBtn } from "./comms.js";

const eyebrow = () => `${S.me.settings.short_name} / ${S.me.user.role_name}`;
const rupee = (p) => "₹" + (Number(p || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lotOpt = (x) => [x.id, `${x.code || "#" + x.id} · ${x.bean || x.name}${x.resting ? " · resting" : ""} — ${num(x.available_kg ?? x.kg, 3)} kg free`];

// ================================================================= blending & grinding
export const blending = {
  paths: () => {
    const s = (S.sub ||= { tab: "blend" });
    const canRecipes = can("recipe.view_public") || can("recipe.view_secret") || can("recipe.execute_secret") || can("recipe.edit");
    return [...(canRecipes ? ["/recipes", "/blends"] : []), ...(can("grind.execute") ? ["/grinds"] : []), "/inventory"];
  },
  render() {
    const s = S.sub, canRecipes = !!S.data["/recipes"];
    const tabs = [["blend", "Blend jobs", canRecipes], ["recipes", "Recipes", canRecipes], ["grind", "Grinding", can("grind.execute")]].filter((x) => x[2]);
    if (!tabs.some((x) => x[0] === s.tab)) s.tab = tabs[0]?.[0];
    const body = { blend: blendTab, recipes: recipesTab, grind: grindTab }[s.tab]?.() || "";
    return pageHead(eyebrow(), t("blending"), "Recipes, blend jobs and grinding. Scale weights are what count; recipe targets are guidance.") +
      `<div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${s.tab === k ? "on" : ""}" data-ptab="${k}">${l}</button>`).join("")}</div>${body}`;
  },
};

function recipesTab() {
  const rows = S.data["/recipes"];
  return `<div class="toolbar"><p class="sub m0">Confidential formulas are hidden from anyone without “Read confidential blend formula”. Changing a formula makes a new version; old jobs keep theirs.</p>
    ${can("recipe.edit") ? '<button class="btn btn-primary" data-action="newRecipe">+ New recipe</button>' : ""}</div>
    <div class="grid">${rows.map((r) => `<section class="card span4 ${r.active ? "" : "muted"}"><div class="row between"><h3 class="m0">${h(r.name)}</h3>${r.confidential ? chip("🔒 confidential", "risk-critical") : ""}</div>
      <div class="row mt-s">${chip(r.stage === "RAW" ? "Blend before roasting" : "Blend after roasting", "kind")}${chip("v" + r.version)}</div>
      <ul class="plain">${r.components.map((c) => `<li><b>${c.pct == null ? "••" : c.pct}%</b> ${h(c.name)}</li>`).join("")}</ul>
      ${!r.formula_visible ? '<p class="tiny">Formula hidden — you don\'t have the right to read it.</p>' : r.notes ? `<p class="tiny">${h(r.notes)}</p>` : ""}
      ${can("recipe.edit") ? `<div class="row mt"><button class="btn btn-small" data-editrecipe="${r.id}">New version</button><button class="btn btn-small" data-recipeactive="${r.id}:${r.active ? 0 : 1}">${r.active ? "Retire" : "Bring back"}</button></div>` : ""}
    </section>`).join("") || '<section class="card span12"><div class="empty"><b>No recipes yet</b>Add your house blends here.</div></section>'}</div>`;
}

function blendTab() {
  const recipes = S.data["/recipes"].filter((r) => r.active && r.may_run), jobs = S.data["/blends"];
  return `<div class="toolbar"><p class="sub m0">Weigh each component, then the blended output. The difference is recorded as loss.</p>
    ${recipes.length ? '<button class="btn btn-primary" data-action="newBlend">+ Record a blend</button>' : ""}</div>
    <section class="card">${table(["Job", "Recipe", "Stage", "In → out", "Loss", "By", ""], jobs.map((j) =>
      `<tr><td>#${j.id}</td><td>${h(j.recipe)} v${j.version}${j.confidential ? " 🔒" : ""}</td><td>${j.stage === "RAW" ? "Before roast" : "After roast"}</td><td>${num(j.input_kg, 3)} → ${num(j.output_kg, 3)} kg</td><td>${num(j.loss_kg, 3)} kg</td><td>${h(j.made_by)} · ${when(j.created_at)}</td><td>${discussBtn("blend", j.id)}</td></tr>`), "No blend jobs yet.")}</section>`;
}

async function blendDialog() {
  const recipes = S.data["/recipes"].filter((r) => r.active && r.may_run);
  const pick = await dialog({ title: "Which recipe?", submit: "Next", body: select("recipe_id", "Recipe", recipes.map((r) => [r.id, `${r.name} v${r.version}${r.confidential ? " 🔒" : ""}`])) });
  if (!pick) return;
  const r = recipes.find((x) => x.id === Number(pick.recipe_id));
  const stageOk = r.stage === "RAW" ? ["RAW"] : ["ROASTED", "BLENDED"];
  const lots = S.data["/inventory"].filter((x) => x.status === "RELEASED" && x.owner === "VTC" && x.location === "PROD-01" && stageOk.includes(x.stage) && x.available_kg > 0);
  if (!lots.length) return toast(`No ${r.stage === "RAW" ? "raw" : "roasted"} stock free at production for this recipe.`, true);
  const f = await dialog({ title: `Blend: ${r.name} v${r.version}`, submit: "Record blend", wide: true,
    body: `${r.components.map((c, i) => `<div class="component"><div class="component-n">${String.fromCharCode(65 + i)}</div>${select("lot_" + i, `${h(c.name)}${c.pct != null ? ` (target ${c.pct}%)` : ""}`, [["", "Choose lot"], ...lots.map(lotOpt)], "required")}${field("kg_" + i, "Weighed kg", "number", 'required min="0.001" step="0.001" inputmode="decimal"')}</div>`).join("")}
      <div class="form-grid">${field("output_kg", "Blended output (kg)", "number", 'required min="0.001" step="0.001"')}${field("notes", "Notes", "text", 'maxlength="300"')}</div>` });
  if (!f) return;
  try {
    const res = await api("/blends", "POST", { recipe_id: r.id, output_kg: Number(f.output_kg), notes: f.notes,
      inputs: r.components.map((_, i) => ({ component: i, lot_id: Number(f["lot_" + i]), kg: Number(f["kg_" + i]) })) }, newKey());
    toast(`Blend ${res.code} saved.${res.actual_pct ? " Actual mix: " + res.actual_pct.map((p) => p + "%").join(" / ") : ""}`);
    S.saved = { view: "blending", title: `Blend ${res.code} saved`, note: "Label the container.", lot_id: res.output_lot_id };
    await nav.go("blending", S.sub);
  } catch (e) { fail(e); }
}

async function recipeDialog(r = null) {
  const comps = r?.components?.length ? r.components : [{ name: "", pct: "" }, { name: "", pct: "" }];
  const f = await dialog({ title: r ? `New version of ${r.name}` : "New recipe", submit: r ? "Save new version" : "Create recipe", wide: true,
    body: `${r ? "" : field("name", "Recipe name", "text", 'required maxlength="60"')}
      ${r ? "" : select("stage", "When is it blended?", [["ROASTED", "After roasting (mix roasted coffees)"], ["RAW", "Before roasting (mix green beans)"]])}
      <div class="tiny upper mt">Components (must total 100%)</div>
      ${[0, 1, 2, 3, 4, 5].map((i) => `<div class="form-grid">${field("cname_" + i, `Component ${String.fromCharCode(65 + i)}`, "text", `maxlength="40" value="${h(comps[i]?.name || "")}" ${i < 2 ? "required" : ""}`)}${field("cpct_" + i, "%", "number", `min="0" max="100" step="0.01" value="${comps[i]?.pct ?? ""}" ${i < 2 ? "required" : ""}`)}</div>`).join("")}
      ${field("notes", "Notes (roast profile, grind…)", "text", 'maxlength="300"')}
      ${r ? "" : check("confidential", "Confidential formula", true, "Only people with the right can read it; running it needs a separate right")}` });
  if (!f) return;
  const components = [0, 1, 2, 3, 4, 5].filter((i) => f["cname_" + i]).map((i) => ({ name: f["cname_" + i], pct: Number(f["cpct_" + i]) }));
  try {
    if (r) await api(`/recipes/${r.id}`, "PUT", { components, notes: f.notes });
    else await api("/recipes", "POST", { name: f.name, stage: f.stage, components, notes: f.notes, confidential: !!f.confidential });
    toast("Recipe saved.");
    await nav.go("blending", { tab: "recipes" });
  } catch (e) { fail(e); }
}

function grindTab() {
  const jobs = S.data["/grinds"] || [];
  return `<div class="toolbar"><p class="sub m0">Grinding turns roasted coffee into a ground lot. Ground coffee is what the counter sells as powder.</p><button class="btn btn-primary" data-action="newGrind">+ Record grinding</button></div>
    <section class="card">${table(["Job", "From", "Grind", "In → out", "Loss", "By"], jobs.map((g) =>
      `<tr><td>#${g.id}</td><td>${h(g.input_name)}</td><td>${h(g.grind)}</td><td>${num(g.input_kg, 3)} → ${num(g.output_kg, 3)} kg</td><td>${num(g.input_kg - g.output_kg, 3)} kg</td><td>${h(g.made_by)} · ${when(g.created_at)}</td></tr>`), "No grinding recorded yet.")}</section>`;
}

async function grindDialog() {
  const lots = S.data["/inventory"].filter((x) => x.status === "RELEASED" && x.owner === "VTC" && x.location === "PROD-01" && ["ROASTED", "BLENDED"].includes(x.stage) && x.available_kg > 0);
  if (!lots.length) return toast("No released roasted coffee free at production.", true);
  const f = await dialog({ title: "Record grinding", submit: "Save",
    body: `${select("lot_id", "Roasted lot", lots.map(lotOpt))}<div class="form-grid">${field("input_kg", "Kg put in grinder", "number", 'required min="0.001" step="0.001"')}${field("output_kg", "Ground kg out", "number", 'required min="0.001" step="0.001"')}</div>
      ${select("grind", "Grind size", [["Fine (espresso)", "Fine (espresso)"], ["Medium (filter)", "Medium (filter)"], ["Coarse (French press)", "Coarse (French press)"], ["South Indian filter", "South Indian filter"]])}` });
  if (!f) return;
  try { const r = await api("/grinds", "POST", { lot_id: Number(f.lot_id), input_kg: Number(f.input_kg), output_kg: Number(f.output_kg), grind: f.grind }, newKey()); toast(`Saved · ${r.loss_kg} kg grinding loss.`);
    S.saved = { view: "blending", title: `Ground coffee ${r.code} saved`, note: "Label the container.", lot_id: r.output_lot_id }; await nav.go("blending", S.sub); } catch (e) { fail(e); }
}

// ================================================================= outside roasting
export const outside = {
  paths: () => ["/outside/jobs"],
  render() {
    const d = S.data["/outside/jobs"], money = can("finance.collection.record") || can("finance.view");
    return pageHead(eyebrow(), t("outside"), "Customers' own coffee, roasted as a service. Their stock is kept on its own ledger and can never be sold as ours.",
      can("outside.execute") ? '<button class="btn btn-primary" data-action="newOutside">+ Receive customer coffee</button>' : "") +
      `<section class="card">${table(["Job", "Customer", "Received", "Roasted", "Handed back", "Still with us", ...(money ? ["Service charge", "Paid"] : []), "State", ""], d.jobs.map((j) =>
        `<tr><td>#${j.id}</td><td><b>${h(j.customer)}</b>${j.bean_type ? `<br><span class="tiny">${h(j.bean_type)}</span>` : ""}</td><td>${num(j.received_kg, 3)} kg</td><td>${j.input_kg ? `${num(j.input_kg, 3)} → ${num(j.output_kg, 3)} kg` : "—"}</td><td>${num(j.returned_kg, 3)} kg</td>
         <td>${num(j.raw_left_kg + j.roasted_left_kg, 3)} kg</td>${money ? `<td>${j.charge_paise != null ? rupee(j.charge_paise) : "—"}<br><span class="tiny">${j.charge_basis.replace("_", " ").toLowerCase()} @ ${rupee(j.rate_paise)}</span></td><td>${j.charge_paise != null ? tag(j.payment_status === "PAID" ? "PAID" : "hold", j.payment_status) : "—"}</td>` : ""}
         <td>${tag(j.state === "RETURNED" ? "DONE" : "hold", j.state)}</td>
         <td class="nowrap">${can("outside.execute") && !j.roasted_lot_id ? `<button class="btn btn-small" data-oroast="${j.id}:${j.raw_left_kg}">Roast</button>` : ""}
           ${can("outside.execute") && j.raw_left_kg + j.roasted_left_kg > 0 ? `<button class="btn btn-small" data-oreturn="${j.id}:${j.roasted_left_kg}:${j.raw_left_kg}">Hand back</button>` : ""}
           ${can("finance.collection.record") && j.charge_paise != null && j.payment_status !== "PAID" ? `<button class="btn btn-small" data-opaid="${j.id}">Mark paid</button>` : ""}${discussBtn("outside", j.id)}</td></tr>`), "No customer jobs yet.")}</section>`;
  },
};

// ================================================================= packing
export const packing = {
  paths: () => ["/packing"],
  render() {
    const d = S.data["/packing"];
    const form = can("pack.create") ? `<section class="card span4"><h3>New packing ticket</h3><form data-form="packTicket">
      ${field("product_name", "Product / pack name", "text", "required")}
      ${select("demand_type", "Why are we packing?", [["STOCK", "Ready stock (counter / later orders)"], ["ORDER", "For a customer order"]])}
      <div class="form-grid">${field("packs_target", "How many packs?", "number", 'required min="1" step="1"')}${field("pack_g", "Grams per pack", "number", 'required min="1" step="0.1"')}</div>
      ${field("label_ref", "Label / artwork reference", "text", 'maxlength="60"', "Legal label review is separate (O-18)")}
      <div class="form-actions"><button class="btn btn-primary">Create ticket</button></div></form></section>` : "";
    return pageHead(eyebrow(), t("packing"), "Record coffee used and packs made. Finished packs wait on QA hold until released for sale.") +
      `<div class="grid">${form}<section class="card ${form ? "span8" : "span12"}"><h3>Packing queue</h3>${table(["Ticket", "Product", "Done", "Coffee used", "Rejected", "Packs", "Status", ""], d.jobs.map((x) =>
        `<tr><td>#${x.id}<br><span class="tiny">${x.demand_type === "ORDER" ? "Order" : "Stock"}</span></td><td>${h(x.product_name)}<br><span class="tiny">${x.packs_target} × ${num(x.pack_g)} g</span></td><td><b>${x.packs_done}</b> / ${x.packs_target}</td>
         <td>${x.input_kg ? num(x.input_kg, 3) + " kg" : "—"}</td><td>${x.rejected_packs || 0}</td><td>${x.finished_status ? tag(x.finished_status, x.finished_status === "QC_HOLD" ? "QA hold" : x.finished_status) : "—"}</td><td>${tag(x.state === "COMPLETE" ? "DONE" : "hold", x.state.replace(/_/g, " "))}</td>
         <td class="nowrap">${can("pack.execute") && x.packs_done < x.packs_target ? `<button class="btn btn-small" data-packrun="${x.id}">Record packing</button>` : ""}
          ${can("pack.qa_approve") && x.finished_status === "QC_HOLD" ? `<button class="btn btn-small" data-packqa="${x.id}">QA release</button>` : ""}${discussBtn("pack", x.id)}</td></tr>`))}</section></div>`;
  },
  async submit(f) {
    await api("/packing", "POST", { ...f, packs_target: Number(f.packs_target), pack_g: Number(f.pack_g) });
    toast("Packing ticket created.");
  },
};

async function packRunDialog(id) {
  const d = S.data["/packing"], job = d.jobs.find((x) => x.id === Number(id));
  const sources = job.source_lot_id ? d.sources.filter((s) => s.id === job.source_lot_id) : d.sources;
  if (!sources.length) return toast("No released roasted, blended or ground coffee free at production to pack.", true);
  const left = job.packs_target - job.packs_done;
  const f = await dialog({ title: `Packing ticket #${job.id} · ${job.product_name}`, submit: "Save packing",
    body: `<p class="sub">${job.packs_done} of ${job.packs_target} done — ${left} left. Each pack ${num(job.pack_g)} g.</p>
      ${select("source_lot_id", "Coffee taken from", sources.map(lotOpt))}
      <div class="form-grid">${field("input_kg", "Coffee used (kg, weighed)", "number", 'required min="0.001" step="0.001" inputmode="decimal"')}${field("good_packs", "Good packs made", "number", `required min="0" max="${left}" step="1" inputmode="numeric"`)}
      ${field("rejected_packs", "Rejected packs", "number", 'required min="0" step="1" value="0" inputmode="numeric"')}</div>
      <p class="tiny" id="srcLeft"></p><p class="tiny">You can stop part-way and continue later. Packs are held for QA before they can be sold.</p>`,
    onReady(dl) {
      const src = dl.querySelector("[name=source_lot_id]"), kg = dl.querySelector("[name=input_kg]"), note = dl.querySelector("#srcLeft");
      const sync = () => { const s = sources.find((x) => String(x.id) === src.value); if (!s) return; kg.max = s.available_kg; note.textContent = `${num(s.available_kg, 3)} kg free in this lot.`; };
      src.addEventListener("change", sync); sync();
    } });
  if (!f) return;
  try { const r = await api(`/packing/${job.id}/run`, "POST", { source_lot_id: Number(f.source_lot_id), input_kg: Number(f.input_kg), good_packs: Number(f.good_packs), rejected_packs: Number(f.rejected_packs) }, newKey());
    toast(`Saved · ${r.packs_done} of ${job.packs_target} packs · ${r.loss_kg} kg handling loss`);
    if (r.packs) S.saved = { view: "packing", title: `${r.packs} packs into ${r.code}`, note: "One label per pack, or one per carton.", lot_id: r.lot_id, copies: r.packs };
    await nav.go("packing"); } catch (e) { fail(e); }
}

// ================================================================= events
export async function productionClick(el) {
  const ds = el.dataset;
  if (ds.ptab) { S.sub = { tab: ds.ptab }; return nav.go("blending", S.sub), true; }
  if (ds.action === "newRecipe") return recipeDialog(), true;
  if (ds.editrecipe) return recipeDialog(S.data["/recipes"].find((r) => r.id === Number(ds.editrecipe))), true;
  if (ds.recipeactive) { const [id, on] = ds.recipeactive.split(":"); try { await api(`/recipes/${id}`, "PUT", { active: on === "1" }); await nav.go("blending", S.sub); } catch (e) { fail(e); } return true; }
  if (ds.action === "newBlend") return blendDialog(), true;
  if (ds.action === "newGrind") return grindDialog(), true;
  if (ds.packrun) return packRunDialog(ds.packrun), true;
  if (ds.packqa) {
    const f = await dialog({ title: "QA release of packed goods", submit: "Release for sale", body: `${select("approve", "Decision", [["1", "Release — packs are fine"], ["0", "Reject — packs not fit for sale"]])}<div class="field"><label>What did you check?</label><textarea name="note" required minlength="3" rows="2" placeholder="Seal, net weight sample, label, batch code"></textarea></div>` });
    if (!f) return true;
    try { await api(`/packing/${ds.packqa}/release`, "POST", { approve: f.approve === "1", note: f.note }); toast(f.approve === "1" ? "Released for sale." : "Rejected."); await nav.go("packing"); } catch (e) { fail(e); }
    return true;
  }
  if (ds.action === "newOutside") {
    const customers = S.data["/outside/jobs"].customers;
    if (!customers.length) return toast("Add the customer in Master Data first.", true), true;
    const f = await dialog({ title: "Receive customer's coffee", submit: "Receive",
      body: `${select("customer_id", "Customer", customers.map((c) => [c.id, c.name]))}${field("bean_type", "Type of beans", "text", 'required minlength="2" maxlength="80" list="beanTypes" placeholder="e.g. Robusta cherry"')}
        <datalist id="beanTypes">${[...new Set(S.data["/outside/jobs"].jobs.map((j) => j.bean_type).filter(Boolean))].map((b) => `<option value="${h(b)}">`).join("")}</datalist>
        ${field("received_kg", "Kg received (weighed)", "number", 'required min="0.001" step="0.001"')}
        <div class="form-grid">${select("charge_basis", "Charge by", [["INPUT_KG", "Per kg roasted (input)"], ["OUTPUT_KG", "Per kg returned (output)"], ["BATCH", "Per batch"]])}${field("rate", "Agreed rate (₹)", "number", 'required min="0.01" step="0.01"')}</div>` });
    if (!f) return true;
    try { await api("/outside/jobs", "POST", { customer_id: Number(f.customer_id), received_kg: Number(f.received_kg), bean_type: f.bean_type.trim(), charge_basis: f.charge_basis, rate_paise: Math.round(Number(f.rate) * 100) }); toast("Received onto the customer's own ledger."); await nav.go("outside"); } catch (e) { fail(e); }
    return true;
  }
  if (ds.oroast) {
    const [id, left] = ds.oroast.split(":");
    const f = await dialog({ title: `Roast job #${id}`, submit: "Save roast",
      body: `<div class="form-grid">${field("input_kg", `Green kg in (up to ${num(left, 3)})`, "number", `required min="0.001" max="${left}" step="0.001"`)}${field("output_kg", "Roasted kg out", "number", 'required min="0.001" step="0.001"')}</div>` });
    if (!f) return true;
    try { await api(`/outside/jobs/${id}/roast`, "POST", { input_kg: Number(f.input_kg), output_kg: Number(f.output_kg) }); toast("Roast saved on the customer's ledger."); await nav.go("outside"); } catch (e) { fail(e); }
    return true;
  }
  if (ds.oreturn) {
    const [id, roasted, raw] = ds.oreturn.split(":");
    const f = await dialog({ title: `Hand back to customer · job #${id}`, submit: "Record hand-back",
      body: `${select("what", "What is going back?", [...(Number(roasted) > 0 ? [["roasted", `Roasted coffee (${num(roasted, 3)} kg with us)`]] : []), ...(Number(raw) > 0 ? [["raw", `Unroasted coffee (${num(raw, 3)} kg with us)`]] : [])])}
        ${field("kg", "Kg handed back", "number", 'required min="0.001" step="0.001"')}${field("note", "Who collected / how (evidence)", "text", 'required minlength="3" maxlength="200"')}` });
    if (!f) return true;
    try { await api(`/outside/jobs/${id}/return`, "POST", { what: f.what, kg: Number(f.kg), note: f.note }); toast("Hand-back recorded."); await nav.go("outside"); } catch (e) { fail(e); }
    return true;
  }
  if (ds.opaid) { try { await api(`/outside/jobs/${ds.opaid}/payment`, "POST", { status: "PAID" }); toast("Marked as paid."); await nav.go("outside"); } catch (e) { fail(e); } return true; }
  return false;
}
