"""VTC Counter Sales app (standalone, 28 Oct 2026).

Coffee (beans, or powder with a coffee:chicory ratio) and tea, sold by weight. No stock.
Cashiers sign in with a PIN; owner/admin with a password. Owner/admin set items, prices, ratios,
the discount cap and the bill layout; they approve cancellations and see reports.
"""
import asyncio
import json
import os
import re
from urllib.parse import quote
from pathlib import Path

from fastapi import Depends, FastAPI, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db, dues, escpos, pricing, printer, saves, xlsx
from .security import Fail, check_secret, hash_secret, new_token, token_hash, valid_password, valid_pin

STATIC = db.ROOT / "static"
COOKIE = "vtc_counter"
OWNER_TEMP = "VTC-Owner-Demo26"
METHODS = ("CASH", "UPI", "CARD")
IDLE_HOURS = 12
SAFE = {"GET", "HEAD", "OPTIONS"}

from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(_app):
    startup()
    yield


app = FastAPI(title="VTC Counter", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.middleware("http")
async def guard(request: Request, call_next):
    # Anti-forgery: our own screens send X-VTC on every change; another web page cannot.
    if request.url.path.startswith("/api/") and request.method not in SAFE and request.headers.get("X-VTC") != "1":
        return JSONResponse({"error": "BAD_REQUEST_ORIGIN"}, status_code=403)
    res = await call_next(request)
    res.headers["X-Content-Type-Options"] = "nosniff"
    res.headers["X-Frame-Options"] = "SAMEORIGIN"
    res.headers["Referrer-Policy"] = "same-origin"
    res.headers["Content-Security-Policy"] = ("default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                                              "script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'self'")
    if request.url.path.startswith("/api/"):
        res.headers["Cache-Control"] = "no-store"
    return res


@app.exception_handler(StarletteHTTPException)
async def on_error(_req, ex):
    return JSONResponse({"error": ex.detail if isinstance(ex.detail, str) else "ERROR"}, status_code=ex.status_code)


# ------------------------------------------------------------------ helpers

def body_text(d: dict, key: str, lo: int, hi: int, code: str) -> str:
    v = str(d.get(key) or "").strip()
    if not lo <= len(v) <= hi:
        raise Fail(code)
    return v


def money(v, code="INVALID_AMOUNT", allow_zero=False, allow_none=False):
    if v in (None, "") and allow_none:
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise Fail(code)
    if n < 0 or (n == 0 and not allow_zero) or n > 10_000_000_00:
        raise Fail(code)
    return n


def norm_phone(v) -> str:
    d = re.sub(r"\D", "", str(v or ""))
    if len(d) == 12 and d.startswith("91"):
        d = d[2:]
    return d if 10 <= len(d) <= 13 else ""


def mask(p: str) -> str:
    return ("•" * (len(p) - 4) + p[-4:]) if len(p) > 4 else ""


def is_boss(u) -> bool:
    return u["role"] in ("owner", "admin")


def can_view_dues(u) -> bool:
    return is_boss(u) or bool(u.get("can_view_dues"))


def can_manage_clients(u) -> bool:
    return is_boss(u) or bool(u.get("can_manage_clients"))


def current(request: Request) -> dict:
    tok = request.cookies.get(COOKIE)
    if not tok:
        raise Fail("LOGIN_REQUIRED", 401)
    with db.tx() as c:
        u = db.one(c.execute("SELECT s.last_seen, u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?", (token_hash(tok),)))
        if not u or not u["active"] or u["last_seen"] < db.later(hours=-IDLE_HOURS):
            c.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(tok),))
            raise Fail("LOGIN_REQUIRED", 401)
        c.execute("UPDATE sessions SET last_seen=? WHERE token_hash=?", (db.stamp(), token_hash(tok)))
    u["session"] = token_hash(tok)
    allowed = ("/api/me", "/api/me/secret", "/api/logout")
    if u["must_change"] and request.url.path not in allowed:
        raise Fail("CHANGE_SECRET_FIRST", 403)
    return u


def boss(u: dict = Depends(current)) -> dict:
    if not is_boss(u):
        raise Fail("OWNER_OR_ADMIN_ONLY", 403)
    return u


def dues_viewer(u: dict = Depends(current)) -> dict:
    if not can_view_dues(u):
        raise Fail("OWNER_OR_ADMIN_ONLY", 403)
    return u


def client_manager(u: dict = Depends(current)) -> dict:
    if not can_manage_clients(u):
        raise Fail("OWNER_OR_ADMIN_ONLY", 403)
    return u


def public_user(u: dict) -> dict:
    return {k: u[k] for k in ("id", "username", "full_name", "role", "login", "must_change", "can_view_dues", "can_manage_clients") if k in u}


# ------------------------------------------------------------------ start-up

def startup():
    db.init()
    with db.tx() as c:
        if not c.execute("SELECT 1 FROM users").fetchone():
            c.execute("INSERT INTO users(username, full_name, role, login, secret_hash, must_change, created_at) VALUES('owner','Owner','owner','password',?,1,?)",
                      (hash_secret(OWNER_TEMP), db.stamp()))
        if not db.get(c, "save_folder") and os.environ.get("VTC_SAVE_DIR"):
            db.put(c, "save_folder", os.environ["VTC_SAVE_DIR"])   # chosen in the folder picker at first start
    saves.catch_up()


# ------------------------------------------------------------------ sign-in

def _start_session(c, response: Response, user_id: int):
    token, th = new_token()
    c.execute("INSERT INTO sessions(token_hash, user_id, created_at, last_seen) VALUES(?,?,?,?)", (th, user_id, db.stamp(), db.stamp()))
    c.execute("UPDATE users SET failed=0, locked_until=NULL WHERE id=?", (user_id,))
    response.set_cookie(COOKIE, token, httponly=True, samesite="strict", max_age=IDLE_HOURS * 3600)


def _check(c, row, secret: str):
    if not row or not row["active"]:
        raise Fail("INVALID_CREDENTIALS", 401)
    if row["locked_until"] and row["locked_until"] > db.stamp():
        raise Fail("ACCOUNT_LOCKED_TRY_LATER", 423)
    if not check_secret(secret, row["secret_hash"]):
        n = row["failed"] + 1
        c.execute("UPDATE users SET failed=?, locked_until=? WHERE id=?", (0 if n >= 5 else n, db.later(minutes=10) if n >= 5 else None, row["id"]))
        db.audit(c, row["id"], "SIGN_IN_FAILED", f"user:{row['id']}", f"attempt {n}")
        return False
    return True


@app.get("/api/login/people")
def pin_people():
    with db.read() as c:
        return db.rows(c.execute("SELECT id, full_name FROM users WHERE login='pin' AND active=1 ORDER BY full_name"))


@app.post("/api/login")
async def login(req: Request, response: Response):
    d = await req.json()
    with db.tx() as c:
        row = db.one(c.execute("SELECT * FROM users WHERE username=? AND login='password'", (str(d.get("username", "")).strip().lower(),)))
        ok = _check(c, row, str(d.get("password", "")))
        if ok:
            _start_session(c, response, row["id"])
            db.audit(c, row["id"], "SIGNED_IN", f"user:{row['id']}")
    if not ok:
        raise Fail("INVALID_CREDENTIALS", 401)
    return {"ok": True}


@app.post("/api/login/pin")
async def login_pin(req: Request, response: Response):
    d = await req.json()
    with db.tx() as c:
        row = db.one(c.execute("SELECT * FROM users WHERE id=? AND login='pin'", (int(d.get("user_id") or 0),)))
        ok = _check(c, row, str(d.get("pin", "")))
        if ok:
            _start_session(c, response, row["id"])
            db.audit(c, row["id"], "SIGNED_IN", f"user:{row['id']}")
    if not ok:
        raise Fail("WRONG_PIN", 401)
    return {"ok": True}


@app.post("/api/logout")
def logout(response: Response, u: dict = Depends(current)):
    with db.tx() as c:
        c.execute("DELETE FROM sessions WHERE token_hash=?", (u["session"],))
    response.delete_cookie(COOKIE)
    return {"ok": True}


@app.get("/api/me")
def me(u: dict = Depends(current)):
    return {"user": public_user(u)}


@app.post("/api/me/check")
async def check_me(req: Request, u: dict = Depends(current)):
    """Confirms it is really this person before they add an item at the counter (the bill sends it again to be sure)."""
    d = await req.json()
    with db.read() as c:
        row = c.execute("SELECT secret_hash FROM users WHERE id=?", (u["id"],)).fetchone()
    if not check_secret(str(d.get("secret") or ""), row["secret_hash"]):
        raise Fail("CONFIRM_WITH_YOUR_PIN")
    return {"ok": True, "name": u["full_name"]}


@app.post("/api/me/secret")
async def change_secret(req: Request, u: dict = Depends(current)):
    d = await req.json()
    new = str(d.get("new", ""))
    (valid_pin if u["login"] == "pin" else valid_password)(new)
    with db.tx() as c:
        row = db.one(c.execute("SELECT secret_hash FROM users WHERE id=?", (u["id"],)))
        if not check_secret(str(d.get("current", "")), row["secret_hash"]):
            raise Fail("CURRENT_SECRET_WRONG")
        if check_secret(new, row["secret_hash"]):
            raise Fail("CHOOSE_A_NEW_SECRET")
        c.execute("UPDATE users SET secret_hash=?, must_change=0 WHERE id=?", (hash_secret(new), u["id"]))
        c.execute("DELETE FROM sessions WHERE user_id=? AND token_hash!=?", (u["id"], u["session"]))
        db.audit(c, u["id"], "SECRET_CHANGED", f"user:{u['id']}")
    return {"ok": True}


# ------------------------------------------------------------------ counter set-up (read by everyone signed in)

@app.get("/api/counter")
def counter(u: dict = Depends(current)):
    with db.read() as c:
        st = db.all_settings(c)
        items = db.rows(c.execute("SELECT * FROM items WHERE active=1 ORDER BY sort, name"))
        blends = db.rows(c.execute("SELECT * FROM blends WHERE active=1 ORDER BY name"))
        for b in blends:
            b["components"] = db.rows(c.execute(
                "SELECT bc.*, i.name item_name, i.item_group, i.color_tag FROM blend_components bc "
                "JOIN items i ON i.id=bc.item_id WHERE bc.blend_id=?", (b["id"],)))
        closed = _closed(c, db.today())
    return {"items": items, "blends": blends, "ratios": st["ratios"], "chicory_rate_paise": st["chicory_rate_paise"], "discount_cap_pct": st["discount_cap_pct"],
            "tax_approved": st["tax_approved"], "layout": st["layout"], "bill_prefix": st["bill_prefix"],
            "dealer_bill_prefix": st.get("dealer_bill_prefix") or "DLR", "cafe_bill_prefix": st.get("cafe_bill_prefix") or "CAF",
            "color_scheme": st.get("color_scheme") or db.DEFAULTS["color_scheme"], "day": db.today(),
            "day_closed": closed, "is_boss": is_boss(u), "can_view_dues": can_view_dues(u), "can_manage_clients": can_manage_clients(u),
            "save_folder_set": bool(st["save_folder"]), "print_method": print_method(st),
            "overdue_days": st["overdue_days"], "client_bill_prefix": st["client_bill_prefix"]}


# ------------------------------------------------------------------ items, blends, prices (owner/admin)

