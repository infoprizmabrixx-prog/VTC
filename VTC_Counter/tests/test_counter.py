"""VTC Counter app: the rules that touch money, people and the daily save."""
import importlib
import io
import os
import sys
import uuid
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
OWNER_PW = "Shop2026Counter"


class Client(TestClient):
    def request(self, method, url, **kw):
        headers = kw.pop("headers", None) or {}
        headers.setdefault("X-VTC", "1")
        return super().request(method, url, headers=headers, **kw)


def ok(r, status=200):
    assert r.status_code == status, f"{r.status_code}: {r.text}"
    return r.json()


def key():
    return {"X-Idempotency-Key": str(uuid.uuid4())}


@pytest.fixture()
def app(tmp_path):
    os.environ["VTC_COUNTER_DB"] = str(tmp_path / "c.sqlite3")
    os.environ["VTC_SAVE_DIR"] = str(tmp_path / "saves")
    for m in [m for m in sys.modules if m == "counter" or m.startswith("counter.")]:
        del sys.modules[m]
    return importlib.import_module("counter.main")


@pytest.fixture()
def shop(app):
    """Owner signs in, sets a password, adds a cashier, items, rates and the discount cap."""
    o = Client(app.app)
    o.__enter__()   # runs start-up (creates the owner)
    ok(o.post("/api/login", json={"username": "owner", "password": "VTC-Owner-Demo26"}))
    assert ok(o.get("/api/me"))["user"]["must_change"] == 1
    ok(o.get("/api/counter"), 403)                              # must set own password first
    ok(o.post("/api/me/secret", json={"current": "VTC-Owner-Demo26", "new": OWNER_PW}))
    cid = ok(o.post("/api/people", json={"role": "cashier", "full_name": "Lakshmi", "pin": "4826"}))["id"]
    premium = ok(o.post("/api/items", json={"name": "Prem P", "bill_name": "Premium powder", "price_paise": 90000, "gst_bp": 500, "mix_chicory": True}))["id"]
    beans = ok(o.post("/api/items", json={"name": "Prem B", "bill_name": "Premium beans", "price_paise": 110000, "gst_bp": 500}))["id"]
    tea = ok(o.post("/api/items", json={"name": "CTC", "bill_name": "CTC dust", "price_paise": 40000, "gst_bp": 500}))["id"]
    ok(o.put("/api/settings", json={"chicory_rate_paise": 30000, "discount_cap_pct": 5, "opening_cash_paise": 200000}))
    k = Client(app.app)
    k.__enter__()
    ok(k.post("/api/login/pin", json={"user_id": cid, "pin": "4826"}))
    yield {"owner": o, "cashier": k, "premium": premium, "beans": beans, "tea": tea, "cashier_id": cid}
    o.__exit__(None, None, None)
    k.__exit__(None, None, None)


def sale(lines, pays, **kw):
    return {"lines": lines, "payments": pays, **kw}


def test_pricing_rules():
    from counter import pricing as p
    assert p.powder_rate(80, 90000, 30000) == 78000                 # 0.8 x 900 + 0.2 x 300 = 780 /kg
    assert p.powder_rate(100, 90000, 30000) == 90000
    assert p.line_amount(250, 78000) == 19500
    assert p.round_bill(38960) == (39000, 40) and p.round_bill(38949) == (38900, -49) and p.round_bill(38950) == (39000, 50)
    assert p.gst_included([(10500, 500)], 0) == 500                  # Rs105 incl. 5% → Rs5 tax
    assert p.split_grams("mix", 500, 80) == (400, 100, 0) and p.split_grams("plain", 250, None) == (0, 0, 250)


def test_bill_powder_ratio_beans_tea_discount_rounding(shop):
    k, P, T = shop["cashier"], shop["premium"], shop["tea"]
    lines = [{"item_id": P, "coffee_pct": 80, "grams": 500},   # 0.5 x 780 = 390.00
             {"item_id": shop["beans"], "grams": 250},                       # 0.25 x 1100 = 275.00
             {"item_id": T, "grams": 123}]                                        # 0.123 x 400 = 49.20
    # subtotal 714.20; discount 10.00 → 704.20 → rounds to 704.00
    ok(k.post("/api/bills", json=sale(lines, [{"method": "CASH", "amount_paise": 70420}], discount_paise=1000, discount_reason="regular"), headers=key()), 400)
    b = ok(k.post("/api/bills", json=sale(lines, [{"method": "CASH", "amount_paise": 40000}, {"method": "UPI", "amount_paise": 30400, "reference": "UTR1"}],
                                          discount_paise=1000, discount_reason="regular", customer_name="Ravi", customer_phone="+91 98765 43210"), headers=key()))
    assert b["subtotal_paise"] == 71420 and b["total_paise"] == 70400 and b["round_off_paise"] == -20
    assert [l["item_name"] for l in b["lines"]] == ["Premium powder 80/20", "Premium beans", "CTC dust"]
    assert [(l["coffee_g"], l["chicory_g"], l["plain_g"]) for l in b["lines"]] == [(400, 100, 0), (0, 0, 250), (0, 0, 123)]
    assert b["bill_no"].startswith("CTR-") and b["bill_no"].endswith("-0001")
    assert b["gst_paise"] == 3353            # 5% inside each line after its share of the discount
    # cashier sees the customer phone masked in the list
    assert ok(k.get("/api/bills"))["bills"][0]["customer_phone"] == "••••••3210"
    assert ok(shop["owner"].get("/api/bills"))["bills"][0]["customer_phone"] == "9876543210"


