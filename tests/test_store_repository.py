from uuid import uuid4

import pytest

from app import store_repository


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
        return self.results.pop(0) if self.results else FakeResult()


def test_create_store_encrypts_before_persisting_and_requires_admin(monkeypatch):
    connection = FakeConnection([FakeResult({"store_id": str(uuid4())})])
    monkeypatch.setattr(store_repository, "_connect", lambda: connection)
    monkeypatch.setattr(store_repository, "encrypt_ozon_api_key", lambda value: b"encrypted-value")
    api_key = "never-store-this-plaintext"

    created = store_repository.create_store(
        str(uuid4()), str(uuid4()), "Primary shop", "123456", api_key,
    )

    query, params = connection.statements[0]
    assert created["name"] == "Primary shop"
    assert "m.role IN ('owner', 'admin')" in query
    assert b"encrypted-value" in params
    assert api_key not in params


def test_create_store_rejects_non_admin_membership(monkeypatch):
    connection = FakeConnection([FakeResult()])
    monkeypatch.setattr(store_repository, "_connect", lambda: connection)
    monkeypatch.setattr(store_repository, "encrypt_ozon_api_key", lambda value: b"encrypted")

    with pytest.raises(store_repository.StoreAccessDenied):
        store_repository.create_store(
            str(uuid4()), str(uuid4()), "Shop", "123", "api-secret",
        )


def test_list_stores_is_tenant_scoped_and_never_selects_secret(monkeypatch):
    connection = FakeConnection([FakeResult(rows=[{
        "store_id": str(uuid4()), "name": "Shop", "client_id": "123",
        "is_active": True, "created_at": None, "updated_at": None,
    }])])
    monkeypatch.setattr(store_repository, "_connect", lambda: connection)

    stores = store_repository.list_stores(str(uuid4()), str(uuid4()))

    query, params = connection.statements[0]
    assert len(stores) == 1
    assert "m.user_id = %s AND m.tenant_id = %s" in query
    assert "api_key_ciphertext" not in query
    assert "password_hash" not in query


def test_get_store_credentials_requires_same_tenant_membership_and_decrypts(monkeypatch):
    connection = FakeConnection([FakeResult(row={
        "store_id": str(uuid4()), "name": "Shop", "client_id": "123",
        "api_key_ciphertext": b"ciphertext", "credential_key_version": 1,
    })])
    monkeypatch.setattr(store_repository, "_connect", lambda: connection)
    monkeypatch.setattr(store_repository, "decrypt_ozon_api_key", lambda value: "secret-api-key")

    result = store_repository.get_store_credentials(str(uuid4()), str(uuid4()), str(uuid4()))

    query = connection.statements[0][0]
    assert result["api_key"] == "secret-api-key"
    assert "s.id = %s AND s.tenant_id = %s" in query
    assert "m.user_id = %s AND m.tenant_id = %s" in query
    assert "s.is_active = TRUE AND u.is_active = TRUE" in query


def test_get_store_credentials_fails_closed_when_membership_missing(monkeypatch):
    connection = FakeConnection([FakeResult()])
    monkeypatch.setattr(store_repository, "_connect", lambda: connection)

    with pytest.raises(store_repository.StoreAccessDenied):
        store_repository.get_store_credentials(str(uuid4()), str(uuid4()), str(uuid4()))


def test_deactivate_store_requires_owner_or_admin(monkeypatch):
    connection = FakeConnection([FakeResult(row={"id": uuid4()})])
    monkeypatch.setattr(store_repository, "_connect", lambda: connection)

    assert store_repository.deactivate_store(str(uuid4()), str(uuid4()), str(uuid4()))
    query = connection.statements[0][0]
    assert "m.role IN ('owner', 'admin')" in query
    assert "s.tenant_id = %s" in query
