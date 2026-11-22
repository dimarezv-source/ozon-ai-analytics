"""Conservative normalization helpers for Ozon accrual reconciliation.

This module never guesses semantic categories from amount sign alone. Unknown
accrual types remain explicitly unclassified; posting attribution requires an
exact posting number present in the source record. Monetary totals are never
combined across currencies.
"""
from decimal import Decimal, InvalidOperation


def money(value):
    if isinstance(value, dict):
        value = value.get("amount")
    try:
        result = Decimal(str(value))
        return result if result.is_finite() else None
    except (InvalidOperation, ValueError, TypeError):
        return None


def collect_components(record):
    """Extract paired fee components and only explicit SKU/product context."""
    found = []

    def walk(node, path="", context=None):
        context = dict(context or {})
        if isinstance(node, list):
            for i, child in enumerate(node):
                walk(child, f"{path}[{i}]", context)
            return
        if not isinstance(node, dict):
            return
        for field in ("sku", "product_id", "offer_id"):
            value = node.get(field)
            if value not in (None, ""):
                context[field] = str(value)
        accrued, type_id = node.get("accrued"), node.get("type_id")
        if type_id is not None and isinstance(accrued, dict) and accrued.get("amount") is not None:
            amount = money(accrued)
            if amount is not None:
                found.append({
                    "type_id": str(type_id), "amount": amount,
                    "currency": str(accrued.get("currency") or ""),
                    "path": path, "sku": context.get("sku"),
                    "product_id": context.get("product_id"),
                    "offer_id": context.get("offer_id"),
                })
            return
        for key, child in node.items():
            walk(child, f"{path}.{key}" if path else key, context)

    walk(record)
    return found

def _serialize_totals(totals):
    return [
        {**item, "amount": str(item["amount"])}
        for _, item in sorted(totals.items(), key=lambda pair: pair[0])
    ]


