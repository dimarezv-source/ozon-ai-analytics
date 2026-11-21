"""Normalize explicit product commission fields from Ozon finance accrual records.

These values are kept separate from service-fee components (logistics, storage,
advertising, etc.). Currency is never inferred: when the source does not expose
one, the row is explicitly marked as unspecified.
"""
from collections import defaultdict
from decimal import Decimal, InvalidOperation


AMOUNT_FIELDS = ("seller_price", "sale_price", "sale_commission", "bonus", "coinvestment")


def _decimal(value):
    if isinstance(value, dict):
        value = value.get("amount")
    try:
        result = Decimal(str(value))
        return result if result.is_finite() else None
    except (InvalidOperation, TypeError, ValueError):
        return None


def _currency(*values):
    for value in values:
        if isinstance(value, dict) and (value.get("currency") or value.get("currency_code")):
            return str(value.get("currency") or value.get("currency_code"))
    return ""


def normalize_product_commissions(records, delivered_postings=None):
    """Extract explicit posting.products[].commission values without guessing."""
    schemas = {
        str(row.get("posting_number")): str(row.get("fulfillment_type"))
        for row in (delivered_postings or [])
        if isinstance(row, dict)
        and row.get("posting_number") not in (None, "")
        and row.get("fulfillment_type") in ("FBO", "FBS")
    }
    totals = defaultdict(lambda: {
        "fulfillment_type": None, "sku": None, "currency": "",
        "seller_price": Decimal("0"), "sale_price": Decimal("0"),
        "sale_commission": Decimal("0"), "bonus": Decimal("0"),
        "coinvestment": Decimal("0"), "records": 0,
    })
    rows = []
    for record in records or []:
        if not isinstance(record, dict):
            continue
        posting = record.get("posting") if isinstance(record.get("posting"), dict) else {}
        number = record.get("posting_number") or posting.get("posting_number")
        if number in (None, ""):
            continue
        number = str(number)
        fulfillment = schemas.get(number)
        products = posting.get("products", [])
        if not isinstance(products, list):
            continue
        for product in products:
            if not isinstance(product, dict):
                continue
            commission = product.get("commission")
            if not isinstance(commission, dict):
                continue
            values = {field: _decimal(commission.get(field)) for field in AMOUNT_FIELDS}
            if not any(value is not None for value in values.values()):
                continue
            currency = _currency(*(commission.get(field) for field in AMOUNT_FIELDS),
                                 product.get("price"), product.get("currency"))
            sku = str(product.get("sku")) if product.get("sku") not in (None, "") else None
            row = {
                "posting_number": number, "fulfillment_type": fulfillment,
                "reconciliation_status": "matched" if fulfillment else "unmatched",
                "sku": sku, "currency": currency,
                **{field: str(value) if value is not None else None for field, value in values.items()},
                "commission_ratio": commission.get("commission_ratio"),
            }
            rows.append(row)
            key = (fulfillment or "UNMATCHED", sku or "UNATTRIBUTED", currency)
            item = totals[key]
            item["fulfillment_type"] = fulfillment
            item["sku"] = sku
            item["currency"] = currency
            item["records"] += 1
            for field, value in values.items():
                if value is not None:
                    item[field] += value

    summary = []
    for key, item in sorted(totals.items()):
        summary.append({
            **item,
            **{field: str(item[field]) for field in AMOUNT_FIELDS},
        })
    matched = sum(1 for row in rows if row["reconciliation_status"] == "matched")
    return {
        "product_commissions": rows,
        "product_commission_summary": summary,
        "product_commission_metrics": {
            "record_count": len(rows),
            "matched_count": matched,
            "unmatched_count": len(rows) - matched,
            "currency_unspecified_count": sum(1 for row in rows if not row["currency"]),
        },
        "product_commission_basis": (
            "Explicit posting.products[].commission source fields. These are kept "
            "separate from service accrual components; currency is not inferred. "
            "Only exact delivered posting-number matches receive FBO/FBS attribution."
        ),
    }
