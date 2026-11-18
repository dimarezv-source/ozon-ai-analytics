import base64
import hashlib
import hmac
import logging
import secrets
import time as time_module
from pathlib import Path
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qs

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from app.config import get_settings
from app.ozon.client import OzonReadOnlyClient

logger = logging.getLogger(__name__)
security = HTTPBasic(auto_error=False)

app = FastAPI(
    title="Ozon AI Analytics",
    description="Read-only Ozon Seller analytics service.",
    version="0.4.0",
)

DASHBOARD_FILE = Path(__file__).resolve().parents[1] / "dashboard" / "index.html"
PROFIT_CALCULATOR_FILE = Path(__file__).resolve().parents[1] / "dashboard" / "profit-calculator.js"


def _session_token(username: str, password: str, expires: int) -> str:
    payload = f"{username}:{expires}".encode("utf-8")
    signature = hmac.new(password.encode("utf-8"), payload, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(payload + b"." + signature.hex().encode("ascii")).decode("ascii")


def _valid_session(token: str | None, username: str, password: str) -> bool:
    if not token:
        return False
    try:
        decoded = base64.urlsafe_b64decode(token.encode("ascii"))
        payload, signature = decoded.rsplit(b".", 1)
        token_user, expires_text = payload.decode("utf-8").rsplit(":", 1)
        expires = int(expires_text)
        expected = hmac.new(password.encode("utf-8"), payload, hashlib.sha256).digest()
        return (
            secrets.compare_digest(token_user, username)
            and expires >= int(time_module.time())
            and hmac.compare_digest(signature, expected.hex().encode("ascii"))
        )
    except (ValueError, UnicodeError):
        return False


def require_dashboard_auth(
    request: Request,
    credentials: HTTPBasicCredentials | None = Depends(security),
) -> None:
    """Protect dashboard routes using a signed login cookie or HTTP Basic."""
    settings = get_settings()
    expected_username = settings.dashboard_username
    expected_password = settings.dashboard_password

    if not expected_username or not expected_password:
        raise HTTPException(
            status_code=503,
            detail="Dashboard authentication is not configured on this server.",
        )

    cookie_ok = _valid_session(
        request.cookies.get("ozon_dashboard_session"),
        expected_username,
        expected_password,
    )
    basic_ok = (
        credentials is not None
        and secrets.compare_digest(credentials.username.encode("utf-8"), expected_username.encode("utf-8"))
        and secrets.compare_digest(credentials.password.encode("utf-8"), expected_password.encode("utf-8"))
    )
    if not (cookie_ok or basic_ok):
        raise HTTPException(status_code=401, detail="Authentication required.", headers={"WWW-Authenticate": "Basic"})


@app.get("/login", tags=["dashboard"], response_class=HTMLResponse, include_in_schema=False)
async def login_page() -> HTMLResponse:
    return HTMLResponse("""<!doctype html>
<html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вход · Ozon AI Analytics</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111827;color:#f9fafb;font:16px Arial,sans-serif}
form{width:min(92vw,390px);padding:30px;background:#1f2937;border:1px solid #374151;border-radius:18px}
h1{font-size:23px;margin:0 0 8px}p{color:#9ca3af;margin:0 0 24px}
label{display:block;margin:15px 0 7px;color:#d1d5db;font-size:14px}
input{width:100%;padding:13px;border:1px solid #4b5563;border-radius:9px;background:#111827;color:white;font-size:16px}
button{width:100%;margin-top:22px;padding:13px;border:0;border-radius:9px;background:#f97316;color:#111827;font-weight:700;font-size:16px;cursor:pointer}
</style>
<form method="post" action="/login"><h1>Ozon AI Analytics</h1><p>Войдите в личный кабинет</p>
<label for="username">Логин</label><input id="username" name="username" autocomplete="username" required>
<label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Войти</button></form></html>""")


@app.post("/login", include_in_schema=False)
async def login_submit(request: Request):
    settings = get_settings()
    body = (await request.body()).decode("utf-8", errors="replace")
    fields = parse_qs(body)
    username = fields.get("username", [""])[0]
    password = fields.get("password", [""])[0]
    if not settings.dashboard_username or not settings.dashboard_password:
        raise HTTPException(status_code=503, detail="Dashboard authentication is not configured.")
    valid = (
        secrets.compare_digest(username.encode("utf-8"), settings.dashboard_username.encode("utf-8"))
        and secrets.compare_digest(password.encode("utf-8"), settings.dashboard_password.encode("utf-8"))
    )
    if not valid:
        return HTMLResponse(
            "<!doctype html><meta charset='utf-8'><p>Неверный логин или пароль.</p><a href='/login'>Попробовать снова</a>",
            status_code=401,
        )
    expires = int(time_module.time()) + 12 * 60 * 60
    token = _session_token(username, settings.dashboard_password, expires)
    response = RedirectResponse(url="/dashboard", status_code=303)
    response.set_cookie(
        "ozon_dashboard_session", token, max_age=12 * 60 * 60,
        httponly=True, secure=True, samesite="lax", path="/",
    )
    return response


@app.post("/logout", include_in_schema=False)
async def logout():
    response = RedirectResponse(url="/login", status_code=303)
    response.delete_cookie("ozon_dashboard_session", path="/")
    return response


@app.get("/api/sales", tags=["dashboard"])
async def sales_data(request: Request, _: None = Depends(require_dashboard_auth)) -> dict:
    """Read-only delivered FBO/FBS sales for a selected UTC date range."""
    raw_from = request.query_params.get("date_from", "")
    raw_to = request.query_params.get("date_to", "")
    try:
        date_from = date.fromisoformat(raw_from)
        date_to = date.fromisoformat(raw_to)
    except ValueError:
        raise HTTPException(status_code=400, detail="Укажите даты в формате ГГГГ-ММ-ДД.") from None
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="Дата окончания не может быть раньше даты начала.")
    if (date_to - date_from).days > 364:
        raise HTTPException(status_code=400, detail="Максимальный период одного запроса — 365 дней.")
    settings = get_settings()
    if not settings.ozon_client_id or not settings.ozon_api_key:
        raise HTTPException(status_code=503, detail="Ozon API credentials are not configured.")
    client = OzonReadOnlyClient(settings.ozon_client_id, settings.ozon_api_key, settings.ozon_api_base_url)
    since = datetime.combine(date_from, time.min, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    to = datetime.combine(date_to + timedelta(days=1), time.min, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    delivered_postings = set()
    delivered_posting_refs: dict[str, str] = {}
    units = 0
    gmv = Decimal("0")
    unpriced_units = 0
    counts = {"FBO": 0, "FBS": 0}
    schema_units = {"FBO": 0, "FBS": 0}
    schema_gmv = {"FBO": Decimal("0"), "FBS": Decimal("0")}
    sku_sales: dict[str, dict] = {}
    try:
        for schema, path in (("FBO", "/v3/posting/fbo/list"), ("FBS", "/v4/posting/fbs/list")):
            cursor = ""
            seen_cursors = set()
            for _ in range(5000):
                payload = {"filter": {"since": since, "to": to}, "limit": 100, "cursor": cursor,
                           "sort_dir": "ASC", "with": {"analytics_data": True, "financial_data": True, "legal_info": False}}
                if schema == "FBS":
                    payload["with"]["barcodes"] = False
                    payload["with"]["translit"] = False
                operation = "posting_fbo_list" if schema == "FBO" else "posting_fbs_list"
                response = await client.execute(operation, payload)
                body = response.get("result", response)
                if not isinstance(body, dict) or not isinstance(body.get("postings"), list):
                    raise ValueError(f"Unexpected {schema} postings response.")
                for posting in body["postings"]:
                    if not isinstance(posting, dict) or str(posting.get("status") or "").lower() != "delivered":
                        continue
                    number = str(posting.get("posting_number") or "")
                    if not number:
                        continue
                    delivered_postings.add(number)
                    delivered_posting_refs[number] = schema
                    counts[schema] += 1
                    for product in posting.get("products", []):
                        if not isinstance(product, dict):
                            continue
                        try:
                            quantity = max(0, int(product.get("quantity") or 0))
                        except (TypeError, ValueError):
                            quantity = 0
                        units += quantity
                        schema_units[schema] += quantity
                        sku = str(product.get("sku") or "")
                        product_id = str(product.get("product_id") or "")
                        offer_id = str(product.get("offer_id") or "")
                        name = str(product.get("name") or offer_id or product_id or sku or "Товар без названия")
                        product_key = sku or product_id or offer_id or name
                        key = f"{schema}:{product_key}"
                        row = sku_sales.setdefault(key, {
                            "fulfillment_type": schema,
                            "sku": sku or None, "product_id": product_id or None,
                            "offer_id": offer_id or None, "name": name,
                            "units": 0, "sales_gmv": Decimal("0"), "unpriced_units": 0,
                        })
                        row["units"] += quantity
                        try:
                            price = Decimal(str(product.get("price")))
                            if not price.is_finite() or price < 0:
                                raise InvalidOperation
                            line_gmv = price * quantity
                            gmv += line_gmv
                            schema_gmv[schema] += line_gmv
                            row["sales_gmv"] += line_gmv
                        except (InvalidOperation, ValueError, TypeError):
                            unpriced_units += quantity
                            row["unpriced_units"] += quantity
                has_next = body.get("has_next", False)
                next_cursor = body.get("cursor") or ""
                if not has_next:
                    break
                if not next_cursor or next_cursor == cursor or next_cursor in seen_cursors:
                    raise ValueError(f"{schema}: invalid pagination cursor.")
                seen_cursors.add(next_cursor)
                cursor = next_cursor
            else:
                raise ValueError(f"{schema}: pagination safety limit reached.")
        product_rows = [
            {**row, "sales_gmv": float(row["sales_gmv"])}
            for row in sorted(sku_sales.values(), key=lambda item: item["sales_gmv"], reverse=True)
        ]
        return {"status": "ok", "mode": "read-only", "period": {"date_from": raw_from, "date_to": raw_to, "timezone": "UTC"},
                "sales_gmv": float(gmv), "delivered_units": units, "delivered_postings": len(delivered_postings),
                "fbo_postings": counts["FBO"], "fbs_postings": counts["FBS"], "unpriced_units": unpriced_units,
                "fulfillment": {
                    schema: {"delivered_units": schema_units[schema], "sales_gmv": float(schema_gmv[schema]),
                             "delivered_postings": counts[schema]}
                    for schema in ("FBO", "FBS")
                },
                "products": product_rows,
                "delivered_posting_refs": [
                    {"posting_number": number, "fulfillment_type": schema}
                    for number, schema in sorted(delivered_posting_refs.items())
                ],
                "basis": "Delivered postings at current status; GMV is estimated from item price x quantity before returns and deductions."}
    except Exception as exc:
        logger.exception("Could not retrieve Ozon sales for selected period: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Не удалось получить продажи из Ozon. Проверьте логи сервера.") from None


def _extract_fee_components(value: object) -> list[dict]:
    """Keep each Ozon fee type_id paired with its own accrued money object."""
    found: list[dict] = []

    def walk(node: object, path: str = "") -> None:
        if isinstance(node, list):
            for index, child in enumerate(node):
                walk(child, f"{path}[{index}]")
            return
        if not isinstance(node, dict):
            return

        accrued = node.get("accrued")
        type_id = node.get("type_id")
        if (
            type_id is not None
            and isinstance(accrued, dict)
            and accrued.get("amount") is not None
        ):
            found.append({
                "type_id": str(type_id),
                "amount": accrued.get("amount"),
                "currency": accrued.get("currency"),
                "path": path,
            })
            return

        for key, child in node.items():
            walk(child, f"{path}.{key}" if path else key)

    walk(value)
    return found


def _summarize_fee_components(rows: list[dict]) -> list[dict]:
    """Aggregate only explicitly paired Ozon fee components; preserve currency and sign."""
    totals: dict[tuple[str, str], dict] = {}
    for row in rows:
        for component in row.get("fee_components", []):
            if not isinstance(component, dict):
                continue
            type_id = str(component.get("type_id") or "")
            currency = str(component.get("currency") or "")
            if not type_id or not currency or component.get("amount") is None:
                continue
            try:
                amount = Decimal(str(component["amount"]))
                if not amount.is_finite():
                    continue
            except (InvalidOperation, ValueError, TypeError):
                continue
            key = (type_id, currency)
            item = totals.setdefault(key, {"type_id": type_id, "currency": currency, "amount": Decimal("0"), "count": 0})
            item["amount"] += amount
            item["count"] += 1
    return [
        {**item, "amount": str(item["amount"])}
        for _, item in sorted(totals.items(), key=lambda pair: (pair[0][0], pair[0][1]))
    ]


def _summarize_posting_fee_components(rows: list[dict]) -> list[dict]:
    """Group fee components only when Ozon explicitly supplies a posting number."""
    totals: dict[tuple[str, str, str], dict] = {}
    for row in rows:
        posting = row.get("posting")
        posting_number = row.get("posting_number")
        if posting_number in (None, "") and isinstance(posting, dict):
            posting_number = posting.get("posting_number")
        if posting_number in (None, ""):
            continue
        for component in row.get("fee_components", []):
            if not isinstance(component, dict):
                continue
            type_id = str(component.get("type_id") or "")
            currency = str(component.get("currency") or "")
            if not type_id or not currency or component.get("amount") is None:
                continue
            try:
                amount = Decimal(str(component["amount"]))
                if not amount.is_finite():
                    continue
            except (InvalidOperation, ValueError, TypeError):
                continue
            key = (str(posting_number), type_id, currency)
            item = totals.setdefault(key, {
                "posting_number": str(posting_number), "type_id": type_id,
                "currency": currency, "amount": Decimal("0"), "count": 0,
            })
            item["amount"] += amount
            item["count"] += 1
    return [
        {**item, "amount": str(item["amount"])}
        for _, item in sorted(totals.items(), key=lambda pair: pair[0])
    ]


@app.get("/api/finance/accruals", tags=["dashboard"])
async def finance_accruals(request: Request, _: None = Depends(require_dashboard_auth)) -> dict:
    """Read-only raw Ozon accruals, fetched sequentially one calendar day at a time."""
    raw_from = request.query_params.get("date_from", "")
    raw_to = request.query_params.get("date_to", "")
    try:
        date_from = date.fromisoformat(raw_from)
        date_to = date.fromisoformat(raw_to)
    except ValueError:
        raise HTTPException(status_code=400, detail="Укажите даты в формате ГГГГ-ММ-ДД.") from None
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="Дата окончания не может быть раньше даты начала.")
    if (date_to - date_from).days > 30:
        raise HTTPException(status_code=400, detail="Максимальный период финансовых начислений — 31 день.")
    settings = get_settings()
    if not settings.ozon_client_id or not settings.ozon_api_key:
        raise HTTPException(status_code=503, detail="Ozon API credentials are not configured.")
    client = OzonReadOnlyClient(settings.ozon_client_id, settings.ozon_api_key, settings.ozon_api_base_url)
    try:
        # Ozon requires sequential calls for this API family. Keep by-day pages
        # sequential too; never infer totals from forecast tariffs.
        type_response = await client.execute("finance_accrual_types", {})
        types = type_response.get("accrual_types", [])
        if not isinstance(types, list):
            raise ValueError("Unexpected accrual types response.")
        type_names = {
            str(item.get("id")): {
                "name": item.get("name"),
                "description": item.get("description"),
            }
            for item in types if isinstance(item, dict) and item.get("id") is not None
        }
        rows = []
        day = date_from
        while day <= date_to:
            last_id = ""
            seen_ids = set()
            for _ in range(200):
                response = await client.execute(
                    "finance_accrual_by_day", {"date": day.isoformat(), "last_id": last_id}
                )
                page = response.get("accruals", [])
                if not isinstance(page, list):
                    raise ValueError("Unexpected accruals response.")
                for item in page:
                    if not isinstance(item, dict):
                        raise ValueError("Unexpected accrual record.")
                    record = dict(item)
                    record["date"] = day.isoformat()
                    record["fee_components"] = _extract_fee_components(record)
                    rows.append(record)
                next_id = response.get("last_id") or ""
                if not next_id:
                    break
                if not isinstance(next_id, str) or next_id == last_id or next_id in seen_ids:
                    raise ValueError("Ozon returned an invalid accrual pagination cursor.")
                seen_ids.add(next_id)
                last_id = next_id
            else:
                raise ValueError("Accrual pagination safety limit reached.")
            day += timedelta(days=1)
        return {
            "status": "ok",
            "mode": "read-only",
            "period": {"date_from": raw_from, "date_to": raw_to},
            "record_count": len(rows),
            "accrual_types": type_names,
            "fee_summary": _summarize_fee_components(rows),
            "posting_fee_summary": _summarize_posting_fee_components(rows),
            "accruals": rows,
            "basis": "Raw Ozon accrual records by calendar day. No forecast tariffs or estimated zero values are mixed into this report.",
        }
    except Exception as exc:
        logger.exception("Could not retrieve Ozon accruals for selected period: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Не удалось получить финансовые начисления Ozon. Проверьте логи сервера.") from None


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok", "mode": "read-only"}


@app.get("/dashboard", tags=["dashboard"], include_in_schema=False)
async def dashboard(_: None = Depends(require_dashboard_auth)) -> FileResponse:
    return FileResponse(DASHBOARD_FILE, media_type="text/html")


@app.get("/dashboard/profit-calculator.js", tags=["dashboard"], include_in_schema=False)
async def profit_calculator_script(_: None = Depends(require_dashboard_auth)) -> FileResponse:
    return FileResponse(PROFIT_CALCULATOR_FILE, media_type="application/javascript")


@app.get("/api/dashboard", tags=["dashboard"])
async def dashboard_data(_: None = Depends(require_dashboard_auth)) -> dict:
    """Fetch a fresh read-only catalog and current FBS price/commission data."""
    settings = get_settings()
    if not settings.ozon_client_id or not settings.ozon_api_key:
        raise HTTPException(
            status_code=503,
            detail="Ozon API credentials are not configured on this server.",
        )

    client = OzonReadOnlyClient(
        settings.ozon_client_id,
        settings.ozon_api_key,
        settings.ozon_api_base_url,
    )
    try:
        catalog_items: list[dict] = []
        cursor = ""
        seen: set[str] = set()
        for _ in range(100):
            response = await client.execute(
                "product_list",
                {"filter": {"visibility": "ALL"}, "last_id": cursor, "limit": 1000},
            )
            result = response.get("result") or {}
            page = result.get("items") or []
            if not isinstance(page, list):
                raise ValueError("Unexpected catalog response from Ozon.")
            catalog_items.extend(item for item in page if isinstance(item, dict))
            next_cursor = result.get("last_id") or ""
            if not next_cursor:
                break
            if not isinstance(next_cursor, str) or next_cursor in seen or next_cursor == cursor:
                raise ValueError("Ozon returned an invalid catalog pagination cursor.")
            seen.add(next_cursor)
            cursor = next_cursor
        else:
            raise ValueError("Catalog pagination safety limit reached.")

        product_ids = [
            int(item["product_id"])
            for item in catalog_items
            if str(item.get("product_id", "")).isdigit()
        ]
        details: list[dict] = []
        for start in range(0, len(product_ids), 1000):
            response = await client.execute(
                "product_info_list", {"product_id": product_ids[start:start + 1000]}
            )
            batch = response.get("items") or []
            if not isinstance(batch, list):
                raise ValueError("Unexpected product details response from Ozon.")
            details.extend(item for item in batch if isinstance(item, dict))

        detail_by_id = {
            str(item.get("id", item.get("product_id", ""))): item for item in details
        }
        products = []
        for item in catalog_items:
            pid = str(item.get("product_id", ""))
            detail = detail_by_id.get(pid, {})
            products.append({
                **item,
                **detail,
                "product_id": item.get("product_id", detail.get("id")),
            })

        offer_ids = list(dict.fromkeys(
            str(item["offer_id"])
            for item in products
            if item.get("offer_id") not in (None, "")
        ))
        price_items: list[dict] = []
        # Ozon's filter accepts up to 1000 offer IDs per request. Process all
        # offers in batches so larger stores do not silently miss later SKUs.
        for offer_start in range(0, len(offer_ids), 1000):
            offer_batch = offer_ids[offer_start:offer_start + 1000]
            cursor = ""
            seen.clear()
            for _ in range(100):
                response = await client.execute(
                    "product_info_prices",
                    {
                        "cursor": cursor,
                        "filter": {"offer_id": offer_batch},
                        "limit": 1000,
                    },
                )
                page = response.get("items")
                if page is None and isinstance(response.get("result"), dict):
                    page = response["result"].get("items", [])
                if not isinstance(page, list):
                    raise ValueError("Unexpected price response from Ozon.")
                price_items.extend(item for item in page if isinstance(item, dict))
                next_cursor = response.get("cursor") or (
                    response.get("result") or {}
                ).get("cursor", "")
                if not next_cursor or not page:
                    break
                if (
                    not isinstance(next_cursor, str)
                    or next_cursor in seen
                    or next_cursor == cursor
                ):
                    raise ValueError("Ozon returned an invalid price pagination cursor.")
                seen.add(next_cursor)
                cursor = next_cursor
            else:
                raise ValueError("Price pagination safety limit reached.")

        prices_by_offer = {
            str(item.get("offer_id")): item
            for item in price_items
            if item.get("offer_id") not in (None, "")
        }
        prices_by_product = {
            str(item.get("product_id")): item
            for item in price_items
            if item.get("product_id") not in (None, "")
        }
        output = []
        for item in products:
            offer = str(item.get("offer_id", ""))
            pid = str(item.get("product_id", ""))
            price_record = prices_by_product.get(pid) or prices_by_offer.get(offer, {})
            price = price_record.get("price") if isinstance(price_record.get("price"), dict) else {}
            commissions = (
                price_record.get("commissions")
                or price_record.get("comissions")
                or {}
            )
            if not isinstance(commissions, dict):
                commissions = {}
            output.append({
                "product_id": item.get("product_id"),
                "offer_id": item.get("offer_id"),
                "name": item.get("name"),
                "sku": item.get("sku"),
                "price": price.get("price", item.get("price")),
                "old_price": price.get("old_price", item.get("old_price")),
                "sales_percent_fbs": commissions.get("sales_percent_fbs"),
                "sales_percent_fbo": commissions.get("sales_percent_fbo"),
                "first_mile_min": commissions.get("fbs_first_mile_min_amount"),
                "first_mile_max": commissions.get("fbs_first_mile_max_amount"),
                "delivery_to_customer": commissions.get("fbs_deliv_to_customer_amount"),
                "transit_min": commissions.get("fbs_direct_flow_trans_min_amount"),
                "transit_max": commissions.get("fbs_direct_flow_trans_max_amount"),
                "return_flow": commissions.get("fbs_return_flow_amount"),
                "fbo_delivery_to_customer": commissions.get("fbo_deliv_to_customer_amount"),
                "fbo_transit_min": commissions.get("fbo_direct_flow_trans_min_amount"),
                "fbo_transit_max": commissions.get("fbo_direct_flow_trans_max_amount"),
                "fbo_return_flow": commissions.get("fbo_return_flow_amount"),
                "acquiring": price_record.get("acquiring"),
            })

        return {
            "status": "ok",
            "mode": "read-only",
            "source": [
                "/v3/product/list",
                "/v3/product/info/list",
                "/v5/product/info/prices",
            ],
            "products_count": len(output),
            "products": output,
            "sales": {
                "status": "not_connected",
                "note": "Sales and returns are not included in this live endpoint yet.",
            },
        }
    except Exception as exc:
        logger.exception("Could not retrieve Ozon dashboard snapshot: %s", type(exc).__name__)
        raise HTTPException(
            status_code=502,
            detail="Could not retrieve a complete dashboard snapshot from Ozon. Check server logs and API access.",
        ) from None
