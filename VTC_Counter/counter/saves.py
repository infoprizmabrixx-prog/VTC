"""Daily save to the owner's folder: full data backup + the day's bills (Excel) + a one-page day summary (PDF).

Runs when the day is closed, when owner/admin press "Save now", and at start-up for any earlier day
that has bills but was never saved (PC switched off, day not closed).
Layout:  <folder>/<YYYY-MM>/<YYYY-MM-DD>/VTC_backup_<day>.sqlite3, VTC_bills_<day>.xlsx, VTC_day_summary_<day>.pdf
"""
import json
import sqlite3
from pathlib import Path

from . import db, xlsx


def folder_ok(folder: str) -> bool:
    if not folder:
        return False
    p = Path(folder)
    try:
        p.mkdir(parents=True, exist_ok=True)
        probe = p / ".vtc_write_test"
        probe.write_text("ok")
        probe.unlink()
        return True
    except OSError:
        return False


def _bills(c, day: str) -> list[dict]:
    out = db.rows(c.execute("SELECT b.*, u.full_name cashier FROM bills b JOIN users u ON u.id=b.cashier_id WHERE b.day=? ORDER BY b.id", (day,)))
    for b in out:
        b["lines"] = db.rows(c.execute("SELECT l.item_name, l.grams, l.amount_paise, l.form, u.full_name added_by_name FROM bill_lines l "
                                       "LEFT JOIN users u ON u.id=l.added_by WHERE l.bill_id=? ORDER BY l.id", (b["id"],)))
        b["pays"] = {m: 0 for m in ("CASH", "UPI", "CARD")}
        for p in c.execute("SELECT method, amount_paise FROM payments WHERE bill_id=?", (b["id"],)):
            b["pays"][p["method"]] += p["amount_paise"]
    return out


def _excel(bills: list[dict]) -> bytes:
    rs = lambda p: round(p / 100, 2)
    rows = [["Bill", "Time", "Cashier", "Customer", "Phone", "Items", "Before discount (Rs)", "Discount (Rs)", "Discount reason", "Round off (Rs)",
             "Total (Rs)", "GST included (Rs)", "Cash (Rs)", "UPI (Rs)", "Card (Rs)", "On credit (Rs)", "Status"]]
    for b in bills:
        from datetime import datetime
        t = datetime.fromisoformat(b["created_at"]).astimezone(db.IST).strftime("%H:%M")
        items = "; ".join(f"{l['item_name']}" + (f" {l['grams']} g" if l["grams"] else "") + (f" [added by {l['added_by_name']}]" if l["form"] == "custom" else "") for l in b["lines"])
        rows.append([b["bill_no"], t, b["cashier"], b["customer_name"], b["customer_phone"], items, rs(b["subtotal_paise"]), rs(b["discount_paise"]),
                     b["discount_reason"], rs(b["round_off_paise"]), rs(b["total_paise"]), rs(b["gst_paise"]), rs(b["pays"]["CASH"]), rs(b["pays"]["UPI"]),
                     rs(b["pays"]["CARD"]), rs(b.get("due_paise") or 0), b["status"].replace("_", " ")])
    live = [b for b in bills if b["status"] != "CANCELLED"]
    rows.append(["TOTAL (not cancelled)", "", "", "", "", f"{len(live)} bills", rs(sum(b["subtotal_paise"] for b in live)), rs(sum(b["discount_paise"] for b in live)),
                 "", rs(sum(b["round_off_paise"] for b in live)), rs(sum(b["total_paise"] for b in live)), rs(sum(b["gst_paise"] for b in live)),
                 rs(sum(b["pays"]["CASH"] for b in live)), rs(sum(b["pays"]["UPI"] for b in live)), rs(sum(b["pays"]["CARD"] for b in live)),
                 rs(sum(b.get("due_paise") or 0 for b in live)), ""])
    return xlsx.write([("Bills", rows)])


