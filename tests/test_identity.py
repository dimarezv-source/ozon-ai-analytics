from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app import identity


class FakeResult:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows if rows is not None else ([] if row is None else [row])

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class FakeConnection:
    def __init__(self, results=None):
        self.results = list(results or [])
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, query, params=None):
        self.statements.append((query, params))
        if self.results:
            return self.results.pop(0)
        return FakeResult()


def test_normalize_email_and_reject_invalid_values():
    assert identity.normalize_email("  USER@Example.COM ") == "user@example.com"
    for value in ("", "missing-at", "@host.com", "user@", "x" * 255 + "@a"):
        with pytest.raises(ValueError):
            identity.normalize_email(value)


def test_create_tenant_owner_is_atomic_and_assigns_owner(monkeypatch):
    connection = FakeConnection()
    monkeypatch.setattr(identity, "_connect", lambda: connection)

    created = identity.create_tenant_owner("OWNER@example.com", "$argon2id$hash", "Main shop")

    assert created["email"] == "owner@example.com"
    assert created["role"] == "owner"
    assert len(connection.statements) == 3
    assert "INSERT INTO tenants" in connection.statements[0][0]
    assert "INSERT INTO users" in connection.statements[1][0]
    assert "INSERT INTO tenant_memberships" in connection.statements[2][0]


def test_create_session_requires_membership_and_active_user(monkeypatch):
    session_id = str(uuid4())
    connection = FakeConnection([FakeResult({"session_id": session_id})])
    monkeypatch.setattr(identity, "_connect", lambda: connection)

    result = identity.create_session(
        str(uuid4()), str(uuid4()), b"a" * 32, b"b" * 32,
        datetime.now(timezone.utc) + timedelta(hours=1),
    )

    query = connection.statements[0][0]
    assert result == session_id
    assert "FROM tenant_memberships" in query
    assert "u.is_active = TRUE" in query
    assert "m.user_id = %s AND m.tenant_id = %s" in query


def test_create_session_rejects_non_member(monkeypatch):
    connection = FakeConnection([FakeResult()])
    monkeypatch.setattr(identity, "_connect", lambda: connection)

    with pytest.raises(identity.IdentityNotFound):
        identity.create_session(
            str(uuid4()), str(uuid4()), b"a" * 32, b"b" * 32,
            datetime.now(timezone.utc) + timedelta(hours=1),
        )


def test_load_session_fails_closed_for_expired_revoked_or_inactive(monkeypatch):
    connection = FakeConnection([FakeResult({"session_id": "s1", "role": "owner"})])
    monkeypatch.setattr(identity, "_connect", lambda: connection)

    result = identity.load_session(b"a" * 32)

    query = connection.statements[0][0]
    assert result["role"] == "owner"
    assert "s.expires_at > NOW()" in query
    assert "s.revoked_at IS NULL" in query
    assert "u.is_active = TRUE" in query
    assert "JOIN tenant_memberships" in query


def test_rotation_locks_old_session_revokes_and_links_replacement(monkeypatch):
    old_id, user_id, tenant_id = uuid4(), uuid4(), uuid4()
    connection = FakeConnection([FakeResult({
        "id": old_id, "user_id": user_id, "tenant_id": tenant_id,
    })])
    monkeypatch.setattr(identity, "_connect", lambda: connection)

    identity.rotate_session(
        b"a" * 32, b"b" * 32, b"c" * 32,
        datetime.now(timezone.utc) + timedelta(hours=1),
    )

    assert "FOR UPDATE OF s" in connection.statements[0][0]
    assert "UPDATE user_sessions SET revoked_at = NOW()" in connection.statements[1][0]
    assert "rotated_from" in connection.statements[2][0]


def test_revoke_session_returns_false_for_unknown_token(monkeypatch):
    connection = FakeConnection([FakeResult()])
    monkeypatch.setattr(identity, "_connect", lambda: connection)

    assert identity.revoke_session(b"x" * 32) is False
    assert "revoked_at IS NULL" in connection.statements[0][0]
