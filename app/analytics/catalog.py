"""Pure catalog metrics that do not depend on the Ozon network client."""
from collections.abc import Iterable
from typing import Any


def summarize_catalog(items: Iterable[dict[str, Any]]) -> dict[str, int | float]:
    """Build a compact summary from product-list records."""
    total = 0
    archived = 0
    fbo_stock = 0
    fbs_stock = 0
    discounted = 0
    missing_offer_id = 0

    for item in items:
        if not isinstance(item, dict):
            raise ValueError("Catalog records must be objects")

        total += 1
        archived += bool(item.get("archived", False))
        fbo_stock += bool(item.get("has_fbo_stocks", False))
        fbs_stock += bool(item.get("has_fbs_stocks", False))
        discounted += bool(item.get("is_discounted", False))
        missing_offer_id += not bool(str(item.get("offer_id", "")).strip())

    active = total - archived
    return {
        "total_products": total,
        "active_products": active,
        "archived_products": archived,
        "products_with_fbo_stock": fbo_stock,
        "products_with_fbs_stock": fbs_stock,
        "discounted_products": discounted,
        "products_without_offer_id": missing_offer_id,
        "active_share_percent": round(active / total * 100, 2) if total else 0.0,
    }