def _pdf(path: Path, day: str, shop: str, bills: list[dict], close: dict | None, items: list[dict], usage: dict, collected: list[dict] = ()):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    rs = lambda p: f"Rs. {p / 100:,.2f}"
    st = getSampleStyleSheet()
    live = [b for b in bills if b["status"] != "CANCELLED"]
    pay = {m: sum(b["pays"][m] for b in live) for m in ("CASH", "UPI", "CARD")}
    story = [Paragraph(f"{shop} — Counter day summary", st["Title"]), Paragraph(f"Day: <b>{day}</b>", st["Normal"]), Spacer(1, 6)]

    def grid(data, widths):
        t = Table(data, colWidths=[w * mm for w in widths])
        t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#efe7de")),
                               ("FONTSIZE", (0, 0), (-1, -1), 8.5), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        return t

    story.append(grid([["Bills", "Total", "Cash", "UPI", "Card", "Discount", "GST included", "Cancelled"],
                       [len(live), rs(sum(b["total_paise"] for b in live)), rs(pay["CASH"]), rs(pay["UPI"]), rs(pay["CARD"]),
                        rs(sum(b["discount_paise"] for b in live)), rs(sum(b["gst_paise"] for b in live)), len(bills) - len(live)]],
                      [16, 26, 24, 24, 20, 22, 24, 18]))
    story += [Spacer(1, 8), Paragraph("Cash count", st["Heading3"])]
    if close:
        story.append(grid([["Opening cash", "Cash sales", "Should be in drawer", "Counted", "Difference", "Note"],
                           [rs(close["opening_paise"]), rs(close["cash_sales_paise"]), rs(close["expected_paise"]), rs(close["counted_paise"]),
                            rs(close["difference_paise"]), Paragraph(close["note"] or "—", st["BodyText"])]], [26, 26, 30, 24, 24, 44]))
    else:
        story.append(Paragraph("<b>Day was not closed</b> — no cash count recorded for this day.", st["Normal"]))
    story += [Spacer(1, 8), Paragraph("Items sold", st["Heading3"])]
    story.append(grid([["Item", "Kg", "Amount"]] + [[i["item_name"], f"{i['grams'] / 1000:,.3f}", rs(i["amount_paise"])] for i in items] or [["—", "", ""]], [100, 30, 40]))
    story.append(Paragraph(f"Coffee in mixes {usage['coffee_g'] / 1000:,.3f} kg · Chicory {usage['chicory_g'] / 1000:,.3f} kg · Other items {usage['plain_g'] / 1000:,.3f} kg", st["Normal"]))
    disc = [b for b in live if b["discount_paise"]]
    if disc:
        story += [Spacer(1, 8), Paragraph("Discounts", st["Heading3"]),
                  grid([["Bill", "Cashier", "Discount", "Reason"]] + [[b["bill_no"], b["cashier"], rs(b["discount_paise"]), Paragraph(b["discount_reason"], st["BodyText"])] for b in disc],
                       [36, 40, 26, 68])]
    added = [(b, l) for b in live for l in b["lines"] if l.get("form") == "custom"]
    if added:
        story += [Spacer(1, 8), Paragraph("Items added at the counter", st["Heading3"]),
                  grid([["Bill", "Item", "Grams", "Amount", "Added by"]] + [[b["bill_no"], Paragraph(l["item_name"], st["BodyText"]), l["grams"] or "", rs(l["amount_paise"]), l["added_by_name"] or ""]
                        for b, l in added], [32, 64, 18, 26, 30])]
    credit = [b for b in live if b.get("due_paise")]
    if credit or collected:
        story += [Spacer(1, 8), Paragraph("Clients: credit given and dues collected", st["Heading3"])]
        if credit:
            story.append(grid([["Bill", "Client", "Total", "Paid now", "On credit"]] + [[b["bill_no"], Paragraph(b["customer_name"], st["BodyText"]), rs(b["total_paise"]),
                               rs(b["paid_paise"] or 0), rs(b["due_paise"])] for b in credit], [32, 60, 26, 26, 26]))
        if collected:
            story += [Spacer(1, 4), grid([["Client", "Amount", "How", "Reference"]] + [[Paragraph(k["client"], st["BodyText"]), rs(k["amount_paise"]), k["method"], k["reference"]]
                                          for k in collected], [70, 30, 24, 46])]
    canc = [b for b in bills if b["status"] == "CANCELLED"]
    if canc:
        story += [Spacer(1, 8), Paragraph("Cancelled bills", st["Heading3"]), grid([["Bill", "Cashier", "Amount"]] + [[b["bill_no"], b["cashier"], rs(b["total_paise"])] for b in canc], [40, 60, 40])]
    SimpleDocTemplate(str(path), pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                      title=f"Counter day summary {day}").build(story)