def test_discount_limit_and_reason(shop):
    k, P = shop["cashier"], shop["premium"]
    line = [{"item_id": shop["beans"], "grams": 1000}]                           # Rs1100; 5% cap = Rs55
    assert ok(k.post("/api/bills", json=sale(line, [{"method": "CASH", "amount_paise": 104400}], discount_paise=5600, discount_reason="too much"), headers=key()), 400)["error"] == "DISCOUNT_ABOVE_LIMIT"
    assert ok(k.post("/api/bills", json=sale(line, [{"method": "CASH", "amount_paise": 105000}], discount_paise=5000), headers=key()), 400)["error"] == "DISCOUNT_REASON_REQUIRED"
    ok(k.post("/api/bills", json=sale(line, [{"method": "CASH", "amount_paise": 104500}], discount_paise=5500, discount_reason="festival"), headers=key()))


def test_custom_ratio_and_missing_setup(shop):
    k, o, P = shop["cashier"], shop["owner"], shop["premium"]
    b = ok(k.post("/api/bills", json=sale([{"item_id": P, "coffee_pct": 85, "grams": 1000}], [{"method": "UPI", "amount_paise": 81000}]), headers=key()))
    assert b["lines"][0]["rate_paise"] == 81000                                       # 0.85 x 900 + 0.15 x 300
    assert ok(k.post("/api/bills", json=sale([{"item_id": P, "coffee_pct": 0, "grams": 100}], [{"method": "UPI", "amount_paise": 3000}]), headers=key()), 400)["error"] == "INVALID_RATIO"
    ok(o.put("/api/settings", json={"chicory_rate_paise": None}))
    assert ok(k.post("/api/bills", json=sale([{"item_id": P, "coffee_pct": 80, "grams": 100}], [{"method": "UPI", "amount_paise": 7800}]), headers=key()), 400)["error"] == "CHICORY_RATE_NOT_SET"


def test_retry_returns_same_bill_and_cashier_cannot_set_prices(shop):
    k, P = shop["cashier"], shop["premium"]
    h = key()
    body = sale([{"item_id": shop["beans"], "grams": 100}], [{"method": "CASH", "amount_paise": 11000}])
    assert ok(k.post("/api/bills", json=body, headers=h))["id"] == ok(k.post("/api/bills", json=body, headers=h))["id"]
    ok(k.put("/api/settings", json={"discount_cap_pct": 50}), 403)
    ok(k.put(f"/api/items/{P}", json={"beans_rate_paise": 1}), 403)
    ok(k.get("/api/reports"), 403)
    assert Client(shop["owner"].app).post("/api/bills", json=body, headers={"X-VTC": "0"}).status_code == 403   # forged page refused


def test_cancel_needs_owner_and_day_close(shop):
    k, o, P = shop["cashier"], shop["owner"], shop["premium"]
    b1 = ok(k.post("/api/bills", json=sale([{"item_id": shop["beans"], "grams": 1000}], [{"method": "CASH", "amount_paise": 110000}]), headers=key()))
    b2 = ok(k.post("/api/bills", json=sale([{"item_id": shop["beans"], "grams": 500}], [{"method": "CASH", "amount_paise": 55000}]), headers=key()))
    assert ok(k.post(f"/api/bills/{b1['id']}/cancel", json={"reason": "wrong weight"}))["state"] == "CANCEL_REQUESTED"
    ok(k.get("/api/cancels"), 404)
    xid = ok(o.get("/api/bills"))["pending_cancels"][0]["id"]
    ok(k.post(f"/api/cancels/{xid}/decide", json={"approve": True}), 403)                # cashier cannot approve
    assert ok(k.post("/api/day-close", json={"counted_paise": 0}), 400)["error"] == "DECIDE_CANCEL_REQUESTS_FIRST"
    ok(o.post(f"/api/cancels/{xid}/decide", json={"approve": True, "note": "ok"}))
    st = ok(k.get("/api/day-close"))["today"]
    assert st["bills"] == 1 and st["cancelled"] == 1 and st["expected_paise"] == 200000 + 55000
    assert ok(k.post("/api/day-close", json={"counted_paise": 254000}), 400)["error"] == "EXPLAIN_THE_DIFFERENCE"
    r = ok(k.post("/api/day-close", json={"counted_paise": 254000, "note": "short 10 rupees"}))
    assert r["state"] == "DIFFERENCE" and r["difference_paise"] == -1000 and r["save"]["ok"]
    assert ok(k.post("/api/bills", json=sale([{"item_id": shop["beans"], "grams": 100}], [{"method": "CASH", "amount_paise": 11000}]), headers=key()), 400)["error"] == "DAY_CLOSED"
    assert ok(o.post(f"/api/bills/{b2['id']}/cancel", json={"reason": "after close"}), 400)["error"] == "ONLY_TODAYS_OPEN_BILLS_CAN_BE_CANCELLED"
    ok(k.post(f"/api/day-close/{r['id']}/reopen", json={"reason": "late customer"}), 403)
    ok(o.post(f"/api/day-close/{r['id']}/reopen", json={"reason": "late customer"}))
    ok(k.post("/api/bills", json=sale([{"item_id": shop["beans"], "grams": 100}], [{"method": "CASH", "amount_paise": 11000}]), headers=key()))


