#!/usr/bin/env python3
"""Build a conservative report from Ozon's raw daily accrual records."""
import json
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

SOURCE = Path("output/ozon-finance.json")
DESTINATION = Path("output/finance-report.md")

def amount(value):
    if not isinstance(value, dict):
        return None
    raw = value.get("amount")
    if raw in (None, ""):
        return None
    try:
        return Decimal(str(raw))
    except InvalidOperation:
        return None

def money(value):
    return f"{value:,.2f}".replace(",", " ")

def add_fee(target, node, type_names):
    if not isinstance(node, dict):
        return
    type_id = node.get("type_id")
    value = amount(node.get("accrued"))
    if type_id is not None and value is not None:
        key = str(type_id)
        label = type_names.get(key) or type_names.get(type_id) or f"Unknown type {key}"
        target[(key, str(label))] += value

def main():
    if not SOURCE.exists():
        raise SystemExit(f"Missing input file: {SOURCE}")
    payload = json.loads(SOURCE.read_text(encoding="utf-8"))
    days = payload.get("days", [])
    if not isinstance(days, list):
        raise SystemExit("Invalid finance export: days must be a list")

    type_names = {}
    for item in payload.get("accrual_types", []):
        if isinstance(item, dict) and item.get("id") is not None:
            type_names[str(item["id"])] = item.get("name") or item.get("description") or ""

    category_counts = Counter()
    category_amounts = defaultdict(Decimal)
    fee_amounts = defaultdict(Decimal)
    sku_sales = defaultdict(Decimal)
    sku_commission = defaultdict(Decimal)
    day_totals = []
    total_records = 0
    currency_set = set()

    for day in days:
        day_date = day.get("date", "—")
        records = day.get("accruals", [])
        total_records += len(records)
        daily_total = Decimal("0")
        daily_has_total = False
        for record in records:
            if not isinstance(record, dict):
                continue
            category = str(record.get("accrued_category") or "UNSPECIFIED")
            category_counts[category] += 1
            total = amount(record.get("total_amount"))
            if total is not None:
                category_amounts[category] += total
                daily_total += total
                daily_has_total = True
                currency = record.get("total_amount", {}).get("currency")
                if currency:
                    currency_set.add(str(currency))

            posting = record.get("posting") or {}
            for product in posting.get("products", []) or []:
                if not isinstance(product, dict):
                    continue
                sku = str(product.get("sku") or "unknown")
                commission = product.get("commission") or {}
                seller_price = amount(commission.get("seller_price"))
                sale_commission = amount(commission.get("sale_commission"))
                if seller_price is not None:
                    sku_sales[sku] += seller_price
                if sale_commission is not None:
                    sku_commission[sku] += sale_commission
                delivery = product.get("delivery") or {}
                for service in delivery.get("services", []) or []:
                    add_fee(fee_amounts, service, type_names)

            item_fees = record.get("item_fees") or {}
            for group in item_fees.get("fees", []) or []:
                if isinstance(group, dict):
                    for fee in group.get("fees", []) or []:
                        add_fee(fee_amounts, fee, type_names)

            add_fee(fee_amounts, record.get("non_item_fee"), type_names)
            container = record.get("container_fees") or {}
            for fee in container.get("fees", []) or []:
                add_fee(fee_amounts, fee, type_names)

        day_totals.append((day_date, len(records), daily_total if daily_has_total else None))

    lines = [
        "# Ozon finance report", "",
        f"- Period: **{payload.get('date_from', '—')} — {payload.get('date_to', '—')}**",
        f"- Days requested: **{payload.get('days_requested', len(days))}**",
        f"- Accrual records received: **{total_records}**",
        f"- Accrual types in dictionary: **{len(type_names)}**",
        f"- Currency values returned: **{', '.join(sorted(currency_set)) if currency_set else 'not provided'}**",
        "",
        "> Read-only report. Totals below use Ozon's returned total_amount once per accrual record. They are not net profit.",
        "", "## Accruals by category", "",
        "| Category | Records | Total amount |", "|---|---:|---:|"
    ]
    for category, count in sorted(category_counts.items()):
        lines.append(f"| {category} | {count} | {money(category_amounts.get(category, Decimal('0')))} |")

    lines += ["", "## Daily totals", "", "| Date | Records | Total amount |", "|---|---:|---:|"]
    for date, count, total in day_totals:
        lines.append(f"| {date} | {count} | {money(total) if total is not None else '—'} |")

    lines += ["", "## Product-level values returned by Ozon", "",
              "These are the seller_price and sale_commission fields inside posting products. They are not a complete profit calculation.",
              "", "| SKU | Seller price total | Sale commission total |", "|---:|---:|---:|"]
    for sku in sorted(set(sku_sales) | set(sku_commission)):
        lines.append(f"| {sku} | {money(sku_sales.get(sku, Decimal('0')))} | {money(sku_commission.get(sku, Decimal('0')))} |")

    lines += ["", "## Fee detail by type_id", "",
              "| type_id | Ozon type name | Accrued amount |", "|---:|---|---:|"]
    for (type_id, label), total in sorted(fee_amounts.items(), key=lambda x: (x[0][0], x[0][1])):
        lines.append(f"| {type_id} | {label or '—'} | {money(total)} |")

    lines += ["", "## Important limitations", "",
              "- The daily endpoint returns accrual records, not a complete profit-and-loss statement.",
              "- SKU-level seller_price and commission are shown only where Ozon returned them.",
              "- Fee rows are grouped by type_id; unknown types are retained instead of discarded.",
              "- Product purchase cost is not available from Ozon and must be entered separately.",
              "- Returns, compensation, advertising, storage, logistics and other charges must be interpreted by their returned type_id and sign; do not infer profit from the total alone.",
              ""]
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text("\n".join(lines), encoding="utf-8")
    print(f"Finance report created: {DESTINATION}")

if __name__ == "__main__":
    main()
