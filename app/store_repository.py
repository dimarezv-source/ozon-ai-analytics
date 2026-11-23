"""Tenant-scoped Ozon store credential persistence.

Encrypted API keys are only returned to trusted server-side callers after an
active membership check. HTTP handlers must never serialize the credential value.
"""
from __future__ import annotations

from uuid import UUID, uuid4

from app.persistence import _connect
from app.security import encrypt_ozon_api_key, decrypt_ozon_api_key


class StoreAccessDenied(RuntimeError):
    """Raised when a user has no permitted access to a tenant store."""


def create_store(user_id: str, tenant_id: str, name: str, client_id: str, api_key: str) -> dict:
    try:
        user_uuid, tenant_uuid = UUID(user_id), UUID(tenant_id)
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Invalid user or tenant identifier.") from None
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 160:
        raise ValueError("Store name must contain between 1 and 160 characters.")
    if not isinstance(client_id, str) or not 1 <= len(client_id.strip()) <= 64:
        raise ValueError("Invalid Ozon Client ID.")
    ciphertext = encrypt_ozon_api_key(api_key)
    store_id = uuid4()
    with _connect() as connection:
        row = connection.execute(
            """
            INSERT INTO ozon_stores
                (id, tenant_id, name, client_id, api_key_ciphertext, credential_key_version)
            SELECT %s, m.tenant_id, %s, %s, %s, 1
            FROM tenant_memberships m
            JOIN users u ON u.id = m.user_id
            WHERE m.user_id = %s AND m.tenant_id = %s
              AND m.role IN ('owner', 'admin') AND u.is_active = TRUE
            RETURNING id::text AS store_id
            """,
            (store_id, name.strip(), client_id.strip(), ciphertext, user_uuid, tenant_uuid),
        ).fetchone()
    if row is None:
        raise StoreAccessDenied("Store creation requires an active owner or admin membership.")
    return {"store_id": row["store_id"], "name": name.strip(), "client_id": client_id.strip()}


def list_stores(user_id: str, tenant_id: str) -> list[dict]:
    try:
        user_uuid, tenant_uuid = UUID(user_id), UUID(tenant_id)
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Invalid user or tenant identifier.") from None
    with _connect() as connection:
        rows = connection.execute(
            """
            SELECT s.id::text AS store_id, s.name, s.client_id, s.is_active,
                   s.created_at, s.updated_at
            FROM ozon_stores s
            JOIN tenant_memberships m ON m.tenant_id = s.tenant_id
            JOIN users u ON u.id = m.user_id
            WHERE m.user_id = %s AND m.tenant_id = %s
              AND u.is_active = TRUE
            ORDER BY s.created_at, s.id
            """,
            (user_uuid, tenant_uuid),
        ).fetchall()
    return [
        {
            "store_id": row["store_id"],
            "name": row["name"],
            "client_id": row["client_id"],
            "is_active": row["is_active"],
            "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
            "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
        }
        for row in rows
    ]


def get_store_credentials(user_id: str, tenant_id: str, store_id: str) -> dict:
    """Return credentials to internal server code only; never expose this result via API."""
    try:
        user_uuid, tenant_uuid, store_uuid = UUID(user_id), UUID(tenant_id), UUID(store_id)
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Invalid user, tenant, or store identifier.") from None
    with _connect() as connection:
        row = connection.execute(
            """
            SELECT s.id::text AS store_id, s.name, s.client_id,
                   s.api_key_ciphertext, s.credential_key_version
            FROM ozon_stores s
            JOIN tenant_memberships m ON m.tenant_id = s.tenant_id
            JOIN users u ON u.id = m.user_id
            WHERE s.id = %s AND s.tenant_id = %s
              AND m.user_id = %s AND m.tenant_id = %s
              AND s.is_active = TRUE AND u.is_active = TRUE
            LIMIT 1
            """,
            (store_uuid, tenant_uuid, user_uuid, tenant_uuid),
        ).fetchone()
    if row is None:
        raise StoreAccessDenied("Active store not found for this tenant membership.")
    return {
        "store_id": row["store_id"],
        "name": row["name"],
        "client_id": row["client_id"],
        "api_key": decrypt_ozon_api_key(row["api_key_ciphertext"]),
    }


def deactivate_store(user_id: str, tenant_id: str, store_id: str) -> bool:
    try:
        user_uuid, tenant_uuid, store_uuid = UUID(user_id), UUID(tenant_id), UUID(store_id)
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Invalid user, tenant, or store identifier.") from None
    with _connect() as connection:
        row = connection.execute(
            """
            UPDATE ozon_stores s SET is_active = FALSE, updated_at = NOW()
            WHERE s.id = %s AND s.tenant_id = %s AND s.is_active = TRUE
              AND EXISTS (
                  SELECT 1 FROM tenant_memberships m
                  JOIN users u ON u.id = m.user_id
                  WHERE m.user_id = %s AND m.tenant_id = %s
                    AND m.role IN ('owner', 'admin') AND u.is_active = TRUE
              )
            RETURNING s.id
            """,
            (store_uuid, tenant_uuid, user_uuid, tenant_uuid),
        ).fetchone()
    return row is not None
