#!/usr/bin/env python3
"""Fetch read-only Ozon v5 prices and commission details for catalog products."""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE_URL = "https://api-seller.ozon.ru"
PAGE_SIZE = 1000
MAX_PAGES = 100

def post(path: str, payload: dict) -> dict:
    client_id = os.environ.get("OZON_CLIENT_ID", "").strip()
    api_key = os.environ.get("OZON_API_KEY", "").strip()
    if not client_id or not api_key:
        raise RuntimeError("Add OZON_CLIENT_ID and OZON_API_KEY to repository Actions secrets.")
    request = urllib.request.Request(
        BASE_URL + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Client-Id": client_id, "Api-Key": api_key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1000]
        raise RuntimeError(f"Ozon API {path} returned HTTP {exc.code}: {detail}") from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach Ozon API: {exc.reason}") from None

def main() -> int:
    source = Path("output/ozon-products.json")
    if not source.exists():
        raise RuntimeError(f"Missing catalog export: {source}")
    catalog = json.loads(source.read_text(encoding="utf-8"))
    products = catalog.get("products", [])
    offer_ids = list(dict.fromkeys(
        str(p["offer_id"]) for p in products
        if isinstance(p, dict) and p.get("offer_id") not in (None, "")
    ))
    if not offer_ids:
        raise RuntimeError("No offer_id values found in catalog; cannot query product prices.")

    items = []
    cursor = ""
    seen = set()
    for _ in range(MAX_PAGES):
        payload = {"cursor": cursor, "filter": {"offer_id": offer_ids[:1000]}, "limit": PAGE_SIZE}
        response = post("/v5/product/info/prices", payload)
        page_items = response.get("items")
        if page_items is None and isinstance(response.get("result"), dict):
            page_items = response["result"].get("items", [])
        if not isinstance(page_items, list):
            raise RuntimeError("Unexpected Ozon response from /v5/product/info/prices: items is not a list")
        items.extend(item for item in page_items if isinstance(item, dict))
        next_cursor = response.get("cursor") or (response.get("result") or {}).get("cursor", "")
        if not next_cursor or not page_items:
            break
        if not isinstance(next_cursor, str) or next_cursor in seen or next_cursor == cursor:
            raise RuntimeError("Ozon returned a repeated or invalid price cursor.")
        seen.add(next_cursor)
        cursor = next_cursor
    else:
        raise RuntimeError(f"Stopped at safety limit ({MAX_PAGES} price pages).")

    output = Path("output")
    output.mkdir(exist_ok=True)
    destination = output / "ozon-prices.json"
    destination.write_text(json.dumps({
        "source": "/v5/product/info/prices",
        "read_only": True,
        "requested_offer_ids": offer_ids,
        "items_received": len(items),
        "items": items,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Price/commission data fetched: {len(items)} items for {len(offer_ids)} offer IDs.")
    print(f"Saved read-only price data: {destination}")
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