def save_day(day: str, manual: bool = False) -> dict:
    with db.read() as c:
        folder = db.get(c, "save_folder")
    if not folder:
        return {"ok": False, "error": "SAVE_FOLDER_NOT_SET"}
    if not folder_ok(folder):
        return {"ok": False, "error": "SAVE_FOLDER_NOT_WRITABLE"}
    out = Path(folder) / day[:7] / day
    try:
        out.mkdir(parents=True, exist_ok=True)
        files = []
        # 1. full backup of all data (SQLite's own backup is safe while people keep billing)
        dst = out / f"VTC_backup_{day}.sqlite3"
        src = sqlite3.connect(db.DB_PATH)
        bk = sqlite3.connect(dst)
        try:
            src.backup(bk)
        finally:
            bk.close()
            src.close()
        files.append(dst.name)
        with db.read() as c:
            bills = _bills(c, day)
            close = db.one(c.execute("SELECT * FROM day_closes WHERE day=? AND state!='REOPENED' ORDER BY id DESC LIMIT 1", (day,)))
            live = "b.day=? AND b.status!='CANCELLED'"
            items = db.rows(c.execute(f"SELECT l.item_name, SUM(l.grams) grams, SUM(l.amount_paise) amount_paise FROM bill_lines l JOIN bills b ON b.id=l.bill_id "
                                      f"WHERE {live} GROUP BY l.item_name ORDER BY amount_paise DESC", (day,)))
            usage = db.one(c.execute(f"SELECT COALESCE(SUM(coffee_g),0) coffee_g, COALESCE(SUM(chicory_g),0) chicory_g, COALESCE(SUM(plain_g),0) plain_g "
                                     f"FROM bill_lines l JOIN bills b ON b.id=l.bill_id WHERE {live}", (day,)))
            shop = db.get(c, "layout")["shop_name"]
            collected = db.rows(c.execute("SELECT cl.name client, k.amount_paise, k.method, k.reference FROM collections k JOIN clients cl ON cl.id=k.client_id "
                                          "WHERE k.day=? AND k.cancelled_at IS NULL ORDER BY k.id", (day,)))
        # 2. the day's bills, readable without the app
        (out / f"VTC_bills_{day}.xlsx").write_bytes(_excel(bills))
        files.append(f"VTC_bills_{day}.xlsx")
        # 3. one-page summary
        _pdf(out / f"VTC_day_summary_{day}.pdf", day, shop, bills, close, items, usage, collected)
        files.append(f"VTC_day_summary_{day}.pdf")
    except Exception as e:   # a full disk or pulled-out drive must not stop the counter
        return {"ok": False, "error": "SAVE_FAILED", "detail": str(e)[:200]}
    note = "saved by hand" if manual else ("day closed" if close else "day not closed")
    with db.tx() as c:
        c.execute("INSERT INTO day_saves(day, folder, files, saved_at, note) VALUES(?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET "
                  "folder=excluded.folder, files=excluded.files, saved_at=excluded.saved_at, note=excluded.note", (day, str(out), json.dumps(files), db.stamp(), note))
    return {"ok": True, "folder": str(out), "files": files}