def test_daily_save_files_and_report(shop, tmp_path):
    k, o, P, T = shop["cashier"], shop["owner"], shop["premium"], shop["tea"]
    ok(k.post("/api/bills", json=sale([{"item_id": P, "coffee_pct": 70, "grams": 1000}, {"item_id": T, "grams": 500}],
                                      [{"method": "CARD", "amount_paise": 92000}]), headers=key()))        # 720 + 200
    r = ok(o.post("/api/saves/run"))
    folder = Path(r["folder"])
    assert sorted(p.name.split("_")[1] for p in folder.iterdir()) == ["backup", "bills", "day"]
    assert folder.is_relative_to(tmp_path / "saves")
    import sqlite3
    assert sqlite3.connect(next(folder.glob("*.sqlite3"))).execute("SELECT COUNT(*) FROM bills").fetchone()[0] == 1
    assert next(folder.glob("*.pdf")).read_bytes()[:4] == b"%PDF"
    rep = ok(o.get("/api/reports"))
    assert rep["totals"]["total_paise"] == 92000 and rep["totals"]["CARD"] == 92000
    assert rep["usage"] == {"coffee_g": 700, "chicory_g": 300, "plain_g": 500}
    x = o.get("/api/reports.xlsx")
    assert x.status_code == 200 and len([n for n in zipfile.ZipFile(io.BytesIO(x.content)).namelist() if "worksheets/sheet" in n]) == 10


def test_print_queue_one_press_one_bill(shop):
    k, o, P = shop["cashier"], shop["owner"], shop["premium"]
    ok(o.put("/api/settings", json={"print_method": "browser"}))
    b = ok(k.post("/api/bills", json=sale([{"item_id": shop["beans"], "grams": 100}], [{"method": "CASH", "amount_paise": 11000}], print=True), headers=key()))
    got = ok(o.get("/api/print-jobs/next"))                      # the PC print station picks it up
    assert got["job"]["label"] == "CUSTOMER COPY" and got["job"]["duplicate"] == 0 and got["bill"]["id"] == b["id"]
    assert ok(o.get("/api/print-jobs/next"))["job"] is None      # claimed once only — never printed twice
    ok(o.post(f"/api/print-jobs/{got['job']['id']}/done"))
    jid = ok(k.post(f"/api/bills/{b['id']}/print", json={"copy": "customer"}))["job_id"]
    again = ok(k.post(f"/api/print-jobs/{jid}/claim"))
    assert again["job"]["duplicate"] == 1 and again["bill"]["reprints"] == 1


def test_people_rules(shop):
    o, k = shop["owner"], shop["cashier"]
    ok(k.post("/api/people", json={"role": "cashier", "full_name": "X", "pin": "1357"}), 403)
    aid = ok(o.post("/api/people", json={"role": "admin", "full_name": "Office", "username": "office", "password": "Office2026pass"}))["id"]
    a = Client(o.app)
    ok(a.post("/api/login", json={"username": "office", "password": "Office2026pass"}))
    ok(a.post("/api/me/secret", json={"current": "Office2026pass", "new": "Office2027pass"}))
    ok(a.post("/api/people", json={"role": "admin", "full_name": "Two", "username": "two", "password": "Two2026passw"}), 403)   # only owner adds admins
    ok(a.put("/api/people/1", json={"active": False}), 403)                                                                      # nobody touches the owner
    ok(a.put(f"/api/people/{shop['cashier_id']}", json={"active": False}))
    ok(k.get("/api/me"), 401)                                                                                                   # switched off = signed out
    ok(a.put(f"/api/people/{shop['cashier_id']}", json={"active": True}))
    x = Client(o.app)
    for _ in range(5):
        assert ok(x.post("/api/login/pin", json={"user_id": shop["cashier_id"], "pin": "1111"}), 401)["error"] == "WRONG_PIN"
    assert ok(x.post("/api/login/pin", json={"user_id": shop["cashier_id"], "pin": "4826"}), 423)["error"] == "ACCOUNT_LOCKED_TRY_LATER"   # right PIN, still locked