def normalize_accrual_records(records, type_dictionary=None, delivered_postings=None):
    """Normalize source records without inventing attribution or meanings."""
    types = type_dictionary or {}
    posting_map = {
        str(row.get("posting_number")): str(row.get("fulfillment_type"))
        for row in (delivered_postings or [])
        if isinstance(row, dict) and row.get("posting_number") not in (None, "")
        and row.get("fulfillment_type") in ("FBO", "FBS")
    }
    output = []
    summary = {}
    fulfillment_totals = {}
    unmatched_totals = {}
    product_fee_totals = {}
    matched_by_currency = {}
    known_by_currency = {}
    unknown_by_currency = {}
    total_by_currency = {}
    currencies = set()
    classification_coverage = {}

    for record in records or []:
        components = collect_components(record)
        posting = record.get("posting") if isinstance(record, dict) else None
        number = record.get("posting_number")
        if number in (None, "") and isinstance(posting, dict):
            number = posting.get("posting_number")
        number = str(number) if number not in (None, "") else None
        fulfillment = posting_map.get(number) if number else None
        for component in components:
            type_id = component["type_id"]
            meta = types.get(type_id, {}) if isinstance(types, dict) else {}
            label = (meta.get("name") or meta.get("description")) if isinstance(meta, dict) else None
            amount = component["amount"]
            currency = component["currency"]
            key = (type_id, currency)
            item = summary.setdefault(key, {"type_id": type_id, "label": label,
                "currency": currency, "amount": Decimal("0"), "records": 0,
                "matched_records": 0, "unmatched_records": 0})
            item["amount"] += amount
            item["records"] += 1
            currency_bucket = currency or "UNKNOWN_CURRENCY"
            total_by_currency[currency_bucket] = total_by_currency.get(currency_bucket, Decimal("0")) + amount
            if label:
                known_by_currency[currency_bucket] = known_by_currency.get(currency_bucket, Decimal("0")) + amount
            else:
                unknown_by_currency[currency_bucket] = unknown_by_currency.get(currency_bucket, Decimal("0")) + amount
            if fulfillment:
                item["matched_records"] += 1
                matched_by_currency[currency_bucket] = matched_by_currency.get(currency_bucket, Decimal("0")) + amount
                fkey = (fulfillment, type_id, currency)
                target = fulfillment_totals.setdefault(fkey, {
                    "fulfillment_type": fulfillment, "type_id": type_id,
                    "label": label, "currency": currency, "amount": Decimal("0"),
                    "components": 0})
                target["amount"] += amount
                target["components"] += 1
            else:
                item["unmatched_records"] += 1
                ukey = (type_id, currency)
                target = unmatched_totals.setdefault(ukey, {
                    "type_id": type_id, "label": label, "currency": currency,
                    "amount": Decimal("0"), "components": 0})
                target["amount"] += amount
                target["components"] += 1
            if component.get("sku") is not None:
                pkey = (fulfillment or "UNMATCHED", component["sku"], type_id, currency)
                product_row = product_fee_totals.setdefault(pkey, {
                    "fulfillment_type": fulfillment, "sku": component["sku"],
                    "product_id": component.get("product_id"), "offer_id": component.get("offer_id"),
                    "type_id": type_id, "label": label, "currency": currency,
                    "amount": Decimal("0"), "components": 0})
                product_row["amount"] += amount
                product_row["components"] += 1
            # A dictionary label identifies the source operation type, but does not
            # by itself establish whether it is an expense, compensation, or adjustment.
            semantic_status = "needs_review" if label else "missing_dictionary_entry"
            coverage_key = (type_id, currency, semantic_status)
            coverage = classification_coverage.setdefault(coverage_key, {
                "type_id": type_id, "label": label, "currency": currency,
                "status": semantic_status, "amount": Decimal("0"), "records": 0,
            })
            coverage["amount"] += amount
            coverage["records"] += 1
            output.append({**component, "label": label,
                "posting_number": number, "fulfillment_type": fulfillment,
                "posting_match": "matched" if fulfillment else "unmatched",
                "classification": "known_type" if label else "unknown_type",
                "semantic_classification": "unclassified",
                "classification_status": semantic_status})
            currencies.add(currency_bucket)

    serialized = _serialize_totals(summary)
    for row in serialized:
        row["amount"] = str(row["amount"])
    def amounts(values):
        return {currency: str(amount) for currency, amount in sorted(values.items())}
    matched_count = sum(1 for row in output if row["posting_match"] == "matched")
    unknown_count = sum(1 for row in output if row["classification"] == "unknown_type")
    known_count = len(output) - unknown_count
    # Legacy scalar totals remain meaningful only when the source uses one currency.
    single_currency = len(currencies) <= 1 and "UNKNOWN_CURRENCY" not in currencies
    return {
        "components": output,
        "summary": serialized,
        "fulfillment_summary": _serialize_totals(fulfillment_totals),
        "unmatched_summary": _serialize_totals(unmatched_totals),
        "product_fee_summary": _serialize_totals(product_fee_totals),
        "classification_coverage": [
            {**item, "amount": str(item["amount"])}
            for _, item in sorted(classification_coverage.items(), key=lambda pair: pair[0])
        ],
        "metrics": {
            "component_count": len(output),
            "posting_match_count": matched_count,
            "posting_unmatched_count": len(output) - matched_count,
            "posting_match_percent": round(matched_count / len(output) * 100, 2) if output else 0,
            "sku_attributed_count": sum(1 for row in output if row.get("sku") is not None),
            "sku_unattributed_count": sum(1 for row in output if row.get("sku") is None),
            "known_type_count": known_count,
            "unknown_type_count": unknown_count,
            "semantically_classified_count": 0,
            "named_but_unclassified_count": known_count,
            "missing_dictionary_entry_count": unknown_count,
            "classification_review_count": len(output),
            "matched_amount": str(sum(matched_by_currency.values(), Decimal("0"))) if single_currency else None,
            "known_type_amount": str(sum(known_by_currency.values(), Decimal("0"))) if single_currency else None,
            "total_component_amount": str(sum(total_by_currency.values(), Decimal("0"))) if single_currency else None,
            "matched_amount_by_currency": amounts(matched_by_currency),
            "known_type_amount_by_currency": amounts(known_by_currency),
            "unknown_type_amount_by_currency": amounts(unknown_by_currency),
            "total_component_amount_by_currency": amounts(total_by_currency),
            "currencies": sorted(currencies),
        },
        "classification_basis": "Ozon dictionary names/descriptions identify operation types only. No expense, compensation, adjustment, or neutral category is inferred without a separately verified mapping.",
        "basis": "Raw source components; type labels only from Ozon dictionary. Posting attribution requires exact delivered posting-number match. Amounts are separated by currency.",
    }
