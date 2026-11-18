import asyncio

import pytest

from app.analytics.inventory import fetch_inventory, normalize_stock_items


def test_normalize_stock_items_subtracts_reserved_and_keeps_schemes_separate():
    result = normalize_stock_items([{
        "product_id": 10, "offer_id": "SKU-10", "sku": 100,
        "stocks": [
            {"type": "fbo", "present": 12, "reserved": 3},
            {"type": "fbs", "present": 8, "reserved": 8},
            {"type": "rfbs", "present": 5, "reserved": 1},
        ],
    }])
    product = result["products"][0]
    assert product["stocks"][0]["available"] == 9
    assert product["stocks"][1]["available"] == 0
    assert result["summary"]["FBO"]["available"] == 9
    assert result["summary"]["FBS"]["available"] == 0
    assert result["summary"]["RFBS"]["available"] == 4


def test_normalize_stock_items_handles_invalid_and_negative_quantities():
    result = normalize_stock_items([{"stocks": [{"type": "fbo", "present": "bad", "reserved": -4}]}])
    assert result["products"][0]["stocks"][0] == {
        "type": "FBO", "present": 0, "reserved": 0, "available": 0
    }


def test_fetch_inventory_paginates():
    class FakeClient:
        def __init__(self):
            self.calls = []
        async def execute(self, operation, payload):
            self.calls.append((operation, payload))
            if len(self.calls) == 1:
                return {"items": [{"product_id": 1, "stocks": [{"type": "fbo", "present": 3, "reserved": 1}]}], "cursor": "next"}
            return {"items": [{"product_id": 2, "stocks": [{"type": "fbs", "present": 4, "reserved": 0}]}], "cursor": ""}

    client = FakeClient()
    result = asyncio.run(fetch_inventory(client))
    assert len(client.calls) == 2
    assert all(call[0] == "product_info_stocks" for call in client.calls)
    assert client.calls[0][1]["filter"]["visibility"] == "ALL"
    assert result["summary"]["FBO"]["available"] == 2
    assert result["summary"]["FBS"]["available"] == 4


def test_fetch_inventory_rejects_repeated_cursor():
    class FakeClient:
        async def execute(self, operation, payload):
            return {"items": [{"product_id": 1}], "cursor": "same"}

    with pytest.raises(ValueError, match="invalid stock pagination cursor"):
        asyncio.run(fetch_inventory(FakeClient()))
