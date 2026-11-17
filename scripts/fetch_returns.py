#!/usr/bin/env python3
"""Export FBO/FBS returns through the unified read-only Ozon endpoint."""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

BASE_URL = "https://api-seller.ozon.ru"
PAGE_SIZE = 500
MAX_PAGES = 5000
DATE_FILTERS = ("logistic_return_date", "visual_status_change_moment")


def post(payload: dict) -> dict:
    client_id = os.environ.get("OZON_CLIENT_ID", "").strip()
    api_key = os.environ.get("OZON_API_KEY", "").strip()
    if not client_id or not api_key:
        raise RuntimeError("Add OZON_CLIENT_ID and OZON_API_KEY to repository Actions secrets.")
    request = urllib.request.Request(
        BASE_URL + "/v1/returns/list",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Client-Id": client_id, "Api-Key": api_key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1200]
        raise RuntimeError(f"Ozon API /v1/returns/list returned HTTP {exc.code}: {detail}") from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach Ozon API: {exc.reason}") from None
    if not isinstance(data, dict) or not isinstance(data.get("returns"), list):
        keys = sorted(data.keys()) if isinstance(data, dict) else type(data).__name__
        raise RuntimeError(f"Unexpected /v1/returns/list response: {keys}; expected returns array")
    if "has_next" not in data or not isinstance(data["has_next"], bool):
        raise RuntimeError("Missing or invalid has_next field from /v1/returns/list")
    return data


def fetch_by_date_filter(filter_name: str, time_from: str, time_to: str) -> list[dict]:
    last_id = 0
    returns = []
    seen_ids = set()
    for page_no in range(1, MAX_PAGES + 1):
        response = post({
            "filter": {filter_name: {"time_from": time_from, "time_to": time_to}},
            "limit": PAGE_SIZE,
            "last_id": last_id,
        })
        page = response["returns"]
        for item in page:
            if not isinstance(item, dict) or item.get("id") in (None, ""):
                raise RuntimeError("Returns response contains an item without an id")
            return_id = str(item["id"])
            if return_id not in seen_ids:
                seen_ids.add(return_id)
                returns.append(item)
        print(f"Returns ({filter_name}): page {page_no}, received {len(page)}, unique total {len(returns)}")
        if not response["has_next"]:
            return returns
        if not page:
            raise RuntimeError(f"Returns API says has_next=true but returned an empty page ({filter_name})")
        try:
            next_id = int(page[-1]["id"])
        except (TypeError, ValueError, KeyError):
            raise RuntimeError(f"Cannot derive numeric last_id from the final return record ({filter_name})") from None
        if next_id <= last_id:
            raise RuntimeError(f"Returns API returned a non-advancing last_id cursor ({filter_name})")
        last_id = next_id
    raise RuntimeError(f"Stopped at safety limit ({MAX_PAGES} pages, {filter_name})")


def main() -> int:
    raw_days = os.environ.get("RETURNS_DAYS", "31").strip()
    try:
        days = int(raw_days)
    except ValueError:
        raise RuntimeError("RETURNS_DAYS must be an integer from 1 to 365")
    if not 1 <= days <= 365:
        raise RuntimeError("RETURNS_DAYS must be from 1 to 365")

    today = datetime.now(timezone.utc).date()
    first_day = today - timedelta(days=days)
    last_day = today - timedelta(days=1)
    time_from = datetime.combine(first_day, time.min, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    time_to = datetime.combine(last_day, time.max, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    # Ozon accepts only one date filter per request. Query both independently:
    # logistics return date catches physical return events; visual status change
    # also catches status transitions such as cancellations and approvals.
    merged = {}
    for filter_name in DATE_FILTERS:
        for item in fetch_by_date_filter(filter_name, time_from, time_to):
            return_id = str(item["id"])
            if return_id not in merged:
                merged[return_id] = {**item, "_matched_date_filters": [filter_name]}
            elif filter_name not in merged[return_id]["_matched_date_filters"]:
                merged[return_id]["_matched_date_filters"].append(filter_name)

    returns = list(merged.values())
    output = Path("output")
    output.mkdir(exist_ok=True)
    destination = output / "ozon-returns.json"
    payload = {
        "source": "/v1/returns/list",
        "read_only": True,
        "date_filters": list(DATE_FILTERS),
        "period": {"time_from": time_from, "time_to": time_to, "days": days, "timezone": "UTC"},
        "return_count": len(returns),
        "returns": returns,
    }
    destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Returns export complete: {len(returns)} unique records from {len(DATE_FILTERS)} date filters")
    print(f"Period (UTC): {time_from} — {time_to}")
    print(f"Saved read-only returns: {destination}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