def test_layout_and_owner_reset(shop):
    o = shop["owner"]
    ok(o.put("/api/layout", json={"footer": "Visit again!", "show_customer_phone": True, "logo": "data:image/png;base64,iVBORw0KGgo="}))
    lay = ok(o.get("/api/counter"))["layout"]
    assert lay["footer"] == "Visit again!" and lay["show_customer_phone"] is True and lay["shop_name"] == "Vasavi Trading Company"
    ok(o.put("/api/layout", json={"logo": "javascript:alert(1)"}), 400)
    from counter import reset_owner
    reset_owner.main()
    ok(o.get("/api/me"), 401)
    ok(o.post("/api/login", json={"username": "owner", "password": "VTC-Owner-Demo26"}))
    assert ok(o.get("/api/me"))["user"]["must_change"] == 1


def _text(data: bytes) -> list[str]:
    """Printed text lines from ESC/POS bytes (commands stripped)."""
    import re
    t = re.sub(rb"\x1b[@]|\x1bt.|\x1ba.|\x1bE.|\x1d!.|\x1dV..|\x1dv0.{5}", b"", data, flags=re.S)
    return t.decode("cp437").split("\n")


def test_escpos_bill_is_one_80mm_receipt():
    from counter import escpos
    from datetime import datetime, timezone
    lay = {"shop_name": "Vasavi Trading Company", "address": "Abids, Hyderabad", "phone": "040-0000", "gstin": "", "footer": "Thank you! Visit again.",
           "logo": "", "show_time": True, "show_cashier": False, "show_customer_name": True, "show_customer_phone": False, "show_ratio": True, "show_gst": True, "show_payments": True}
    b = {**escpos.SAMPLE, "created_at": datetime(2026, 10, 28, 8, 50, tzinfo=timezone.utc).isoformat(),
         "lines": escpos.SAMPLE["lines"] + [{"item_name": "A very long coffee name that will not fit on one line powder 80/20", "form": "powder", "grams": 1250, "rate_paise": 78000, "amount_paise": 97500}]}
    data = escpos.bill_bytes(b, lay, cols=48)
    assert data.startswith(b"\x1b@") and data.endswith(b"\x1dV\x42\x00")          # starts clean, ends with one cut
    assert data.count(b"\x1dV") == 1                                                # one bill = one cut
    lines = _text(data)
    assert all(len(l) <= 48 for l in lines), [l for l in lines if len(l) > 48]
    joined = "\n".join(lines)
    assert "Bill CTR-2610-0042" in joined and "28/10/26 02:20 PM" in joined         # IST time
    assert "Cashier" not in joined                                                  # owner switched it off
    assert "Rs. 655.00" in joined and "₹" not in joined                         # no rupee glyph on thermal fonts
    assert any(l.startswith("  1.25 kg x 780.00/kg") and l.endswith("975.00") for l in lines)
    assert "Tax details pending accountant approval" in joined
    assert len(escpos.bill_bytes(b, lay, cols=42).split(b"\n")) > 0 and all(len(l) <= 42 for l in _text(escpos.bill_bytes(b, lay, cols=42)))


def test_direct_print_to_windows_printer(shop, monkeypatch):
    from counter import main, printer
    sent = []
    monkeypatch.setattr(printer, "available", lambda: True)
    monkeypatch.setattr(printer, "send", lambda data, name="", title="": sent.append((data, name)))
    k, o, P = shop["cashier"], shop["owner"], shop["premium"]
    assert ok(k.get("/api/counter"))["print_method"] == "direct"
    b = ok(k.post("/api/bills", json=sale([{"item_id": shop["beans"], "grams": 100}], [{"method": "CASH", "amount_paise": 11000}]), headers=key()))
    r = ok(k.post(f"/api/bills/{b['id']}/print", json={"copy": "customer"}))
    assert r == {"job_id": r["job_id"], "direct": True, "ok": True, "error": ""} and len(sent) == 1
    assert b"DUPLICATE" not in sent[0][0] and b["bill_no"].encode() in sent[0][0]
    ok(k.post(f"/api/bills/{b['id']}/print", json={"copy": "customer"}))
    assert b"DUPLICATE 1" in sent[1][0]                                            # reprint is marked
    assert ok(o.get("/api/print-jobs/next"))["job"] is None                        # no browser station needed
    ok(o.put("/api/settings", json={"printer_name": "ATPOS AT-402", "print_cols": 42}))
    ok(k.post(f"/api/bills/{b['id']}/print", json={"copy": "office"}))
    assert sent[-1][1] == "ATPOS AT-402" and b"[ OFFICE COPY ]" in sent[-1][0]
    def broken(data, name="", title=""):
        raise printer.PrintError("Printer 'ATPOS AT-402' was not found in Windows.")
    monkeypatch.setattr(printer, "send", broken)
    r = ok(k.post(f"/api/bills/{b['id']}/print", json={"copy": "customer"}))
    assert r["ok"] is False and "not found" in r["error"]                          # the sale is safe; the error is shown
    assert ok(o.post("/api/printers/test", json={}))["ok"] is False
    ok(k.post("/api/printers/test", json={}), 403)


