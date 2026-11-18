"""Password hashing and authenticated encryption for tenant credentials."""
import base64
import hashlib
import hmac
import os

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

_PASSWORD_ITERATIONS = 600_000

def hash_password(password: str) -> str:
    if len(password) < 12:
        raise ValueError("Password must contain at least 12 characters.")
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PASSWORD_ITERATIONS)
    return "$".join(["pbkdf2_sha256", str(_PASSWORD_ITERATIONS), base64.urlsafe_b64encode(salt).decode("ascii"), base64.urlsafe_b64encode(digest).decode("ascii")])

def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_text.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_text.encode("ascii"))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False

def _fernet() -> Fernet:
    key = get_settings().ozon_credentials_encryption_key
    if not key:
        raise RuntimeError("OZON_CREDENTIALS_ENCRYPTION_KEY is not configured.")
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeEncodeError):
        raise RuntimeError("OZON_CREDENTIALS_ENCRYPTION_KEY is invalid.") from None

def encrypt_ozon_secret(value: str) -> str:
    if not value:
        raise ValueError("Credential value cannot be empty.")
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")

def decrypt_ozon_secret(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeEncodeError):
        raise ValueError("Stored Ozon credential could not be decrypted.") from None
