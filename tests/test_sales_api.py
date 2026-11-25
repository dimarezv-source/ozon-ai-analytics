import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app import tenant_analytics


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
            schema = "FBO" if operation == "posting_fbo_list" else "FBS"
            quantity = 2 if schema == "FBO" else 3
            return {
                "result": {
                    "postings": [{
                        "posting_number": f"{schema}-1",
                        "status": "delivered",
                        "products": [{
                            "sku": 123,
                            "product_id": 456,
                            "offer_id": "offer-1",
                            "name": "Test product",
                            "quantity": quantity,
                            "price": "100.50",
                        }],
                    }],
                    "has_next": False,
                }
            }

    monkeypatch.setattr(tenant_analytics, "_current_user_session", lambda request: {
        "user_id": "user-1", "tenant_id": "tenant-1", "role": "owner"
    })
    monkeypatch.setattr(tenant_analytics, "get_store_credentials", lambda user_id, tenant_id, store_id: {
        "store_id": store_id, "name": "Primary", "client_id": "client", "api_key": "read-only-key"
    })
    monkeypatch.setattr("app.main.OzonReadOnlyClient", FakeOzonClient)
    monkeypatch.setattr(tenant_analytics, "OzonReadOnlyClient", FakeOzonClient)
    response = TestClient(app).get(
        "/api/sales?store_id=store-1&date_from=2026-11-01&date_to=2026-11-18",
        auth=("owner", "test-password"),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["sales_gmv"] == 502.5
    assert data["delivered_units"] == 5
    assert data["fulfillment"] == {
        "FBO": {"delivered_units": 2, "sales_gmv": 201.0, "delivered_postings": 1},
        "FBS": {"delivered_units": 3, "sales_gmv": 301.5, "delivered_postings": 1},
    }
    # Product rows are sorted by GMV descending, so FBS precedes FBO here.
    assert data["products"] == [
        {
            "fulfillment_type": "FBS",
            "sku": "123",
            "product_id": "456",
            "offer_id": "offer-1",
            "name": "Test product",
            "units": 3,
            "sales_gmv": 301.5,
            "unpriced_units": 0,
        },
        {
            "fulfillment_type": "FBO",
            "sku": "123",
            "product_id": "456",
            "offer_id": "offer-1",
            "name": "Test product",
            "units": 2,
            "sales_gmv": 201.0,
            "unpriced_units": 0,
        },
    ]


def test_sales_endpoint_rejects_reversed_dates(monkeypatch) -> None:
    monkeypatch.setenv("DASHBOARD_USERNAME", "owner")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "test-password")

    response = TestClient(app).get(
        "/api/sales?store_id=store-1&date_from=2026-11-18&date_to=2026-11-01",
        auth=("owner", "test-password"),
    )

    assert response.status_code == 400


def test_sales_endpoint_returns_zero_totals_when_no_delivered_sales(monkeypatch) -> None:
    monkeypatch.setenv("DASHBOARD_USERNAME", "owner")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "test-password")
    monkeypatch.setenv("OZON_CLIENT_ID", "client")
    monkeypatch.setenv("OZON_API_KEY", "read-only-key")

    class EmptyOzonClient:
        def __init__(self, client_id, api_key, base_url):
            pass

        async def execute(self, operation, payload):
            return {"result": {"postings": [], "has_next": False}}

    monkeypatch.setattr("app.main.OzonReadOnlyClient", EmptyOzonClient)
    response = TestClient(app).get(
        "/api/sales?store_id=store-1&date_from=2026-11-01&date_to=2026-11-18",
        auth=("owner", "test-password"),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["sales_gmv"] == 0
    assert data["delivered_units"] == 0
    assert data["delivered_postings"] == 0
    assert data["fulfillment"] == {
        "FBO": {"delivered_units": 0, "sales_gmv": 0, "delivered_postings": 0},
        "FBS": {"delivered_units": 0, "sales_gmv": 0, "delivered_postings": 0},
    }
    assert data["products"] == []
    assert data["unpriced_units"] == 0
