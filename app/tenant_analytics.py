"""Fail-closed request context for tenant/store-scoped Ozon analytics."""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, Query, Request

from app.auth_api import _current_user_session
from app.config import get_settings
from app.ozon.client import OzonReadOnlyClient
from app.security import CredentialEncryptionNotConfigured
from app.store_repository import StoreAccessDenied, get_store_credentials


@dataclass(frozen=True)
class TenantAnalyticsContext:
    """Trusted server-side analytics identity and store-specific API client."""

    user_id: str
    tenant_id: str
    store_id: str
    store_name: str
    client: OzonReadOnlyClient


def get_tenant_analytics_context(
    request: Request,
    store_id: str = Query(..., min_length=1, max_length=64),
) -> TenantAnalyticsContext:
    """Resolve the live session and an active store belonging to its tenant.

    The browser supplies only the opaque store identifier. User and tenant IDs
    always come from the validated database session. Credentials are decrypted
    only after the store repository verifies the active membership and tenant.
    This dependency intentionally has no legacy/global-credential fallback.
    """
    session = _current_user_session(request)
    user_id = str(session["user_id"])
    tenant_id = str(session["tenant_id"])

    try:
        credentials = get_store_credentials(user_id, tenant_id, store_id)
    except StoreAccessDenied:
        # Avoid disclosing whether a foreign-tenant store identifier exists.
        raise HTTPException(status_code=404, detail="Active store not found.") from None
    except CredentialEncryptionNotConfigured:
        raise HTTPException(
            status_code=503,
            detail="Server-side credential encryption is not configured.",
        ) from None
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid store identifier or stored credentials.") from None

    client_id = credentials.get("client_id")
    api_key = credentials.get("api_key")
    if not isinstance(client_id, str) or not client_id.strip() or not isinstance(api_key, str) or not api_key:
        raise HTTPException(status_code=503, detail="Selected store credentials are unavailable.")

    try:
        client = OzonReadOnlyClient(
            client_id.strip(),
            api_key,
            get_settings().ozon_api_base_url,
        )
    except (TypeError, ValueError):
        raise HTTPException(status_code=503, detail="Ozon API client configuration is invalid.") from None

    return TenantAnalyticsContext(
        user_id=user_id,
        tenant_id=tenant_id,
        store_id=str(credentials["store_id"]),
        store_name=str(credentials["name"]),
        client=client,
    )
