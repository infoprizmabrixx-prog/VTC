"""Put the Owner password back to the temporary one, on the counter PC itself.

Run: python -m counter.reset_owner  (or double-click reset_owner_password.bat).
Only someone at the PC that holds the data folder can run it. The owner must choose a new
password at the next sign-in; old owner sessions are signed out; it is written in the audit log.
"""
from . import db
from .security import hash_secret

TEMP = "VTC-Owner-Demo26"


def main() -> None:
    if not db.DB_PATH.exists():
        print(f"No data yet at {db.DB_PATH}. Start the counter app once first.")
        return
    with db.tx() as c:
        row = c.execute("SELECT id, username FROM users WHERE role='owner'").fetchone()
        if not row:
            print("No owner account found.")
            return
        c.execute("UPDATE users SET secret_hash=?, must_change=1, failed=0, locked_until=NULL, active=1 WHERE id=?", (hash_secret(TEMP), row["id"]))
        c.execute("DELETE FROM sessions WHERE user_id=?", (row["id"],))
        db.audit(c, row["id"], "OWNER_PASSWORD_RESET_ON_PC", f"user:{row['id']}")
    print(f"Owner sign-in reset.  Username: {row['username']}   Temporary password: {TEMP}")
    print("Sign in now and choose a new password.")


if __name__ == "__main__":
    main()
