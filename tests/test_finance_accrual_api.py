import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


@pytest.fixture(autouse=True)
def clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_finance_accrual_endpoint_reads_sequential_days_and_pages(monkeypatch) -> None:
    monkeypatch.setenv("DASHBOARD_USERNAME", "owner")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "test-password")
    monkeypatch.setenv("OZON_CLIENT_ID", "client")
    monkeypatch.setenv("OZON_API_KEY", "read-only-key")

    calls = []

    class FakeOzonClient:
        def __init__(self, client_id, api_key, base_url):
            assert client_id == "client"
            assert api_key == "read-only-key"

        async def execute(self, operation, payload):
            calls.append((operation, payload))
            if operation == "finance_accrual_types":
                return {"accrual_types": [{"id": 7, "name": "Logistics", "description": "Доставка"}]}
            if payload["date"] == "2026-11-17" and not payload["last_id"]:
                return {"accruals": [{"accrued_category": "POSTING", "posting": {"products": []}}], "last_id": "next"}
            if payload["date"] == "2026-11-17":
                return {"accruals": [{"accrued_category": "NON_ITEM", "non_item_fee": {"type_id": 7, "accrued": {"amount": "-10.00", "currency": "RUB"}}}], "last_id": ""}
            return {"accruals": [], "last_id": ""}

    monkeypatch.setattr("app.main.OzonReadOnlyClient", FakeOzonClient)
    response = TestClient(app).get(
        "/api/finance/accruals?date_from=2026-11-17&date_to=2026-11-18",
        auth=("owner", "test-password"),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["record_count"] == 2
    assert data["accrual_types"]["7"]["description"] == "Доставка"
    assert [row["date"] for row in data["accruals"]] == ["2026-11-17", "2026-11-17"]
    assert calls == [
        ("finance_accrual_types", {}),
        ("finance_accrual_by_day", {"date": "2026-11-17", "last_id": ""}),
        ("finance_accrual_by_day", {"date": "2026-11-17", "last_id": "next"}),
        ("finance_accrual_by_day", {"date": "2026-11-18", "last_id": ""}),
    ]


@pytest.mark.parametrize(
    ("date_from", "date_to"),
    [
        ("2026-11-18", "2026-11-17"),
        ("2026-10-01", "2026-11-01"),
        ("not-a-date", "2026-11-01"),
    ],
)
def test_finance_accrual_endpoint_rejects_invalid_period(monkeypatch, date_from, date_to) -> None:
    monkeypatch.setenv("DASHBOARD_USERNAME", "owner")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "test-password")
    response = TestClient(app).get(
        f"/api/finance/accruals?date_from={date_from}&date_to={date_to}",
        auth=("owner", "test-password"),
    )
    assert response.status_code == 400
