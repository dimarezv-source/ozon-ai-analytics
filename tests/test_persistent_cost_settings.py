import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app import main


@pytest.fixture(autouse=True)
def clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def configure_auth(monkeypatch):
    monkeypatch.setenv("DASHBOARD_USERNAME", "owner")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "test-password")


def configure_tenant_session(monkeypatch):
    monkeypatch.setattr(main, "_current_user_session", lambda request: {
        "user_id": "user-1", "tenant_id": "tenant-1", "role": "owner",
        "csrf_token_hash": b"csrf-hash",
    })
    monkeypatch.setattr(main, "_require_csrf", lambda request, session: None)


def test_cost_settings_requires_authentication(monkeypatch):
    configure_auth(monkeypatch)
    response = TestClient(app).get("/api/settings/costs")
    assert response.status_code == 401


def test_cost_settings_reports_missing_database_configuration(monkeypatch):
    configure_auth(monkeypatch)
    configure_tenant_session(monkeypatch)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    response = TestClient(app).get(
        "/api/settings/costs", auth=("owner", "test-password")
    )
    assert response.status_code == 503
    assert "PostgreSQL persistence is not configured" in response.json()["detail"]


def test_cost_settings_rejects_invalid_payload_before_database_access(monkeypatch):
    configure_auth(monkeypatch)
    configure_tenant_session(monkeypatch)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    response = TestClient(app).put(
        "/api/settings/costs",
        auth=("owner", "test-password"),
        json={"costs": []},
    )
    assert response.status_code == 400


def test_cost_settings_rejects_unknown_fields(monkeypatch):
    configure_auth(monkeypatch)
    configure_tenant_session(monkeypatch)
    response = TestClient(app).put(
        "/api/settings/costs",
        auth=("owner", "test-password"),
        json={"costs": {"123": {"secret": "unexpected"}}},
    )
    assert response.status_code == 400


def test_cost_settings_rejects_negative_values(monkeypatch):
    configure_auth(monkeypatch)
    configure_tenant_session(monkeypatch)
    response = TestClient(app).put(
        "/api/settings/costs",
        auth=("owner", "test-password"),
        json={"costs": {"123": {"cost": -1}}},
    )
    assert response.status_code == 400
