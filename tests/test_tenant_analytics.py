from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app import tenant_analytics


def make_request():
    return Request({
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "https",
        "path": "/api/catalog/intelligence",
        "raw_path": b"/api/catalog/intelligence",
        "query_string": b"",
        "headers": [],
        "client": ("testclient", 50000),
        "server": ("testserver", 443),
    })


def install_context_mocks(monkeypatch, credentials=None):
    user_id, tenant_id, store_id = str(uuid4()), str(uuid4()), str(uuid4())
    session = {"user_id": user_id, "tenant_id": tenant_id, "role": "owner"}
    calls = []

    monkeypatch.setattr(tenant_analytics, "_current_user_session", lambda request: session)

    def load_credentials(actual_user_id, actual_tenant_id, actual_store_id):
        calls.append((actual_user_id, actual_tenant_id, actual_store_id))
        return credentials or {
            "store_id": store_id,
            "name": "Primary",
            "client_id": "seller-client",
            "api_key": "server-only-secret",
        }

    monkeypatch.setattr(tenant_analytics, "get_store_credentials", load_credentials)

    class FakeClient:
        def __init__(self, client_id, api_key, base_url):
            self.client_id = client_id
            self.api_key = api_key
            self.base_url = base_url

    monkeypatch.setattr(tenant_analytics, "OzonReadOnlyClient", FakeClient)
    monkeypatch.setattr(
        tenant_analytics,
        "get_settings",
        lambda: SimpleNamespace(ozon_api_base_url="https://api-seller.ozon.ru"),
    )
    return user_id, tenant_id, store_id, calls, FakeClient


def test_context_builds_read_only_client_from_selected_tenant_store(monkeypatch):
    user_id, tenant_id, store_id, calls, fake_client = install_context_mocks(monkeypatch)

    context = tenant_analytics.get_tenant_analytics_context(make_request(), store_id)

    assert (context.user_id, context.tenant_id, context.store_id) == (user_id, tenant_id, store_id)
    assert context.store_name == "Primary"
    assert isinstance(context.client, fake_client)
    assert context.client.client_id == "seller-client"
    assert context.client.api_key == "server-only-secret"
    assert calls == [(user_id, tenant_id, store_id)]
    assert not hasattr(context, "api_key")


def test_context_rejects_missing_user_session(monkeypatch):
    def no_session(request):
        raise HTTPException(status_code=401, detail="Authentication required.")

    monkeypatch.setattr(tenant_analytics, "_current_user_session", no_session)
    monkeypatch.setattr(
        tenant_analytics,
        "get_store_credentials",
        lambda *args: pytest.fail("Store credentials must not be loaded without a session"),
    )

    with pytest.raises(HTTPException) as error:
        tenant_analytics.get_tenant_analytics_context(make_request(), str(uuid4()))

    assert error.value.status_code == 401


def test_context_rejects_store_outside_current_tenant(monkeypatch):
    from app.store_repository import StoreAccessDenied

    install_context_mocks(monkeypatch)

    def denied(*args):
        raise StoreAccessDenied("not accessible")

    monkeypatch.setattr(tenant_analytics, "get_store_credentials", denied)

    with pytest.raises(HTTPException) as error:
        tenant_analytics.get_tenant_analytics_context(make_request(), str(uuid4()))

    assert error.value.status_code == 404


def test_context_fails_closed_when_credential_encryption_is_unavailable(monkeypatch):
    from app.security import CredentialEncryptionNotConfigured

    install_context_mocks(monkeypatch)

    def unavailable(*args):
        raise CredentialEncryptionNotConfigured("encryption unavailable")

    monkeypatch.setattr(tenant_analytics, "get_store_credentials", unavailable)

    with pytest.raises(HTTPException) as error:
        tenant_analytics.get_tenant_analytics_context(make_request(), str(uuid4()))

    assert error.value.status_code == 503
