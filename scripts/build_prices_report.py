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
        f"- Records received: **{len(items)}**",
        "",
        "> Read-only data returned by Ozon. Values are not inferred. Commission fields may be nested and are shown as returned.",
        "",
        "| Offer ID | Product ID | Price | Commissions | FBS first-mile min | FBS first-mile max | Other returned fields |",
        "|---|---:|---:|---|---:|---:|---|",
    ]
    for item in items:
        price = item.get("price") if isinstance(item.get("price"), dict) else {}
        commission = item.get("commissions", item.get("comissions", {}))
        known = {"offer_id", "product_id", "price", "commissions", "comissions", "fbs_first_mile_min_amount", "fbs_first_mile_max_amount"}
        extra = {k: v for k, v in item.items() if k not in known}
        lines.append("| " + " | ".join([
            clean(item.get("offer_id")),
            clean(item.get("product_id")),
            clean(price if price else item.get("price")),
            clean(commission),
            clean(item.get("fbs_first_mile_min_amount")),
            clean(item.get("fbs_first_mile_max_amount")),
            clean(extra),
        ]) + " |")
    if not items:
        lines += ["| — | — | — | — | — | — | Ozon returned no records |"]
    lines += [
        "", "## What this report does not calculate", "",
        "- It does not treat a missing commission or logistics field as zero.",
        "- It does not estimate final buyer-facing price from deprecated marketing_price fields.",
        "- Final FBS unit economics still requires actual delivery/last-mile/return charges and seller-side packaging/cost inputs.",
        "",
    ]
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text("\n".join(lines), encoding="utf-8")
    print(f"Price/commission report created: {DESTINATION}")

if __name__ == "__main__":
    main()
