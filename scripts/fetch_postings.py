#!/usr/bin/env python3
"""Export Ozon FBO/FBS postings using read-only Seller API methods."""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

BASE_URL = "https://api-seller.ozon.ru"
PAGE_SIZE = 100
MAX_PAGES = 5000


def post(path: str, payload: dict) -> dict:
    client_id = os.environ.get("OZON_CLIENT_ID", "").strip()
    api_key = os.environ.get("OZON_API_KEY", "").strip()
    if not client_id or not api_key:
        raise RuntimeError("Add OZON_CLIENT_ID and OZON_API_KEY to repository Actions secrets.")
    request = urllib.request.Request(
        BASE_URL + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Client-Id": client_id,
            "Api-Key": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            decoded = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1200]
        raise RuntimeError(f"Ozon API {path} returned HTTP {exc.code}: {detail}") from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach Ozon API: {exc.reason}") from None
    if not isinstance(decoded, dict):
        raise RuntimeError(f"Unexpected non-object response from {path}")
    return decoded


def extract_page(response: dict, path: str) -> tuple[list, str, bool]:
    # Current endpoints return postings at the root. Accept the documented
    # legacy-style result envelope too, but fail loudly on unknown shapes.
    body = response.get("result", response)
    if not isinstance(body, dict) or not isinstance(body.get("postings"), list):
        raise RuntimeError(
            f"Unexpected response from {path}: keys={sorted(response.keys())}; "
            "expected postings array"
        )
    postings = body["postings"]
    cursor = body.get("cursor") or ""
    has_next = body.get("has_next", False)
    if not isinstance(cursor, str) or not isinstance(has_next, bool):
        raise RuntimeError(f"Invalid pagination fields from {path}")
    return postings, cursor, has_next


def fetch_postings(path: str, since: str, to: str, schema: str) -> list[dict]:
    cursor = ""
    seen_cursors = set()
    records = []
    seen_postings = set()
    for page_no in range(1, MAX_PAGES + 1):
        payload = {
            "filter": {"since": since, "to": to},
            "limit": PAGE_SIZE,
            "cursor": cursor,
            "sort_dir": "ASC",
            "with": {
                "analytics_data": True,
                "financial_data": True,
                "legal_info": False,
            },
        }
        if schema == "FBS":
            payload["with"]["barcodes"] = False
            payload["with"]["translit"] = False
        response = post(path, payload)
        postings, next_cursor, has_next = extract_page(response, path)
        for posting in postings:
            if not isinstance(posting, dict):
                raise RuntimeError(f"{schema} response contains a non-object posting")
            number = str(posting.get("posting_number") or "")
            if not number:
                raise RuntimeError(f"{schema} posting is missing posting_number")
            if number not in seen_postings:
                seen_postings.add(number)
                records.append(posting)
        print(f"{schema}: page {page_no}, received {len(postings)}, unique total {len(records)}")
        if not has_next:
            return records
        if not next_cursor or next_cursor == cursor or next_cursor in seen_cursors:
            raise RuntimeError(f"{schema}: Ozon returned a missing or repeated pagination cursor")
        seen_cursors.add(next_cursor)
        cursor = next_cursor
    raise RuntimeError(f"{schema}: stopped at safety limit ({MAX_PAGES} pages)")


def main() -> int:
    raw_days = os.environ.get("SALES_DAYS", "7").strip()
    try:
        days = int(raw_days)
    except ValueError:
        raise RuntimeError("SALES_DAYS must be an integer from 1 to 31")
    if not 1 <= days <= 31:
        raise RuntimeError("SALES_DAYS must be from 1 to 31")

    today = datetime.now(timezone.utc).date()
    first_day = today - timedelta(days=days)
    last_day = today - timedelta(days=1)
    since = datetime.combine(first_day, time.min, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    to = datetime.combine(last_day, time.max, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    fbo = fetch_postings("/v3/posting/fbo/list", since, to, "FBO")
    fbs = fetch_postings("/v4/posting/fbs/list", since, to, "FBS")
    output = Path("output")
    output.mkdir(exist_ok=True)
    destination = output / "ozon-postings.json"
    payload = {
        "source": ["/v3/posting/fbo/list", "/v4/posting/fbs/list"],
        "read_only": True,
        "period": {"since": since, "to": to, "days": days, "timezone": "UTC"},
        "counts": {"fbo": len(fbo), "fbs": len(fbs), "total": len(fbo) + len(fbs)},
        "postings": [{"schema": "FBO", **p} for p in fbo]
        + [{"schema": "FBS", **p} for p in fbs],
    }
    destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Posting export complete: FBO={len(fbo)}, FBS={len(fbs)}, total={len(fbo) + len(fbs)}")
    print(f"Period (UTC): {since} — {to}")
    print(f"Saved read-only postings: {destination}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