def test_old_items_convert_to_one_price_items(tmp_path):
    """Shops that started with the first version (beans + powder prices on one coffee) keep every bill."""
    import sqlite3
    path = tmp_path / "old.sqlite3"
    c = sqlite3.connect(path)
    c.executescript("""
      CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, full_name TEXT NOT NULL, role TEXT NOT NULL, login TEXT NOT NULL, secret_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_at TEXT NOT NULL);
      CREATE TABLE items(id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('coffee','tea')), name TEXT NOT NULL, beans_rate_paise INTEGER, powder_rate_paise INTEGER,
        tea_rate_paise INTEGER, gst_bp INTEGER, hsn TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, changed_by INTEGER, changed_at TEXT NOT NULL);
      CREATE TABLE bills(id INTEGER PRIMARY KEY, bill_no TEXT NOT NULL UNIQUE, day TEXT NOT NULL, customer_id INTEGER, customer_name TEXT NOT NULL DEFAULT '', customer_phone TEXT NOT NULL DEFAULT '',
        subtotal_paise INTEGER NOT NULL, discount_paise INTEGER NOT NULL DEFAULT 0, discount_reason TEXT NOT NULL DEFAULT '', round_off_paise INTEGER NOT NULL DEFAULT 0,
        total_paise INTEGER NOT NULL, gst_paise INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, reprints INTEGER NOT NULL DEFAULT 0, cashier_id INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE bill_lines(id INTEGER PRIMARY KEY, bill_id INTEGER NOT NULL REFERENCES bills(id), item_id INTEGER NOT NULL REFERENCES items(id), item_name TEXT NOT NULL,
        form TEXT NOT NULL CHECK(form IN ('beans','powder','tea')), coffee_pct INTEGER, grams INTEGER NOT NULL, rate_paise INTEGER NOT NULL, amount_paise INTEGER NOT NULL,
        gst_bp INTEGER, hsn TEXT NOT NULL DEFAULT '', coffee_g INTEGER NOT NULL DEFAULT 0, chicory_g INTEGER NOT NULL DEFAULT 0, tea_g INTEGER NOT NULL DEFAULT 0);
      INSERT INTO users VALUES(1,'owner','Owner','owner','password','x',1,0,0,NULL,'2026-10-28T00:00:00+00:00');
      INSERT INTO items VALUES(1,'coffee','Premium',110000,90000,NULL,500,'',1,0,1,'2026-10-28T00:00:00+00:00');
      INSERT INTO items VALUES(2,'coffee','Robusta',80000,NULL,NULL,500,'',1,0,1,'2026-10-28T00:00:00+00:00');
      INSERT INTO items VALUES(3,'tea','CTC',NULL,NULL,40000,500,'',1,0,1,'2026-10-28T00:00:00+00:00');
      INSERT INTO bills VALUES(1,'CTR-2610-0001','2026-10-28',NULL,'','',75000,0,'',0,75000,0,'PAID',0,1,'2026-10-28T05:00:00+00:00');
      INSERT INTO bill_lines VALUES(1,1,1,'Premium powder 80/20','powder',80,500,78000,39000,500,'',400,100,0);
      INSERT INTO bill_lines VALUES(2,1,1,'Premium beans','beans',NULL,250,110000,27500,500,'',250,0,0);
      INSERT INTO bill_lines VALUES(3,1,3,'CTC','tea',NULL,212,40000,8500,500,'',0,0,212);
    """)
    c.close()
    os.environ["VTC_COUNTER_DB"] = str(path)
    for m in [m for m in sys.modules if m == "counter" or m.startswith("counter.")]:
        del sys.modules[m]
    from counter import db
    db.init()
    db.init()
    c = sqlite3.connect(path)
    items = c.execute("SELECT id, name, bill_name, price_paise, mix_chicory FROM items WHERE for_client=0 ORDER BY id").fetchall()
    copies = c.execute("SELECT name, bill_name, price_paise, mix_chicory FROM items WHERE for_client=1 ORDER BY id").fetchall()
    assert copies == [x[1:] for x in sorted(items)]                                   # copied once to the client list (init ran twice)
    assert items == [(1, "Premium Powder", "Premium powder", 90000, 1), (2, "Robusta Beans", "Robusta beans", 80000, 0), (3, "CTC", "CTC", 40000, 0),
                     (4, "Premium Beans", "Premium beans", 110000, 0)]
    lines = c.execute("SELECT item_id, item_name, form, amount_paise, coffee_g, chicory_g, plain_g FROM bill_lines ORDER BY id").fetchall()
    assert lines == [(1, "Premium powder 80/20", "mix", 39000, 400, 100, 0), (4, "Premium beans", "plain", 27500, 0, 0, 250), (3, "CTC", "plain", 8500, 0, 0, 212)]
    assert c.execute("PRAGMA foreign_key_check").fetchall() == []


