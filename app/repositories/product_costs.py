"""Workspace-scoped persistence operations for product unit-economics inputs."""
import math

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ProductCost

ALLOWED_COST_FIELDS = frozenset({"cost", "pack", "ads", "transit", "other", "tax"})


def normalize_cost_values(values: dict) -> dict[str, float]:
    """Validate and normalize the editable numeric fields stored for one SKU."""
    if not isinstance(values, dict):
        raise ValueError("Product cost values must be an object.")
    unknown = set(values) - ALLOWED_COST_FIELDS
    if unknown:
        raise ValueError("Unsupported product cost field.")
    normalized: dict[str, float] = {}
    for key, raw in values.items():
        if isinstance(raw, bool):
            raise ValueError(f"{key} must be a non-negative number.")
        try:
            number = float(raw)
        except (TypeError, ValueError, OverflowError):
            raise ValueError(f"{key} must be a non-negative number.") from None
        if not math.isfinite(number) or number < 0:
            raise ValueError(f"{key} must be a finite non-negative number.")
        normalized[key] = number
    return normalized


def list_product_costs(session: Session, workspace_id: int) -> list[ProductCost]:
    """Return costs for exactly one already-authorized workspace."""
    if workspace_id <= 0:
        raise ValueError("A valid workspace is required.")
    statement = (
        select(ProductCost)
        .where(ProductCost.workspace_id == workspace_id)
        .order_by(ProductCost.product_key)
    )
    return list(session.scalars(statement).all())


def get_product_cost(
    session: Session, workspace_id: int, product_key: str
) -> ProductCost | None:
    if workspace_id <= 0:
        raise ValueError("A valid workspace is required.")
    key = str(product_key or "").strip()
    if not key or len(key) > 180:
        raise ValueError("Product key must contain 1 to 180 characters.")
    statement = select(ProductCost).where(
        ProductCost.workspace_id == workspace_id,
        ProductCost.product_key == key,
    )
    return session.scalar(statement)


def upsert_product_cost(
    session: Session, workspace_id: int, product_key: str, values: dict
) -> ProductCost:
    """Insert or update a product cost without crossing workspace boundaries.

    The caller owns transaction commit/rollback and must authorize workspace_id
    against the current authenticated user before calling this function.
    """
    normalized = normalize_cost_values(values)
    key = str(product_key or "").strip()
    if workspace_id <= 0:
        raise ValueError("A valid workspace is required.")
    if not key or len(key) > 180:
        raise ValueError("Product key must contain 1 to 180 characters.")
    record = get_product_cost(session, workspace_id, key)
    if record is None:
        record = ProductCost(
            workspace_id=workspace_id, product_key=key, values=normalized
        )
        session.add(record)
    else:
        record.values = normalized
    session.flush()
    return record


def delete_product_cost(
    session: Session, workspace_id: int, product_key: str
) -> bool:
    """Delete only the matching product record inside the supplied workspace."""
    record = get_product_cost(session, workspace_id, product_key)
    if record is None:
        return False
    session.delete(record)
    session.flush()
    return True
