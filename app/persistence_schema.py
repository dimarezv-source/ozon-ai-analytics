"""Additive PostgreSQL schema foundation for multi-tenant accounts and stores."""
from __future__ import annotations

TENANT_SCHEMA_STATEMENTS = (
"""CREATE TABLE IF NOT EXISTS tenants (id UUID PRIMARY KEY, name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""",
"""CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""",
"""CREATE TABLE IF NOT EXISTS tenant_memberships (tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK (role IN ('owner','admin','analyst','viewer')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (tenant_id,user_id))""",
"""CREATE TABLE IF NOT EXISTS ozon_stores (id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160), client_id TEXT NOT NULL, api_key_ciphertext BYTEA NOT NULL, credential_key_version SMALLINT NOT NULL DEFAULT 1, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (tenant_id,name))""",
"""CREATE TABLE IF NOT EXISTS user_sessions (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, token_hash BYTEA NOT NULL UNIQUE, csrf_token_hash BYTEA NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), rotated_from UUID REFERENCES user_sessions(id) ON DELETE SET NULL, revoked_at TIMESTAMPTZ)""",
"CREATE INDEX IF NOT EXISTS idx_memberships_user ON tenant_memberships(user_id)",
"CREATE INDEX IF NOT EXISTS idx_stores_tenant ON ozon_stores(tenant_id)",
"CREATE INDEX IF NOT EXISTS idx_sessions_user_tenant ON user_sessions(user_id,tenant_id)",
"CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON user_sessions(expires_at)",
)

def migrate_tenant_foundation(connection) -> None:
    """Run idempotent additive schema statements in the caller transaction."""
    for statement in TENANT_SCHEMA_STATEMENTS:
        connection.execute(statement)
