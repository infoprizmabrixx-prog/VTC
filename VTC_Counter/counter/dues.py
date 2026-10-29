"""Client dues: what each client owes, how old it is, and their statement.

Money owed = opening balance + the unpaid part of every client bill (not cancelled)
             - every collection (not cancelled).
Collections always clear the oldest dues first, so "how old" is worked out by applying all money
received to the oldest charges, in date order. Paying more than owed leaves an advance (negative balance).
"""
from datetime import date

from . import db

BUCKETS = (("0_30", 0, 30), ("31_60", 31, 60), ("61_90", 61, 90), ("90_plus", 91, 10 ** 6))


def _days(day: str, today: str) -> int:
    return (date.fromisoformat(today) - date.fromisoformat(day)).days


def charges(c, cid: int) -> tuple[list[dict], int, dict]:
    """(charges oldest first, money received, client)."""
    cl = db.one(c.execute("SELECT * FROM clients WHERE id=?", (cid,)))
    out = []
    if cl and cl["opening_paise"]:
        out.append({"day": cl["opening_date"] or cl["created_at"][:10], "at": "", "what": "Opening balance", "bill_id": None, "amount": cl["opening_paise"]})
    for b in c.execute("SELECT id, bill_no, day, created_at, total_paise, paid_paise, due_paise FROM bills WHERE client_id=? AND status!='CANCELLED' AND due_paise>0 "
                       "ORDER BY created_at, id", (cid,)):
        out.append({"day": b["day"], "at": b["created_at"], "what": f"Bill {b['bill_no']}", "bill_id": b["id"], "amount": b["due_paise"]})
    out.sort(key=lambda x: (x["day"], x["at"]))
    received = c.execute("SELECT COALESCE(SUM(amount_paise),0) FROM collections WHERE client_id=? AND cancelled_at IS NULL", (cid,)).fetchone()[0]
    return out, received, cl


def summary(c, cid: int, today: str | None = None) -> dict:
    today = today or db.today()
    ch, received, cl = charges(c, cid)
    left = received
    open_items, buckets = [], {k: 0 for k, _, _ in BUCKETS}
    for x in ch:   # money received clears the oldest charges first
        take = min(left, x["amount"])
        left -= take
        rest = x["amount"] - take
        if rest:
            age = _days(x["day"], today)
            open_items.append({**x, "remaining": rest, "age_days": age})
            for k, lo, hi in BUCKETS:
                if lo <= age <= hi:
                    buckets[k] += rest
    balance = sum(x["amount"] for x in ch) - received
    return {
        "client_id": cid,
        "balance_paise": balance,
        "advance_paise": max(0, -balance),
        "open": open_items,
        "buckets": buckets,
        "oldest_days": max((x["age_days"] for x in open_items), default=0),
        "name": cl["name"] if cl else "",
        "client_type": cl.get("client_type", "dealer") if cl else "dealer",
        "credit_limit_paise": cl.get("credit_limit_paise") if cl else None,
    }


def statement(c, cid: int) -> list[dict]:
    """Every charge and payment with a running balance, oldest first."""
    cl = db.one(c.execute("SELECT * FROM clients WHERE id=?", (cid,)))
    rows = []
    if cl["opening_paise"]:
        rows.append({"day": cl["opening_date"] or cl["created_at"][:10], "at": "", "what": "Opening balance (before this app)", "debit": cl["opening_paise"], "credit": 0})
    for b in c.execute("SELECT bill_no, day, created_at, total_paise, paid_paise, due_paise FROM bills WHERE client_id=? AND status!='CANCELLED' ORDER BY created_at, id", (cid,)):
        paid = b["paid_paise"] or 0
        rows.append({"day": b["day"], "at": b["created_at"], "what": f"Bill {b['bill_no']} (total ₹{b['total_paise'] / 100:,.2f}" + (f", paid then ₹{paid / 100:,.2f}" if paid else "") + ")",
                     "debit": b["due_paise"], "credit": 0})
    for k in c.execute("SELECT day, created_at, amount_paise, method, reference FROM collections WHERE client_id=? AND cancelled_at IS NULL ORDER BY created_at, id", (cid,)):
        rows.append({"day": k["day"], "at": k["created_at"], "what": f"Received {k['method']}" + (f" {k['reference']}" if k["reference"] else ""), "debit": 0, "credit": k["amount_paise"]})
    rows.sort(key=lambda x: (x["day"], x["at"]))
    bal = 0
    for r in rows:
        bal += r["debit"] - r["credit"]
        r["balance"] = bal
    return rows
