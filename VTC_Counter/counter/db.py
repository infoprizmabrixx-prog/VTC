"""SQLite storage for the VTC Counter app. One file holds everything: data/vtc_counter.sqlite3."""
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.environ.get("VTC_COUNTER_DB", str(ROOT / "data" / "vtc_counter.sqlite3")))
IST = timezone(timedelta(hours=5, minutes=30))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE, full_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','admin','cashier')),
  login TEXT NOT NULL CHECK(login IN ('password','pin')), secret_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  must_change INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_at TEXT NOT NULL,
  can_view_dues INTEGER NOT NULL DEFAULT 0, can_manage_clients INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, last_seen TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, changed_by INTEGER, changed_at TEXT);
CREATE TABLE IF NOT EXISTS items(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, bill_name TEXT NOT NULL, price_paise INTEGER NOT NULL,
  mix_chicory INTEGER NOT NULL DEFAULT 0, gst_bp INTEGER, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0,
  changed_by INTEGER, changed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS blends(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, bill_name TEXT NOT NULL, base_price_paise INTEGER NOT NULL,
  is_shared INTEGER NOT NULL DEFAULT 1, cafe_id INTEGER REFERENCES clients(id), gst_bp INTEGER NOT NULL DEFAULT 500,
  active INTEGER NOT NULL DEFAULT 1, color_tag TEXT NOT NULL DEFAULT '#6366f1', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS blend_components(
  id INTEGER PRIMARY KEY, blend_id INTEGER NOT NULL REFERENCES blends(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id), ratio_pct INTEGER NOT NULL CHECK(ratio_pct > 0 AND ratio_pct <= 100));
CREATE TABLE IF NOT EXISTS client_prices(
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id),
  item_id INTEGER, blend_id INTEGER, rate_paise INTEGER NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ix_client_item_price ON client_prices(client_id, item_id) WHERE item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ix_client_blend_price ON client_prices(client_id, blend_id) WHERE blend_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
  visits INTEGER NOT NULL DEFAULT 0, spent_paise INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bills(
  id INTEGER PRIMARY KEY, bill_no TEXT NOT NULL UNIQUE, day TEXT NOT NULL, customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT NOT NULL DEFAULT '', customer_phone TEXT NOT NULL DEFAULT '',
  subtotal_paise INTEGER NOT NULL, discount_paise INTEGER NOT NULL DEFAULT 0, discount_reason TEXT NOT NULL DEFAULT '',
  round_off_paise INTEGER NOT NULL DEFAULT 0, total_paise INTEGER NOT NULL, gst_paise INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('PAID','CANCEL_REQUESTED','CANCELLED')), reprints INTEGER NOT NULL DEFAULT 0,
  cashier_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id), paid_paise INTEGER, due_paise INTEGER NOT NULL DEFAULT 0,
  balance_after_paise INTEGER, credit_reason TEXT NOT NULL DEFAULT '',
  bill_type TEXT NOT NULL DEFAULT 'counter', tendered_paise INTEGER, change_paise INTEGER,
  taxable_paise INTEGER NOT NULL DEFAULT 0, cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0, igst_paise INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_bills_day ON bills(day);
CREATE TABLE IF NOT EXISTS bill_lines(
  id INTEGER PRIMARY KEY, bill_id INTEGER NOT NULL REFERENCES bills(id), item_id INTEGER REFERENCES items(id),
  item_name TEXT NOT NULL, form TEXT NOT NULL CHECK(form IN ('mix','plain','custom','blend')), coffee_pct INTEGER,
  grams INTEGER NOT NULL, rate_paise INTEGER NOT NULL, amount_paise INTEGER NOT NULL, gst_bp INTEGER,
  coffee_g INTEGER NOT NULL DEFAULT 0, chicory_g INTEGER NOT NULL DEFAULT 0, plain_g INTEGER NOT NULL DEFAULT 0,
  added_by INTEGER REFERENCES users(id), list_rate_paise INTEGER,
  hsn_code TEXT NOT NULL DEFAULT '0901', blend_id INTEGER REFERENCES blends(id),
  blend_recipe_json TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, bill_id INTEGER NOT NULL REFERENCES bills(id),
  method TEXT NOT NULL CHECK(method IN ('CASH','UPI','CARD')), amount_paise INTEGER NOT NULL, reference TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS cancels(id INTEGER PRIMARY KEY, bill_id INTEGER NOT NULL REFERENCES bills(id), reason TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('REQUESTED','APPROVED','REJECTED')), requested_by INTEGER NOT NULL, decided_by INTEGER,
  decision_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, decided_at TEXT);
CREATE TABLE IF NOT EXISTS day_closes(id INTEGER PRIMARY KEY, day TEXT NOT NULL, opening_paise INTEGER NOT NULL,
  cash_sales_paise INTEGER NOT NULL, expected_paise INTEGER NOT NULL, counted_paise INTEGER NOT NULL, difference_paise INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '', state TEXT NOT NULL CHECK(state IN ('BALANCED','DIFFERENCE','REOPENED')),
  closed_by INTEGER NOT NULL, created_at TEXT NOT NULL, seen_by INTEGER, seen_note TEXT NOT NULL DEFAULT '', seen_at TEXT,
  reopened_by INTEGER, reopen_reason TEXT NOT NULL DEFAULT '', reopened_at TEXT);
CREATE TABLE IF NOT EXISTS print_jobs(id INTEGER PRIMARY KEY, bill_id INTEGER NOT NULL REFERENCES bills(id), label TEXT NOT NULL,
  duplicate INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL CHECK(state IN ('QUEUED','PRINTING','DONE')),
  requested_by INTEGER NOT NULL, created_at TEXT NOT NULL, claimed_at TEXT, done_at TEXT, error TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS day_saves(day TEXT PRIMARY KEY, folder TEXT NOT NULL, files TEXT NOT NULL, saved_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS idempotency(key TEXT NOT NULL, user_id INTEGER NOT NULL, bill_id INTEGER NOT NULL, PRIMARY KEY(key, user_id));
CREATE TABLE IF NOT EXISTS clients(id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '', gstin TEXT NOT NULL DEFAULT '', opening_paise INTEGER NOT NULL DEFAULT 0, opening_date TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_by INTEGER, created_at TEXT NOT NULL,
  client_type TEXT NOT NULL DEFAULT 'dealer' CHECK(client_type IN ('dealer','cafe')),
  state_code TEXT NOT NULL DEFAULT '36', credit_limit_paise INTEGER);
CREATE TABLE IF NOT EXISTS collections(id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), day TEXT NOT NULL,
  amount_paise INTEGER NOT NULL, method TEXT NOT NULL CHECK(method IN ('CASH','UPI','BANK','CHEQUE')), reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL, created_at TEXT NOT NULL,
  cancelled_by INTEGER, cancel_reason TEXT NOT NULL DEFAULT '', cancelled_at TEXT);
CREATE INDEX IF NOT EXISTS ix_collections_client ON collections(client_id);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '',
  info TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
"""

# Values the owner/admin set. None = not set yet; the screen says who must set it. Nothing is guessed.
DEFAULTS = {
    "bill_prefix": "CTR",
    "dealer_bill_prefix": "DLR",
    "cafe_bill_prefix": "CAF",
    "chicory_rate_paise": None,
    "ratios": [100, 90, 80, 70],          # coffee % buttons; the owner edits this list
    "discount_cap_pct": None,             # None = no discounts allowed yet
    "opening_cash_paise": None,           # float in the drawer each morning; day close needs it
    "tax_approved": False,                # accountant OK; until then bills say GST details pending
    "save_folder": "",
    "client_bill_prefix": "CL",          # legacy client bill prefix fallback
    "overdue_days": None,                # owner sets: client bills unpaid longer than this show a warning
    "print_method": "auto",              # auto = straight to the printer on the Windows PC, else through the browser
    "printer_name": "",                  # empty = the Windows default printer
    "print_cols": 48,                    # characters per line: 48 for 80 mm (Font A); some printers need 42
    "color_scheme": {
        "raw_beans": "#10b981",
        "roasted_beans": "#78350f",
        "chicory": "#d97706",
        "blend": "#6366f1",
        "tea": "#059669",
        "other": "#64748b"
    },
    "layout": {
        "shop_name": "Vasavi Trading Company", "address": "", "phone": "", "gstin": "",
        "footer": "Thank you! Visit again.", "logo": "", "logo_size": "medium",
        "highlight_customer": True, "show_hsn": True, "show_tax_split": True, "show_tendered": True,
        "show_time": True, "show_cashier": True, "show_customer_name": True, "show_customer_phone": False,
        "show_ratio": True, "show_gst": True, "show_payments": True,
    },
}


def now() -> datetime:
    return datetime.now(timezone.utc)


def stamp(dt: datetime | None = None) -> str:
    return (dt or now()).isoformat(timespec="seconds")


def later(**kw) -> str:
    return stamp(now() + timedelta(**kw))


def today() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d")


def ist_day(ts: str) -> str:
    return datetime.fromisoformat(ts).astimezone(IST).strftime("%Y-%m-%d")


def _connect() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH, timeout=15, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=15000")
    return c


@contextmanager
def tx():
    """A write transaction: everything inside commits together or not at all."""
    c = _connect()
    c.execute("BEGIN IMMEDIATE")
    try:
        yield c
        c.execute("COMMIT")
    except BaseException:
        c.execute("ROLLBACK")
        raise
    finally:
        c.close()


@contextmanager
def read():
    c = _connect()
    try:
        yield c
    finally:
        c.close()


def one(cur) -> dict | None:
    r = cur.fetchone()
    return dict(r) if r else None


def rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]


def get(c, key):
    r = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    if not r:
        return DEFAULTS.get(key)
    v = json.loads(r["value"])
    if key == "layout":   # new layout switches added later keep their defaults
        return {**DEFAULTS["layout"], **v}
    return v


def put(c, key, value, by=None):
    c.execute("INSERT INTO settings(key, value, changed_by, changed_at) VALUES(?,?,?,?) "
              "ON CONFLICT(key) DO UPDATE SET value=excluded.value, changed_by=excluded.changed_by, changed_at=excluded.changed_at",
              (key, json.dumps(value), by, stamp()))


def all_settings(c) -> dict:
    return {k: get(c, k) for k in DEFAULTS}


def audit(c, user_id, action, subject="", info=""):
    c.execute("INSERT INTO audit(user_id, action, subject, info, created_at) VALUES(?,?,?,?,?)", (user_id, action, subject, info, stamp()))


def _migrate_items(c):
    """28 Oct 2026: items became 'one price each' (name on button, name on bill, price, GST, mix-with-chicory tick).
    A coffee that had both a beans and a powder price becomes two items. Past bills keep their names and amounts."""
    if "kind" not in {r[1] for r in c.execute("PRAGMA table_info(items)")}:
        return
    c.execute("PRAGMA foreign_keys=OFF")
    c.execute("BEGIN IMMEDIATE")
    try:
        old = [dict(r) for r in c.execute("SELECT * FROM items ORDER BY id")]
        lines = [dict(r) for r in c.execute("SELECT * FROM bill_lines ORDER BY id")]
        c.execute("ALTER TABLE items RENAME TO items_old")
        c.execute("ALTER TABLE bill_lines RENAME TO bill_lines_old")
        for stmt in SCHEMA.split(";"):
            if "CREATE TABLE IF NOT EXISTS items(" in stmt or "CREATE TABLE IF NOT EXISTS bill_lines(" in stmt:
                c.execute(stmt)
        beans_id = {}
        add = "INSERT INTO items(id, name, bill_name, price_paise, mix_chicory, gst_bp, active, sort, changed_by, changed_at) VALUES(?,?,?,?,?,?,?,?,?,?)"
        base = lambda i: (i["gst_bp"], i["active"], i["sort"], i["changed_by"], i["changed_at"])
        for i in old:   # first keep every old id (past bills point at them)
            if i["kind"] == "tea":
                c.execute(add, (i["id"], i["name"], i["name"], i["tea_rate_paise"], 0, *base(i)))
            elif i["powder_rate_paise"] is not None:
                c.execute(add, (i["id"], f"{i['name']} Powder", f"{i['name']} powder", i["powder_rate_paise"], 1, *base(i)))
            else:
                c.execute(add, (i["id"], f"{i['name']} Beans", f"{i['name']} beans", i["beans_rate_paise"], 0, *base(i)))
        next_id = max([i["id"] for i in old], default=0) + 1
        for i in old:   # then a separate beans item for coffees that had both prices
            if i["kind"] == "coffee" and i["powder_rate_paise"] is not None and i["beans_rate_paise"] is not None:
                c.execute(add, (next_id, f"{i['name']} Beans", f"{i['name']} beans", i["beans_rate_paise"], 0, *base(i)))
                beans_id[i["id"]] = next_id
                next_id += 1
        for l in lines:
            mix = l["form"] == "powder"
            item_id = beans_id.get(l["item_id"], l["item_id"]) if l["form"] == "beans" else l["item_id"]
            c.execute("INSERT INTO bill_lines(id, bill_id, item_id, item_name, form, coffee_pct, grams, rate_paise, amount_paise, gst_bp, coffee_g, chicory_g, plain_g) "
                      "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (l["id"], l["bill_id"], item_id, l["item_name"], "mix" if mix else "plain", l["coffee_pct"] if mix else None, l["grams"], l["rate_paise"],
                       l["amount_paise"], l["gst_bp"], l["coffee_g"] if mix else 0, l["chicory_g"] if mix else 0, 0 if mix else l["grams"]))
        c.execute("DROP TABLE bill_lines_old")
        c.execute("DROP TABLE items_old")
        c.execute("COMMIT")
    except BaseException:
        c.execute("ROLLBACK")
        raise
    finally:
        c.execute("PRAGMA foreign_keys=ON")


def _migrate_lines(c):
    """28 Oct 2026: a bill line can be an item the cashier added at the counter (no item, amount typed, who added it)."""
    sql = (c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='bill_lines'").fetchone() or [""])[0]
    if not sql or "'custom'" in sql:
        return
    c.execute("PRAGMA foreign_keys=OFF")
    c.execute("BEGIN IMMEDIATE")
    try:
        c.execute("ALTER TABLE bill_lines RENAME TO bill_lines_old")
        c.execute(next(x for x in SCHEMA.split(";") if "CREATE TABLE IF NOT EXISTS bill_lines(" in x))
        cols = "id, bill_id, item_id, item_name, form, coffee_pct, grams, rate_paise, amount_paise, gst_bp, coffee_g, chicory_g, plain_g"
        c.execute(f"INSERT INTO bill_lines({cols}) SELECT {cols} FROM bill_lines_old")
        c.execute("DROP TABLE bill_lines_old")
        c.execute("COMMIT")
    except BaseException:
        c.execute("ROLLBACK")
        raise
    finally:
        c.execute("PRAGMA foreign_keys=ON")


# columns added later (28 Oct 2026: clients and dues). Adding is safe on old and new databases.
NEW_COLUMNS = {
    "users": [
        ("can_view_dues", "INTEGER NOT NULL DEFAULT 0"),
        ("can_manage_clients", "INTEGER NOT NULL DEFAULT 0"),
    ],
    "clients": [
        ("client_type", "TEXT NOT NULL DEFAULT 'dealer'"),
        ("state_code", "TEXT NOT NULL DEFAULT '36'"),
        ("credit_limit_paise", "INTEGER"),
    ],
    "items": [
        ("item_group", "TEXT NOT NULL DEFAULT 'other'"),
        ("color_tag", "TEXT NOT NULL DEFAULT '#78350f'"),
        ("hsn_code", "TEXT NOT NULL DEFAULT '0901'"),
    ],
    "bills": [
        ("client_id", "INTEGER REFERENCES clients(id)"),
        ("paid_paise", "INTEGER"),
        ("due_paise", "INTEGER NOT NULL DEFAULT 0"),
        ("balance_after_paise", "INTEGER"),
        ("credit_reason", "TEXT NOT NULL DEFAULT ''"),
        ("bill_type", "TEXT NOT NULL DEFAULT 'counter'"),
        ("tendered_paise", "INTEGER"),
        ("change_paise", "INTEGER"),
        ("taxable_paise", "INTEGER NOT NULL DEFAULT 0"),
        ("cgst_paise", "INTEGER NOT NULL DEFAULT 0"),
        ("sgst_paise", "INTEGER NOT NULL DEFAULT 0"),
        ("igst_paise", "INTEGER NOT NULL DEFAULT 0"),
    ],
    "bill_lines": [
        ("list_rate_paise", "INTEGER"),
        ("hsn_code", "TEXT NOT NULL DEFAULT '0901'"),
        ("blend_id", "INTEGER REFERENCES blends(id)"),
        ("blend_recipe_json", "TEXT NOT NULL DEFAULT ''"),
    ],
}


def _migrate_item_groups_and_blends(c):
    # 1. Classify items by name if group is not set
    for row in c.execute("SELECT id, name, mix_chicory FROM items WHERE item_group='other' OR item_group IS NULL").fetchall():
        nm = row["name"].lower()
        if "raw" in nm or "green" in nm:
            grp, col, hsn = "raw_beans", "#10b981", "0901"
        elif "chicory" in nm:
            grp, col, hsn = "chicory", "#d97706", "2101"
        elif "tea" in nm or "ctc" in nm:
            grp, col, hsn = "tea", "#059669", "0902"
        elif row["mix_chicory"]:
            grp, col, hsn = "blend", "#6366f1", "0901"
        elif "roasted" in nm or "beans" in nm or "powder" in nm:
            grp, col, hsn = "roasted_beans", "#78350f", "0901"
        else:
            grp, col, hsn = "other", "#64748b", "0901"
        c.execute("UPDATE items SET item_group=?, color_tag=?, hsn_code=? WHERE id=?", (grp, col, hsn, row["id"]))

    # 2. Check if blends table is empty and migrate legacy mix_chicory items into blends
    count = c.execute("SELECT COUNT(*) FROM blends").fetchone()[0]
    if count == 0:
        mix_items = c.execute("SELECT * FROM items WHERE mix_chicory=1 AND for_client=0 AND active=1").fetchall()
        for it in mix_items:
            c.execute("INSERT INTO blends(name, bill_name, base_price_paise, is_shared, cafe_id, gst_bp, active, color_tag, created_at) "
                      "VALUES(?,?,?,?,NULL,?,1,'#6366f1',?)",
                      (f"{it['name']} 80/20", f"{it['bill_name']} 80/20", it["price_paise"], 1, it["gst_bp"] or 500, stamp()))


def _add_columns(c):
    for table, cols in NEW_COLUMNS.items():
        have = {r[1] for r in c.execute(f"PRAGMA table_info({table})")}
        for name, kind in cols:
            if name not in have:
                c.execute(f"ALTER TABLE {table} ADD COLUMN {name} {kind}")
    c.execute("UPDATE bills SET paid_paise=total_paise WHERE paid_paise IS NULL AND client_id IS NULL")   # counter bills are paid in full
    # 28 Oct 2026: separate item lists for Sell (counter) and Clients. Existing items are copied into both lists once.
    if "for_client" not in {r[1] for r in c.execute("PRAGMA table_info(items)")}:
        c.execute("ALTER TABLE items ADD COLUMN for_client INTEGER NOT NULL DEFAULT 0")
        c.execute("INSERT INTO items(name, bill_name, price_paise, mix_chicory, gst_bp, active, sort, changed_by, changed_at, for_client) "
                  "SELECT name, bill_name, price_paise, mix_chicory, gst_bp, active, sort, changed_by, changed_at, 1 FROM items")
    _migrate_item_groups_and_blends(c)


def init():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = _connect()
    try:
        _migrate_items(c)
        _migrate_lines(c)
        c.executescript(SCHEMA)
        _add_columns(c)
        cols = {r[1] for r in c.execute("PRAGMA table_info(print_jobs)")}
        if "error" not in cols:   # added for direct printing
            c.execute("ALTER TABLE print_jobs ADD COLUMN error TEXT NOT NULL DEFAULT ''")
    finally:
        c.close()
