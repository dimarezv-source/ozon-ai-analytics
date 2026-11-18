#!/usr/bin/env python3
"""Build a transparent report from raw Ozon v5 price/commission fields."""
import json
from pathlib import Path

SOURCE = Path("output/ozon-prices.json")
DESTINATION = Path("output/prices-report.md")


def clean(value):
    if value is None or value == "":
        return "—"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value).replace("|", "/").replace("\n", " ")[:500]


def main():
    if not SOURCE.exists():
        raise SystemExit(f"Missing input file: {SOURCE}")
    payload = json.loads(SOURCE.read_text(encoding="utf-8"))
    items = payload.get("items", [])
    if not isinstance(items, list):
        raise SystemExit("Invalid price export: items must be a list")

    lines = [
        "# Ozon price and commission report", "",
        f"- Source: `{payload.get('source', 'unknown')}`",
        f"- Requested offer IDs: **{len(payload.get('requested_offer_ids', []))}**",
        f"- Records received: **{len(items)}**", "",
        "> Read-only values returned by Ozon. FBS logistics and commission fields are nested inside `commissions`; the report reads them from there. No missing value is treated as zero.", "",
        "| Offer ID (as returned) | Product ID | Price, ₽ | FBS sales commission | First mile, ₽ (min–max) | Delivery to customer, ₽ | Direct flow transit, ₽ (min–max) | Return flow, ₽ | Acquiring, ₽ |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]

    for item in items:
        price = item.get("price") if isinstance(item.get("price"), dict) else {}
        commission = item.get("commissions") or item.get("comissions") or {}
        if not isinstance(commission, dict):
            commission = {}
        lines.append("| " + " | ".join([
            clean(item.get("offer_id")),
            clean(item.get("product_id")),
            clean(price.get("price")),
            clean(commission.get("sales_percent_fbs")),
            clean(commission.get("fbs_first_mile_min_amount")) + "–" + clean(commission.get("fbs_first_mile_max_amount")),
            clean(commission.get("fbs_deliv_to_customer_amount")),
            clean(commission.get("fbs_direct_flow_trans_min_amount")) + "–" + clean(commission.get("fbs_direct_flow_trans_max_amount")),
            clean(commission.get("fbs_return_flow_amount")),
            clean(item.get("acquiring")),
        ]) + " |")

    if not items:
        lines.append("| — | — | — | — | — | — | — | — | — |")

    lines += [
        "", "## Additional returned price fields", "",
        "| Offer ID | net_price, ₽ | min_price, ₽ | VAT field |",
        "|---|---:|---:|---:|",
    ]
    for item in items:
        price = item.get("price") if isinstance(item.get("price"), dict) else {}
        lines.append("| " + " | ".join([
            clean(item.get("offer_id")),
            clean(price.get("net_price")),
            clean(price.get("min_price")),
            clean(price.get("vat")),
        ]) + " |")

    lines += [
        "", "## Calculation limits", "",
        "- The FBS sales commission amount can be estimated as sale price × `sales_percent_fbs` / 100; this is a percentage calculation, not a final payout.",
        "- The transit field is returned as a min/max range; actual logistics charges depend on the order and delivery route.",
        "- Acquiring, delivery, return flow, packaging, tax, purchase/replacement cost and any other services must be accounted for separately where applicable.",
        "- `net_price` is reproduced as returned by Ozon and is not treated here as confirmed seller payout or profit.",
        "- Offer IDs are reproduced exactly as returned by Ozon; the report does not rewrite or deduplicate them.",
        "",
    ]
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text("\n".join(lines), encoding="utf-8")
    print(f"Price/commission report created: {DESTINATION}")


if __name__ == "__main__":
    main()
