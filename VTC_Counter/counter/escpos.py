"""The bill as ESC/POS receipt-printer commands (80 mm thermal, e.g. ATPOS AT-402).

Sent straight to the printer by the counter server, so no browser, print window, page size,
scaling or header/footer is involved: one bill, exact width, cut at the end.
Thermal printer fonts have no rupee sign, so amounts print as "Rs.".
"""
import base64
import io
from datetime import datetime

from . import db

ESC, GS = b"\x1b", b"\x1d"
INIT = ESC + b"@" + ESC + b"t\x00"            # reset, code page PC437
LEFT, CENTER = ESC + b"a\x00", ESC + b"a\x01"
BOLD_ON, BOLD_OFF = ESC + b"E\x01", ESC + b"E\x00"
NORMAL, TALL, BIG = GS + b"!\x00", GS + b"!\x01", GS + b"!\x11"   # normal, double height, double width+height
CUT = b"\n" * 4 + GS + b"V\x42\x00"            # feed past the cutter, then cut


def _enc(s: str) -> bytes:
    s = str(s).replace("₹", "Rs.").replace("×", "x").replace("—", "-").replace("•", "*").replace("−", "-")
    return s.encode("cp437", errors="replace")


def money(p: int) -> str:
    return f"{p / 100:,.2f}"


def grams(g: int) -> str:
    """Format weight cleanly: >= 1000g as kg (e.g. 1.25 kg, 25 kg); < 1000g as kg decimal or grams."""
    if g >= 1000:
        return f"{g / 1000:g} kg"
    return f"{g / 1000:.3f} kg" if g % 100 != 0 else f"{g / 1000:g} kg"


def _wrap(text: str, width: int) -> list[str]:
    words, lines, cur = str(text).split(), [], ""
    for w in words:
        while len(w) > width:            # a single very long word
            if cur:
                lines.append(cur)
                cur = ""
            lines.append(w[:width])
            w = w[width:]
        if not cur:
            cur = w
        elif len(cur) + 1 + len(w) <= width:
            cur += " " + w
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


def _row(left: str, right: str, cols: int) -> str:
    """Left text and right-aligned amount on one line; long left text wraps above."""
    space = cols - len(right) - 1
    indent = len(left) - len(left.lstrip())
    parts = [" " * indent + x for x in _wrap(left, max(space - indent, 8))]
    out = parts[:-1]
    out.append(parts[-1].ljust(space) + " " + right)
    return "\n".join(out)


def _logo(data_url: str, max_dots: int) -> bytes:
    """A black-and-white raster of the owner's logo (GS v 0). Skipped if Pillow is missing or the image is bad."""
    try:
        from PIL import Image, ImageOps
        raw = base64.b64decode(data_url.split(",", 1)[1])
        im = Image.open(io.BytesIO(raw))
        im = ImageOps.exif_transpose(im).convert("RGBA")
        bg = Image.new("RGBA", im.size, "white")
        im = Image.alpha_composite(bg, im).convert("L")
        w = min(max_dots, im.width)
        h = max(1, round(im.height * w / im.width))
        if h > 240:
            w, h = max(1, round(w * 240 / h)), 240
        im = im.resize((w, h)).point(lambda v: 0 if v < 160 else 255, "1")
        wb = (w + 7) // 8
        bits = bytearray()
        px = im.load()
        for y in range(h):
            for xb in range(wb):
                byte = 0
                for bit in range(8):
                    x = xb * 8 + bit
                    if x < w and px[x, y] == 0:
                        byte |= 0x80 >> bit
                bits.append(byte)
        return CENTER + GS + b"v0\x00" + bytes([wb & 255, wb >> 8, h & 255, h >> 8]) + bytes(bits) + b"\n"
    except Exception:
        return b""


