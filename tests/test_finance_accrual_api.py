import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import _extract_fee_components, app


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
                # A cursor, not an empty page, determines whether pagination continues.
                return {"accruals": [], "last_id": "next"}
            if payload["date"] == "2026-11-17":
                return {"accruals": [
                    {"accrued_category": "POSTING", "posting": {"products": []}},
                    {"accrued_category": "NON_ITEM", "non_item_fee": {"type_id": 7, "accrued": {"amount": "-10.00", "currency": "RUB"}}},
                ], "last_id": ""}
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


def test_extract_fee_components_keeps_each_type_paired_with_its_amount() -> None:
    record = {
        "accrued_category": "POSTING",
        "posting": {
            "products": [{
                "delivery": {
                    "services": [
                        {"type_id": 32, "name": "Delivery", "accrued": {"amount": "-12.50", "currency": "RUB"}},
                        {"type_id": 41, "accrued": {"amount": "-3.00", "currency": "RUB"}},
                    ]
                }
            }]
        },
        "item_fees": {
            "fees": [{
                "sku": 123,
                "fees": [{"type_id": 77, "accrued": {"amount": "-1.25", "currency": "RUB"}}],
            }]
        },
        "non_item_fee": {
            "type_id": 98,
            "accrued": {"amount": "4.00", "currency": "RUB"},
        },
        "container_fees": [{
            "type_id": 105,
            "accrued": {"amount": "-0.50", "currency": "RUB"},
        }],
    }

    components = _extract_fee_components(record)

    assert [(item["type_id"], item["amount"], item["currency"]) for item in components] == [
        ("32", "-12.50", "RUB"),
        ("41", "-3.00", "RUB"),
        ("77", "-1.25", "RUB"),
        ("98", "4.00", "RUB"),
        ("105", "-0.50", "RUB"),
    ]
    assert len({item["path"] for item in components}) == 5


def test_extract_fee_components_does_not_guess_missing_type_or_amount() -> None:
    record = {
        "fees": [
            {"type_id": 32, "accrued": {"amount": "-2", "currency": "RUB"}},
            {"type_id": 41, "accrued": None},
            {"accrued": {"amount": "-9", "currency": "RUB"}},
            {"type_id": 77, "accrued": {"currency": "RUB"}},
        ]
    }

    assert _extract_fee_components(record) == [
        {"type_id": "32", "amount": "-2", "currency": "RUB", "path": "fees[0]"}
    ]