def _item_fields(d: dict) -> dict:
    """An item: name on Sell button, name on bill, price/kg, GST, mix-chicory, category group, color, HSN."""
    out = {
        "name": body_text(d, "name", 2, 40, "NAME_2_TO_40_LETTERS"),
        "bill_name": body_text(d, "bill_name", 2, 60, "BILL_NAME_2_TO_60_LETTERS"),
        "price_paise": money(d.get("price_paise")),
        "mix_chicory": int(bool(d.get("mix_chicory"))),
        "item_group": str(d.get("item_group") or "other").strip()[:30],
        "color_tag": str(d.get("color_tag") or "#78350f").strip()[:20],
        "hsn_code": str(d.get("hsn_code") or "0901").strip()[:10],
    }
    gst = d.get("gst_bp")
    out["gst_bp"] = None if gst in (None, "") else int(gst)
    if out["gst_bp"] is not None and not 0 <= out["gst_bp"] <= 2800:
        raise Fail("INVALID_GST_RATE")
    return out


@app.get("/api/setup")
def setup(u: dict = Depends(boss)):
    with db.read() as c:
        items = db.rows(c.execute("SELECT * FROM items ORDER BY active DESC, sort, name"))
        blends = db.rows(c.execute("SELECT * FROM blends ORDER BY active DESC, name"))
        for b in blends:
            b["components"] = db.rows(c.execute(
                "SELECT bc.*, i.name item_name, i.item_group, i.color_tag FROM blend_components bc "
                "JOIN items i ON i.id=bc.item_id WHERE bc.blend_id=?", (b["id"],)))
        return {"items": items, "blends": blends, "settings": db.all_settings(c),
                "people": db.rows(c.execute("SELECT id, username, full_name, role, login, active, must_change, created_at, can_view_dues, can_manage_clients FROM users ORDER BY role, full_name")),
                "me": public_user(u)}