def test_cashier_adds_item_at_counter_with_own_pin(shop, tmp_path):
    k, o, P = shop["cashier"], shop["owner"], shop["premium"]
    lines = [{"item_id": P, "coffee_pct": 100, "grams": 100},                                   # Rs90
             {"custom": {"name": "Coffee filter (steel)", "amount_paise": 25000}},               # typed amount, no weight
             {"custom": {"name": "Loose jaggery", "amount_paise": 6000, "grams": 500, "gst_bp": 0}}]
    pay = [{"method": "CASH", "amount_paise": 40000}]
    assert ok(k.post("/api/bills", json=sale(lines, pay), headers=key()), 400)["error"] == "CONFIRM_WITH_YOUR_PIN"
    assert ok(k.post("/api/bills", json=sale(lines, pay, confirm_secret="1111"), headers=key()), 400)["error"] == "CONFIRM_WITH_YOUR_PIN"
    assert ok(k.post("/api/me/check", json={"secret": "4826"}))["name"] == "Lakshmi"
    b = ok(k.post("/api/bills", json=sale(lines, pay, confirm_secret="4826"), headers=key()))
    assert b["total_paise"] == 40000
    custom = [l for l in b["lines"] if l["form"] == "custom"]
    assert [(l["item_name"], l["amount_paise"], l["grams"], l["item_id"], l["added_by_name"]) for l in custom] == [
        ("Coffee filter (steel)", 25000, 0, None, "Lakshmi"), ("Loose jaggery", 6000, 500, None, "Lakshmi")]
    rep = ok(o.get("/api/reports"))
    assert [(x["item_name"], x["added_by"]) for x in rep["added"]] == [("Coffee filter (steel)", "Lakshmi"), ("Loose jaggery", "Lakshmi")]
    from counter import escpos
    txt = escpos.bill_bytes({**b, "created_at": b["created_at"]}, ok(k.get("/api/counter"))["layout"]).decode("cp437", "replace")
    assert "Coffee filter (steel)" in txt and "x 0.00/kg" not in txt                        # no fake rate on typed items
    r = ok(o.post("/api/saves/run"))
    pdf = next(Path(r["folder"]).glob("*.pdf")).read_bytes()
    assert pdf[:4] == b"%PDF"


