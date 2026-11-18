"""Read-only stock retrieval and conservative FBO/FBS stock normalization."""
from __future__ import annotations


def _quantity(value: object) -> int:
    try:
        number = int(value or 0)
    except (TypeError, ValueError, OverflowError):
        return 0
    return max(0, number)


def normalize_stock_items(items: list[dict]) -> dict:
    products = []
    totals = {name: {"present": 0, "reserved": 0, "available": 0, "products": 0}
              for name in ("FBO", "FBS", "RFBS", "FBP")}
    for item in items:
        if not isinstance(item, dict):
            continue
        stocks = []
        source_stocks = item.get("stocks") if isinstance(item.get("stocks"), list) else []
        for source in source_stocks:
            if not isinstance(source, dict):
                continue
            stock_type = str(source.get("type") or "").upper()
            present = _quantity(source.get("present"))
            reserved = _quantity(source.get("reserved"))
            available = max(0, present - reserved)
            stocks.append({"type": stock_type or "UNKNOWN", "present": present,
                           "reserved": reserved, "available": available})
            if stock_type in totals:
                aggregate = totals[stock_type]
                aggregate["present"] += present
                aggregate["reserved"] += reserved
                aggregate["available"] += available
                if available > 0:
                    aggregate["products"] += 1
        products.append({"product_id": item.get("product_id"), "offer_id": item.get("offer_id"),
                         "sku": item.get("sku"), "name": item.get("name"), "stocks": stocks})
    return {"status": "ok", "mode": "read-only", "products_count": len(products),
            "products": products, "summary": totals,
            "basis": "Available stock is present minus reserved; no stock mutation is performed."}


async def fetch_inventory(client) -> dict:
    items: list[dict] = []
    cursor = ""
    seen: set[str] = set()
    for _ in range(1000):
        response = await client.execute("product_info_stocks",
            {"cursor": cursor, "filter": {"visibility": "ALL"}, "limit": 1000})
        body = response.get("result") if isinstance(response.get("result"), dict) else response
        page = body.get("items") if isinstance(body, dict) else None
        if not isinstance(page, list):
            raise ValueError("Unexpected stock response from Ozon.")
        items.extend(row for row in page if isinstance(row, dict))
        next_cursor = body.get("cursor") or ""
        if not next_cursor:
            break
        if not isinstance(next_cursor, str) or next_cursor == cursor or next_cursor in seen:
            raise ValueError("Ozon returned an invalid stock pagination cursor.")
        seen.add(next_cursor)
        cursor = next_cursor
    else:
        raise ValueError("Stock pagination safety limit reached.")
    return normalize_stock_items(items)
