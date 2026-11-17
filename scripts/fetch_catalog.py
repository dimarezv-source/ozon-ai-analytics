#!/usr/bin/env python3
"""Fetch the Ozon Seller product catalog using read-only API calls only."""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE_URL = "https://api-seller.ozon.ru"
PAGE_SIZE = 1000
MAX_PAGES = 1000


def post(path: str, payload: dict) -> dict:
    client_id = os.environ.get("OZON_CLIENT_ID", "").strip()
    api_key = os.environ.get("OZON_API_KEY", "").strip()
    if not client_id or not api_key:
        raise RuntimeError("Add OZON_CLIENT_ID and OZON_API_KEY to repository Actions secrets.")

    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        BASE_URL + path,
        data=body,
        headers={
            "Client-Id": client_id,
            "Api-Key": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # Do not print request headers or credentials.
        detail = exc.read().decode("utf-8", errors="replace")[:1000]
        raise RuntimeError(f"Ozon API returned HTTP {exc.code}: {detail}") from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach Ozon API: {exc.reason}") from None


def main() -> int:
    products = []
    last_id = ""
    seen = set()

    for page in range(1, MAX_PAGES + 1):
        response = post(
            "/v3/product/list",
            {"filter": {"visibility": "ALL"}, "last_id": last_id, "limit": PAGE_SIZE},
        )
        result = response.get("result")
        if not isinstance(result, dict):
            raise RuntimeError("Unexpected Ozon response: result is missing or invalid.")
        items = result.get("items", [])
        if not isinstance(items, list):
            raise RuntimeError("Unexpected Ozon response: result.items is not a list.")
        products.extend(items)

        next_id = result.get("last_id") or ""
        if not next_id:
            break
        if not isinstance(next_id, str) or next_id in seen or next_id == last_id:
            raise RuntimeError("Ozon returned a repeated or invalid pagination cursor.")
        seen.add(next_id)
        last_id = next_id
    else:
        raise RuntimeError(f"Stopped at safety limit ({MAX_PAGES} pages).")

    output = Path("output")
    output.mkdir(exist_ok=True)
    destination = output / "ozon-products.json"
    destination.write_text(
        json.dumps(
            {
                "source": "Ozon Seller API /v3/product/list",
                "read_only": True,
                "product_count": len(products),
                "products": products,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Catalog fetched successfully: {len(products)} products across {page} page(s).")
    print(f"Saved private workflow artifact source file: {destination}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
