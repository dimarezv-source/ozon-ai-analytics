"""Password and opaque session-token primitives for per-user authentication.

These helpers are deliberately independent of HTTP routes and persistence so they
can be tested before the new authentication flow is enabled in production.
"""
from __future__ import annotations

import secrets

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_password_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=2,
    hash_len=32,
    salt_len=16,
    type=Type.ID,
)


def hash_password(password: str) -> str:
    """Hash a user password with Argon2id; never store the plaintext password."""
    if not isinstance(password, str) or not 12 <= len(password) <= 1024:
        raise ValueError("Password must contain between 12 and 1024 characters.")
    return _password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """Verify a password without leaking malformed hashes or mismatch details."""
    if not isinstance(password_hash, str) or not isinstance(password, str):
        return False
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError, ValueError):
        return False


def password_hash_needs_upgrade(password_hash: str) -> bool:
    if not isinstance(password_hash, str):
        return False
    try:
        return _password_hasher.check_needs_rehash(password_hash)
    except (VerificationError, InvalidHashError, ValueError):
        return False


def new_session_token() -> str:
    """Return a high-entropy opaque bearer token; persist only its hash."""
    return secrets.token_urlsafe(48)


def new_csrf_token() -> str:
    """Return a high-entropy CSRF token; persist only its hash."""
    return secrets.token_urlsafe(32)