@app.post("/api/items")
async def add_item(req: Request, u: dict = Depends(boss)):
    d = await req.json()
    f = _item_fields(d)
    with db.tx() as c:
        side = int(bool(d.get("for_client")))   # 0 = Sell list, 1 = Clients list; fixed once added
        c.execute("INSERT INTO items(name, bill_name, price_paise, mix_chicory, gst_bp, changed_by, changed_at, for_client, item_group, color_tag, hsn_code) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                  (f["name"], f["bill_name"], f["price_paise"], f["mix_chicory"], f["gst_bp"], u["id"], db.stamp(), side, f["item_group"], f["color_tag"], f["hsn_code"]))
        iid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        db.audit(c, u["id"], "ITEM_ADDED", f"item:{iid}", ("Clients list: " if side else "Sell list: ") + _price_text(f))
    return {"id": iid}


def _price_text(f: dict) -> str:
    gst = "GST not set" if f["gst_bp"] is None else f"GST {f['gst_bp'] / 100:g}%"
    return f"{f['name']} / bill: {f['bill_name']}: ₹{f['price_paise'] / 100:.2f}/kg, {gst}{', mixes with chicory' if f['mix_chicory'] else ''}"


@app.put("/api/items/{iid}")
async def edit_item(iid: int, req: Request, u: dict = Depends(boss)):
    d = await req.json()
    with db.tx() as c:
        old = db.one(c.execute("SELECT * FROM items WHERE id=?", (iid,)))
        if not old:
            raise Fail("NOT_FOUND", 404)
        if set(d) == {"active"}:
            c.execute("UPDATE items SET active=?, changed_by=?, changed_at=? WHERE id=?", (int(bool(d["active"])), u["id"], db.stamp(), iid))
            db.audit(c, u["id"], "ITEM_SHOWN" if d["active"] else "ITEM_HIDDEN", f"item:{iid}", old["name"])
            return {"ok": True}
        f = _item_fields({**old, **d})
        c.execute("UPDATE items SET name=?, bill_name=?, price_paise=?, mix_chicory=?, gst_bp=?, changed_by=?, changed_at=?, item_group=?, color_tag=?, hsn_code=? WHERE id=?",
                  (f["name"], f["bill_name"], f["price_paise"], f["mix_chicory"], f["gst_bp"], u["id"], db.stamp(), f["item_group"], f["color_tag"], f["hsn_code"], iid))
        db.audit(c, u["id"], "PRICE_CHANGED", f"item:{iid}", f"was {_price_text(old)} · now {_price_text(f)}")
    return {"ok": True}


# ------------------------------------------------------------------ blends API

@app.get("/api/blends")
def list_blends(req: Request, u: dict = Depends(current)):
    cafe_id = int(req.query_params.get("cafe_id") or 0)
    with db.read() as c:
        sql = "SELECT * FROM blends WHERE active=1 AND (is_shared=1"
        args = []
        if cafe_id:
            sql += " OR cafe_id=?"
            args.append(cafe_id)
        sql += ") ORDER BY name"
        blends = db.rows(c.execute(sql, args))
        for b in blends:
            b["components"] = db.rows(c.execute(
                "SELECT bc.*, i.name item_name, i.item_group, i.color_tag FROM blend_components bc "
                "JOIN items i ON i.id=bc.item_id WHERE bc.blend_id=?", (b["id"],)))
            if cafe_id:
                cp = c.execute("SELECT rate_paise FROM client_prices WHERE client_id=? AND blend_id=?", (cafe_id, b["id"])).fetchone()
                if cp:
                    b["client_rate_paise"] = cp[0]
        return blends


@app.post("/api/blends")
async def add_blend(req: Request, u: dict = Depends(boss)):
    d = await req.json()
    name = body_text(d, "name", 2, 40, "NAME_2_TO_40_LETTERS")
    bill_name = body_text(d, "bill_name", 2, 60, "BILL_NAME_2_TO_60_LETTERS")
    price = money(d.get("base_price_paise"))
    is_shared = 1 if d.get("is_shared") or not d.get("cafe_id") else 0
    cafe_id = int(d.get("cafe_id") or 0) or None
    color = str(d.get("color_tag") or "#6366f1").strip()[:20]
    gst = d.get("gst_bp", 500)
    comps = d.get("components") or []
    if not isinstance(comps, list) or not comps:
        raise Fail("BLEND_NEEDS_COMPONENTS")
    tot_pct = sum(int(c.get("ratio_pct") or 0) for c in comps)
    if tot_pct != 100:
        raise Fail("RATIO_MUST_SUM_TO_100")
        
    with db.tx() as c:
        c.execute("INSERT INTO blends(name, bill_name, base_price_paise, is_shared, cafe_id, gst_bp, active, color_tag, created_at) "
                  "VALUES(?,?,?,?,?,?,1,?,?)", (name, bill_name, price, is_shared, cafe_id, int(gst), color, db.stamp()))
        bid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        for cp in comps:
            c.execute("INSERT INTO blend_components(blend_id, item_id, ratio_pct) VALUES(?,?,?)",
                      (bid, int(cp["item_id"]), int(cp["ratio_pct"])))
        db.audit(c, u["id"], "BLEND_ADDED", f"blend:{bid}", f"{name} ({price / 100:.2f}/kg)")
    return {"id": bid}


@app.put("/api/blends/{bid}")
async def edit_blend(bid: int, req: Request, u: dict = Depends(boss)):
    d = await req.json()
    with db.tx() as c:
        old = db.one(c.execute("SELECT * FROM blends WHERE id=?", (bid,)))
        if not old:
            raise Fail("NOT_FOUND", 404)
        if set(d) == {"active"}:
            c.execute("UPDATE blends SET active=? WHERE id=?", (int(bool(d["active"])), bid))
            return {"ok": True}
        name = body_text(d, "name", 2, 40, "NAME_2_TO_40_LETTERS")
        bill_name = body_text(d, "bill_name", 2, 60, "BILL_NAME_2_TO_60_LETTERS")
        price = money(d.get("base_price_paise"))
        color = str(d.get("color_tag") or old.get("color_tag") or "#6366f1").strip()[:20]
        c.execute("UPDATE blends SET name=?, bill_name=?, base_price_paise=?, color_tag=? WHERE id=?",
                  (name, bill_name, price, color, bid))
        if "components" in d and isinstance(d["components"], list):
            comps = d["components"]
            if sum(int(x.get("ratio_pct") or 0) for x in comps) != 100:
                raise Fail("RATIO_MUST_SUM_TO_100")
            c.execute("DELETE FROM blend_components WHERE blend_id=?", (bid,))
            for cp in comps:
                c.execute("INSERT INTO blend_components(blend_id, item_id, ratio_pct) VALUES(?,?,?)",
                          (bid, int(cp["item_id"]), int(cp["ratio_pct"])))
        db.audit(c, u["id"], "BLEND_EDITED", f"blend:{bid}", name)
    return {"ok": True}


@app.put("/api/settings")
async def put_settings(req: Request, u: dict = Depends(boss)):
    d = await req.json()
    clean = {}
    for k, v in d.items():
        if k == "chicory_rate_paise":
            clean[k] = money(v, allow_none=True)
        elif k == "opening_cash_paise":
            clean[k] = money(v, allow_zero=True, allow_none=True)
        elif k == "discount_cap_pct":
            if v in (None, ""):
                clean[k] = None
            else:
                try:
                    n = float(v)
                except (TypeError, ValueError):
                    raise Fail("INVALID_DISCOUNT_CAP")
                if not 0 <= n <= 50:
                    raise Fail("INVALID_DISCOUNT_CAP")
                clean[k] = n
        elif k == "ratios":
            try:
                r = sorted({int(x) for x in v}, reverse=True)
            except (TypeError, ValueError):
                raise Fail("INVALID_RATIO")
            if not r or len(r) > 12 or any(not 1 <= x <= 100 for x in r):
                raise Fail("INVALID_RATIO")
            clean[k] = r
        elif k == "bill_prefix":
            clean[k] = body_text(d, k, 1, 8, "INVALID_BILL_PREFIX").upper()
            if not re.fullmatch(r"[A-Z0-9]+", clean[k]):
                raise Fail("INVALID_BILL_PREFIX")
        elif k == "tax_approved":
            clean[k] = bool(v)
        elif k == "save_folder":
            clean[k] = str(v or "").strip()[:260]
        elif k == "overdue_days":
            if v in (None, ""):
                clean[k] = None
            else:
                clean[k] = int(v)
                if not 1 <= clean[k] <= 365:
                    raise Fail("INVALID_OVERDUE_DAYS")
        elif k == "client_bill_prefix":
            clean[k] = body_text(d, k, 1, 8, "INVALID_BILL_PREFIX").upper()
            if not re.fullmatch(r"[A-Z0-9]+", clean[k]):
                raise Fail("INVALID_BILL_PREFIX")
        elif k in ("dealer_bill_prefix", "cafe_bill_prefix"):
            clean[k] = body_text(d, k, 1, 8, "INVALID_BILL_PREFIX").upper()
            if not re.fullmatch(r"[A-Z0-9]+", clean[k]):
                raise Fail("INVALID_BILL_PREFIX")
        elif k == "color_scheme":
            if not isinstance(v, dict):
                raise Fail("INVALID_COLOR_SCHEME")
            clean[k] = v
        elif k == "print_method":
            if v not in ("auto", "direct", "browser"):
                raise Fail("INVALID_PRINT_METHOD")
            clean[k] = v
        elif k == "printer_name":
            clean[k] = str(v or "").strip()[:120]
        elif k == "print_cols":
            if int(v) not in (32, 42, 48):
                raise Fail("INVALID_PRINT_COLS")
            clean[k] = int(v)
        else:
            raise Fail("UNKNOWN_SETTING")
    with db.tx() as c:
        prefixes = [
            clean.get("bill_prefix", db.get(c, "bill_prefix")),
            clean.get("client_bill_prefix", db.get(c, "client_bill_prefix")),
            clean.get("dealer_bill_prefix", db.get(c, "dealer_bill_prefix") or "DLR"),
            clean.get("cafe_bill_prefix", db.get(c, "cafe_bill_prefix") or "CAF")
        ]
        if len(set(prefixes)) != len(prefixes):
            raise Fail("BILL_PREFIXES_MUST_ALL_DIFFER")
        for k, v in clean.items():
            old = db.get(c, k)
            db.put(c, k, v, u["id"])
            db.audit(c, u["id"], "SETTING_CHANGED", k, f"{old} → {v}")
    return {"ok": True}


LAYOUT_TEXT = {"shop_name": 60, "address": 160, "phone": 40, "gstin": 20, "footer": 120}
LAYOUT_SWITCHES = ("show_time", "show_cashier", "show_customer_name", "show_customer_phone", "show_ratio", "show_gst", "show_payments",
                   "highlight_customer", "show_hsn", "show_tax_split")


@app.put("/api/layout")
async def put_layout(req: Request, u: dict = Depends(boss)):
    d = await req.json()
    with db.tx() as c:
        lay = db.get(c, "layout")
        for k, n in LAYOUT_TEXT.items():
            if k in d:
                lay[k] = str(d[k] or "").strip()[:n]
        for k in LAYOUT_SWITCHES:
            if k in d:
                lay[k] = bool(d[k])
        if "logo_size" in d and d["logo_size"] in ("small", "medium", "large"):
            lay["logo_size"] = d["logo_size"]
        if "logo" in d:
            logo = str(d["logo"] or "")
            if logo and (not re.fullmatch(r"data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+", logo) or len(logo) > 300_000):
                raise Fail("LOGO_MUST_BE_PNG_OR_JPG_UNDER_200KB")
            lay["logo"] = logo
        if not lay["shop_name"]:
            raise Fail("SHOP_NAME_REQUIRED")
        db.put(c, "layout", lay, u["id"])
        db.audit(c, u["id"], "BILL_LAYOUT_CHANGED", "layout", ", ".join(sorted(d)))
    return {"ok": True}


# ------------------------------------------------------------------ people (owner/admin)

@app.post("/api/people")
async def add_person(req: Request, u: dict = Depends(boss)):
    d = await req.json()
    role = d.get("role")
    if role not in ("cashier", "admin"):
        raise Fail("INVALID_ROLE")
    if role == "admin" and u["role"] != "owner":
        raise Fail("ONLY_OWNER_ADDS_ADMINS", 403)
    name = body_text(d, "full_name", 2, 40, "NAME_2_TO_40_LETTERS")
    can_view_dues = int(bool(d.get("can_view_dues", 1 if role == "admin" else 0)))
    can_manage_clients = int(bool(d.get("can_manage_clients", 1 if role == "admin" else 0)))
    with db.tx() as c:
        if role == "cashier":
            pin = str(d.get("pin", ""))
            valid_pin(pin)
            c.execute("INSERT INTO users(full_name, role, login, secret_hash, must_change, created_at, can_view_dues, can_manage_clients) VALUES(?,?,?,?,0,?,?,?)",
                      (name, "cashier", "pin", hash_secret(pin), db.stamp(), can_view_dues, can_manage_clients))
        else:
            username = body_text(d, "username", 3, 24, "USERNAME_3_TO_24").lower()
            if not re.fullmatch(r"[a-z0-9._-]+", username):
                raise Fail("USERNAME_3_TO_24")
            if c.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
                raise Fail("USERNAME_TAKEN")
            pw = str(d.get("password", ""))
            valid_password(pw)
            c.execute("INSERT INTO users(username, full_name, role, login, secret_hash, must_change, created_at, can_view_dues, can_manage_clients) VALUES(?,?,?,?,?,1,?,?,?)",
                      (username, name, "admin", "password", hash_secret(pw), db.stamp(), can_view_dues, can_manage_clients))
        pid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        db.audit(c, u["id"], "PERSON_ADDED", f"user:{pid}", f"{name} ({role})")
    return {"id": pid}


@app.put("/api/people/{pid}")
async def edit_person(pid: int, req: Request, u: dict = Depends(boss)):
    d = await req.json()
    with db.tx() as c:
        p = db.one(c.execute("SELECT * FROM users WHERE id=?", (pid,)))
        if not p:
            raise Fail("NOT_FOUND", 404)
        if p["role"] == "owner" and u["role"] != "owner":
            raise Fail("ONLY_THE_OWNER_CHANGES_THE_OWNER", 403)
        if p["role"] == "admin" and u["role"] != "owner" and p["id"] != u["id"]:
            raise Fail("ONLY_OWNER_CHANGES_ADMINS", 403)
        if "active" in d:
            if p["role"] == "owner" or p["id"] == u["id"]:
                raise Fail("CANNOT_SWITCH_OFF_THIS_ACCOUNT")
            c.execute("UPDATE users SET active=? WHERE id=?", (int(bool(d["active"])), pid))
            if not d["active"]:
                c.execute("DELETE FROM sessions WHERE user_id=?", (pid,))
            db.audit(c, u["id"], "PERSON_ON" if d["active"] else "PERSON_OFF", f"user:{pid}", p["full_name"])
        if "can_view_dues" in d and u["role"] == "owner":
            c.execute("UPDATE users SET can_view_dues=? WHERE id=?", (int(bool(d["can_view_dues"])), pid))
        if "can_manage_clients" in d and u["role"] == "owner":
            c.execute("UPDATE users SET can_manage_clients=? WHERE id=?", (int(bool(d["can_manage_clients"])), pid))
        if "full_name" in d:
            c.execute("UPDATE users SET full_name=? WHERE id=?", (body_text(d, "full_name", 2, 40, "NAME_2_TO_40_LETTERS"), pid))
        if "new_secret" in d:
            new = str(d["new_secret"])
            (valid_pin if p["login"] == "pin" else valid_password)(new)
            c.execute("UPDATE users SET secret_hash=?, failed=0, locked_until=NULL, must_change=? WHERE id=?",
                      (hash_secret(new), int(p["login"] == "password" and p["id"] != u["id"]), pid))
            c.execute("DELETE FROM sessions WHERE user_id=?", (pid,))
            db.audit(c, u["id"], "SECRET_RESET", f"user:{pid}", p["full_name"])
    return {"ok": True}


@app.get("/api/audit")
def audit_log(req: Request, u: dict = Depends(boss)):
    q = f"%{req.query_params.get('q', '')}%"
    with db.read() as c:
        return db.rows(c.execute("SELECT a.*, u.full_name who FROM audit a LEFT JOIN users u ON u.id=a.user_id "
                                 "WHERE a.action LIKE ? OR a.info LIKE ? OR a.subject LIKE ? ORDER BY a.id DESC LIMIT 300", (q, q, q)))


# ------------------------------------------------------------------ customers

@app.get("/api/customers/lookup")
def lookup(req: Request, u: dict = Depends(current)):
    p = norm_phone(req.query_params.get("phone"))
    if not p:
        return {"found": False}
    with db.read() as c:
        cu = db.one(c.execute("SELECT * FROM customers WHERE phone=?", (p,)))
        if not cu:
            return {"found": False, "phone_masked": mask(p)}
        last = db.one(c.execute("SELECT id, bill_no, created_at, total_paise FROM bills WHERE customer_id=? AND status!='CANCELLED' ORDER BY id DESC LIMIT 1", (cu["id"],)))
        if last:
            last["lines"] = db.rows(c.execute("SELECT item_id, item_name, form, coffee_pct, grams FROM bill_lines WHERE bill_id=?", (last["id"],)))
    return {"found": True, "name": cu["name"], "visits": cu["visits"], "phone_masked": mask(p), "last": last}


@app.get("/api/customers")
def customers(u: dict = Depends(boss)):
    with db.tx() as c:
        db.audit(c, u["id"], "CUSTOMER_LIST_VIEWED")
        return db.rows(c.execute("SELECT * FROM customers ORDER BY last_seen DESC LIMIT 2000"))


# ------------------------------------------------------------------ bills

def _closed(c, day: str):
    return db.one(c.execute("SELECT * FROM day_closes WHERE day=? AND state!='REOPENED' ORDER BY id DESC LIMIT 1", (day,)))


def _next_bill_no(c, prefix: str) -> str:
    from datetime import datetime
    stem = f"{prefix}-{datetime.now(db.IST).strftime('%y%m')}-"
    last = c.execute("SELECT bill_no FROM bills WHERE bill_no LIKE ? ORDER BY id DESC LIMIT 1", (stem + "%",)).fetchone()
    n = int(last[0].rsplit("-", 1)[1]) + 1 if last else 1
    return f"{stem}{n:04d}"


def bill(c, bid: int, full_phone=False) -> dict:
    b = db.one(c.execute("SELECT b.*, u.full_name cashier FROM bills b JOIN users u ON u.id=b.cashier_id WHERE b.id=?", (bid,)))
    if not b:
        raise Fail("NOT_FOUND", 404)
    if not full_phone:
        b["customer_phone"] = mask(b["customer_phone"])
    b["lines"] = db.rows(c.execute("SELECT l.*, u.full_name added_by_name FROM bill_lines l LEFT JOIN users u ON u.id=l.added_by WHERE bill_id=? ORDER BY l.id", (bid,)))
    b["payments"] = db.rows(c.execute("SELECT method, amount_paise, reference FROM payments WHERE bill_id=? ORDER BY id", (bid,)))
    b["client"] = db.one(c.execute("SELECT id, name, contact, phone, address, gstin, client_type, state_code, credit_limit_paise FROM clients WHERE id=?", (b["client_id"],))) if b.get("client_id") else None
    b["cancel"] = db.one(c.execute("SELECT x.*, a.full_name requested_by_name, d.full_name decided_by_name FROM cancels x JOIN users a ON a.id=x.requested_by "
                                   "LEFT JOIN users d ON d.id=x.decided_by WHERE bill_id=? ORDER BY x.id DESC LIMIT 1", (bid,)))
    return b


@app.post("/api/bills")
async def create_bill(req: Request, u: dict = Depends(current)):
    d = await req.json()
    lines_in, pays_in = d.get("lines") or [], d.get("payments") or []
    if not isinstance(lines_in, list) or not 1 <= len(lines_in) <= 30:
        raise Fail("BILL_NEEDS_ITEMS")
    client_id = int(d.get("client_id") or 0) or None
    # a client may take goods on credit (no payment now); a counter customer always pays in full
    if not isinstance(pays_in, list) or not (0 if client_id else 1) <= len(pays_in) <= 4:
        raise Fail("PAYMENT_REQUIRED")
    key = req.headers.get("X-Idempotency-Key", "")[:80]
    with db.tx() as c:
        if key:
            prev = c.execute("SELECT bill_id FROM idempotency WHERE key=? AND user_id=?", (key, u["id"])).fetchone()
            if prev:
                return bill(c, prev[0])   # a retried press returns the same bill, never a second sale
        day = db.today()
        if _closed(c, day):
            raise Fail("DAY_CLOSED")
        st = db.all_settings(c)
        client = None
        if client_id:
            client = db.one(c.execute("SELECT * FROM clients WHERE id=? AND active=1", (client_id,)))
            if not client:
                raise Fail("CLIENT_NOT_FOUND")
        lines = []
        if any(isinstance(x, dict) and x.get("custom") for x in lines_in):
            # an item typed at the counter: the person billing confirms with their own PIN/password, so we know who added it
            row = c.execute("SELECT secret_hash FROM users WHERE id=?", (u["id"],)).fetchone()
            if not check_secret(str(d.get("confirm_secret") or ""), row["secret_hash"]):
                raise Fail("CONFIRM_WITH_YOUR_PIN")
        for x in lines_in:
            if x.get("custom"):
                cu = x["custom"]
                name = body_text(cu, "name", 2, 60, "BILL_NAME_2_TO_60_LETTERS")
                amount = money(cu.get("amount_paise"))
                try:
                    g = int(cu.get("grams") or 0)
                except (TypeError, ValueError):
                    raise Fail("INVALID_WEIGHT")
                if not 0 <= g <= 100_000:
                    raise Fail("INVALID_WEIGHT")
                gst = cu.get("gst_bp")
                gst = None if gst in (None, "") else int(gst)
                if gst is not None and not 0 <= gst <= 2800:
                    raise Fail("INVALID_GST_RATE")
                lines.append({"item": {"id": None, "gst_bp": gst}, "blend_id": None, "blend_recipe_json": "", "hsn_code": "0901",
                              "form": "custom", "pct": None, "grams": g, "rate": 0, "amount": amount, "name": name})
                continue
            if x.get("blend_id"):
                blend = db.one(c.execute("SELECT * FROM blends WHERE id=? AND active=1", (int(x["blend_id"]),)))
                if not blend:
                    raise Fail("BLEND_NOT_FOUND")
                try:
                    grams = int(x.get("grams"))
                except (TypeError, ValueError):
                    raise Fail("INVALID_WEIGHT")
                if not 1 <= grams <= 100_000:
                    raise Fail("INVALID_WEIGHT")
                rate = blend["base_price_paise"]
                if client:
                    cp = c.execute("SELECT rate_paise FROM client_prices WHERE client_id=? AND blend_id=?", (client["id"], blend["id"])).fetchone()
                    if cp:
                        rate = cp[0]
                list_rate = None
                if client and x.get("rate_paise") not in (None, "") and int(x["rate_paise"]) != rate:
                    list_rate, rate = rate, money(x.get("rate_paise"))
                comps = db.rows(c.execute("SELECT bc.ratio_pct, i.id item_id, i.name item_name, i.item_group FROM blend_components bc JOIN items i ON i.id=bc.item_id WHERE bc.blend_id=?", (blend["id"],)))
                recipe_json = json.dumps([{"item_id": cp["item_id"], "name": cp["item_name"], "ratio_pct": cp["ratio_pct"], "grams": round(grams * cp["ratio_pct"] / 100), "item_group": cp["item_group"]} for cp in comps])
                lines.append({"item": {"id": None, "gst_bp": blend["gst_bp"]}, "blend_id": blend["id"], "blend_recipe_json": recipe_json,
                              "blend_components": comps, "hsn_code": "0901", "form": "blend", "pct": None, "grams": grams, "rate": rate,
                              "amount": pricing.line_amount(grams, rate), "name": blend["bill_name"], "list_rate": list_rate})
                continue
            item = db.one(c.execute("SELECT * FROM items WHERE id=? AND active=1 AND for_client=?", (int(x.get("item_id") or 0), int(bool(client_id)))))
            if not item:
                raise Fail("ITEM_NOT_ON_SALE")
            try:
                grams = int(x.get("grams"))
            except (TypeError, ValueError):
                raise Fail("INVALID_WEIGHT")
            if not 1 <= grams <= 100_000:
                raise Fail("INVALID_WEIGHT")
            rate = item["price_paise"]
            if client:
                cp = c.execute("SELECT rate_paise FROM client_prices WHERE client_id=? AND item_id=?", (client["id"], item["id"])).fetchone()
                if cp:
                    rate = cp[0]
            pct = None
            if item["mix_chicory"]:
                form = "mix"
                try:
                    pct = 100 if x.get("coffee_pct") is None else int(x.get("coffee_pct"))
                except (TypeError, ValueError):
                    raise Fail("INVALID_RATIO")
                if not 1 <= pct <= 100:
                    raise Fail("INVALID_RATIO")
                if pct < 100 and st["chicory_rate_paise"] is None:
                    raise Fail("CHICORY_RATE_NOT_SET")
                rate = pricing.powder_rate(pct, item["price_paise"], st["chicory_rate_paise"] or 0)
            else:
                form = "plain"
            name = item["bill_name"] + (f" {pct}/{100 - pct}" if form == "mix" else "")
            list_rate = None
            if client and x.get("rate_paise") not in (None, "") and int(x["rate_paise"]) != rate:
                list_rate, rate = rate, money(x.get("rate_paise"))   # wholesale price for this client: the list price is kept for the owner
            lines.append({"item": item, "blend_id": None, "blend_recipe_json": "", "hsn_code": item.get("hsn_code") or "0901",
                          "form": form, "pct": pct, "grams": grams, "rate": rate, "amount": pricing.line_amount(grams, rate), "name": name, "list_rate": list_rate})
        subtotal = sum(l["amount"] for l in lines)
        discount = int(d.get("discount_paise") or 0)
        reason = str(d.get("discount_reason") or "").strip()[:120]
        if discount:
            if st["discount_cap_pct"] is None:
                raise Fail("DISCOUNTS_NOT_SET_UP")
            if discount < 0 or discount > pricing.max_discount(subtotal, st["discount_cap_pct"]):
                raise Fail("DISCOUNT_ABOVE_LIMIT")
            if len(reason) < 3:
                raise Fail("DISCOUNT_REASON_REQUIRED")
        total, round_off = pricing.round_bill(subtotal - discount)
        paid = 0
        for p in pays_in:
            if p.get("method") not in METHODS:
                raise Fail("INVALID_PAYMENT_METHOD")
            paid += money(p.get("amount_paise"))
        if client:
            if paid > total:
                raise Fail("PAID_MORE_THAN_BILL")
        elif paid != total:
            raise Fail("PAYMENT_MUST_EQUAL_TOTAL")
        due = total - paid
        credit_reason = str(d.get("credit_reason") or "").strip()[:200]
        if client and due and st["overdue_days"]:
            old = dues.summary(c, client["id"])
            if old["oldest_days"] > st["overdue_days"] and len(credit_reason) < 5:
                raise Fail("CLIENT_HAS_OLD_DUES")

        # Tax calculations
        client_state = (client.get("state_code") if client else "36") or "36"
        tax_info = pricing.tax_breakdown([(l["amount"], l["item"]["gst_bp"]) for l in lines], discount, client_state)
        gst = tax_info["gst_paise"]
        taxable_paise = tax_info["taxable_paise"]
        cgst_paise = tax_info["cgst_paise"]
        sgst_paise = tax_info["sgst_paise"]
        igst_paise = tax_info["igst_paise"]

        tendered_paise = money(d.get("tendered_paise"), allow_zero=True, allow_none=True)
        change_paise = money(d.get("change_paise"), allow_zero=True, allow_none=True)

        phone, cname = norm_phone(d.get("customer_phone")), str(d.get("customer_name") or "").strip()[:40]
        if str(d.get("customer_phone") or "").strip() and not phone:
            raise Fail("PHONE_LOOKS_WRONG")
        cid = None
        if client:
            phone, cname = norm_phone(client["phone"]), client["name"]
            ctype = client.get("client_type") or "dealer"
            if ctype == "cafe":
                bill_type = "cafe"
                pfx = st.get("cafe_bill_prefix") or "CAF"
            else:
                bill_type = "dealer"
                pfx = st.get("dealer_bill_prefix") or "DLR"
        else:
            bill_type = "counter"
            pfx = st["bill_prefix"]
            if phone:
                cu = c.execute("SELECT id, name FROM customers WHERE phone=?", (phone,)).fetchone()
                if cu:
                    cid = cu["id"]
                    cname = cname or cu["name"]
                    c.execute("UPDATE customers SET visits=visits+1, spent_paise=spent_paise+?, last_seen=?, name=CASE WHEN ?!='' THEN ? ELSE name END WHERE id=?",
                              (total, db.stamp(), cname, cname, cid))
                else:
                    c.execute("INSERT INTO customers(phone, name, visits, spent_paise, first_seen, last_seen) VALUES(?,?,1,?,?,?)", (phone, cname, total, db.stamp(), db.stamp()))
                    cid = c.execute("SELECT last_insert_rowid()").fetchone()[0]

        bill_no = _next_bill_no(c, pfx)
        c.execute("INSERT INTO bills(bill_no, day, customer_id, customer_name, customer_phone, subtotal_paise, discount_paise, discount_reason, round_off_paise, "
                  "total_paise, gst_paise, status, cashier_id, created_at, client_id, paid_paise, due_paise, credit_reason, bill_type, tendered_paise, change_paise, "
                  "taxable_paise, cgst_paise, sgst_paise, igst_paise) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (bill_no, day, cid, cname, phone, subtotal, discount, reason, round_off, total, gst, "PAID", u["id"], db.stamp(),
                   client["id"] if client else None, paid, due, credit_reason if client and due else "", bill_type, tendered_paise, change_paise,
                   taxable_paise, cgst_paise, sgst_paise, igst_paise))
        bid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        for l in lines:
            cg, chg, tg = pricing.split_grams(l["form"], l["grams"], l["pct"], l.get("blend_components"))
            c.execute("INSERT INTO bill_lines(bill_id, item_id, item_name, form, coffee_pct, grams, rate_paise, amount_paise, gst_bp, coffee_g, chicory_g, plain_g, added_by, list_rate_paise, hsn_code, blend_id, blend_recipe_json) "
                      "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (bid, l["item"]["id"], l["name"], l["form"], l["pct"], l["grams"], l["rate"], l["amount"],
                       l["item"]["gst_bp"], cg, chg, tg, u["id"] if l["form"] == "custom" else None, l.get("list_rate"),
                       l.get("hsn_code") or "0901", l.get("blend_id"), l.get("blend_recipe_json") or ""))
            if l["form"] == "custom":
                db.audit(c, u["id"], "ITEM_ADDED_AT_COUNTER", f"bill:{bid}", f"{l['name']} ₹{l['amount'] / 100:.2f}" + (f", {l['grams']} g" if l["grams"] else ""))
            # Save client agreed price
            if client:
                if l.get("blend_id"):
                    c.execute("DELETE FROM client_prices WHERE client_id=? AND blend_id=?", (client["id"], l["blend_id"]))
                    c.execute("INSERT INTO client_prices(client_id, blend_id, item_id, rate_paise, updated_at) VALUES(?,?,NULL,?,?)",
                              (client["id"], l["blend_id"], l["rate"], db.stamp()))
                elif l["item"].get("id"):
                    c.execute("DELETE FROM client_prices WHERE client_id=? AND item_id=?", (client["id"], l["item"]["id"]))
                    c.execute("INSERT INTO client_prices(client_id, blend_id, item_id, rate_paise, updated_at) VALUES(?,NULL,?,?,?)",
                              (client["id"], l["item"]["id"], l["rate"], db.stamp()))

        for p in pays_in:
            c.execute("INSERT INTO payments(bill_id, method, amount_paise, reference) VALUES(?,?,?,?)",
                      (bid, p["method"], int(p["amount_paise"]), str(p.get("reference") or "").strip()[:40]))
        if key:
            c.execute("INSERT INTO idempotency(key, user_id, bill_id) VALUES(?,?,?)", (key, u["id"], bid))
        if client:   # the bill prints the client's balance as it stands right after this bill
            c.execute("UPDATE bills SET balance_after_paise=? WHERE id=?", (dues.summary(c, client["id"])["balance_paise"], bid))
        db.audit(c, u["id"], "BILL_SAVED", f"bill:{bid}", f"{bill_no} ₹{total / 100:.2f}" + (f", discount ₹{discount / 100:.2f}: {reason}" if discount else "")
                 + (f", client {client['name']}, due ₹{due / 100:.2f}" + (f", old dues: {credit_reason}" if credit_reason else "") if client else "")
                 + "".join(f", {l['name']} at ₹{l['rate'] / 100:.2f}/kg (list ₹{l['list_rate'] / 100:.2f})" for l in lines if l.get("list_rate")))
        if d.get("print"):
            _queue_print(c, bid, u["id"], "CUSTOMER COPY")
        return bill(c, bid, full_phone=True)


