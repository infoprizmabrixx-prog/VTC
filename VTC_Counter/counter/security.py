"""Password / PIN hashing, tokens, input helpers and the standard error."""
import hashlib
import hmac
import math
import re
import secrets

from fastapi import HTTPException

PBKDF2_ROUNDS = 240_000


class Fail(HTTPException):
    """Raise with a stable error code; the UI turns codes into plain language."""

    def __init__(self, code: str, status: int = 400):
        super().__init__(status_code=status, detail=code)


def hash_secret(secret: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", secret.encode(), bytes.fromhex(salt), PBKDF2_ROUNDS).hex()
    return f"{salt}${digest}"


def check_secret(secret: str, stored: str) -> bool:
    try:
        salt, _ = stored.split("$")
    except ValueError:
        return False
    return hmac.compare_digest(hash_secret(secret, salt), stored)


def new_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(48)
    return token, token_hash(token)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# --- validation helpers -----------------------------------------------------

def valid_password(pw: str):
    if len(pw) < 10 or not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        raise Fail("PASSWORD_TOO_WEAK")


def valid_pin(pin: str):
    if not re.fullmatch(r"\d{4,6}", pin or ""):
        raise Fail("PIN_MUST_BE_4_TO_6_DIGITS")
    if len(set(pin)) == 1 or pin in "0123456789" or pin in "9876543210":
        raise Fail("PIN_TOO_SIMPLE")


