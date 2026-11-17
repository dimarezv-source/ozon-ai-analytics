#!/usr/bin/env python3
"""Reconcile delivered posting lines against observed Ozon return records."""
import json
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

POSTINGS_FILE = Path("output/ozon-postings.json")
RETURNS_FILE = Path("output/ozon-returns.json")
DESTINATION = Path("output/sales-reconciliation.md")
RETURN_TYPES_TO_SUBTRACT = {"Cancellation", "FullReturn", "PartialReturn", "ClientReturn"}


def decimal_value(value):
    try:
        return Decimal(str(value)) if value not in (None, "") else None
    except (InvalidOperation, ValueError):
        return None


def quantity(value):
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def money(value):
    return "—" if value is None else f"{value:,.2f}".replace(",", " ")


def clean(value, limit=90):
    if value is None or value == "":
        return "—"
    value = " ".join(str(value).split()).replace("|", "/")
    return value[:limit] + ("…" if len(value) > limit else "")


def main():
    if not POSTINGS_FILE.exists() or not RETURNS_FILE.exists():
        raise SystemExit("Missing input: run the orders and returns exports first.")
    posting_payload = json.loads(POSTINGS_FILE.read_text(encoding="utf-8"))
    returns_payload = json.loads(RETURNS_FILE.read_text(encoding="utf-8"))
    postings = posting_payload.get("postings")
    returns = returns_payload.get("returns")
    if not isinstance(postings, list) or not isinstance(returns, list):
        raise SystemExit("Invalid input: postings and returns must both be arrays.")

    delivered = {}
    product_rows = defaultdict(lambda: {
        "sku": "", "offer_id": "", "name": "", "delivered": 0,
        "returned": 0, "unknown_return": 0, "gross_gmv": Decimal("0"),
        "net_gmv": Decimal("0"), "currency": set(), "priced_delivered": 0,
    })
    delivered_posting_numbers = set()

    for posting in postings:
        if not isinstance(posting, dict) or str(posting.get("status") or "").lower() != "delivered":
            continue
        posting_number = str(posting.get("posting_number") or "")
        if not posting_number:
            continue
        delivered_posting_numbers.add(posting_number)
        for product in posting.get("products", []) if isinstance(posting.get("products"), list) else []:
            if not isinstance(product, dict):
                continue
            sku = str(product.get("sku") or product.get("product_id") or "unknown")
            key = (posting_number, sku)
            row = delivered.setdefault(key, {
                "posting_number": posting_number,
                "order_number": str(posting.get("order_number") or ""),
                "schema": str(posting.get("schema") or "unknown").upper(),
                "sku": sku,
                "offer_id": str(product.get("offer_id") or ""),
                "name": str(product.get("name") or ""),
                "delivered": 0,
                "returned": 0,
                "unknown_return": 0,
                "price": decimal_value(product.get("price")),
                "currency": str(product.get("currency") or product.get("currency_code") or ""),
            })
            row["delivered"] += quantity(product.get("quantity"))
            if row["price"] is None:
                row["price"] = decimal_value(product.get("price"))
            if not row["offer_id"]:
                row["offer_id"] = str(product.get("offer_id") or "")
            if not row["name"]:
                row["name"] = str(product.get("name") or "")

    unmatched_returns = []
    return_type_counts = {}
    unknown_return_units = 0
    matched_return_records = 0
    for item in returns:
        if not isinstance(item, dict):
            continue
        return_type = str(item.get("type") or "Unknown")
        return_type_counts[return_type] = return_type_counts.get(return_type, 0) + 1
        product = item.get("product") if isinstance(item.get("product"), dict) else {}
        sku = str(product.get("sku") or product.get("product_id") or "unknown")
        posting_number = str(item.get("posting_number") or "")
        qty = quantity(product.get("quantity"))
        key = (posting_number, sku)
        row = delivered.get(key)
        if row is None:
            unmatched_returns.append({
                "id": item.get("id"),
                "type": return_type,
                "posting_number": posting_number,
                "sku": sku,
                "quantity": qty,
                "reason": item.get("return_reason_name"),
            })
            if return_type == "Unknown":
                unknown_return_units += qty
            continue

        matched_return_records += 1
        if return_type in RETURN_TYPES_TO_SUBTRACT:
            row["returned"] += qty
        else:
            row["unknown_return"] += qty
            unknown_return_units += qty

    gross_units = 0
    confirmed_return_units = 0
    net_units = 0
    gross_gmv = Decimal("0")
    net_gmv = Decimal("0")
    unpriced_units = 0
    over_return_lines = 0

    for row in delivered.values():
        gross_units += row["delivered"]
        confirmed_return_units += row["returned"]
        if row["returned"] > row["delivered"]:
            over_return_lines += 1
        row_net = max(0, row["delivered"] - row["returned"])
        net_units += row_net
        pkey = (row["sku"], row["offer_id"])
        product = product_rows[pkey]
        product["sku"] = row["sku"]
        product["offer_id"] = row["offer_id"]
        product["name"] = row["name"] or product["name"]
        product["delivered"] += row["delivered"]
        product["returned"] += row["returned"]
        product["unknown_return"] += row["unknown_return"]
        if row["currency"]:
            product["currency"].add(row["currency"])
        if row["price"] is None:
            unpriced_units += row_net
        else:
            gross_value = row["price"] * row["delivered"]
            net_value = row["price"] * row_net
            gross_gmv += gross_value
            net_gmv += net_value
            product["gross_gmv"] += gross_value
            product["net_gmv"] += net_value
            product["priced_delivered"] += row["delivered"]

    posting_period = posting_payload.get("period", {})
    returns_period = returns_payload.get("period", {})
    lines = [
        "# Ozon sales reconciliation", "",
        f"- Posting cohort (UTC): **{clean(posting_period.get('since'))} — {clean(posting_period.get('to'))}**",
        f"- Returns/status-change window (UTC): **{clean(returns_period.get('time_from'))} — {clean(returns_period.get('time_to'))}**",
        f"- Delivered postings: **{len(delivered_posting_numbers)}**",
        f"- Matched return records: **{matched_return_records}**",
        f"- Unmatched return records: **{len(unmatched_returns)}**",
        f"- Delivered units before observed returns: **{gross_units}**",
        f"- Confirmed returned/cancelled units: **{confirmed_return_units}**",
        f"- Net units after observed returns: **{net_units}**",
        f"- Units in unclassified return records: **{unknown_return_units}**",
        f"- Gross delivered GMV estimate: **{money(gross_gmv)}**",
        f"- Net GMV estimate after matched returns: **{money(net_gmv)}**",
        f"- Net units without a usable item price: **{unpriced_units}**",
        f"- Lines where returned quantity exceeds delivered quantity: **{over_return_lines}**",
        "",
        "> This is an operational reconciliation estimate, not accounting revenue or profit. Only matched return records of types Cancellation, FullReturn, PartialReturn, and ClientReturn are deducted. Unknown/unmatched returns are shown separately. Recent orders may receive returns later; the result is provisional until the return window has matured and finance accruals are reconciled.",
        "",
        "## Return record types", "",
        "| Type | Records |",
        "|---|---:|",
    ]
    for key, count in sorted(return_type_counts.items()):
        lines.append(f"| {clean(key)} | {count} |")

    lines += [
        "", "## Net delivered products by SKU", "",
        "| SKU | Offer ID | Product | Delivered | Returned | Net units | Net GMV estimate | Currency |",
        "|---:|---|---|---:|---:|---:|---:|---|",
    ]
    for product in sorted(product_rows.values(), key=lambda x: (x["delivered"] - x["returned"], x["sku"]), reverse=True):
        currencies = ", ".join(sorted(product["currency"])) or "—"
        net_qty = max(0, product["delivered"] - product["returned"])
        lines.append(
            f"| {clean(product['sku'], 30)} | {clean(product['offer_id'], 50)} | {clean(product['name'])} | "
            f"{product['delivered']} | {product['returned']} | {net_qty} | {money(product['net_gmv'])} | {clean(currencies, 20)} |"
        )
    if not product_rows:
        lines.append("| — | — | No delivered product lines | 0 | 0 | 0 | — | — |")

    lines += [
        "", "## Unmatched return records", "",
        "| Return ID | Type | Posting number | SKU | Quantity | Reason |",
        "|---:|---|---|---:|---:|---|",
    ]
    for item in unmatched_returns[:100]:
        lines.append(
            f"| {clean(item['id'], 30)} | {clean(item['type'], 30)} | {clean(item['posting_number'], 40)} | "
            f"{clean(item['sku'], 30)} | {item['quantity']} | {clean(item['reason'], 80)} |"
        )
    if not unmatched_returns:
        lines.append("| — | — | No unmatched returns | 0 | 0 | — |")

    if int(returns_period.get("days") or 0) < int(posting_period.get("days") or 0):
        lines += ["", "> Warning: the returns/status-change window is shorter than the posting cohort. Increase RETURNS_DAYS before relying on net units."]
    if int(returns_period.get("days") or 0) < 365:
        lines += ["", "> Coverage note: returns/status changes outside the selected return window are not included. A longer return window improves reconciliation for older delivered orders."]
    lines += [
        "", "## Method and limitations", "",
        "- Posting data comes from `/v3/posting/fbo/list` and `/v4/posting/fbs/list`; only current `delivered` postings are treated as delivered.",
        "- Returns come from `/v1/returns/list`. The export queries both logistic return date and visual status-change date and deduplicates by return ID.",
        "- Return types Cancellation, FullReturn, PartialReturn, and ClientReturn reduce net quantity when posting number and SKU match. Unknown types are not automatically deducted.",
        "- A return without a matching delivered posting is listed as unmatched and is not silently deducted.",
        "- Net GMV is calculated using the original posting item price multiplied by net quantity. It is not payout, refund value, net revenue, or profit.",
        "- Reconcile the result with finance accruals, compensation, logistics, storage, and purchase costs before making business decisions.",
        "",
    ]
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text("\n".join(lines), encoding="utf-8")
    print(
        f"Reconciliation complete: delivered={gross_units}, returned={confirmed_return_units}, "
        f"net={net_units}, unmatched_returns={len(unmatched_returns)}, net_gmv_estimate={money(net_gmv)}"
    )
    print(f"Report created: {DESTINATION}")


if __name__ == "__main__":
    main()
