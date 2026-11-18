"""Normalize posting-level Ozon accruals without inventing product attribution."""
from collections import defaultdict
from decimal import Decimal, InvalidOperation


def normalize_posting_accruals(posting_accruals, type_dictionary=None, delivered_postings=None):
    """Aggregate explicit posting/SKU accrual rows by fulfillment, SKU, type and currency."""
    types = type_dictionary or {}
    schemas = {
        str(row.get("posting_number")): row.get("fulfillment_type")
        for row in (delivered_postings or [])
        if isinstance(row, dict) and row.get("posting_number") not in (None, "")
        and row.get("fulfillment_type") in ("FBO", "FBS")
    }
    totals = defaultdict(lambda: {"amount": Decimal("0"), "records": 0, "quantity": 0})
    normalized = []
    posting_numbers = set()
    for posting in posting_accruals or []:
        if not isinstance(posting, dict):
            continue
        number = posting.get("posting_number")
        if number in (None, ""):
            continue
        number = str(number)
        posting_numbers.add(number)
        for row in posting.get("accruals", []) or []:
            if not isinstance(row, dict) or row.get("sku") in (None, ""):
                continue
            type_id = str(row.get("type_id")) if row.get("type_id") is not None else "UNKNOWN"
            meta = types.get(type_id, {}) if isinstance(types, dict) else {}
            label = (meta.get("name") or meta.get("description")) if isinstance(meta, dict) else None
            money = row.get("accrued") if isinstance(row.get("accrued"), dict) else {}
            currency = str(money.get("currency") or "")
            try:
                amount = Decimal(str(money.get("amount")))
                if not amount.is_finite():
                    raise InvalidOperation
            except (InvalidOperation, ValueError, TypeError):
                continue
            try:
                quantity = max(0, int(row.get("quantity") or 0))
            except (TypeError, ValueError):
                quantity = 0
            sku = str(row["sku"])
            schema = schemas.get(number) or "UNMATCHED"
            key = (schema, sku, type_id, currency)
            bucket = totals[key]
            bucket["amount"] += amount
            bucket["records"] += 1
            bucket["quantity"] += quantity
            normalized.append({
                "posting_number": number, "fulfillment_type": schemas.get(number),
                "sku": sku, "type_id": type_id, "label": label,
                "currency": currency, "amount": str(amount), "quantity": quantity,
                "accrual_date": row.get("accrual_date"),
            })
    summary = []
    for key, value in sorted(totals.items()):
        meta = types.get(key[2], {}) if isinstance(types, dict) else {}
        summary.append({
            "fulfillment_type": key[0], "sku": key[1], "type_id": key[2],
            "label": (meta.get("name") or meta.get("description")) if isinstance(meta, dict) else None,
            "currency": key[3], "amount": str(value["amount"]),
            "records": value["records"], "reported_quantity": value["quantity"],
        })
    return {
        "posting_accruals": normalized,
        "posting_product_summary": summary,
        "posting_accrual_metrics": {
            "posting_count": len(posting_numbers), "sku_record_count": len(normalized),
            "unmatched_posting_count": sum(1 for number in posting_numbers if number not in schemas),
        },
    }
