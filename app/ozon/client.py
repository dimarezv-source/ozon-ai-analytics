"""Ozon Seller API client with an explicit read-only operation allowlist.

POST is permitted only for individually reviewed read operations. No write
operation is registered here.
"""
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx


ALLOWED_API_HOSTS = {"api-seller.ozon.ru", "api-seller-sandbox.ozon.ru"}


@dataclass(frozen=True)
class ReadOperation:
    path: str
    http_method: str


# Intentionally empty: the current official role map still lists the retired
# /v2/product/list for Admin read-only, while current docs use /v3/product/list.
# Enable an operation only after its access under this key is confirmed.
READ_ONLY_OPERATIONS: dict[str, ReadOperation] = {}


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
            timeout=httpx.Timeout(30.0),
        ) as client:
            response = await client.request(
                operation.http_method,
                operation.path,
                json=payload or {},
            )
            response.raise_for_status()
            return response.json()
