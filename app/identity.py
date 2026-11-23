"""Database-backed identity and session operations.

All tenant selection is derived from an authenticated membership. Callers never
supply a tenant identifier to a data query on behalf of an untrusted browser.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from app.persistence import _connect


class IdentityNotFound(RuntimeError):
    """Raised when a user or active tenant membership does not exist."""


def normalize_email(email: str) -> str:
    if not isinstance(email, str):
        raise ValueError("A valid email address is required.")
    value = email.strip().casefold()
    if len(value) > 254 or len(value) < 5 or "@" not in value or value.startswith("@") or value.endswith("@"):
        raise ValueError("A valid email address is required.")
    return value


def create_tenant_owner(email: str, password_hash: str, tenant_name: str) -> dict:
    """Atomically create the first user, tenant, and owner membership."""
    normalized_email = normalize_email(email)
    if not isinstance(password_hash, str) or not password_hash.startswith("$argon2id$") or len(password_hash) > 512:
        raise ValueError("A valid Argon2id password hash is required.")
    if not isinstance(tenant_name, str) or not 1 <= len(tenant_name.strip()) <= 160:
        raise ValueError("Tenant name must contain between 1 and 160 characters.")

    user_id, tenant_id = uuid4(), uuid4()
    with _connect() as connection:
        connection.execute(
            "INSERT INTO tenants (id, name) VALUES (%s, %s)",
            (tenant_id, tenant_name.strip()),
        )
        connection.execute(
            "INSERT INTO users (id, email, password_hash) VALUES (%s, %s, %s)",
            (user_id, normalized_email, password_hash),
        )
        connection.execute(
            "INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES (%s, %s, 'owner')",
            (tenant_id, user_id),
        )
    return {"user_id": str(user_id), "tenant_id": str(tenant_id), "email": normalized_email, "role": "owner"}


def get_user_for_login(email: str) -> dict | None:
    """Load an active account and its memberships for login/tenant selection."""
    normalized_email = normalize_email(email)
    with _connect() as connection:
        rows = connection.execute(
            """
            SELECT u.id::text AS user_id, u.email, u.password_hash, u.is_active,
                   t.id::text AS tenant_id, t.name AS tenant_name, m.role
            FROM users u
            JOIN tenant_memberships m ON m.user_id = u.id
            JOIN tenants t ON t.id = m.tenant_id
            WHERE u.email = %s AND u.is_active = TRUE
            ORDER BY t.created_at, t.id
            """,
            (normalized_email,),
        ).fetchall()
    if not rows:
        return None
    first = rows[0]
    return {
        "user_id": first["user_id"],
        "email": first["email"],
        "password_hash": first["password_hash"],
        "memberships": [
            {"tenant_id": row["tenant_id"], "tenant_name": row["tenant_name"], "role": row["role"]}
            for row in rows
        ],
    }


def create_session(
    user_id: str,
    tenant_id: str,
    token_hash: bytes,
    csrf_token_hash: bytes,
    expires_at: datetime,
) -> str:
    """Create a session only when the user is active and has the requested membership."""
    try:
        user_uuid, tenant_uuid = UUID(user_id), UUID(tenant_id)
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Invalid user or tenant identifier.") from None
    if not isinstance(token_hash, bytes) or len(token_hash) != 32:
        raise ValueError("Session token hash must be a SHA-256 digest.")
    if not isinstance(csrf_token_hash, bytes) or len(csrf_token_hash) != 32:
        raise ValueError("CSRF token hash must be a SHA-256 digest.")
    if not isinstance(expires_at, datetime) or expires_at.tzinfo is None or expires_at <= datetime.now(timezone.utc):
        raise ValueError("Session expiry must be a future timezone-aware datetime.")

    session_id = uuid4()
    with _connect() as connection:
        row = connection.execute(
            """
            INSERT INTO user_sessions (id, user_id, tenant_id, token_hash, csrf_token_hash, expires_at)
            SELECT %s, m.user_id, m.tenant_id, %s, %s, %s
            FROM tenant_memberships m
            JOIN users u ON u.id = m.user_id
            WHERE m.user_id = %s AND m.tenant_id = %s AND u.is_active = TRUE
            RETURNING id::text AS session_id
            """,
            (session_id, token_hash, csrf_token_hash, expires_at, user_uuid, tenant_uuid),
        ).fetchone()
    if row is None:
        raise IdentityNotFound("No active membership for this user and tenant.")
    return row["session_id"]


def load_session(token_hash: bytes) -> dict | None:
    """Resolve a live session and its membership; revoked/expired/disabled sessions fail closed."""
    if not isinstance(token_hash, bytes) or len(token_hash) != 32:
        return None
    with _connect() as connection:
        row = connection.execute(
            """
            SELECT s.id::text AS session_id, s.user_id::text AS user_id,
                   s.tenant_id::text AS tenant_id, s.csrf_token_hash,
                   u.email, m.role, t.name AS tenant_name
            FROM user_sessions s
            JOIN users u ON u.id = s.user_id
            JOIN tenant_memberships m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id
            JOIN tenants t ON t.id = s.tenant_id
            WHERE s.token_hash = %s
              AND s.expires_at > NOW()
              AND s.revoked_at IS NULL
              AND u.is_active = TRUE
            LIMIT 1
            """,
            (token_hash,),
        ).fetchone()
    return dict(row) if row else None


def rotate_session(
    old_token_hash: bytes,
    new_token_hash: bytes,
    new_csrf_token_hash: bytes,
    expires_at: datetime,
) -> str:
    """Atomically revoke a live session and replace it for the same user/tenant."""
    for value, label in ((old_token_hash, "old session"), (new_token_hash, "new session"), (new_csrf_token_hash, "CSRF")):
        if not isinstance(value, bytes) or len(value) != 32:
            raise ValueError(f"{label} token hash must be a SHA-256 digest.")
    if not isinstance(expires_at, datetime) or expires_at.tzinfo is None or expires_at <= datetime.now(timezone.utc):
        raise ValueError("Session expiry must be a future timezone-aware datetime.")

    new_session_id = uuid4()
    with _connect() as connection:
        old = connection.execute(
            """
            SELECT s.id, s.user_id, s.tenant_id
            FROM user_sessions s
            JOIN users u ON u.id = s.user_id
            JOIN tenant_memberships m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id
            WHERE s.token_hash = %s AND s.expires_at > NOW()
              AND s.revoked_at IS NULL AND u.is_active = TRUE
            FOR UPDATE OF s
            """,
            (old_token_hash,),
        ).fetchone()
        if old is None:
            raise IdentityNotFound("Active session not found.")
        connection.execute(
            "UPDATE user_sessions SET revoked_at = NOW() WHERE id = %s AND revoked_at IS NULL",
            (old["id"],),
        )
        connection.execute(
            """
            INSERT INTO user_sessions
                (id, user_id, tenant_id, token_hash, csrf_token_hash, expires_at, rotated_from)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (new_session_id, old["user_id"], old["tenant_id"], new_token_hash, new_csrf_token_hash, expires_at, old["id"]),
        )
    return str(new_session_id)


