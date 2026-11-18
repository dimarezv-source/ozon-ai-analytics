from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


def test_dashboard_requires_configured_authentication(monkeypatch) -> None:
    monkeypatch.delenv("DASHBOARD_USERNAME", raising=False)
    monkeypatch.delenv("DASHBOARD_PASSWORD", raising=False)
    get_settings.cache_clear()

    response = TestClient(app).get("/dashboard")

    assert response.status_code == 503
    assert "authentication is not configured" in response.json()["detail"].lower()
    get_settings.cache_clear()


def test_dashboard_rejects_invalid_basic_auth(monkeypatch) -> None:
    monkeypatch.setenv("DASHBOARD_USERNAME", "owner")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "test-password")
    get_settings.cache_clear()

    response = TestClient(app).get("/dashboard", auth=("intruder", "wrong-password"))

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Basic"
    get_settings.cache_clear()


def test_dashboard_serves_html_after_basic_auth(monkeypatch) -> None:
    monkeypatch.setenv("DASHBOARD_USERNAME", "owner")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "test-password")
    get_settings.cache_clear()

    response = TestClient(app).get("/dashboard", auth=("owner", "test-password"))

    assert response.status_code == 200
    assert "OZON AI ANALYTICS" in response.text
    get_settings.cache_clear()


def test_live_api_rejects_missing_auth_before_calling_ozon(monkeypatch) -> None:
    monkeypatch.setenv("DASHBOARD_USERNAME", "owner")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "test-password")
    get_settings.cache_clear()

    response = TestClient(app).get("/api/dashboard")

    assert response.status_code == 401
    get_settings.cache_clear()
