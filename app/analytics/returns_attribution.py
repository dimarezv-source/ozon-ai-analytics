"""Conservative return-to-delivered-sale attribution.

A return affects a delivered SKU only when Ozon supplies both the exact
posting number and SKU, and that pair exists in delivered posting data.
Product-price value is an indicator, never a confirmed refund or seller loss.
"""
from collections import defaultdict
from decimal import Decimal, InvalidOperation


def attribute_returns_to_delivered_postings(return_rows, delivered_postings):
    delivered = {}
    for posting in delivered_postings or []:
        if not isinstance(posting, dict):
            continue
        number = posting.get("posting_number")
        schema = posting.get("fulfillment_type")
        if number in (None, "") or schema not in ("FBO", "FBS"):
            continue
        delivered[str(number)] = {
            "fulfillment_type": schema,
            "skus": {str(sku) for sku in (posting.get("skus") or []) if sku not in (None, "")},
        }

    totals = defaultdict(lambda: {
        "fulfillment_type": None, "sku": None, "currency": "",
        "return_type": "UNKNOWN", "quantity": 0,
        "returned_value": Decimal("0"), "priced_quantity": 0, "return_records": 0,
    })
    matched, unmatched = [], []
    for row in return_rows or []:
        if not isinstance(row, dict):
            continue
        product = row.get("product") if isinstance(row.get("product"), dict) else {}
        number = row.get("posting_number")
        sku = product.get("sku")
        if number in (None, ""):
            reason = "missing_posting_number"
        elif sku in (None, ""):
            reason = "missing_sku"
        elif str(number) not in delivered:
            reason = "posting_not_in_delivered_period"
        elif str(sku) not in delivered[str(number)]["skus"]:
            reason = "sku_not_in_posting"
        else:
            reason = None

        quantity_raw = product.get("quantity")
        try:
            quantity = max(0, int(quantity_raw))
        except (TypeError, ValueError):
            quantity = 0
        price_obj = product.get("price") if isinstance(product.get("price"), dict) else {}
        currency = str(price_obj.get("currency_code") or "")
        try:
            price = Decimal(str(price_obj.get("price")))
            if not price.is_finite() or price < 0:
                raise InvalidOperation
        except (InvalidOperation, ValueError, TypeError):
            price = None

        event = {
            "return_id": str(row.get("id") or ""),
            "posting_number": str(number) if number not in (None, "") else None,
            "fulfillment_type": delivered[str(number)]["fulfillment_type"] if reason is None else None,
            "sku": str(sku) if sku not in (None, "") else None,
            "return_type": str(row.get("type") or "UNKNOWN"),
            "quantity": quantity, "currency": currency,
            "returned_value": str(price * quantity) if price is not None else None,
            "match_status": "matched" if reason is None else "unmatched",
            "unmatched_reason": reason,
        }
        (matched if reason is None else unmatched).append(event)
        if reason is None and quantity:
            key = (event["fulfillment_type"], str(sku), currency, event["return_type"])
            item = totals[key]
            item["fulfillment_type"] = event["fulfillment_type"]
            item["sku"] = str(sku)
            item["currency"] = currency
            item["return_type"] = event["return_type"]
            item["quantity"] += quantity
            item["return_records"] += 1
            if price is not None:
                item["returned_value"] += price * quantity
                item["priced_quantity"] += quantity

    summary = [
        {**item, "returned_value": str(item["returned_value"]) if item["priced_quantity"] else None}
        for _, item in sorted(totals.items(), key=lambda pair: pair[0])
    ]
    return {
        "matched_count": len(matched),
        "unmatched_count": len(unmatched),
        "matched_events": matched,
        "unmatched_events": unmatched,
        "summary": summary,
        "basis": "Exact posting number and SKU match to delivered posting data. Product-price value is not a confirmed refund, compensation, or seller loss.",
    }
