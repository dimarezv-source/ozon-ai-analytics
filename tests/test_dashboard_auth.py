import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


@pytest.fixture(autouse=True)
def clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_dashboard_requires_configured_authentication(monkeypatch) -> None:
    monkeypatch.setenv("DASHBOARD_USERNAME", "")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "")

    response = TestClient(app).get("/dashboard")

    assert response.status_code == 503
    assert "authentication is not configured" in response.json()["detail"].lower()


def test_dashboard_rejects_invalid_basic_auth(monkeypatch) -> None:
    monkeypatch.setenv("DASHBOARD_USERNAME", "owner")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "test-password")

    response = TestClient(app).get("/dashboard", auth=("intruder", "wrong-password"))

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Basic"


def test_dashboard_serves_html_after_basic_auth(monkeypatch) -> None:
    monkeypatch.setenv("DASHBOARD_USERNAME", "owner")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "test-password")

    response = TestClient(app).get("/dashboard", auth=("owner", "test-password"))

    assert response.status_code == 200
    assert "OZON AI ANALYTICS" in response.text


def test_live_api_rejects_missing_auth_before_calling_ozon(monkeypatch) -> None:
    monkeypatch.setenv("DASHBOARD_USERNAME", "owner")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "test-password")

    response = TestClient(app).get("/api/dashboard")

    assert response.status_code == 401
