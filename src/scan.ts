// v1.4: scan a QR lot label and act on it. Three ways in, whatever the device:
//  · live camera (only on HTTPS or on the office PC itself — browsers allow cameras on secure pages only)
//  · photo mode: the phone's camera app takes a picture of the label and the portal reads it
//  · a handheld scanner or typing: the code goes into the box (or anywhere on the page, see app.js)

import { api } from "./api.js";
import { icon } from "./icons.js";
import { fmtDay, offerLabels } from "./labels.js";
import { S, can, nav } from "./state.js";
import { dialog, fail, field, h, num, tag, toast } from "./ui.js";
import { countLot, sendToCounter } from "./views/ops.js";
import { receiveTransfer } from "./views/counter.js";

let reader = null;
const qrReader = async () => (reader ||= (await import("./vendor/jsqr.mjs")).default);
export const canScan = () => can("inventory.view") || can("counter.sell") || can("goods.receive");
const LOC = { "PROD-01": "Production", "CTR-01": "Counter", IN_TRANSIT: "On the way to the counter" };
const STAGE = { RAW: "Raw beans", ROASTED: "Roasted", GROUND: "Ground", BLENDED: "Blend", PACKED: "Packed" };

/** Read a QR code from a photo; tries a few sizes because phone photos are large and noisy. */
async function readPhoto(file: File) {
  const jsQR = await qrReader();   // data: URL, not blob: — the portal's security policy allows only data: images
  const url = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.readAsDataURL(file); });
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    for (const max of [1000, 1600, 700]) {
      const k = Math.min(1, max / Math.max(img.width, img.height)), w = Math.round(img.width * k), hgt = Math.round(img.height * k);
      const cv = Object.assign(document.createElement("canvas"), { width: w, height: hgt }), ctx = cv.getContext("2d");
      ctx.drawImage(img, 0, 0, w, hgt);
      const hit = jsQR(ctx.getImageData(0, 0, w, hgt).data, w, hgt, { inversionAttempts: "attemptBoth" });
      if (hit?.data) return hit.data;
    }
  } catch { /* unreadable image */ }
  return null;
}

const PHOTO = `<label class="btn btn-primary btn-big scan-photo">${icon("camera", 20)} Take a photo of the label<input type="file" accept="image/*" capture="environment" hidden/></label>
  <p class="tiny">Live scanning switches on by itself once the portal runs on HTTPS.</p>`;

export async function openScanner() {
  const live = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
  let stream = null, timer = null;
  const stop = () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  const r = await dialog({ title: "Scan a label", submit: "Open",
    body: `<div class="scan-way">${live ? `<div class="scan-live"><video playsinline muted aria-label="Camera"></video><span class="scan-frame" aria-hidden="true"></span></div><p class="tiny">Hold the QR code inside the frame.</p>` : PHOTO}</div>
      ${field("code", "Or type the code (a handheld scanner types it for you)", "text", 'autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="RAW-ROBCAB-261027-01"')}`,
    onReady(d) {
      const input = d.querySelector("[name=code]"), done = (text) => { input.value = text; stop(); d.querySelector("form").requestSubmit(); };
      d.addEventListener("close", stop);
      const photoMode = () => d.querySelector("input[type=file]")?.addEventListener("change", async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        toast("Reading the label…");
        const text = await readPhoto(f);
        text ? done(text) : toast("Couldn't read that QR. Fill the photo with the label, keep it flat and in focus, and try again.", true);
      });
      if (!live) return photoMode();
      const video = d.querySelector("video");
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(async (s) => {
        stream = s; video.srcObject = s; await video.play();
        const jsQR = await qrReader(), cv = document.createElement("canvas"), ctx = cv.getContext("2d", { willReadFrequently: true });
        timer = setInterval(() => {
          if (!video.videoWidth) return;
          const k = Math.min(1, 640 / video.videoWidth);
          cv.width = Math.round(video.videoWidth * k); cv.height = Math.round(video.videoHeight * k);
          ctx.drawImage(video, 0, 0, cv.width, cv.height);
          const hit = jsQR(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: "dontInvert" });
          if (hit?.data) done(hit.data);
        }, 220);
      }).catch(() => { d.querySelector(".scan-way").innerHTML = PHOTO; photoMode(); });   // no camera here or not allowed: photo mode
    } });
  stop();
  if (r?.code?.trim()) await openLot(r.code.trim());
}

