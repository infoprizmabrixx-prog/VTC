#!/usr/bin/env python3
"""One-off migration tool: VTC v1.6 SQLite -> VTC v2 MySQL 8.0.

Implements 11_DEPLOYMENT_AND_OPERATIONS.md §6:
1. Reads table & column specifications from backend/src/main/resources/generated/V1__baseline_column_map.json.
2. Disables FOREIGN_KEY_CHECKS during bulk copy, copies every table (except `sessions`, which starts fresh).
3. Converts ISO-8601 timestamps to UTC DATETIME(6), rounds REAL to DECIMAL(p,s) using ROUND_HALF_EVEN,
   normalizes boolean flags to 0/1, lets `roast_inputs` and `blend_inputs` auto-number `id`,
   and resets AUTO_INCREMENT to MAX(id)+1.
4. Re-enables FOREIGN_KEY_CHECKS, optionally copies `data/files/*`, and prints the full verification report
   (row counts per table, per-lot SUM(delta_kg) parity, per-invoice paid totals, meta.schema_version = 3).
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_EVEN
import json
from pathlib import Path
import re
import shutil
import sqlite3
import sys
from typing import Any

try:
    import pymysql
except ImportError:
    pymysql = None  # type: ignore


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_COL_MAP = ROOT / "backend" / "src" / "main" / "resources" / "generated" / "V1__baseline_column_map.json"
DECIMAL_RE = re.compile(r"DECIMAL\(\s*(\d+)\s*,\s*(\d+)\s*\)", re.IGNORECASE)
AUTO_ID_TABLES = {"roast_inputs", "blend_inputs"}
SKIP_TABLES = {"sessions"}
GENERATED_COLS = {("masters", "bean_code_key")}


def parse_utc_datetime(val: Any) -> str | None:
    if val is None or str(val).strip() == "":
        return None
    s = str(val).strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt.strftime("%Y-%m-%d %H:%M:%S.%f")
    except ValueError:
        return s[:26]


def convert_value(val: Any, mysql_type: str) -> Any:
    if val is None:
        return None
    ut = mysql_type.upper()
    if ut.startswith("DATETIME"):
        return parse_utc_datetime(val)
    if ut == "DATE":
        s = str(val).strip()
        return s[:10] if s else None
    if ut.startswith("DECIMAL"):
        m = DECIMAL_RE.match(ut)
        scale = int(m.group(2)) if m else 3
        q = Decimal("10") ** (-scale)
        return str(Decimal(str(val)).quantize(q, rounding=ROUND_HALF_EVEN))
    if ut.startswith("TINYINT(1)"):
        if isinstance(val, bool):
            return 1 if val else 0
        try:
            return 1 if int(val) != 0 else 0
        except (ValueError, TypeError):
            return 1 if str(val).strip().lower() in ("true", "1", "yes") else 0
    if ut in ("BIGINT", "INT", "INTEGER", "SMALLINT"):
        if str(val).strip() == "":
            return None
        return int(val)
    return val


def load_table_specs(col_map_path: Path) -> dict[str, list[dict[str, Any]]]:
    entries = json.loads(col_map_path.read_text(encoding="utf-8"))
    tables: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        t = entry["table"]
        c = entry["column"]
        if (t, c) in GENERATED_COLS:
            continue
        tables.setdefault(t, []).append(entry)
    return tables


def migrate(
    sqlite_path: Path,
    mysql_host: str,
    mysql_port: int,
    mysql_user: str,
    mysql_password: str,
    mysql_db: str,
    col_map_path: Path = DEFAULT_COL_MAP,
    files_src: Path | None = None,
    files_dst: Path | None = None,
) -> bool:
    if pymysql is None:
        raise RuntimeError("PyMySQL is required (`pip install pymysql`) to run migrate_sqlite_to_mysql.py")

    tables = load_table_specs(col_map_path)
    s_conn = sqlite3.connect(str(sqlite_path))
    s_conn.row_factory = sqlite3.Row
    m_conn = pymysql.connect(
        host=mysql_host,
        port=mysql_port,
        user=mysql_user,
        password=mysql_password,
        database=mysql_db,
        charset="utf8mb4",
        autocommit=False,
    )

    try:
        with m_conn.cursor() as cur:
            cur.execute("SET FOREIGN_KEY_CHECKS=0")
            cur.execute("SET time_zone='+00:00'")

            for table, cols in tables.items():
                cur.execute(f"TRUNCATE TABLE `{table}`")
                if table in SKIP_TABLES:
                    continue

                sqlite_cols = [r["name"] for r in s_conn.execute(f"PRAGMA table_info(`{table}`)").fetchall()]
                active_cols = [
                    c for c in cols
                    if c["column"] in sqlite_cols and not (table in AUTO_ID_TABLES and c["column"] == "id")
                ]
                if not active_cols:
                    continue

                col_names_sql = ", ".join(f"`{c['column']}`" for c in active_cols)
                placeholders = ", ".join(["%s"] * len(active_cols))
                insert_sql = f"INSERT INTO `{table}` ({col_names_sql}) VALUES ({placeholders})"

                select_cols_sql = ", ".join(f"`{c['column']}`" for c in active_cols)
                rows = s_conn.execute(f"SELECT {select_cols_sql} FROM `{table}`").fetchall()
                batch = [
                    tuple(convert_value(row[c["column"]], c["mysql"]) for c in active_cols)
                    for row in rows
                ]
                if batch:
                    cur.executemany(insert_sql, batch)

                has_id_pk = any(c["column"] == "id" and c["pk"] for c in cols)
                if has_id_pk:
                    cur.execute(f"SELECT COALESCE(MAX(`id`), 0) + 1 FROM `{table}`")
                    next_id = int(cur.fetchone()[0])
                    cur.execute(f"ALTER TABLE `{table}` AUTO_INCREMENT = {next_id}")

            cur.execute("SET FOREIGN_KEY_CHECKS=1")
        m_conn.commit()

        if files_src and files_dst and files_src.is_dir():
            files_dst.mkdir(parents=True, exist_ok=True)
            for item in files_src.iterdir():
                if item.is_file():
                    shutil.copy2(item, files_dst / item.name)

        return verify_migration(s_conn, m_conn, tables)
    finally:
        s_conn.close()
        m_conn.close()


def verify_migration(s_conn: sqlite3.Connection, m_conn: Any, tables: dict[str, list[dict[str, Any]]]) -> bool:
    ok = True
    print("=== VTC SQLite -> MySQL Migration Verification Report ===")
    with m_conn.cursor() as cur:
        for table in tables:
            s_cnt = s_conn.execute(f"SELECT COUNT(*) FROM `{table}`").fetchone()[0]
            cur.execute(f"SELECT COUNT(*) FROM `{table}`")
            m_cnt = cur.fetchone()[0]
            expected = 0 if table in SKIP_TABLES else s_cnt
            if m_cnt != expected:
                print(f"[FAIL] Table `{table}` row count mismatch: SQLite={s_cnt}, MySQL={m_cnt} (expected {expected})")
                ok = False
            else:
                print(f"[ OK ] Table `{table}`: {m_cnt} rows")

        # Lot ledger balance parity
        s_lots = {
            r[0]: float(r[1] or 0.0)
            for r in s_conn.execute("SELECT lot_id, COALESCE(SUM(delta_kg), 0) FROM movements GROUP BY lot_id")
        }
        cur.execute("SELECT lot_id, COALESCE(SUM(delta_kg), 0) FROM movements GROUP BY lot_id")
        m_lots = {r[0]: float(r[1] or 0.0) for r in cur.fetchall()}
        for lid, s_kg in s_lots.items():
            m_kg = m_lots.get(lid, 0.0)
            if abs(s_kg - m_kg) > 0.001:
                print(f"[FAIL] Lot #{lid} balance mismatch: SQLite={s_kg:.3f}, MySQL={m_kg:.3f}")
                ok = False
        print(f"[ OK ] Checked {len(s_lots)} lot movement balances (tolerance <= 0.001 kg)")

        # Invoice paid totals parity
        s_inv = {
            r[0]: int(r[1] or 0)
            for r in s_conn.execute(
                "SELECT invoice_id, COALESCE(SUM(amount_paise), 0) FROM collections WHERE state='VERIFIED' GROUP BY invoice_id"
            )
        }
        cur.execute(
            "SELECT invoice_id, COALESCE(SUM(amount_paise), 0) FROM collections WHERE state='VERIFIED' GROUP BY invoice_id"
        )
        m_inv = {r[0]: int(r[1] or 0) for r in cur.fetchall()}
        if s_inv != m_inv:
            print(f"[FAIL] Verified invoice collections mismatch: SQLite={s_inv} vs MySQL={m_inv}")
            ok = False
        else:
            print(f"[ OK ] Verified collections match across {len(s_inv)} invoices")

        # Schema version check
        cur.execute("SELECT value FROM meta WHERE `key`='schema_version'")
        row = cur.fetchone()
        ver = str(row[0]) if row else None
        if ver != "3":
            print(f"[FAIL] meta.schema_version is {ver!r}, expected '3'")
            ok = False
        else:
            print("[ OK ] meta.schema_version = 3")

    print("=== Verification Result:", "PASSED" if ok else "FAILED", "===")
    return ok


def main() -> int:
    ap = argparse.ArgumentParser(description="Migrate VTC v1.6 SQLite database to VTC v2 MySQL 8.0")
    ap.add_argument("--sqlite", required=True, type=Path, help="Path to v1.6 vtc_portal.sqlite3")
    ap.add_argument("--mysql-host", default="127.0.0.1")
    ap.add_argument("--mysql-port", type=int, default=3306)
    ap.add_argument("--mysql-user", default="vtc_app")
    ap.add_argument("--mysql-password", default="vtc_secret")
    ap.add_argument("--mysql-db", default="vtc_portal")
    ap.add_argument("--col-map", type=Path, default=DEFAULT_COL_MAP)
    ap.add_argument("--files-src", type=Path, default=None, help="Optional v1.6 data/files directory")
    ap.add_argument("--files-dst", type=Path, default=None, help="Optional v2 data/files directory")
    args = ap.parse_args()

    passed = migrate(
        sqlite_path=args.sqlite,
        mysql_host=args.mysql_host,
        mysql_port=args.mysql_port,
        mysql_user=args.mysql_user,
        mysql_password=args.mysql_password,
        mysql_db=args.mysql_db,
        col_map_path=args.col_map,
        files_src=args.files_src,
        files_dst=args.files_dst,
    )
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
