import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


@pytest.fixture(autouse=True)
def clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_sales_endpoint_returns_sku_level_breakdown(monkeypatch) -> None:
    monkeypatch.setenv("DASHBOARD_USERNAME", "owner")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "test-password")
    monkeypatch.setenv("OZON_CLIENT_ID", "client")
    monkeypatch.setenv("OZON_API_KEY", "read-only-key")

    class FakeOzonClient:
        def __init__(self, client_id, api_key, base_url):
            assert client_id == "client"
            assert api_key == "read-only-key"

        async def execute(self, operation, payload):
            if operation == "posting_fbo_list":
                return {
                    "result": {
                        "postings": [{
                            "posting_number": "FBO-1",
                            "status": "delivered",
                            "products": [{
                                "sku": 123,
                                "product_id": 456,
                                "offer_id": "offer-1",
                                "name": "Test product",
                                "quantity": 2,
                                "price": "100.50",
                            }],
                        }],
                        "has_next": False,
                    }
                }
            return {"result": {"postings": [], "has_next": False}}

    monkeypatch.setattr("app.main.OzonReadOnlyClient", FakeOzonClient)
    response = TestClient(app).get(
        "/api/sales?date_from=2026-11-01&date_to=2026-11-18",
        auth=("owner", "test-password"),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["sales_gmv"] == 201.0
    assert data["delivered_units"] == 2
    assert data["products"] == [{
        "sku": "123",
        "product_id": "456",
        "offer_id": "offer-1",
        "name": "Test product",
        "units": 2,
        "sales_gmv": 201.0,
        "unpriced_units": 0,
    }]


def test_sales_endpoint_rejects_reversed_dates(monkeypatch) -> None:
    monkeypatch.setenv("DASHBOARD_USERNAME", "owner")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "test-password")

    response = TestClient(app).get(
        "/api/sales?date_from=2026-11-18&date_to=2026-11-01",
        auth=("owner", "test-password"),
    )

    assert response.status_code == 400