@app.get("/api/bills")
def list_bills(req: Request, u: dict = Depends(current)):
    day = req.query_params.get("day") or db.today()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise Fail("INVALID_DATE")
    if day != db.today() and not is_boss(u):
        raise Fail("OWNER_OR_ADMIN_ONLY", 403)    # cashiers see today's bills only
    with db.read() as c:
        bills = db.rows(c.execute("SELECT b.id, b.bill_no, b.created_at, b.customer_name, b.customer_phone, b.total_paise, b.discount_paise, b.status, b.reprints, b.due_paise, b.client_id, "
                                  "u.full_name cashier, (SELECT GROUP_CONCAT(method, ' + ') FROM payments p WHERE p.bill_id=b.id) methods "
                                  "FROM bills b JOIN users u ON u.id=b.cashier_id WHERE b.day=? ORDER BY b.id DESC", (day,)))
        pending = db.rows(c.execute("SELECT x.id, x.bill_id, x.reason, x.created_at, x.requested_by, a.full_name requested_by_name, b.bill_no, b.total_paise "
                                    "FROM cancels x JOIN bills b ON b.id=x.bill_id JOIN users a ON a.id=x.requested_by WHERE x.state='REQUESTED' ORDER BY x.id"))
        closed = _closed(c, day)
    for b in bills:
        if not is_boss(u):
            b["customer_phone"] = mask(b["customer_phone"])
    live = [b for b in bills if b["status"] != "CANCELLED"]
    return {"day": day, "bills": bills, "pending_cancels": pending, "closed": closed,
            "totals": {"bills": len(live), "total_paise": sum(b["total_paise"] for b in live)}}


