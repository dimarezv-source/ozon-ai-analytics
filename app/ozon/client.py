"""Ozon Seller API client foundation.

No API operations are enabled yet. Add a public operation only after verifying
the exact endpoint is read-only in current official Ozon API documentation.
Some read operations use POST, so safety is enforced by an explicit allowlist.
"""

from dataclasses import dataclass

import httpx


@dataclass(frozen=True)
class ReadOperation:
    path: str
    http_method: str


# Intentionally empty until each operation is verified against official docs.
READ_ONLY_OPERATIONS: dict[str, ReadOperation] = {}


class OzonReadOnlyClient:
    def __init__(self, client_id: str, api_key: str, base_url: str) -> None:
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
