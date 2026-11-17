#!/usr/bin/env python3
"""Export Ozon daily accruals using the current read-only finance API."""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE_URL = "https://api-seller.ozon.ru"
MAX_PAGES_PER_DAY = 500

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
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.loads(response.read().decode("utf-8"))
            if not isinstance(data, dict):
                raise RuntimeError(f"Unexpected non-object response from {path}")
            return data
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1000]
        raise RuntimeError(f"Ozon API {path} returned HTTP {exc.code}: {detail}") from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach Ozon API {path}: {exc.reason}") from None

def get_days() -> list[str]:
    raw = os.environ.get("FINANCE_DAYS", "7").strip()
    try:
        count = int(raw)
    except ValueError:
        raise RuntimeError("FINANCE_DAYS must be an integer from 1 to 31.") from None
    if not 1 <= count <= 31:
        raise RuntimeError("FINANCE_DAYS must be between 1 and 31.")
    today = datetime.now(timezone.utc).date()
    return [(today - timedelta(days=offset)).isoformat() for offset in range(count, 0, -1)]

def fetch_day(day: str, diagnostics: list[dict]) -> list[dict]:
    records: list[dict] = []
    cursor = ""
    seen: set[str] = set()
    for page_number in range(1, MAX_PAGES_PER_DAY + 1):
        response = post("/v1/finance/accrual/by-day", {"date": day, "last_id": cursor})
        if "accruals" not in response:
            raise RuntimeError(
                f"Unexpected response for {day}: missing 'accruals'; "
                f"top-level keys: {sorted(response.keys())}"
            )
        page = response["accruals"]
        if not isinstance(page, list):
            raise RuntimeError(f"Unexpected response for {day}: 'accruals' is not a list")
        if any(not isinstance(item, dict) for item in page):
            raise RuntimeError(f"Unexpected non-object accrual in response for {day}")
        next_cursor_value = response.get("last_id")
        if page_number == 1:
            diagnostics.append({
                "date": day,
                "response_keys": sorted(response.keys()),
                "accruals_type": type(page).__name__,
                "first_page_records": len(page),
                "last_id_type": type(next_cursor_value).__name__ if next_cursor_value is not None else "null",
                "last_id_present": bool(next_cursor_value),
            })
        records.extend(page)
        next_cursor = next_cursor_value or ""
        if not next_cursor:
            return records
        if not isinstance(next_cursor, str) or next_cursor == cursor or next_cursor in seen:
            raise RuntimeError(f"Repeated/invalid pagination cursor for {day}; stopping safely")
        seen.add(next_cursor)
        cursor = next_cursor
    raise RuntimeError(f"Finance pagination exceeded {MAX_PAGES_PER_DAY} pages for {day}")

def main() -> int:
    days = get_days()
    type_response = post("/v1/finance/accrual/types", {})
    types = type_response.get("accrual_types", [])
    if not isinstance(types, list):
        raise RuntimeError("Unexpected response from /v1/finance/accrual/types: accrual_types is not a list")
    by_day = []
    api_diagnostics = []
    total_records = 0
    for day in days:
        records = fetch_day(day, api_diagnostics)
        diagnostic = api_diagnostics[-1]
        if day == days[0]:
            print(
                f"API response diagnostic: keys={diagnostic['response_keys']}; "
                f"accruals_type={diagnostic['accruals_type']}; "
                f"first_page_records={diagnostic['first_page_records']}; "
                f"last_id_present={diagnostic['last_id_present']}"
            )
        by_day.append({"date": day, "count": len(records), "accruals": records})
        total_records += len(records)
        print(f"{day}: {len(records)} accrual records")
    output = Path("output")
    output.mkdir(exist_ok=True)
    payload = {
        "source": ["/v1/finance/accrual/types", "/v1/finance/accrual/by-day"],
        "read_only": True,
        "date_from": days[0],
        "date_to": days[-1],
        "days_requested": len(days),
        "records_received": total_records,
        "accrual_types": types,
        "api_diagnostics": api_diagnostics,
        "days": by_day,
    }
    (output / "ozon-finance.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Finance export complete: {total_records} records across {len(days)} days.")
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