@app.get("/api/bills/{bid}")
def get_bill(bid: int, u: dict = Depends(current)):
    with db.read() as c:
        b = bill(c, bid, full_phone=is_boss(u))
    if b["day"] != db.today() and not is_boss(u):
        raise Fail("OWNER_OR_ADMIN_ONLY", 403)
    return b


# ------------------------------------------------------------------ printing: one press = one bill, printed by the PC

def _queue_print(c, bid: int, uid: int, label: str) -> int:
    earlier = c.execute("SELECT COUNT(*) FROM print_jobs WHERE bill_id=? AND label=?", (bid, label)).fetchone()[0]
    dup = 1 if earlier else 0
    if dup:
        c.execute("UPDATE bills SET reprints=reprints+1 WHERE id=?", (bid,))
    c.execute("INSERT INTO print_jobs(bill_id, label, duplicate, state, requested_by, created_at) VALUES(?,?,?,?,?,?)",
              (bid, label, dup, "QUEUED", uid, db.stamp()))
    jid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
    db.audit(c, uid, "BILL_REPRINT_REQUESTED" if dup else "BILL_PRINT_REQUESTED", f"bill:{bid}", label)
    return jid


@app.post("/api/bills/{bid}/print")
async def print_bill(bid: int, req: Request, u: dict = Depends(current)):
    d = await req.json()
    label = {"customer": "CUSTOMER COPY", "office": "OFFICE COPY"}.get(d.get("copy", "customer"))
    if not label:
        raise Fail("INVALID_COPY")
    with db.tx() as c:
        b = db.one(c.execute("SELECT day FROM bills WHERE id=?", (bid,)))
        if not b:
            raise Fail("NOT_FOUND", 404)
        if b["day"] != db.today() and not is_boss(u):
            raise Fail("OWNER_OR_ADMIN_ONLY", 403)
        jid = _queue_print(c, bid, u["id"], label)
        method = print_method(db.all_settings(c))
    if method == "direct":
        ok, err = await asyncio.to_thread(print_direct, jid)
        return {"job_id": jid, "direct": True, "ok": ok, "error": err}
    return {"job_id": jid, "direct": False}


def print_method(st: dict) -> str:
    m = st.get("print_method") or "auto"
    return ("direct" if printer.available() else "browser") if m == "auto" else m


def print_direct(jid: int) -> tuple[bool, str]:
    """Send one bill straight to the ATPOS printer as ESC/POS: exact 80 mm, no browser, cut at the end."""
    with db.tx() as c:
        n = c.execute("UPDATE print_jobs SET state='PRINTING', claimed_at=? WHERE id=? AND state='QUEUED'", (db.stamp(), jid)).rowcount
        if not n:
            return False, "This bill is already being printed."
        j = db.one(c.execute("SELECT * FROM print_jobs WHERE id=?", (jid,)))
        st = db.all_settings(c)
        data = escpos.bill_bytes(bill(c, j["bill_id"], full_phone=True), st["layout"], label="" if j["label"] == "CUSTOMER COPY" else j["label"],
                                 duplicate=bool(j["duplicate"]), tax_approved=st["tax_approved"], cols=st["print_cols"])
    try:
        printer.send(data, st["printer_name"], title=f"VTC bill job {jid}")
        state, err = "DONE", ""
    except printer.PrintError as e:
        state, err = "QUEUED", str(e)   # stays in the queue: reprint from Today's bills once the printer is fixed
    with db.tx() as c:
        c.execute("UPDATE print_jobs SET state=?, error=?, done_at=? WHERE id=?", (state, err, db.stamp() if state == "DONE" else None, jid))
    return state == "DONE", err


@app.get("/api/printers")
def list_printers(u: dict = Depends(boss)):
    with db.read() as c:
        st = db.all_settings(c)
    return {**printer.printers(), "method": print_method(st), "setting": st["print_method"], "printer_name": st["printer_name"], "cols": st["print_cols"]}


@app.post("/api/printers/test")
async def test_print(req: Request, u: dict = Depends(boss)):
    d = await req.json()
    with db.read() as c:
        st = db.all_settings(c)
    lay = {**st["layout"], **{k: v for k, v in (d.get("layout") or {}).items() if k in st["layout"]}}
    sample = {**escpos.SAMPLE, "created_at": db.stamp()}
    try:
        printer.send(escpos.bill_bytes(sample, lay, label="TEST PRINT", tax_approved=st["tax_approved"], cols=st["print_cols"]),
                     str(d.get("printer_name", st["printer_name"]) or ""), title="VTC test bill")
    except printer.PrintError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True}


def _claim(u) -> dict | None:
    with db.tx() as c:
        if print_method(db.all_settings(c)) != "browser":
            return None   # the server prints directly; no browser print station needed
        # a job left PRINTING for 2 minutes (page closed mid-print) goes back to the queue
        c.execute("UPDATE print_jobs SET state='QUEUED' WHERE state='PRINTING' AND claimed_at<?", (db.later(minutes=-2),))
        j = db.one(c.execute("SELECT * FROM print_jobs WHERE state='QUEUED' ORDER BY id LIMIT 1"))
        if not j:
            return None
        c.execute("UPDATE print_jobs SET state='PRINTING', claimed_at=? WHERE id=? AND state='QUEUED'", (db.stamp(), j["id"]))
        b = bill(c, j["bill_id"], full_phone=True)
        return {"job": j, "bill": b, "layout": db.get(c, "layout"), "tax_approved": db.get(c, "tax_approved")}


@app.get("/api/print-jobs/next")
async def next_job(req: Request, u: dict = Depends(current)):
    """The print station (the PC with the ATPOS printer) waits here for bills to print."""
    wait = min(int(req.query_params.get("wait") or 0), 25)
    for _ in range(wait * 2 + 1):
        got = await asyncio.to_thread(_claim, u)
        if got:
            return got
        if wait:
            await asyncio.sleep(0.5)
    return {"job": None}


@app.post("/api/print-jobs/{jid}/claim")
def claim_one(jid: int, u: dict = Depends(current)):
    """The device that asked for the print is itself the print station: take this job now."""
    with db.tx() as c:
        n = c.execute("UPDATE print_jobs SET state='PRINTING', claimed_at=? WHERE id=? AND state='QUEUED'", (db.stamp(), jid)).rowcount
        if not n:
            return {"job": None}
        j = db.one(c.execute("SELECT * FROM print_jobs WHERE id=?", (jid,)))
        return {"job": j, "bill": bill(c, j["bill_id"], full_phone=True), "layout": db.get(c, "layout"), "tax_approved": db.get(c, "tax_approved")}


@app.post("/api/print-jobs/{jid}/done")
def job_done(jid: int, u: dict = Depends(current)):
    with db.tx() as c:
        c.execute("UPDATE print_jobs SET state='DONE', done_at=? WHERE id=?", (db.stamp(), jid))
    return {"ok": True}


@app.get("/api/print-jobs")
def print_queue(u: dict = Depends(current)):
    with db.read() as c:
        return db.rows(c.execute("SELECT j.id, j.label, j.state, j.created_at, b.bill_no FROM print_jobs j JOIN bills b ON b.id=j.bill_id "
                                 "WHERE j.state!='DONE' ORDER BY j.id"))


# ------------------------------------------------------------------ cancelling a bill (owner/admin OK; nothing is deleted)

def _cancel_now(c, bid: int):
    c.execute("UPDATE bills SET status='CANCELLED' WHERE id=?", (bid,))
    b = c.execute("SELECT customer_id, total_paise FROM bills WHERE id=?", (bid,)).fetchone()
    if b["customer_id"]:
        c.execute("UPDATE customers SET visits=MAX(visits-1,0), spent_paise=MAX(spent_paise-?,0) WHERE id=?", (b["total_paise"], b["customer_id"]))


@app.post("/api/bills/{bid}/cancel")
async def cancel_bill(bid: int, req: Request, u: dict = Depends(current)):
    d = await req.json()
    reason = body_text(d, "reason", 5, 200, "REASON_REQUIRED")
    with db.tx() as c:
        b = db.one(c.execute("SELECT * FROM bills WHERE id=?", (bid,)))
        if not b:
            raise Fail("NOT_FOUND", 404)
        if b["status"] != "PAID":
            raise Fail("BILL_ALREADY_CANCELLED_OR_WAITING")
        if b["day"] != db.today() or _closed(c, b["day"]):
            raise Fail("ONLY_TODAYS_OPEN_BILLS_CAN_BE_CANCELLED")
        if is_boss(u):
            c.execute("INSERT INTO cancels(bill_id, reason, state, requested_by, decided_by, decision_note, created_at, decided_at) VALUES(?,?,?,?,?,?,?,?)",
                      (bid, reason, "APPROVED", u["id"], u["id"], "cancelled by owner/admin", db.stamp(), db.stamp()))
            _cancel_now(c, bid)
            db.audit(c, u["id"], "BILL_CANCELLED", f"bill:{bid}", f"{b['bill_no']}: {reason}")
            return {"state": "CANCELLED"}
        c.execute("INSERT INTO cancels(bill_id, reason, state, requested_by, created_at) VALUES(?,?,?,?,?)", (bid, reason, "REQUESTED", u["id"], db.stamp()))
        c.execute("UPDATE bills SET status='CANCEL_REQUESTED' WHERE id=?", (bid,))
        db.audit(c, u["id"], "BILL_CANCEL_REQUESTED", f"bill:{bid}", f"{b['bill_no']}: {reason}")
    return {"state": "CANCEL_REQUESTED"}


