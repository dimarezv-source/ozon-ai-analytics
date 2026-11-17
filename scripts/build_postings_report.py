#!/usr/bin/env python3
"""Build a posting funnel and delivered-order GMV estimate from Ozon API data."""
import json
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

SOURCE = Path("output/ozon-postings.json")
DESTINATION = Path("output/postings-report.md")


def amount(value):
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def money(value):
    if value is None:
        return "—"
    return f"{value:,.2f}".replace(",", " ")


def clean(value, limit=90):
    if value is None or value == "":
        return "—"
    text = " ".join(str(value).split()).replace("|", "/")
    return text[:limit] + ("…" if len(text) > limit else "")


def product_lines(posting):
    products = posting.get("products", [])
    return products if isinstance(products, list) else []


def main():
    if not SOURCE.exists():
        raise SystemExit(f"Missing input file: {SOURCE}")
    payload = json.loads(SOURCE.read_text(encoding="utf-8"))
    postings = payload.get("postings")
    if not isinstance(postings, list):
        raise SystemExit("Invalid export: postings must be a list")

    statuses = Counter()
    schemas = Counter()
    orders = set()
    cancelled = 0
    delivered_postings = 0
    delivered_units = 0
    all_units = 0
    delivered_gmv = Decimal("0")
    gmv_known_units = 0
    gmv_unknown_units = 0
    product_totals = defaultdict(lambda: {
        "name": "", "offer_id": "", "sku": "", "units": 0,
        "known_units": 0, "gmv": Decimal("0"), "currency": set()
    })

    for posting in postings:
        if not isinstance(posting, dict):
            continue
        schema = str(posting.get("schema") or "unknown").upper()
        status = str(posting.get("status") or "unknown").lower()
        schemas[schema] += 1
        statuses[(schema, status)] += 1
        order_number = posting.get("order_number")
        if order_number:
            orders.add(str(order_number))
        if status in {"cancelled", "canceled"}:
            cancelled += 1

        is_delivered = status == "delivered"
        if is_delivered:
            delivered_postings += 1

        for product in product_lines(posting):
            if not isinstance(product, dict):
                continue
            quantity = product.get("quantity", 0)
            try:
                quantity = int(quantity)
            except (TypeError, ValueError):
                quantity = 0
            if quantity < 0:
                quantity = 0
            all_units += quantity
            if not is_delivered:
                continue

            delivered_units += quantity
            sku = str(product.get("sku") or product.get("product_id") or "unknown")
            offer_id = str(product.get("offer_id") or "")
            key = (sku, offer_id)
            row = product_totals[key]
            row["sku"] = sku
            row["offer_id"] = offer_id
            row["name"] = str(product.get("name") or row["name"])
            row["units"] += quantity
            currency = product.get("currency") or product.get("currency_code")
            if currency:
                row["currency"].add(str(currency))
            price = amount(product.get("price"))
            if price is None:
                price = amount(product.get("customer_price"))
            if price is not None:
                row["gmv"] += price * quantity
                row["known_units"] += quantity
                delivered_gmv += price * quantity
                gmv_known_units += quantity
            else:
                gmv_unknown_units += quantity

    period = payload.get("period", {})
    lines = [
        "# Ozon orders and postings report", "",
        f"- Period (UTC): **{clean(period.get('since'))} — {clean(period.get('to'))}**",
        f"- Days requested: **{clean(period.get('days'))}**",
        f"- FBO postings: **{schemas.get('FBO', 0)}**",
        f"- FBS postings: **{schemas.get('FBS', 0)}**",
        f"- Unique order numbers: **{len(orders)}**",
        f"- Delivered postings (current status): **{delivered_postings}**",
        f"- Cancelled postings (current status): **{cancelled}**",
        f"- Units in all postings: **{all_units}**",
        f"- Units in delivered postings: **{delivered_units}**",
        f"- Delivered GMV estimate: **{money(delivered_gmv)}**",
        f"- Delivered units with price: **{gmv_known_units}**",
        f"- Delivered units without price: **{gmv_unknown_units}**",
        "",
        "> Read-only operational report. A posting is counted as delivered only when its current status is `delivered`. GMV is an estimate from the item price returned in the posting, not seller payout, net revenue, or profit. Returns/refunds after delivery require a separate returns/finance reconciliation.",
        "",
        "## Status distribution", "",
        "| Scheme | Current status | Postings |",
        "|---|---|---:|",
    ]
    for (schema, status), count in sorted(statuses.items()):
        lines.append(f"| {clean(schema)} | {clean(status)} | {count} |")

    lines += [
        "", "## Delivered products by SKU / offer", "",
        "| SKU | Offer ID | Product | Delivered units | Price-based GMV estimate | Currency |",
        "|---:|---|---|---:|---:|---|",
    ]
    for row in sorted(product_totals.values(), key=lambda x: (x["units"], x["sku"]), reverse=True):
        currencies = ", ".join(sorted(row["currency"])) or "—"
        lines.append(
            f"| {clean(row['sku'], 30)} | {clean(row['offer_id'], 50)} | "
            f"{clean(row['name'])} | {row['units']} | {money(row['gmv'])} | {clean(currencies, 20)} |"
        )
    if not product_totals:
        lines.append("| — | — | No delivered product lines in this period | 0 | — | — |")

    lines += [
        "", "## Interpretation", "",
        "- FBO uses `/v3/posting/fbo/list`; FBS uses `/v4/posting/fbs/list` with cursor pagination.",
        "- A posting is not the same as a unique order: one order can contain multiple postings.",
        "- Current posting status is an operational snapshot. Delivered does not guarantee that no later return or refund occurred.",
        "- Price-based GMV is not the amount paid out to the seller. Use the finance accrual export for actual settlements and fees.",
        "- Cancelled and in-transit postings are not counted as delivered units.",
        "",
    ]
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text("\n".join(lines), encoding="utf-8")
    print(f"Report created: {DESTINATION}")
    print(
        f"Postings={len(postings)}, unique orders={len(orders)}, delivered={delivered_postings}, "
        f"cancelled={cancelled}, delivered units={delivered_units}, GMV estimate={money(delivered_gmv)}"
    )


if __name__ == "__main__":
    main()
