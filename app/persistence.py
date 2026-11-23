"""Persistent, per-dashboard-user storage for product cost assumptions."""
from __future__ import annotations

from app.config import get_settings
from app.persistence_schema import migrate_tenant_foundation
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


class PersistenceNotConfigured(RuntimeError):
    """Raised when no PostgreSQL connection has been configured."""


def _database_url() -> str:
    value = (get_settings().database_url or "").strip()
    if not value:
        raise PersistenceNotConfigured("DATABASE_URL is not configured.")
    # Render may provide postgres:// while psycopg accepts both schemes.
    return value


def _connect():
    return psycopg.connect(_database_url(), row_factory=dict_row, connect_timeout=5)


def _ensure_schema(connection) -> None:
    migrate_tenant_foundation(connection)
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS dashboard_cost_settings (
            tenant_id TEXT PRIMARY KEY,
            costs JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )


def load_cost_settings(tenant_id: str) -> dict[str, Any]:
    with _connect() as connection:
        _ensure_schema(connection)
        row = connection.execute(
            "SELECT costs, updated_at FROM dashboard_cost_settings WHERE tenant_id = %s",
            (tenant_id,),
        ).fetchone()
        if row is None:
            return {"costs": {}, "updated_at": None}
        return {"costs": row["costs"] or {}, "updated_at": row["updated_at"].isoformat()}


def save_cost_settings(tenant_id: str, costs: dict[str, Any]) -> dict[str, Any]:
    with _connect() as connection:
        _ensure_schema(connection)
        row = connection.execute(
            """
            INSERT INTO dashboard_cost_settings (tenant_id, costs, updated_at)
            VALUES (%s, %s, NOW())
            ON CONFLICT (tenant_id) DO UPDATE
                SET costs = EXCLUDED.costs, updated_at = NOW()
            RETURNING costs, updated_at
            """,
            (tenant_id, Jsonb(costs)),
        ).fetchone()
        return {"costs": row["costs"], "updated_at": row["updated_at"].isoformat()}