@app.post("/api/cancels/{xid}/decide")
async def decide_cancel(xid: int, req: Request, u: dict = Depends(boss)):
    d = await req.json()
    approve = bool(d.get("approve"))
    note = str(d.get("note") or "").strip()[:200]
    with db.tx() as c:
        x = db.one(c.execute("SELECT * FROM cancels WHERE id=?", (xid,)))
        if not x:
            raise Fail("NOT_FOUND", 404)
        if x["state"] != "REQUESTED":
            raise Fail("ALREADY_DECIDED")
        c.execute("UPDATE cancels SET state=?, decided_by=?, decision_note=?, decided_at=? WHERE id=?",
                  ("APPROVED" if approve else "REJECTED", u["id"], note, db.stamp(), xid))
        if approve:
            _cancel_now(c, x["bill_id"])
        else:
            c.execute("UPDATE bills SET status='PAID' WHERE id=?", (x["bill_id"],))
        db.audit(c, u["id"], "BILL_CANCEL_APPROVED" if approve else "BILL_CANCEL_REJECTED", f"bill:{x['bill_id']}", note)
    return {"ok": True}


# ------------------------------------------------------------------ day close

def _day_numbers(c, day: str) -> dict:
    opening = db.get(c, "opening_cash_paise")
    live = "b.day=? AND b.status!='CANCELLED'"
    t = db.one(c.execute(f"SELECT COUNT(*) bills, COALESCE(SUM(total_paise),0) total_paise, COALESCE(SUM(discount_paise),0) discount_paise, "
                         f"COALESCE(SUM(gst_paise),0) gst_paise FROM bills b WHERE {live}", (day,)))
    by = {m: 0 for m in METHODS}
    for r in c.execute(f"SELECT p.method, SUM(p.amount_paise) s FROM payments p JOIN bills b ON b.id=p.bill_id WHERE {live} GROUP BY p.method", (day,)):
        by[r["method"]] = r["s"]
    cancelled = c.execute("SELECT COUNT(*) FROM bills WHERE day=? AND status='CANCELLED'", (day,)).fetchone()[0]
    credit = c.execute(f"SELECT COALESCE(SUM(due_paise),0) FROM bills b WHERE {live}", (day,)).fetchone()[0]
    coll = {m: 0 for m in COLLECT_METHODS}
    for r in c.execute("SELECT method, SUM(amount_paise) s FROM collections WHERE day=? AND cancelled_at IS NULL GROUP BY method", (day,)):
        coll[r["method"]] = r["s"]
    # the drawer holds counter cash + client cash paid at billing + client dues collected in cash today
    return {**t, "by_method": by, "cancelled": cancelled, "opening_paise": opening, "credit_paise": credit, "collected": coll,
            "expected_paise": None if opening is None else opening + by["CASH"] + coll["CASH"]}


@app.get("/api/day-close")
def day_close_status(u: dict = Depends(current)):
    day = db.today()
    with db.read() as c:
        nums = _day_numbers(c, day)
        pending = c.execute("SELECT COUNT(*) FROM cancels x JOIN bills b ON b.id=x.bill_id WHERE x.state='REQUESTED' AND b.day=?", (day,)).fetchone()[0]
        history = db.rows(c.execute("SELECT k.*, u.full_name closed_by_name, s.full_name seen_by_name, r.full_name reopened_by_name FROM day_closes k "
                                    "JOIN users u ON u.id=k.closed_by LEFT JOIN users s ON s.id=k.seen_by LEFT JOIN users r ON r.id=k.reopened_by "
                                    "ORDER BY k.id DESC LIMIT 40"))
        closed = _closed(c, day)
        save = db.one(c.execute("SELECT * FROM day_saves WHERE day=?", (day,)))
    if not is_boss(u):   # cashiers see the count they need, not the day's sales history
        history = [h for h in history if h["day"] == day]
    return {"day": day, "today": nums, "pending_cancels": pending, "closed": closed, "history": history, "save": save}


@app.post("/api/day-close")
async def close_day(req: Request, u: dict = Depends(current)):
    d = await req.json()
    counted = money(d.get("counted_paise"), allow_zero=True)
    note = str(d.get("note") or "").strip()[:200]
    day = db.today()
    with db.tx() as c:
        if _closed(c, day):
            raise Fail("DAY_ALREADY_CLOSED")
        if c.execute("SELECT 1 FROM cancels x JOIN bills b ON b.id=x.bill_id WHERE x.state='REQUESTED' AND b.day=?", (day,)).fetchone():
            raise Fail("DECIDE_CANCEL_REQUESTS_FIRST")
        n = _day_numbers(c, day)
        if n["expected_paise"] is None:
            raise Fail("OPENING_CASH_NOT_SET")
        diff = counted - n["expected_paise"]
        if diff and len(note) < 5:
            raise Fail("EXPLAIN_THE_DIFFERENCE")
        state = "BALANCED" if diff == 0 else "DIFFERENCE"
        c.execute("INSERT INTO day_closes(day, opening_paise, cash_sales_paise, expected_paise, counted_paise, difference_paise, note, state, closed_by, created_at) "
                  "VALUES(?,?,?,?,?,?,?,?,?,?)", (day, n["opening_paise"], n["by_method"]["CASH"] + n["collected"]["CASH"], n["expected_paise"], counted, diff, note, state, u["id"], db.stamp()))
        kid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        db.audit(c, u["id"], "DAY_CLOSED", f"day:{day}", f"{n['bills']} bills ₹{n['total_paise'] / 100:.2f}; cash expected ₹{n['expected_paise'] / 100:.2f}, counted ₹{counted / 100:.2f}")
    result = saves.save_day(day)    # the daily save goes to the owner's folder right after closing
    return {"id": kid, "state": state, "difference_paise": diff, "save": result}


@app.post("/api/day-close/{kid}/seen")
async def close_seen(kid: int, req: Request, u: dict = Depends(boss)):
    d = await req.json()
    with db.tx() as c:
        k = db.one(c.execute("SELECT * FROM day_closes WHERE id=?", (kid,)))
        if not k:
            raise Fail("NOT_FOUND", 404)
        c.execute("UPDATE day_closes SET seen_by=?, seen_note=?, seen_at=? WHERE id=?", (u["id"], str(d.get("note") or "").strip()[:200], db.stamp(), kid))
        db.audit(c, u["id"], "CASH_DIFFERENCE_SEEN", f"day:{k['day']}", str(d.get("note") or ""))
    return {"ok": True}


@app.post("/api/day-close/{kid}/reopen")
async def reopen(kid: int, req: Request, u: dict = Depends(boss)):
    d = await req.json()
    reason = body_text(d, "reason", 5, 200, "REASON_REQUIRED")
    with db.tx() as c:
        k = db.one(c.execute("SELECT * FROM day_closes WHERE id=?", (kid,)))
        if not k:
            raise Fail("NOT_FOUND", 404)
        if k["day"] != db.today():
            raise Fail("ONLY_TODAY_CAN_BE_REOPENED")
        if k["state"] == "REOPENED":
            raise Fail("DAY_IS_NOT_CLOSED")
        c.execute("UPDATE day_closes SET state='REOPENED', reopened_by=?, reopen_reason=?, reopened_at=? WHERE id=?", (u["id"], reason, db.stamp(), kid))
        db.audit(c, u["id"], "DAY_REOPENED", f"day:{k['day']}", reason)
    return {"ok": True}


# ------------------------------------------------------------------ reports (owner/admin)

