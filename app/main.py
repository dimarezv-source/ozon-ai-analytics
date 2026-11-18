import logging
import secrets
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
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


def require_dashboard_auth(
    credentials: HTTPBasicCredentials | None = Depends(security),
) -> None:
    """Protect the dashboard and live data endpoint with HTTP Basic auth."""
    settings = get_settings()
    expected_username = settings.dashboard_username
    expected_password = settings.dashboard_password

    if not expected_username or not expected_password:
        raise HTTPException(
            status_code=503,
            detail="Dashboard authentication is not configured on this server.",
        )

    valid = (
        credentials is not None
        and secrets.compare_digest(credentials.username.encode('utf-8'), expected_username.encode('utf-8'))
        and secrets.compare_digest(credentials.password.encode('utf-8'), expected_password.encode('utf-8'))
    )
    if not valid:
        raise HTTPException(
            status_code=401,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Basic"},
        )


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok", "mode": "read-only"}


@app.get("/dashboard", tags=["dashboard"], include_in_schema=False)
async def dashboard(_: None = Depends(require_dashboard_auth)) -> FileResponse:
    return FileResponse(DASHBOARD_FILE, media_type="text/html")


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
                "first_mile_min": commissions.get("fbs_first_mile_min_amount"),
                "first_mile_max": commissions.get("fbs_first_mile_max_amount"),
                "delivery_to_customer": commissions.get("fbs_deliv_to_customer_amount"),
                "transit_min": commissions.get("fbs_direct_flow_trans_min_amount"),
                "transit_max": commissions.get("fbs_direct_flow_trans_max_amount"),
                "return_flow": commissions.get("fbs_return_flow_amount"),
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
