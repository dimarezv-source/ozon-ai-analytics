"""Ozon Seller API client with an explicit read-only operation allowlist.

POST is permitted only for individually reviewed read operations. No write
operation is registered here.
"""
import asyncio
import math
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx


ALLOWED_API_HOSTS = {"api-seller.ozon.ru", "api-seller-sandbox.ozon.ru"}


@dataclass(frozen=True)
class ReadOperation:
    path: str
    http_method: str


# /v3/product/list is an informational catalog endpoint. The current role
# mapping article still names its retired predecessor /v2/product/list under
# Admin read-only; the Ozon key itself must therefore remain Admin read-only.
# No mutation, price-changing, stock-changing, or promotion operation is registered; posting and return
# operations below are explicitly read-only list endpoints.
READ_ONLY_OPERATIONS: dict[str, ReadOperation] = {
    "product_list": ReadOperation(
        path="/v3/product/list",
        http_method="POST",
    ),
    "product_info_list": ReadOperation(path="/v3/product/info/list", http_method="POST"),
    "product_info_attributes": ReadOperation(path="/v4/product/info/attributes", http_method="POST"),
    "product_info_prices": ReadOperation(path="/v5/product/info/prices", http_method="POST"),
    "product_info_stocks": ReadOperation(path="/v4/product/info/stocks", http_method="POST"),
    "finance_accrual_types": ReadOperation(path="/v1/finance/accrual/types", http_method="POST"),
    "finance_accrual_by_day": ReadOperation(path="/v1/finance/accrual/by-day", http_method="POST"),
    "finance_accrual_postings": ReadOperation(path="/v1/finance/accrual/postings", http_method="POST"),
    "finance_accrual_postings": ReadOperation(path="/v1/finance/accrual/postings", http_method="POST"),
    "posting_fbo_list": ReadOperation(path="/v3/posting/fbo/list", http_method="POST"),
    "posting_fbs_list": ReadOperation(path="/v4/posting/fbs/list", http_method="POST"),
    "returns_list": ReadOperation(path="/v1/returns/list", http_method="POST"),
}


class OzonReadOnlyClient:
    def __init__(self, client_id: str, api_key: str, base_url: str) -> None:
        parsed = urlsplit(base_url)
        if (
            parsed.scheme != "https"
            or parsed.hostname not in ALLOWED_API_HOSTS
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Ozon API base URL must be an approved HTTPS Ozon host")

        self._base_url = base_url.rstrip("/")
        self._headers = {
            "Client-Id": client_id,
            "Api-Key": api_key,
            "Content-Type": "application/json",
        }

    async def execute(
        self,
        operation_name: str,
        payload: dict | None = None,
    ) -> dict:
        operation = READ_ONLY_OPERATIONS.get(operation_name)
        if operation is None:
            raise ValueError(
                f"Operation is not allowlisted for read-only access: {operation_name}"
            )

        async with httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers,
            timeout=httpx.Timeout(15.0),
        ) as client:
            # Ozon may temporarily return 429 even when this service is not
            # issuing requests rapidly (the Client-Id quota is shared with
            # other integrations). Respect Retry-After instead of failing the
            # entire finance reconciliation immediately.
            for attempt in range(4):
                response = await client.request(
                    operation.http_method,
                    operation.path,
                    json=payload or {},
                )
                if response.status_code != 429:
                    response.raise_for_status()
                    return response.json()
                if attempt == 3:
                    response.raise_for_status()

                retry_after = response.headers.get("Retry-After")
                try:
                    delay = float(retry_after)
                    if not math.isfinite(delay) or delay < 0:
                        raise ValueError("Invalid Retry-After")
                except (TypeError, ValueError):
                    delay = float(2 ** attempt)
                await asyncio.sleep(delay)

            raise RuntimeError("Ozon API retry loop exited unexpectedly")
