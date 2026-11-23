"""Read-only product catalog pagination helpers.

Catalog listing uses the explicitly allowlisted read-only Seller API operation.
"""
from collections.abc import AsyncIterator
from typing import Any, Protocol


class ReadOnlyExecutor(Protocol):
    async def execute(
        self, operation_name: str, payload: dict[str, Any] | None = None
    ) -> dict[str, Any]: ...


async def iter_products(
    client: ReadOnlyExecutor,
    *,
    page_size: int = 1000,
    max_pages: int = 1000,
    visibility: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Yield catalog items page by page, with cursor-loop protection."""
    if not 1 <= page_size <= 1000:
        raise ValueError("page_size must be between 1 and 1000")
    if max_pages < 1:
        raise ValueError("max_pages must be at least 1")

    last_id = ""
    seen_cursors: set[str] = set()

    for _ in range(max_pages):
        payload = {"filter": {"visibility": visibility} if visibility else {}, "last_id": last_id, "limit": page_size}
        response = await client.execute("product_list", payload)

        result = response.get("result")
        if not isinstance(result, dict):
            raise ValueError("Unexpected Ozon response: 'result' must be an object")

        items = result.get("items", [])
        if not isinstance(items, list):
            raise ValueError("Unexpected Ozon response: 'result.items' must be a list")

        for item in items:
            if not isinstance(item, dict):
                raise ValueError("Unexpected Ozon response: catalog item must be an object")
            yield item

        next_cursor = result.get("last_id")
        if not next_cursor:
            return
        if not isinstance(next_cursor, str):
            raise ValueError("Unexpected Ozon response: 'result.last_id' must be a string")
        if next_cursor in seen_cursors or next_cursor == last_id:
            raise RuntimeError("Ozon pagination cursor repeated; stopping to avoid an infinite loop")

        seen_cursors.add(next_cursor)
        last_id = next_cursor

    raise RuntimeError(f"Catalog pagination exceeded the safety limit of {max_pages} pages")
