#!/usr/bin/env python3
"""Summarize Ozon FBO/FBS returns without treating product price as refund payout."""
import json
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

SOURCE = Path("output/ozon-returns.json")
DESTINATION = Path("output/returns-report.md")


def decimal_value(value):
    try:
        return Decimal(str(value)) if value not in (None, "") else None
    except (InvalidOperation, ValueError):
        return None


def money(value):
    return "—" if value is None else f"{value:,.2f}".replace(",", " ")


def clean(value, limit=90):
    if value is None or value == "":
        return "—"
    value = " ".join(str(value).split()).replace("|", "/")
    return value[:limit] + ("…" if len(value) > limit else "")


def main():
    if not SOURCE.exists():
        raise SystemExit(f"Missing input file: {SOURCE}")
    payload = json.loads(SOURCE.read_text(encoding="utf-8"))
    records = payload.get("returns")
    if not isinstance(records, list):
        raise SystemExit("Invalid returns export: returns must be a list")

    schemas = Counter()
    types = Counter()
    visual_statuses = Counter()
    reasons = Counter()
    products = defaultdict(lambda: {"name": "", "offer_id": "", "sku": "", "quantity": 0, "price_value": Decimal("0"), "priced_quantity": 0, "currencies": set()})
    total_quantity = 0
    priced_quantity = 0
    price_value = Decimal("0")

    for item in records:
        if not isinstance(item, dict):
            continue
        schema = str(item.get("schema") or "unknown").upper()
        return_type = str(item.get("type") or "unknown")
        visual = item.get("visual") if isinstance(item.get("visual"), dict) else {}
        status_obj = visual.get("status") if isinstance(visual.get("status"), dict) else {}
        visual_status = str(status_obj.get("display_name") or status_obj.get("sys_name") or "unknown")
        reason = str(item.get("return_reason_name") or "unknown")
        schemas[schema] += 1
        types[return_type] += 1
        visual_statuses[visual_status] += 1
        reasons[reason] += 1

        product = item.get("product") if isinstance(item.get("product"), dict) else {}
        try:
            quantity = max(0, int(product.get("quantity", 0)))
        except (TypeError, ValueError):
            quantity = 0
        total_quantity += quantity
        sku = str(product.get("sku") or "unknown")
        offer_id = str(product.get("offer_id") or "")
        row = products[(sku, offer_id)]
        row["sku"] = sku
        row["offer_id"] = offer_id
        row["name"] = str(product.get("name") or row["name"])
        row["quantity"] += quantity
        price_obj = product.get("price") if isinstance(product.get("price"), dict) else {}
        value = decimal_value(price_obj.get("price"))
        currency = price_obj.get("currency_code")
        if currency:
            row["currencies"].add(str(currency))
        if value is not None:
            row["price_value"] += value * quantity
            row["priced_quantity"] += quantity
            price_value += value * quantity
            priced_quantity += quantity

    period = payload.get("period", {})
    lines = [
        "# Ozon returns report", "",
        f"- Return event / status-change window (UTC): **{clean(period.get('time_from'))} — {clean(period.get('time_to'))}**",
        f"- Days requested: **{clean(period.get('days'))}**",
        f"- Return records: **{len(records)}**",
        f"- FBO returns: **{schemas.get('FBO', 0)}**",
        f"- FBS returns: **{schemas.get('FBS', 0)}**",
        f"- Returned item quantity: **{total_quantity}**",
        f"- Quantity with product price: **{priced_quantity}**",
        f"- Product-price value of returned items: **{money(price_value)}**",
        "",
        "> Read-only operational report. Product-price value is not a confirmed refund, compensation, or seller loss. It is not deducted from delivered GMV automatically. Match by posting/order/product and reconcile against finance accruals before calculating net sales.",
        "", "## Return type", "", "| Type | Records |", "|---|---:|",
    ]
    for key, count in types.most_common():
        lines.append(f"| {clean(key)} | {count} |")
    lines += ["", "## Return status", "", "| Status | Records |", "|---|---:|"]
    for key, count in visual_statuses.most_common():
        lines.append(f"| {clean(key)} | {count} |")
    lines += ["", "## Return reasons", "", "| Reason | Records |", "|---|---:|"]
    for key, count in reasons.most_common(30):
        lines.append(f"| {clean(key, 120)} | {count} |")
    lines += [
        "", "## Returned products", "",
        "| SKU | Offer ID | Product | Returned quantity | Product-price value | Currency |",
        "|---:|---|---|---:|---:|---|",
    ]
    for row in sorted(products.values(), key=lambda x: (x["quantity"], x["sku"]), reverse=True):
        currencies = ", ".join(sorted(row["currencies"])) or "—"
        lines.append(
            f"| {clean(row['sku'], 30)} | {clean(row['offer_id'], 50)} | {clean(row['name'])} | "
            f"{row['quantity']} | {money(row['price_value'])} | {clean(currencies, 20)} |"
        )
    if not products:
        lines.append("| — | — | No returned product lines in this period | 0 | — | — |")
    lines += [
        "", "## Interpretation", "",
        "- Data comes from the unified `/v1/returns/list` endpoint. The exporter queries `logistic_return_date` and `visual_status_change_moment` separately (Ozon permits only one date filter per request), then deduplicates by return ID.",
        "- The API record type and visual status are reported separately: Cancellation = cancellation before delivery to the buyer; FullReturn = full refusal at handover; PartialReturn = partial refusal at handover; ClientReturn = customer return after receipt; Unknown = technical return.",
        "- The window covers either a logistics return date or a visual status change, not the original order date or the finance accrual date.",
        "- A return record does not by itself prove the refund amount or the amount ultimately lost by the seller.",
        "",
    ]
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text("\n".join(lines), encoding="utf-8")
    print(f"Returns report created: {DESTINATION}")
    print(f"Returns={len(records)}, returned quantity={total_quantity}, price value={money(price_value)}")


if __name__ == "__main__":
    main()