def _range(req: Request) -> tuple[str, str]:
    a, b = req.query_params.get("from") or db.today()[:8] + "01", req.query_params.get("to") or db.today()
    if not (re.fullmatch(r"\d{4}-\d{2}-\d{2}", a) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", b)) or a > b:
        raise Fail("INVALID_DATE")
    return a, b


def report(c, a: str, b: str) -> dict:
    live = "b.day BETWEEN ? AND ? AND b.status!='CANCELLED'"
    days = db.rows(c.execute(f"SELECT b.day, COUNT(*) bills, SUM(total_paise) total_paise, SUM(discount_paise) discount_paise, SUM(gst_paise) gst_paise, "
                             f"SUM(round_off_paise) round_off_paise, SUM(CASE WHEN client_id IS NULL THEN total_paise ELSE 0 END) counter_paise, "
                             f"SUM(CASE WHEN client_id IS NOT NULL THEN total_paise ELSE 0 END) client_paise, SUM(due_paise) credit_paise "
                             f"FROM bills b WHERE {live} GROUP BY b.day ORDER BY b.day", (a, b)))
    pays = {}
    for r in c.execute(f"SELECT b.day, p.method, SUM(p.amount_paise) s FROM payments p JOIN bills b ON b.id=p.bill_id WHERE {live} GROUP BY b.day, p.method", (a, b)):
        pays.setdefault(r["day"], {})[r["method"]] = r["s"]
    canc = {r["day"]: r["n"] for r in c.execute("SELECT day, COUNT(*) n FROM bills WHERE day BETWEEN ? AND ? AND status='CANCELLED' GROUP BY day", (a, b))}
    for d in days:
        d.update({m: pays.get(d["day"], {}).get(m, 0) for m in METHODS}, cancelled=canc.pop(d["day"], 0))
    blank = {"bills": 0, "total_paise": 0, "discount_paise": 0, "gst_paise": 0, "round_off_paise": 0, "counter_paise": 0, "client_paise": 0, "credit_paise": 0,
             **{m: 0 for m in METHODS}, "cancelled": 0}
    for day, n in canc.items():   # days where every bill was cancelled still show
        days.append({**blank, "day": day, "cancelled": n})
    coll = {r["day"]: r["s"] for r in c.execute("SELECT day, SUM(amount_paise) s FROM collections WHERE day BETWEEN ? AND ? AND cancelled_at IS NULL GROUP BY day", (a, b))}
    for d in days:
        d["collected_paise"] = coll.pop(d["day"], 0)
    for day, v in coll.items():   # a day with only dues collected
        days.append({**blank, "day": day, "collected_paise": v})
    days.sort(key=lambda x: x["day"])
    collections = db.rows(c.execute("SELECT k.day, cl.name client, k.amount_paise, k.method, k.reference, u.full_name by_name FROM collections k JOIN clients cl ON cl.id=k.client_id "
                                    "JOIN users u ON u.id=k.created_by WHERE k.day BETWEEN ? AND ? AND k.cancelled_at IS NULL ORDER BY k.id", (a, b)))
    price_changes = db.rows(c.execute(f"SELECT b.day, b.bill_no, b.customer_name client, l.item_name, l.grams, l.list_rate_paise, l.rate_paise, u.full_name by_name "
                                      f"FROM bill_lines l JOIN bills b ON b.id=l.bill_id JOIN users u ON u.id=b.cashier_id WHERE {live} AND l.list_rate_paise IS NOT NULL ORDER BY l.id", (a, b)))
    items = db.rows(c.execute(f"SELECT l.item_name, COUNT(*) lines, SUM(l.grams) grams, SUM(l.amount_paise) amount_paise FROM bill_lines l "
                              f"JOIN bills b ON b.id=l.bill_id WHERE {live} GROUP BY l.item_name ORDER BY amount_paise DESC", (a, b)))
    usage = db.one(c.execute(f"SELECT COALESCE(SUM(coffee_g),0) coffee_g, COALESCE(SUM(chicory_g),0) chicory_g, COALESCE(SUM(plain_g),0) plain_g "
                             f"FROM bill_lines l JOIN bills b ON b.id=l.bill_id WHERE {live}", (a, b)))
    discounts = db.rows(c.execute(f"SELECT b.day, b.bill_no, u.full_name cashier, b.subtotal_paise, b.discount_paise, b.discount_reason FROM bills b "
                                  f"JOIN users u ON u.id=b.cashier_id WHERE {live} AND b.discount_paise>0 ORDER BY b.id", (a, b)))
    by_cashier = db.rows(c.execute(f"SELECT u.full_name cashier, COUNT(*) bills, SUM(b.total_paise) total_paise, SUM(b.discount_paise) discount_paise, "
                                   f"SUM(CASE WHEN b.discount_paise>0 THEN 1 ELSE 0 END) discounted_bills FROM bills b JOIN users u ON u.id=b.cashier_id "
                                   f"WHERE {live} GROUP BY u.id ORDER BY total_paise DESC", (a, b)))
    cancelled = db.rows(c.execute("SELECT b.day, b.bill_no, b.total_paise, x.reason, r.full_name requested_by, d.full_name decided_by FROM bills b "
                                  "JOIN cancels x ON x.bill_id=b.id AND x.state='APPROVED' JOIN users r ON r.id=x.requested_by LEFT JOIN users d ON d.id=x.decided_by "
                                  "WHERE b.day BETWEEN ? AND ? ORDER BY b.id", (a, b)))
    added = db.rows(c.execute(f"SELECT b.day, b.bill_no, l.item_name, l.grams, l.amount_paise, u.full_name added_by, b.created_at FROM bill_lines l "
                              f"JOIN bills b ON b.id=l.bill_id LEFT JOIN users u ON u.id=l.added_by WHERE {live} AND l.form='custom' ORDER BY l.id", (a, b)))
    totals = {k: sum(d[k] for d in days) for k in ("counter_paise", "client_paise", "credit_paise", "collected_paise", "bills", "total_paise", "discount_paise", "gst_paise", "round_off_paise", "cancelled", *METHODS)}
    return {"from": a, "to": b, "days": days, "items": items, "usage": usage, "discounts": discounts, "by_cashier": by_cashier,
            "cancelled": cancelled, "totals": totals, "added": added, "collections": collections, "price_changes": price_changes}


@app.get("/api/reports")
def reports(req: Request, u: dict = Depends(boss)):
    a, b = _range(req)
    with db.read() as c:
        return report(c, a, b)


def report_book(r: dict, customers: list | None = None) -> bytes:
    rs = lambda p: round((p or 0) / 100, 2)
    kg = lambda g: round((g or 0) / 1000, 3)
    days = [["Day", "Bills", "Total sales (Rs)", "Counter (Rs)", "Clients (Rs)", "Given on credit (Rs)", "Dues collected (Rs)", "Cash (Rs)", "UPI (Rs)", "Card (Rs)",
             "Discount (Rs)", "GST included (Rs)", "Round off (Rs)", "Cancelled bills"]]
    days += [[d["day"], d["bills"], rs(d["total_paise"]), rs(d["counter_paise"]), rs(d["client_paise"]), rs(d["credit_paise"]), rs(d["collected_paise"]),
              rs(d["CASH"]), rs(d["UPI"]), rs(d["CARD"]), rs(d["discount_paise"]), rs(d["gst_paise"]), rs(d["round_off_paise"]), d["cancelled"]] for d in r["days"]]
    t = r["totals"]
    days.append(["TOTAL", t["bills"], rs(t["total_paise"]), rs(t["counter_paise"]), rs(t["client_paise"]), rs(t["credit_paise"]), rs(t["collected_paise"]),
                 rs(t["CASH"]), rs(t["UPI"]), rs(t["CARD"]), rs(t["discount_paise"]), rs(t["gst_paise"]), rs(t["round_off_paise"]), t["cancelled"]])
    items = [["Item", "Bill lines", "Kg sold", "Amount (Rs)"]] + [[i["item_name"], i["lines"], kg(i["grams"]), rs(i["amount_paise"])] for i in r["items"]]
    used = [["What went out", "Kg"], ["Coffee in chicory mixes", kg(r["usage"]["coffee_g"])], ["Chicory in mixes", kg(r["usage"]["chicory_g"])],
            ["Other items (beans, tea, pure items)", kg(r["usage"]["plain_g"])]]
    disc = [["Day", "Bill", "Cashier", "Bill before discount (Rs)", "Discount (Rs)", "Reason"]] + [
        [x["day"], x["bill_no"], x["cashier"], rs(x["subtotal_paise"]), rs(x["discount_paise"]), x["discount_reason"]] for x in r["discounts"]]
    cash = [["Cashier", "Bills", "Total (Rs)", "Discounted bills", "Discount given (Rs)"]] + [
        [x["cashier"], x["bills"], rs(x["total_paise"]), x["discounted_bills"], rs(x["discount_paise"])] for x in r["by_cashier"]]
    canc = [["Day", "Bill", "Amount (Rs)", "Reason", "Asked by", "Approved by"]] + [
        [x["day"], x["bill_no"], rs(x["total_paise"]), x["reason"], x["requested_by"], x["decided_by"] or ""] for x in r["cancelled"]]
    adds = [["Day", "Bill", "Item typed at counter", "Grams", "Amount (Rs)", "Added by"]] + [
        [x["day"], x["bill_no"], x["item_name"], x["grams"] or "", rs(x["amount_paise"]), x["added_by"] or ""] for x in r["added"]]
    colls = [["Day", "Client", "Amount (Rs)", "How", "Reference", "Entered by"]] + [
        [x["day"], x["client"], rs(x["amount_paise"]), x["method"], x["reference"], x["by_name"]] for x in r["collections"]]
    prices = [["Day", "Bill", "Client", "Item", "Grams", "List price (Rs/kg)", "Price given (Rs/kg)", "By"]] + [
        [x["day"], x["bill_no"], x["client"], x["item_name"], x["grams"], rs(x["list_rate_paise"]), rs(x["rate_paise"]), x["by_name"]] for x in r["price_changes"]]
    sheets = [("Days", days), ("Items", items), ("Kg out", used), ("Discounts", disc), ("By cashier", cash), ("Cancelled", canc), ("Added at counter", adds),
              ("Dues collected", colls), ("Client prices", prices)]
    if customers is not None:
        sheets.append(("Customers", [["Phone", "Name", "Visits", "Spent (Rs)", "First seen", "Last seen"]] + [
            [x["phone"], x["name"], x["visits"], rs(x["spent_paise"]), db.ist_day(x["first_seen"]), db.ist_day(x["last_seen"])] for x in customers]))
    return xlsx.write(sheets)


@app.get("/api/reports.xlsx")
def reports_xlsx(req: Request, u: dict = Depends(boss)):
    a, b = _range(req)
    with db.tx() as c:
        r = report(c, a, b)
        cust = db.rows(c.execute("SELECT * FROM customers ORDER BY last_seen DESC"))
        db.audit(c, u["id"], "REPORT_EXPORTED", f"{a}..{b}")
    return Response(report_book(r, cust), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="VTC_counter_{a}_to_{b}.xlsx"'})


@app.get("/api/reports.pdf")
def reports_pdf(req: Request, u: dict = Depends(boss)):
    a, b = _range(req)
    with db.tx() as c:
        r = report(c, a, b)
        shop = db.get(c, "layout")["shop_name"]
        db.audit(c, u["id"], "REPORT_PDF_EXPORTED", f"{a}..{b}")
    return Response(saves.report_pdf(r, shop), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="VTC_report_{a}_to_{b}.pdf"'})


# ------------------------------------------------------------------ daily saves (owner/admin)

@app.get("/api/saves")
def list_saves(u: dict = Depends(boss)):
    with db.read() as c:
        folder = db.get(c, "save_folder")
        return {"folder": folder, "folder_ok": saves.folder_ok(folder), "saves": db.rows(c.execute("SELECT * FROM day_saves ORDER BY day DESC LIMIT 60"))}


@app.post("/api/saves/run")
def save_now(u: dict = Depends(boss)):
    r = saves.save_day(db.today(), manual=True)
    if not r["ok"]:
        raise Fail(r["error"])
    with db.tx() as c:
        db.audit(c, u["id"], "DAY_SAVED_BY_HAND", f"day:{db.today()}", r["folder"])
    return r


# ------------------------------------------------------------------ clients and their dues (money owed to the shop)

COLLECT_METHODS = ("CASH", "UPI", "BANK", "CHEQUE")


def _client_fields(d: dict, u: dict, old: dict | None = None) -> dict:
    out = {"name": body_text(d, "name", 2, 60, "CLIENT_NAME_2_TO_60_LETTERS"), "contact": str(d.get("contact") or "").strip()[:60],
           "address": str(d.get("address") or "").strip()[:200], "gstin": str(d.get("gstin") or "").strip().upper()[:15]}
    raw = str(d.get("phone") or "").strip()
    out["phone"] = norm_phone(raw)
    if raw and not out["phone"]:
        raise Fail("PHONE_LOOKS_WRONG")
    if out["gstin"] and not re.fullmatch(r"\d{2}[A-Z0-9]{13}", out["gstin"]):
        raise Fail("GSTIN_LOOKS_WRONG")
    out["client_type"] = "cafe" if str(d.get("client_type") or "").strip().lower() == "cafe" else "dealer"
    out["state_code"] = str(d.get("state_code") or "36").strip()[:4]
    out["credit_limit_paise"] = money(d.get("credit_limit_paise"), allow_zero=True, allow_none=True)
    if "opening_paise" in d:
        opening = money(d.get("opening_paise"), allow_zero=True, allow_none=True) or 0
        if old and opening != old["opening_paise"] and not is_boss(u):
            raise Fail("OWNER_OR_ADMIN_ONLY", 403)   # old dues are changed by owner/admin only
        out["opening_paise"] = opening
        day = str(d.get("opening_date") or "").strip()
        if opening and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            raise Fail("OPENING_DATE_REQUIRED")
        out["opening_date"] = day or None
    return out


def _client_row(c, cl: dict) -> dict:
    sm = dues.summary(c, cl["id"])
    return {**cl, "balance_paise": sm["balance_paise"], "oldest_days": sm["oldest_days"], "buckets": sm["buckets"]}


@app.get("/api/clients")
def list_clients(req: Request, u: dict = Depends(current)):
    q = f"%{req.query_params.get('q', '').strip()}%"
    ctype = req.query_params.get("type")
    context = req.query_params.get("context")
    with db.read() as c:
        sql = "SELECT * FROM clients WHERE (name LIKE ? OR phone LIKE ? OR contact LIKE ?)"
        params = [q, q, q]
        if ctype in ("dealer", "cafe"):
            sql += " AND client_type=?"
            params.append(ctype)
        sql += " ORDER BY active DESC, name"
        rows = db.rows(c.execute(sql, params))
        overdue_days = db.get(c, "overdue_days")
        client_rows = []
        for r in rows:
            if context == "billing" and not can_view_dues(u):
                sm = dues.summary(c, r["id"])
                has_overdue = bool(overdue_days and sm["oldest_days"] > overdue_days)
                client_rows.append({
                    **r,
                    "has_overdue": has_overdue,
                    "oldest_days": sm["oldest_days"] if has_overdue else 0,
                    "balance_paise": 0,
                    "buckets": {},
                })
            else:
                client_rows.append(_client_row(c, r))
        return {"clients": client_rows, "overdue_days": overdue_days}


@app.post("/api/clients")
async def add_client(req: Request, u: dict = Depends(current)):
    f = _client_fields(await req.json(), u)
    with db.tx() as c:
        c.execute("INSERT INTO clients(name, contact, phone, address, gstin, opening_paise, opening_date, created_by, created_at, client_type, state_code, credit_limit_paise) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                  (f["name"], f["contact"], f["phone"], f["address"], f["gstin"], f.get("opening_paise", 0), f.get("opening_date"), u["id"], db.stamp(),
                   f["client_type"], f["state_code"], f["credit_limit_paise"]))
        cid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        db.audit(c, u["id"], "CLIENT_ADDED", f"client:{cid}", f"{f['name']} ({f['client_type']})" + (f", opening dues ₹{f['opening_paise'] / 100:.2f} on {f['opening_date']}" if f.get("opening_paise") else ""))
    return {"id": cid}


@app.put("/api/clients/{cid}")
async def edit_client(cid: int, req: Request, u: dict = Depends(current)):
    if not can_manage_clients(u):
        raise Fail("FORBIDDEN", 403)
    d = await req.json()
    with db.tx() as c:
        old = db.one(c.execute("SELECT * FROM clients WHERE id=?", (cid,)))
        if not old:
            raise Fail("NOT_FOUND", 404)
        if set(d) == {"active"}:
            if not is_boss(u):
                raise Fail("OWNER_OR_ADMIN_ONLY", 403)
            c.execute("UPDATE clients SET active=? WHERE id=?", (int(bool(d["active"])), cid))
            db.audit(c, u["id"], "CLIENT_ON" if d["active"] else "CLIENT_OFF", f"client:{cid}", old["name"])
            return {"ok": True}
        f = _client_fields({**old, **d}, u, old)
        c.execute("UPDATE clients SET name=?, contact=?, phone=?, address=?, gstin=?, opening_paise=?, opening_date=?, client_type=?, state_code=?, credit_limit_paise=? WHERE id=?",
                  (f["name"], f["contact"], f["phone"], f["address"], f["gstin"], f.get("opening_paise", old["opening_paise"]), f.get("opening_date", old["opening_date"]),
                   f["client_type"], f["state_code"], f["credit_limit_paise"], cid))
        db.audit(c, u["id"], "CLIENT_CHANGED", f"client:{cid}", f"{f['name']} ({f['client_type']})" + (f"; opening dues ₹{old['opening_paise'] / 100:.2f} → ₹{f['opening_paise'] / 100:.2f}"
                                                                           if f.get("opening_paise", old["opening_paise"]) != old["opening_paise"] else ""))
    return {"ok": True}


@app.get("/api/clients/{cid}")
def get_client(cid: int, u: dict = Depends(current)):
    with db.read() as c:
        cl = db.one(c.execute("SELECT * FROM clients WHERE id=?", (cid,)))
        if not cl:
            raise Fail("NOT_FOUND", 404)
        sm = dues.summary(c, cid)
        cols = db.rows(c.execute("SELECT k.*, u.full_name by_name, x.full_name cancelled_by_name FROM collections k JOIN users u ON u.id=k.created_by "
                                 "LEFT JOIN users x ON x.id=k.cancelled_by WHERE client_id=? ORDER BY k.id DESC LIMIT 100", (cid,)))
        return {"client": cl, "summary": sm, "statement": dues.statement(c, cid), "collections": cols, "overdue_days": db.get(c, "overdue_days")}


@app.get("/api/clients/{cid}/last-bill")
def last_client_bill(cid: int, u: dict = Depends(current)):
    with db.read() as c:
        row = c.execute("SELECT id FROM bills WHERE client_id=? AND status!='CANCELLED' ORDER BY id DESC LIMIT 1", (cid,)).fetchone()
        if not row:
            return {"found": False}
        return {"found": True, "bill": bill(c, row[0], full_phone=True)}


@app.post("/api/clients/categorize-legacy")
async def categorize_legacy(req: Request, u: dict = Depends(boss)):
    d = await req.json()
    with db.tx() as c:
        for cid_str, ctype in d.items():
            if ctype in ("dealer", "cafe"):
                c.execute("UPDATE clients SET client_type=? WHERE id=?", (ctype, int(cid_str)))
                db.audit(c, u["id"], "CLIENT_CATEGORIZED", f"client:{cid_str}", ctype)
    return {"ok": True}


@app.get("/api/dues")
def all_dues(req: Request, u: dict = Depends(current)):
    if not can_view_dues(u):
        raise Fail("FORBIDDEN", 403)
    ctype = req.query_params.get("type")
    with db.read() as c:
        sql = "SELECT * FROM clients"
        params = []
        if ctype in ("dealer", "cafe"):
            sql += " WHERE client_type=?"
            params.append(ctype)
        sql += " ORDER BY name"
        rows = [_client_row(c, r) for r in db.rows(c.execute(sql, params))]
        overdue = db.get(c, "overdue_days")
    rows = [r for r in rows if r["balance_paise"]]
    rows.sort(key=lambda r: -r["balance_paise"])
    tot = {"balance_paise": sum(max(r["balance_paise"], 0) for r in rows), "advance_paise": sum(-r["balance_paise"] for r in rows if r["balance_paise"] < 0),
           **{k: sum(r["buckets"][k] for r in rows) for k, _, _ in dues.BUCKETS}}
    return {"clients": rows, "totals": tot, "overdue_days": overdue}


@app.post("/api/clients/{cid}/collect")
async def collect(cid: int, req: Request, u: dict = Depends(current)):
    d = await req.json()
    amount = money(d.get("amount_paise"))
    method = d.get("method")
    if method not in COLLECT_METHODS:
        raise Fail("INVALID_PAYMENT_METHOD")
    with db.tx() as c:
        cl = db.one(c.execute("SELECT * FROM clients WHERE id=?", (cid,)))
        if not cl:
            raise Fail("NOT_FOUND", 404)
        day = db.today()
        if method == "CASH" and _closed(c, day):
            raise Fail("DAY_CLOSED")   # cash goes into today's drawer, so not after the count
        c.execute("INSERT INTO collections(client_id, day, amount_paise, method, reference, note, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)",
                  (cid, day, amount, method, str(d.get("reference") or "").strip()[:60], str(d.get("note") or "").strip()[:200], u["id"], db.stamp()))
        kid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        bal = dues.summary(c, cid)["balance_paise"]
        db.audit(c, u["id"], "DUES_COLLECTED", f"client:{cid}", f"{cl['name']}: ₹{amount / 100:.2f} {method}; balance now ₹{bal / 100:.2f}")
    return {"id": kid, "balance_paise": bal}


@app.post("/api/collections/{kid}/cancel")
async def cancel_collection(kid: int, req: Request, u: dict = Depends(boss)):
    d = await req.json()
    reason = body_text(d, "reason", 5, 200, "REASON_REQUIRED")
    with db.tx() as c:
        k = db.one(c.execute("SELECT * FROM collections WHERE id=?", (kid,)))
        if not k:
            raise Fail("NOT_FOUND", 404)
        if k["cancelled_at"]:
            raise Fail("ALREADY_CANCELLED")
        if k["method"] == "CASH" and _closed(c, k["day"]):
            raise Fail("DAY_ALREADY_COUNTED")   # that cash was counted in a closed day
        c.execute("UPDATE collections SET cancelled_by=?, cancel_reason=?, cancelled_at=? WHERE id=?", (u["id"], reason, db.stamp(), kid))
        db.audit(c, u["id"], "COLLECTION_CANCELLED", f"client:{k['client_id']}", f"₹{k['amount_paise'] / 100:.2f} {k['method']}: {reason}")
    return {"ok": True}


def _wa_reminder(cl: dict, sm: dict, shop: str) -> str:
    oldest = f" Your oldest unpaid bill is {sm['oldest_days']} days old." if sm["oldest_days"] else ""
    return (f"Dear {cl['contact'] or cl['name']}, this is a reminder from {shop}. Your balance is Rs. {sm['balance_paise'] / 100:,.2f}.{oldest} "
            "Please arrange the payment. Thank you.")


@app.get("/api/clients/{cid}/reminder")
def reminder(cid: int, u: dict = Depends(current)):
    with db.tx() as c:
        cl = db.one(c.execute("SELECT * FROM clients WHERE id=?", (cid,)))
        if not cl:
            raise Fail("NOT_FOUND", 404)
        sm = dues.summary(c, cid)
        text = _wa_reminder(cl, sm, db.get(c, "layout")["shop_name"])
        db.audit(c, u["id"], "DUES_REMINDER", f"client:{cid}", f"₹{sm['balance_paise'] / 100:.2f}")
    phone = cl["phone"]
    return {"text": text, "phone": phone, "link": f"https://wa.me/{'91' + phone if len(phone) == 10 else phone}?text={quote(text)}" if phone else None}


@app.get("/api/clients/{cid}/statement.pdf")
def statement_pdf(cid: int, u: dict = Depends(current)):
    with db.read() as c:
        cl = db.one(c.execute("SELECT * FROM clients WHERE id=?", (cid,)))
        if not cl:
            raise Fail("NOT_FOUND", 404)
        rows, sm, lay = dues.statement(c, cid), dues.summary(c, cid), db.get(c, "layout")
    return Response(saves.statement_pdf(cl, rows, sm, lay), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="Statement_{re.sub(r"[^A-Za-z0-9]+", "_", cl["name"])}_{db.today()}.pdf"'})


@app.get("/api/dues.xlsx")
def dues_xlsx(u: dict = Depends(boss)):
    rs = lambda p: round((p or 0) / 100, 2)
    with db.tx() as c:
        clients = db.rows(c.execute("SELECT * FROM clients ORDER BY name"))
        head = [["Client", "Contact", "Phone", "GSTIN", "Balance (Rs)", "0-30 days", "31-60 days", "61-90 days", "Over 90 days", "Oldest unpaid (days)"]]
        sheet, ledger = [], [["Client", "Date", "What", "Charged (Rs)", "Received (Rs)", "Balance (Rs)"]]
        for cl in clients:
            sm = dues.summary(c, cl["id"])
            if sm["balance_paise"]:
                b = sm["buckets"]
                sheet.append([cl["name"], cl["contact"], cl["phone"], cl["gstin"], rs(sm["balance_paise"]), rs(b["0_30"]), rs(b["31_60"]), rs(b["61_90"]), rs(b["90_plus"]), sm["oldest_days"]])
            for r in dues.statement(c, cl["id"]):
                ledger.append([cl["name"], r["day"], r["what"], rs(r["debit"]), rs(r["credit"]), rs(r["balance"])])
        db.audit(c, u["id"], "DUES_EXPORTED")
    sheet.sort(key=lambda r: -r[4])
    data = xlsx.write([("Dues", head + sheet), ("Statements", ledger)])
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="VTC_client_dues_{db.today()}.xlsx"'})


# ------------------------------------------------------------------ the screens

app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})
