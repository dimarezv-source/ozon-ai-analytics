import pytest

from app.analytics.catalog import summarize_catalog


def test_summarize_catalog_counts_and_active_share() -> None:
    summary = summarize_catalog(
        [
            {
                "product_id": 1,
                "offer_id": "A-1",
                "archived": False,
                "has_fbo_stocks": True,
                "has_fbs_stocks": False,
                "is_discounted": True,
            },
            {
                "product_id": 2,
                "offer_id": "A-2",
                "archived": True,
                "has_fbo_stocks": False,
                "has_fbs_stocks": True,
                "is_discounted": False,
            },
            {"product_id": 3, "offer_id": ""},
        ]
    )

    assert summary == {
        "total_products": 3,
        "active_products": 2,
        "archived_products": 1,
        "products_with_fbo_stock": 1,
        "products_with_fbs_stock": 1,
        "discounted_products": 1,
        "products_without_offer_id": 1,
        "active_share_percent": 66.67,
    }


def test_summarize_empty_catalog() -> None:
    assert summarize_catalog([]) == {
        "total_products": 0,
        "active_products": 0,
        "archived_products": 0,
        "products_with_fbo_stock": 0,
        "products_with_fbs_stock": 0,
        "discounted_products": 0,
        "products_without_offer_id": 0,
        "active_share_percent": 0.0,
    }


def test_summarize_catalog_rejects_non_object_records() -> None:
    with pytest.raises(ValueError, match="must be objects"):
        summarize_catalog([{"product_id": 1}, "bad"])  # type: ignore[list-item]