def catch_up() -> list[str]:
    """At start-up: save every earlier day that has bills but no save yet."""
    with db.read() as c:
        if not db.get(c, "save_folder"):
            return []
        days = [r[0] for r in c.execute("SELECT DISTINCT day FROM (SELECT day FROM bills UNION SELECT day FROM collections) WHERE day<? "
                                        "AND day NOT IN (SELECT day FROM day_saves) ORDER BY day", (db.today(),))]
    return [d for d in days if save_day(d)["ok"]]


def statement_pdf(cl: dict, rows: list[dict], sm: dict, lay: dict) -> bytes:
    """A client's statement: every bill and payment with the running balance, and how old the dues are."""
    import io
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    rs = lambda p: f"{p / 100:,.2f}"
    st = getSampleStyleSheet()
    buf = io.BytesIO()
    head = [lay["shop_name"], lay.get("address") or "", f"Ph {lay['phone']}" if lay.get("phone") else "", f"GSTIN {lay['gstin']}" if lay.get("gstin") else ""]
    story = [Paragraph(f"<b>{lay['shop_name']}</b>", st["Title"]), Paragraph(" · ".join(x for x in head[1:] if x), st["Normal"]), Spacer(1, 8),
             Paragraph(f"<b>Statement of account</b> — {db.today()}", st["Heading2"]),
             Paragraph(f"<b>{cl['name']}</b>" + (f" ({cl['contact']})" if cl["contact"] else "") + (f"<br/>{cl['address']}" if cl["address"] else "")
                       + (f"<br/>Phone {cl['phone']}" if cl["phone"] else "") + (f"<br/>GSTIN {cl['gstin']}" if cl["gstin"] else ""), st["Normal"]), Spacer(1, 8)]
    data = [["Date", "Details", "Charged (Rs)", "Received (Rs)", "Balance (Rs)"]] + [
        [r["day"], Paragraph(r["what"].replace("₹", "Rs."), st["BodyText"]), rs(r["debit"]) if r["debit"] else "", rs(r["credit"]) if r["credit"] else "", rs(r["balance"])] for r in rows]
    t = Table(data, colWidths=[24 * mm, 80 * mm, 24 * mm, 24 * mm, 26 * mm], repeatRows=1)
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#efe7de")),
                           ("FONTSIZE", (0, 0), (-1, -1), 8.5), ("ALIGN", (2, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    b = sm["buckets"]
    age = Table([["Balance due", "0-30 days", "31-60 days", "61-90 days", "Over 90 days"],
                 [rs(sm["balance_paise"]), rs(b["0_30"]), rs(b["31_60"]), rs(b["61_90"]), rs(b["90_plus"])]], colWidths=[36 * mm] * 5)
    age.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#efe7de")),
                             ("FONTSIZE", (0, 0), (-1, -1), 9), ("ALIGN", (0, 0), (-1, -1), "CENTER")]))
    story += [t, Spacer(1, 10), age, Spacer(1, 8),
              Paragraph("Balance in minus means an advance with us." if sm["balance_paise"] < 0 else "Please pay the balance at your earliest. Thank you.", st["Normal"])]
    SimpleDocTemplate(buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                      title=f"Statement {cl['name']}").build(story)
    return buf.getvalue()


