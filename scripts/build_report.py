#!/usr/bin/env python3
"""Build a compact Markdown summary from the read-only Ozon product list."""
import json
from collections import Counter
from pathlib import Path

SOURCE = Path("output/ozon-products.json")
DESTINATION = Path("output/report.md")

def clean(value, limit=100):
    if value is None:
        return "—"
    text = " ".join(str(value).split())
    return text[:limit] + ("…" if len(text) > limit else "")

def main():
    if not SOURCE.exists():
        raise SystemExit(f"Missing input file: {SOURCE}")
    payload = json.loads(SOURCE.read_text(encoding="utf-8"))
    products = payload.get("products", [])
    if not isinstance(products, list):
        raise SystemExit("Invalid catalog: products must be a list")

    archived = sum(bool(p.get("archived")) for p in products if isinstance(p, dict))
    missing_offer = sum(not p.get("offer_id") for p in products if isinstance(p, dict))
    missing_name = sum(not p.get("name") for p in products if isinstance(p, dict))
    statuses = Counter(clean(p.get("status")) for p in products if isinstance(p, dict))
    lines = [
        "# Ozon catalog report",
        "",
        f"- Products received: **{len(products)}**",
        f"- Archived: **{archived}**",
        f"- Without offer_id: **{missing_offer}**",
        f"- Without name: **{missing_name}**",
        "",
        "> Scope: read-only product-list data. This endpoint does not provide current selling prices, stock quantities, sales, fees, or profitability.",
        "",
        "## Product status distribution",
        "",
        "| Status | Count |",
        "|---|---:|",
    ]
    for status, count in statuses.most_common():
        lines.append(f"| {status.replace('|', '/')} | {count} |")
    lines += ["", "## First 50 products", "", "| Product ID | Offer ID | Name | Status | Archived |", "|---:|---|---|---|---|"]
    for p in products[:50]:
        if not isinstance(p, dict):
            continue
        product_id = clean(p.get("product_id"), 30).replace("|", "/")
        offer_id = clean(p.get("offer_id"), 50).replace("|", "/")
        name = clean(p.get("name"), 90).replace("|", "/")
        status = clean(p.get("status"), 40).replace("|", "/")
        archived_value = "yes" if p.get("archived") else "no"
        lines.append(f"| {product_id} | {offer_id} | {name} | {status} | {archived_value} |")
    lines += ["", "## Next data needed", "", "To analyze prices and stock, add separate read-only Ozon API requests for product information and stock data after validating their current request schemas and API-key permissions.", ""]
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text("\n".join(lines), encoding="utf-8")
    print(f"Report created: {DESTINATION}")

if __name__ == "__main__":
    main()
