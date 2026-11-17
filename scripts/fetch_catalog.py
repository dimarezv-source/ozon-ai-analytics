#!/usr/bin/env python3
"""Fetch Ozon catalog IDs and enrich them with read-only product details."""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE_URL = "https://api-seller.ozon.ru"
PAGE_SIZE = 1000
MAX_PAGES = 1000
DETAIL_BATCH_SIZE = 1000

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
    catalog = []
    last_id = ""
    seen = set()
    for page in range(1, MAX_PAGES + 1):
        response = post("/v3/product/list", {"filter": {"visibility": "ALL"}, "last_id": last_id, "limit": PAGE_SIZE})
        result = response.get("result")
        if not isinstance(result, dict) or not isinstance(result.get("items", []), list):
            raise RuntimeError("Unexpected Ozon response from /v3/product/list")
        catalog.extend(result.get("items", []))
        next_id = result.get("last_id") or ""
        if not next_id:
            break
        if not isinstance(next_id, str) or next_id in seen or next_id == last_id:
            raise RuntimeError("Ozon returned a repeated or invalid pagination cursor.")
        seen.add(next_id)
        last_id = next_id
    else:
        raise RuntimeError(f"Stopped at safety limit ({MAX_PAGES} pages).")

    ids = [int(p["product_id"]) for p in catalog if isinstance(p, dict) and str(p.get("product_id", "")).isdigit()]
    details = []
    for start in range(0, len(ids), DETAIL_BATCH_SIZE):
        batch = ids[start:start + DETAIL_BATCH_SIZE]
        if not batch:
            continue
        response = post("/v3/product/info/list", {"product_id": batch})
        items = response.get("items")
        if not isinstance(items, list):
            raise RuntimeError("Unexpected Ozon response from /v3/product/info/list: items is not a list")
        details.extend(items)

    # Keep original list fields and enrich with detailed fields, matching by product ID.
    detail_by_id = {str(p.get("id", p.get("product_id", ""))): p for p in details if isinstance(p, dict)}
    enriched = []
    for item in catalog:
        if not isinstance(item, dict):
            continue
        product_id = str(item.get("product_id", ""))
        detail = detail_by_id.get(product_id, {})
        enriched.append({**item, **detail, "product_id": item.get("product_id", detail.get("id"))})

    output = Path("output")
    output.mkdir(exist_ok=True)
    destination = output / "ozon-products.json"
    destination.write_text(json.dumps({"source": ["/v3/product/list", "/v3/product/info/list"], "read_only": True, "product_count": len(enriched), "details_received": len(details), "products": enriched}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Catalog fetched: {len(enriched)} products; detailed records: {len(details)}.")
    print(f"Saved read-only catalog: {destination}")
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