def revoke_session(token_hash: bytes) -> bool:
    if not isinstance(token_hash, bytes) or len(token_hash) != 32:
        return False
    with _connect() as connection:
        row = connection.execute(
            """
            UPDATE user_sessions SET revoked_at = NOW()
            WHERE token_hash = %s AND revoked_at IS NULL
            RETURNING id
            """,
            (token_hash,),
        ).fetchone()
    return row is not None


def create_first_tenant_owner(email: str, password_hash: str, tenant_name: str) -> dict:
    """Create the initial owner exactly once, guarded by a transaction-scoped lock."""
    normalized_email = normalize_email(email)
    if not isinstance(password_hash, str) or not password_hash.startswith("$argon2id$") or len(password_hash) > 512:
        raise ValueError("A valid Argon2id password hash is required.")
    if not isinstance(tenant_name, str) or not 1 <= len(tenant_name.strip()) <= 160:
        raise ValueError("Tenant name must contain between 1 and 160 characters.")
    user_id, tenant_id = uuid4(), uuid4()
    with _connect() as connection:
        connection.execute("SELECT pg_advisory_xact_lock(741920261)")
        exists = connection.execute("SELECT EXISTS(SELECT 1 FROM users) AS has_users").fetchone()
        if exists and exists["has_users"]:
            raise RuntimeError("Account system already initialized.")
        connection.execute("INSERT INTO tenants (id, name) VALUES (%s, %s)", (tenant_id, tenant_name.strip()))
        connection.execute("INSERT INTO users (id, email, password_hash) VALUES (%s, %s, %s)", (user_id, normalized_email, password_hash))
        connection.execute("INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES (%s, %s, 'owner')", (tenant_id, user_id))
    return {"user_id": str(user_id), "tenant_id": str(tenant_id), "email": normalized_email, "role": "owner"}