def bill_bytes(b: dict, lay: dict, *, label: str = "", duplicate: bool = False, tax_approved: bool = False, cols: int = 48) -> bytes:
    out = bytearray(INIT)
    put = lambda s: out.extend(_enc(s) + b"\n")
    rule = "-" * cols
    
    # Logo size handling
    logo_sz = lay.get("logo_size", "medium")
    max_dots = cols * 8
    if logo_sz == "small":
        max_dots = int(cols * 5.5)
    elif logo_sz == "large":
        max_dots = int(cols * 9.5)

    if lay.get("logo"):
        out += _logo(lay["logo"], max_dots=max_dots)
    out += CENTER
    name = lay.get("shop_name", "")
    if len(name) <= cols // 2:
        out += BIG + BOLD_ON
        put(name)
        out += NORMAL + BOLD_OFF
    else:
        out += BOLD_ON
        for ln in _wrap(name, cols):
            put(ln)
        out += BOLD_OFF
    for x in (lay.get("address"), f"Ph {lay['phone']}" if lay.get("phone") else "", f"GSTIN {lay['gstin']}" if lay.get("gstin") else ""):
        if x:
            for ln in _wrap(x, cols):
                put(ln)
    if label:
        out += BOLD_ON
        put(f"[ {label} ]")
        out += BOLD_OFF
    if duplicate:
        out += BOLD_ON
        put("DUPLICATE" + (f" {b['reprints']}" if b.get("reprints") else ""))
        out += BOLD_OFF
    if b.get("status") == "CANCELLED":
        out += BOLD_ON
        put("*** CANCELLED ***")
        out += BOLD_OFF
    out += LEFT
    put(rule)
    at = datetime.fromisoformat(b["created_at"]).astimezone(db.IST).strftime("%d/%m/%y %I:%M %p")
    put(_row(f"Bill {b['bill_no']}", at if lay.get("show_time", True) else "", cols))
    if lay.get("show_cashier", True) and b.get("cashier"):
        put(f"Cashier: {b['cashier']}")
    
    cl = b.get("client")
    highlight_cx = lay.get("highlight_customer", True)
    if cl:   # B2B client bill (Dealer or Cafe)
        if highlight_cx:
            out += BOLD_ON
        for ln in _wrap(f"Client: {cl['name']}" + (f" ({cl.get('client_type', 'client').upper()})" if cl.get("client_type") else ""), cols):
            put(ln)
        if highlight_cx:
            out += BOLD_OFF
        for x in (cl.get("address"), f"Ph {cl['phone']}" if cl.get("phone") else "", f"GSTIN {cl['gstin']}" if cl.get("gstin") else ""):
            if x:
                for ln in _wrap(x, cols):
                    put(ln)
    elif lay.get("show_customer_name", True) and b.get("customer_name"):
        if highlight_cx:
            out += BOLD_ON
        put(f"Customer: {b['customer_name']}")
        if highlight_cx:
            out += BOLD_OFF
    if lay.get("show_customer_phone") and b.get("customer_phone"):
        put(f"Phone: {b['customer_phone']}")
    put(rule)

    for l in b["lines"]:
        nm = l["item_name"]
        if l.get("form") == "mix" and not lay.get("show_ratio", True):
            nm = nm.rsplit(" ", 1)[0]
        hsn = f" [HSN:{l['hsn_code']}]" if lay.get("show_hsn") and l.get("hsn_code") else ""
        for ln in _wrap(nm + hsn, cols):
            put(ln)
        detail = f"  {grams(l['grams'])}" if l.get("form") == "custom" else f"  {grams(l['grams'])} x {money(l['rate_paise'])}/kg"
        put(_row(detail if l["grams"] else "", money(l["amount_paise"]), cols))
    put(rule)

    put(_row("Subtotal", money(b["subtotal_paise"]), cols))
    if b.get("discount_paise"):
        put(_row("Discount", "-" + money(b["discount_paise"]), cols))
    if b.get("round_off_paise"):
        put(_row("Round off", ("+" if b["round_off_paise"] > 0 else "-") + money(abs(b["round_off_paise"])), cols))
    out += BOLD_ON + TALL
    put(_row("TOTAL", "Rs. " + money(b["total_paise"]), cols))
    out += NORMAL + BOLD_OFF

    # Transparent Tax Breakdown block
    if lay.get("show_gst", True):
        if tax_approved:
            gst_tot = b.get("gst_paise") or 0
            taxable = b.get("taxable_paise") or max(0, b["total_paise"] - gst_tot)
            if gst_tot > 0:
                put(rule)
                out += CENTER + BOLD_ON
                put("[ TAX BREAKDOWN (Included in Total) ]")
                out += BOLD_OFF + LEFT
                put(_row("Taxable Value", money(taxable), cols))
                if b.get("igst_paise"):
                    put(_row("IGST (Inter-state)", money(b["igst_paise"]), cols))
                else:
                    cgst = b.get("cgst_paise") or (gst_tot // 2)
                    sgst = b.get("sgst_paise") or (gst_tot - cgst)
                    put(_row("CGST", money(cgst), cols))
                    put(_row("SGST", money(sgst), cols))
                put(_row("Total Tax", money(gst_tot), cols))
        else:
            out += CENTER
            put("Tax details pending accountant approval")
            out += LEFT

    # Transparent Payment & Settlement block
    if lay.get("show_payments", True) and (b.get("payments") or cl):
        put(rule)
        out += CENTER + BOLD_ON
        put("[ PAID BY ]")
        out += BOLD_OFF + LEFT
        tot_paid = 0
        for p in b.get("payments", []):
            amt = p["amount_paise"]
            tot_paid += amt
            ref = f" (Ref: {p['reference']})" if p.get("reference") else ""
            put(_row(f"{p['method']}{ref}", money(amt), cols))
        
        if lay.get("show_tendered") and b.get("tendered_paise") is not None:
            put(_row("  Cash Received", money(b["tendered_paise"]), cols))
            if b.get("change_paise") is not None:
                put(_row("  Change Returned", money(b["change_paise"]), cols))
        
        if len(b.get("payments", [])) > 1:
            out += BOLD_ON
            put(_row("Total Paid", money(tot_paid), cols))
            out += BOLD_OFF

    if cl:
        put(rule)
        put(_row("Paid now", money(b.get("paid_paise") or 0), cols))
        out += BOLD_ON
        put(_row("This bill due", money(b.get("due_paise") or 0), cols))
        if b.get("balance_after_paise") is not None:
            bal = b["balance_after_paise"]
            put(_row("Advance with us" if bal < 0 else "Total balance due", "Rs. " + money(abs(bal)), cols))
        out += BOLD_OFF
    put(rule)
    if lay.get("footer"):
        out += CENTER
        for ln in _wrap(lay["footer"], cols):
            put(ln)
        out += LEFT
    out += CUT
    return bytes(out)


SAMPLE = {"bill_no": "CTR-2610-0042", "cashier": "Lakshmi", "customer_name": "Ravi", "customer_phone": "9876543210", "status": "PAID", "reprints": 0,
          "subtotal_paise": 66500, "discount_paise": 1000, "round_off_paise": 0, "total_paise": 65500, "gst_paise": 3119,
          "taxable_paise": 62381, "cgst_paise": 1560, "sgst_paise": 1559, "igst_paise": 0, "tendered_paise": 50000, "change_paise": 10000,
          "lines": [{"item_name": "Premium powder 80/20", "form": "mix", "grams": 500, "rate_paise": 78000, "amount_paise": 39000, "hsn_code": "0901"},
                    {"item_name": "Premium beans", "form": "plain", "grams": 250, "rate_paise": 110000, "amount_paise": 27500, "hsn_code": "0901"}],
          "payments": [{"method": "CASH", "amount_paise": 40000, "reference": ""}, {"method": "UPI", "amount_paise": 25500, "reference": "UTR1234"}]}
