import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


@pytest.fixture(autouse=True)
def clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_catalog_intelligence_uses_only_read_operations_and_needs_no_sales(monkeypatch):
    monkeypatch.setenv("DASHBOARD_USERNAME", "owner")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "test-password")
    monkeypatch.setenv("OZON_CLIENT_ID", "client")
    monkeypatch.setenv("OZON_API_KEY", "read-only-key")

    class FakeOzonClient:
        def __init__(self, client_id, api_key, base_url):
            assert client_id == "client"
            assert api_key == "read-only-key"
            self.operations = []

        async def execute(self, operation, payload):
            self.operations.append(operation)
            if operation == "product_info_list":
                return {"items": [{
                    "id": 123, "name": "Товар с подробным названием модели и назначения",
                    "offer_id": "A-123", "price": "1490", "sku": "555",
                }]}
            if operation == "product_info_prices":
                return {"items": [{"product_id": 123, "price_indexes": {"color_index": "GREEN", "external_index_data": {"price_index": 0.92}}}]}
            if operation == "product_content_rating":
                return {"products": [{"sku": "555", "rating": 82, "groups": [{"name": "Фото", "rating": 90}]}]}
            if operation == "product_info_attributes":
                return {"result": [{
                    "id": 123, "description": "Описание товара для теста",
                    "images": ["one.jpg", "two.jpg", "three.jpg"],
                    "attributes": [{"value": "Материал"}, {"value": "Цвет"}],
                }]}
            raise AssertionError(f"Unexpected operation: {operation}")

    async def fake_iter_products(client, **kwargs):
        assert kwargs["visibility"] == "ALL"
        yield {"product_id": 123, "offer_id": "A-123", "archived": False}

    monkeypatch.setattr("app.main.OzonReadOnlyClient", FakeOzonClient)
    monkeypatch.setattr("app.main.iter_products", fake_iter_products)

    response = TestClient(app).get("/api/catalog/intelligence", auth=("owner", "test-password"))

    assert response.status_code == 200
    data = response.json()
    assert data["sales_history_required"] is False
    assert data["product_count"] == 1
    assert data["products"][0]["product_id"] == "123"
    assert data["products"][0]["evidence"]["image_count"] == 3
    assert data["products"][0]["ozon_content_rating"] == 82
    assert data["content_rating_available"] is True
    assert data["products"][0]["price_analysis"]["color_index"] == "GREEN"
    assert data["summary"]["missing_price"] == 0


def test_catalog_intelligence_validates_product_limit(monkeypatch):
    monkeypatch.setenv("DASHBOARD_USERNAME", "owner")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "test-password")

    response = TestClient(app).get("/api/catalog/intelligence?limit=0", auth=("owner", "test-password"))

    assert response.status_code == 400