export async function openLot(code) {
  let x;
  try { x = await api(`/lots/find?code=${encodeURIComponent(code)}`); } catch (e) { return fail(e); }
  const { lot, transfers, bag } = x, acts = [];
  const mine = lot.owner === "VTC";
  if (can("stock.cycle_count") && lot.status === "RELEASED" && lot.kg > 0) acts.push(["count", "Count it", "scale"]);
  if (can("inventory.transfer") && mine && lot.status === "RELEASED" && lot.location === "PROD-01" && lot.available_kg > 0) acts.push(["send", "Send to counter", "send"]);
  if (can("counter.sell") || can("inventory.transfer"))
    transfers.filter((t) => t.sent_by !== S.me.user.id).forEach((t) => acts.push([`receive:${t.id}:${t.kg_sent}:${t.transit_code}`, `Receive ${t.transit_code} · ${num(t.kg_sent, 3)} kg`, "package"]));
  acts.push(["label", "Print label", "printer"]);
  if (can("inventory.view") && mine && (lot.bean_id || lot.product_id)) acts.push(["open", "Open in Inventory", "warehouse"]);
  const row = (k, v) => (v ? `<div class="kv"><span>${k}</span><span>${v}</span></div>` : "");
  const f = await dialog({ title: lot.code, submit: null,
    body: `<div class="lot-sheet"><div class="ls-head"><span class="ls-ic">${icon("qr-code", 22)}</span><div><b>${h(lot.bean || lot.product || lot.name)}</b>
        <div class="row">${tag(lot.status, lot.status.replace("_", " "))}<span class="chip">${h(STAGE[lot.stage] || lot.stage)}</span>${bag ? `<span class="chip">Bag ${bag} of ${lot.bags || "?"}</span>` : ""}</div></div></div>
      ${lot.resting ? `<div class="hint warn">${icon("hourglass", 16)} Resting — ready from <b>${fmtDay(lot.ready_from)}</b></div>` : lot.ready_from ? `<div class="hint">${icon("circle-check", 16)} Rested — ready since ${fmtDay(lot.ready_from)}</div>` : ""}
      ${row("Where", h(LOC[lot.location] || lot.location))}${row("In this lot", `<b>${num(lot.kg, 3)} kg</b>${lot.reserved_kg ? ` · ${num(lot.reserved_kg, 3)} kg reserved` : ""}`)}
      ${row("Roasted", lot.roasted_on && `${fmtDay(lot.roasted_on)}${lot.roast_profile ? " · " + h(lot.roast_profile) : ""}`)}
      ${row("Stock input", lot.receipt_code && `${h(lot.receipt_code)}${lot.supplier ? " · " + h(lot.supplier) : ""} · ${fmtDay(lot.created_at)}`)}
      ${!mine ? row("Owner", "Customer's own coffee") : ""}
      <input type="hidden" name="act"/><div class="ls-acts">${acts.map(([k, l, ic]) => `<button type="button" class="btn ${k === "count" || k.startsWith("receive") ? "btn-primary" : ""}" data-act="${h(k)}">${icon(ic, 16)} ${h(l)}</button>`).join("")}</div></div>`,
    onReady(d) { d.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => { d.querySelector("[name=act]").value = b.dataset.act; d.querySelector("form").requestSubmit(); })); } });
  const act = f?.act || "";
  if (act === "count") return countLot(lot.id, lot.code);
  if (act === "send") return sendToCounter(lot.id, lot.available_kg, lot.code);
  if (act.startsWith("receive:")) { const [, id, kg, c] = act.split(":"); return receiveTransfer(id, kg, c); }
  if (act === "label") return offerLabels(lot);
  if (act === "open") return nav.go("inventory", { product: lot.bean_id || lot.product_id });
}

// Handheld scanners type fast and press Enter. Typing that fast outside a text box = a scan.
let keys = "", last = 0;
export function wedge(e) {
  if (!S.me || !canScan() || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input, textarea, select, [contenteditable], dialog")) return;
  const now = performance.now();
  if (now - last > 60) keys = "";
  last = now;
  if (e.key === "Enter") { if (keys.length >= 8) { e.preventDefault(); const c = keys; keys = ""; openLot(c); } return; }
  if (e.key.length === 1) keys += e.key;
}