def report_pdf(r: dict, shop: str) -> bytes:
    """Complete multi-page PDF report matching Excel for chosen date range."""
    import io
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    rs = lambda p: f"Rs. {(p or 0) / 100:,.2f}"
    kg = lambda g: f"{(g or 0) / 1000:,.3f} kg"
    st = getSampleStyleSheet()
    buf = io.BytesIO()

    story = [
        Paragraph(f"<b>{shop}</b> — Sales & Operations Report", st["Title"]),
        Paragraph(f"Period: <b>{r['from']}</b> to <b>{r['to']}</b> · Generated on {db.today()}", st["Normal"]),
        Spacer(1, 8),
    ]

    def grid(data, widths):
        t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1)
        t.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#efe7de")),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        return t

    # 1. Executive Totals
    t = r["totals"]
    story += [
        Paragraph("<b>1. Summary Totals</b>", st["Heading3"]),
        grid([
            ["Bills", "Total Sales", "Counter", "Clients", "On Credit", "Dues Collected", "Cash", "UPI", "Card", "Discounts", "GST Included"],
            [
                str(t["bills"]), rs(t["total_paise"]), rs(t["counter_paise"]), rs(t["client_paise"]),
                rs(t["credit_paise"]), rs(t["collected_paise"]), rs(t["CASH"]), rs(t["UPI"]), rs(t["CARD"]),
                rs(t["discount_paise"]), rs(t["gst_paise"])
            ]
        ], [12, 18, 16, 16, 16, 18, 16, 16, 14, 16, 16]),
        Spacer(1, 10),
    ]

    # 2. Daily breakdown
    if r.get("days"):
        story += [
            Paragraph("<b>2. Day-by-Day Sales</b>", st["Heading3"]),
            grid(
                [["Day", "Bills", "Total", "Counter", "Clients", "On Credit", "Collected", "Cash", "UPI", "Card"]] +
                [[d["day"], str(d["bills"]), rs(d["total_paise"]), rs(d["counter_paise"]), rs(d["client_paise"]),
                  rs(d["credit_paise"]), rs(d["collected_paise"]), rs(d["CASH"]), rs(d["UPI"]), rs(d["CARD"])]
                 for d in r["days"]],
                [20, 12, 20, 18, 18, 18, 18, 18, 18, 18]
            ),
            Spacer(1, 10),
        ]

    # 3. Items Sold
    if r.get("items"):
        story += [
            Paragraph("<b>3. Items Sold</b>", st["Heading3"]),
            grid(
                [["Item Name", "Bill Lines", "Kilograms Sold", "Total Amount"]] +
                [[i["item_name"], str(i["lines"]), kg(i["grams"]), rs(i["amount_paise"])] for i in r["items"]],
                [80, 24, 34, 40]
            ),
            Spacer(1, 6),
            Paragraph(f"<b>Usage breakdown:</b> Coffee in blends/mixes: <b>{kg(r['usage']['coffee_g'])}</b> · Chicory: <b>{kg(r['usage']['chicory_g'])}</b> · Pure/plain items: <b>{kg(r['usage']['plain_g'])}</b>", st["Normal"]),
            Spacer(1, 10),
        ]

    # 4. By Cashier & Discounts
    if r.get("by_cashier"):
        story += [
            Paragraph("<b>4. Cashier Performance & Discounts</b>", st["Heading3"]),
            grid(
                [["Cashier", "Bills", "Total Sales", "Discounted Bills", "Discounts Given"]] +
                [[c["cashier"], str(c["bills"]), rs(c["total_paise"]), str(c["discounted_bills"]), rs(c["discount_paise"])] for c in r["by_cashier"]],
                [45, 24, 36, 35, 38]
            ),
            Spacer(1, 10),
        ]

    # 5. Dues Collected
    if r.get("collections"):
        story += [
            Paragraph("<b>5. Client Dues Collected</b>", st["Heading3"]),
            grid(
                [["Date", "Client", "Amount", "Method", "Reference", "Collected By"]] +
                [[k["day"], k["client"], rs(k["amount_paise"]), k["method"], k.get("reference") or "—", k.get("by_name") or "—"] for k in r["collections"]],
                [22, 50, 26, 20, 36, 26]
            ),
            Spacer(1, 10),
        ]

    SimpleDocTemplate(buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                      title=f"VTC Report {r['from']} to {r['to']}").build(story)
    return buf.getvalue()
