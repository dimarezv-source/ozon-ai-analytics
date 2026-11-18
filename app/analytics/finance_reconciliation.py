"""Conservative normalization helpers for Ozon accrual reconciliation.

This module never guesses semantic categories from amount sign alone. Unknown
accrual types remain explicitly unclassified; posting attribution requires an
exact posting number present in the source record.
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
    """Extract explicitly paired type_id/accrued amounts from raw accrual."""
    found = []

    def walk(node, path=""):
        if isinstance(node, list):
            for i, child in enumerate(node):
                walk(child, f"{path}[{i}]")
            return
        if not isinstance(node, dict):
            return
        accrued, type_id = node.get("accrued"), node.get("type_id")
        if type_id is not None and isinstance(accrued, dict) and accrued.get("amount") is not None:
            amount = money(accrued)
            if amount is not None:
                found.append({"type_id": str(type_id), "amount": amount,
                              "currency": str(accrued.get("currency") or ""),
                              "path": path})
            return
        for key, child in node.items():
            walk(child, f"{path}.{key}" if path else key)

    walk(record)
    return found


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
    matched_amount = Decimal("0")
    classified_amount = Decimal("0")
    total_amount = Decimal("0")
    currencies = set()
    currency_metrics = {}
    fulfillment_metrics = {"FBO": {"components": 0, "amount": {}}, "FBS": {"components": 0, "amount": {}}, "unmatched": {"components": 0, "amount": {}}}

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
            label = meta.get("name") if isinstance(meta, dict) else None
            amount = component["amount"]
            currency = component["currency"]
            key = (type_id, currency)
            item = summary.setdefault(key, {"type_id": type_id, "label": label,
                "currency": currency, "amount": Decimal("0"), "records": 0,
                "matched_records": 0})
            item["amount"] += amount
            item["records"] += 1
            total_amount += amount
            bucket = currency_metrics.setdefault(currency or "UNKNOWN", {"total": Decimal("0"), "matched": Decimal("0"), "known": Decimal("0"), "unknown": Decimal("0"), "components": 0})
            bucket["total"] += amount; bucket["components"] += 1
            fulfillment_bucket = fulfillment_metrics[fulfillment] if fulfillment else fulfillment_metrics["unmatched"]
            fulfillment_bucket["components"] += 1
            fulfillment_bucket["amount"][currency or "UNKNOWN"] = fulfillment_bucket["amount"].get(currency or "UNKNOWN", Decimal("0")) + amount
            if label:
                classified_amount += amount
                bucket["known"] += amount
            else:
                bucket["unknown"] += amount
            if fulfillment:
                item["matched_records"] += 1
                matched_amount += amount
                bucket["matched"] += amount
            output.append({**component, "label": label,
                "posting_number": number, "fulfillment_type": fulfillment,
                "posting_match": "matched" if fulfillment else "unmatched",
                "classification": "known_type" if label else "unknown_type"})
            if currency:
                currencies.add(currency)

    serialized = [{**item, "amount": str(item["amount"])}
        for _, item in sorted(summary.items(), key=lambda x: x[0])]
    return {"components": output, "summary": serialized,
        "metrics": {"component_count": len(output),
            "posting_match_count": sum(1 for row in output if row["posting_match"] == "matched"),
            "known_type_count": sum(1 for row in output if row["classification"] == "known_type"),
            "unknown_type_count": sum(1 for row in output if row["classification"] == "unknown_type"),
            "matched_amount": str(matched_amount), "known_type_amount": str(classified_amount),
            "total_component_amount": str(total_amount), "currencies": sorted(currencies)},
        "basis": "Raw source components; type labels only from Ozon dictionary. Posting attribution requires exact delivered posting-number match."}
