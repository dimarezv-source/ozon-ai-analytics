import pytest

from app.ozon.catalog import iter_products


class FakeOzonClient:
    def __init__(self, responses: list[dict]) -> None:
        self.responses = iter(responses)
        self.payloads: list[dict] = []

    async def execute(self, operation_name: str, payload: dict | None = None) -> dict:
        assert operation_name == "product_list"
        self.payloads.append(payload or {})
        return next(self.responses)


@pytest.mark.asyncio
async def test_iter_products_reads_multiple_pages() -> None:
    client = FakeOzonClient(
        [
            {"result": {"items": [{"product_id": 1}], "last_id": "cursor-1", "total_items": 2}},
            {"result": {"items": [{"product_id": 2}], "last_id": "", "total_items": 2}},
        ]
    )

    products = [item async for item in iter_products(client, page_size=1)]

    assert products == [{"product_id": 1}, {"product_id": 2}]
    assert client.payloads == [
        {"filter": {}, "last_id": "", "limit": 1},
        {"filter": {}, "last_id": "cursor-1", "limit": 1},
    ]


@pytest.mark.asyncio
async def test_iter_products_stops_on_empty_catalog() -> None:
    client = FakeOzonClient([{"result": {"items": [], "last_id": ""}}])

    assert [item async for item in iter_products(client)] == []


@pytest.mark.asyncio
async def test_iter_products_rejects_repeated_cursor() -> None:
    client = FakeOzonClient(
        [
            {"result": {"items": [], "last_id": "same"}},
            {"result": {"items": [], "last_id": "same"}},
        ]
    )

    with pytest.raises(RuntimeError, match="cursor repeated"):
        [item async for item in iter_products(client)]


@pytest.mark.asyncio
async def test_iter_products_validates_page_size() -> None:
    client = FakeOzonClient([])

    with pytest.raises(ValueError, match="page_size"):
        [item async for item in iter_products(client, page_size=1001)]



@pytest.mark.asyncio
async def test_iter_products_can_request_all_visibility() -> None:
    client = FakeOzonClient([{"result": {"items": [{"product_id": 7}], "last_id": ""}}])

    products = [item async for item in iter_products(client, visibility="ALL")]

    assert products == [{"product_id": 7}]
    assert client.payloads == [{"filter": {"visibility": "ALL"}, "last_id": "", "limit": 1000}]