def test_client_credit_dues_and_collections(shop):
    from datetime import date, timedelta
    k, o, P, B = shop["cashier"], shop["owner"], shop["premium"], shop["beans"]
    # client items are a separate list: same prices here so the sums below stay the same
    CB = ok(o.post("/api/items", json={"name": "Prem B", "bill_name": "Premium beans", "price_paise": 110000, "gst_bp": 500, "for_client": True}))["id"]
    CP = ok(o.post("/api/items", json={"name": "Prem P", "bill_name": "Premium powder", "price_paise": 90000, "gst_bp": 500, "mix_chicory": True, "for_client": True}))["id"]
    forty = (date.fromisoformat(ok(k.get("/api/counter"))["day"]) - timedelta(days=40)).isoformat()
    ok(k.post("/api/clients", json={"name": "Cafe Aroma", "phone": "9000000001", "gstin": "bad"}), 400)                 # GSTIN checked
    cid = ok(k.post("/api/clients", json={"name": "Cafe Aroma", "contact": "Ravi", "phone": "9000000001", "address": "Banjara Hills",
                                          "gstin": "36ABCDE1234F1Z5", "opening_paise": 500000, "opening_date": forty}))["id"]
    ok(k.put(f"/api/clients/{cid}", json={"opening_paise": 1}), 403)                                                  # old dues: owner/admin only
    # each list only bills on its own screen
    assert ok(k.post("/api/bills", json={"client_id": cid, "lines": [{"item_id": B, "grams": 1000}], "payments": []}, headers=key()), 400)["error"] == "ITEM_NOT_ON_SALE"
    assert ok(k.post("/api/bills", json={"lines": [{"item_id": CB, "grams": 1000}], "payments": [{"method": "CASH", "amount_paise": 110000}]}, headers=key()), 400)["error"] == "ITEM_NOT_ON_SALE"
    assert {i["id"] for i in ok(k.get("/api/counter"))["items"] if i["for_client"]} == {CB, CP}
    # full credit, client price instead of list price (beans list 1100/kg)
    b1 = ok(k.post("/api/bills", json={"client_id": cid, "lines": [{"item_id": CB, "grams": 10000, "rate_paise": 95000}], "payments": []}, headers=key()))
    assert b1["bill_no"].startswith("DLR-") and b1["total_paise"] == 950000 and b1["paid_paise"] == 0 and b1["due_paise"] == 950000
    assert b1["lines"][0]["list_rate_paise"] == 110000 and b1["lines"][0]["rate_paise"] == 95000
    assert b1["balance_after_paise"] == 500000 + 950000 and b1["client"]["gstin"] == "36ABCDE1234F1Z5"
    # counter bills ignore any price sent from the screen
    c1 = ok(k.post("/api/bills", json={"lines": [{"item_id": B, "grams": 1000, "rate_paise": 1}], "payments": [{"method": "CASH", "amount_paise": 110000}]}, headers=key()))
    assert c1["total_paise"] == 110000 and c1["bill_no"].startswith("CTR-")
    ok(k.post("/api/bills", json={"lines": [{"item_id": B, "grams": 1000}], "payments": []}, headers=key()), 400)       # counter must pay
    assert ok(k.post("/api/bills", json={"client_id": cid, "lines": [{"item_id": CB, "grams": 1000}], "payments": [{"method": "CASH", "amount_paise": 999999}]},
                     headers=key()), 400)["error"] == "PAID_MORE_THAN_BILL"
    # old dues warning once the owner sets the days
    ok(o.put("/api/settings", json={"overdue_days": 30}))
    part = {"client_id": cid, "lines": [{"item_id": CP, "coffee_pct": 80, "grams": 1000}], "payments": [{"method": "CASH", "amount_paise": 30000}]}   # 780 total
    assert ok(k.post("/api/bills", json=part, headers=key()), 400)["error"] == "CLIENT_HAS_OLD_DUES"
    b2 = ok(k.post("/api/bills", json={**part, "credit_reason": "regular, pays monthly"}, headers=key()))
    assert b2["paid_paise"] == 30000 and b2["due_paise"] == 48000
    # fully paid client bill never needs a reason
    ok(k.post("/api/bills", json={**part, "payments": [{"method": "UPI", "amount_paise": 78000}]}, headers=key()))
    d = ok(k.get(f"/api/clients/{cid}"))["summary"]
    assert d["balance_paise"] == 500000 + 950000 + 48000 and d["oldest_days"] == 40
    assert d["buckets"]["31_60"] == 500000 and d["buckets"]["0_30"] == 998000
    # collection clears the oldest first (the opening balance)
    r = ok(k.post(f"/api/clients/{cid}/collect", json={"amount_paise": 600000, "method": "CASH"}))
    assert r["balance_paise"] == 1498000 - 600000
    d = ok(k.get(f"/api/clients/{cid}"))
    assert d["summary"]["buckets"]["31_60"] == 0 and d["summary"]["oldest_days"] == 0 and d["summary"]["open"][0]["remaining"] == 950000 - 100000
    st = d["statement"]
    assert st[0]["what"].startswith("Opening") and st[-1]["balance"] == 898000
    # day close expects counter cash + client cash at billing + cash collected
    day = ok(k.get("/api/day-close"))["today"]
    assert day["expected_paise"] == 200000 + 110000 + 30000 + 600000 and day["credit_paise"] == 950000 + 48000
    # owner/admin can undo a wrong collection; cashier cannot
    kid = d["collections"][0]["id"]
    ok(k.post(f"/api/collections/{kid}/cancel", json={"reason": "typed twice"}), 403)
    ok(o.post(f"/api/collections/{kid}/cancel", json={"reason": "typed twice"}))
    assert ok(o.get("/api/dues"))["clients"][0]["balance_paise"] == 1498000
    # overpaying leaves an advance
    ok(k.post(f"/api/clients/{cid}/collect", json={"amount_paise": 1500000, "method": "BANK", "reference": "NEFT 1"}))
    assert ok(k.get(f"/api/clients/{cid}"))["summary"]["balance_paise"] == -2000
    rem = ok(k.get(f"/api/clients/{cid}/reminder"))
    assert rem["link"].startswith("https://wa.me/919000000001?text=")
    pdf = k.get(f"/api/clients/{cid}/statement.pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    x = o.get("/api/dues.xlsx")
    assert x.status_code == 200 and k.get("/api/dues.xlsx").status_code == 403
    rep = ok(o.get("/api/reports"))
    assert rep["totals"]["client_paise"] == 950000 + 78000 + 78000 and rep["totals"]["credit_paise"] == 998000
    assert rep["totals"]["collected_paise"] == 1500000 and rep["price_changes"][0]["list_rate_paise"] == 110000
    from counter import escpos
    txt = escpos.bill_bytes(b2, ok(k.get("/api/counter"))["layout"]).decode("cp437", "replace")
    assert "Client: Cafe Aroma" in txt and "This bill due" in txt and "GSTIN 36ABCDE1234F1Z5" in txt


def test_dealer_and_cafe_segregation_and_numbering(shop):
    k, o, P, B = shop["cashier"], shop["owner"], shop["premium"], shop["beans"]
    CB = ok(o.post("/api/items", json={"name": "Prem B", "bill_name": "Premium beans", "price_paise": 110000, "gst_bp": 500, "for_client": True}))["id"]
    
    # Add Dealer and Cafe
    dealer_id = ok(k.post("/api/clients", json={"name": "Sri Krishna Traders", "client_type": "dealer", "phone": "9876543211"}))["id"]
    cafe_id = ok(k.post("/api/clients", json={"name": "Blue Tokai Cafe", "client_type": "cafe", "phone": "9876543212"}))["id"]
    
    # Bill Dealer
    b_dealer = ok(k.post("/api/bills", json={"client_id": dealer_id, "lines": [{"item_id": CB, "grams": 5000}], "payments": [{"method": "CASH", "amount_paise": 550000}]}, headers=key()))
    assert b_dealer["bill_type"] == "dealer"
    assert b_dealer["bill_no"].startswith("DLR-")
    
    # Bill Cafe
    b_cafe = ok(k.post("/api/bills", json={"client_id": cafe_id, "lines": [{"item_id": CB, "grams": 2000}], "payments": [{"method": "UPI", "amount_paise": 220000}]}, headers=key()))
    assert b_cafe["bill_type"] == "cafe"
    assert b_cafe["bill_no"].startswith("CAF-")


def test_blend_builder_and_pricing(shop):
    k, o, P, B = shop["cashier"], shop["owner"], shop["premium"], shop["beans"]
    
    # Create blend
    blend_id = ok(o.post("/api/blends", json={
        "name": "House Blend 70/30",
        "bill_name": "House Blend 70/30",
        "base_price_paise": 85000,
        "is_shared": 1,
        "gst_bp": 500,
        "components": [
            {"item_id": P, "ratio_pct": 70},
            {"item_id": B, "ratio_pct": 30}
        ]
    }))["id"]
    
    # Counter sale with blend
    b = ok(k.post("/api/bills", json={
        "lines": [{"blend_id": blend_id, "grams": 1000}],
        "payments": [{"method": "CASH", "amount_paise": 85000}]
    }, headers=key()))
    assert b["total_paise"] == 85000
    assert b["lines"][0]["blend_id"] == blend_id
    assert b["lines"][0]["item_name"] == "House Blend 70/30"


def test_tax_breakdown_and_cash_tender(shop):
    k, o, P, B = shop["cashier"], shop["owner"], shop["premium"], shop["beans"]
    CB = ok(o.post("/api/items", json={"name": "Prem B", "bill_name": "Premium beans", "price_paise": 110000, "gst_bp": 500, "for_client": True}))["id"]
    
    # Telangana client (state 36): CGST + SGST
    tg_client = ok(k.post("/api/clients", json={"name": "Local Store", "client_type": "dealer", "state_code": "36", "phone": "9998887771"}))["id"]
    b_tg = ok(k.post("/api/bills", json={
        "client_id": tg_client,
        "lines": [{"item_id": CB, "grams": 1000}], # 1100.00 incl 5% GST
        "payments": [{"method": "CASH", "amount_paise": 110000}],
        "tendered_paise": 150000,
        "change_paise": 40000
    }, headers=key()))
    assert b_tg["tendered_paise"] == 150000
    assert b_tg["change_paise"] == 40000
    assert b_tg["cgst_paise"] > 0 and b_tg["sgst_paise"] > 0 and b_tg["igst_paise"] == 0
    assert b_tg["taxable_paise"] + b_tg["cgst_paise"] + b_tg["sgst_paise"] == 110000

    # Interstate client (state 29 Karnataka): IGST
    ka_client = ok(k.post("/api/clients", json={"name": "Bangalore Cafe", "client_type": "cafe", "state_code": "29", "phone": "9998887772"}))["id"]
    b_ka = ok(k.post("/api/bills", json={
        "client_id": ka_client,
        "lines": [{"item_id": CB, "grams": 1000}],
        "payments": [{"method": "CASH", "amount_paise": 110000}]
    }, headers=key()))
    assert b_ka["igst_paise"] > 0 and b_ka["cgst_paise"] == 0 and b_ka["sgst_paise"] == 0
    assert b_ka["taxable_paise"] + b_ka["igst_paise"] == 110000


def test_permission_toggles_and_reports_pdf(shop):
    k, o = shop["cashier"], shop["owner"]
    
    # By default, cashier cannot access dues
    res = k.get("/api/dues")
    assert res.status_code == 403
    
    # Owner toggles can_view_dues for cashier
    ok(o.put(f"/api/people/{shop['cashier_id']}", json={"can_view_dues": True}))
    res = k.get("/api/dues")
    assert res.status_code == 200
    
    # Reports PDF export
    pdf_res = o.get("/api/reports.pdf")
    assert pdf_res.status_code == 200
    assert pdf_res.headers["content-type"] == "application/pdf"
    assert pdf_res.content[:4] == b"%PDF"

