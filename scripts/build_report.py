#!/usr/bin/env python3
"""Build a compact Markdown summary from read-only Ozon product data."""
import json
from collections import Counter
from pathlib import Path

SOURCE = Path("output/ozon-products.json")
DESTINATION = Path("output/report.md")

def clean(value, limit=100):
    if value is None or value == "":
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
    archived = sum(bool(p.get("is_archived", p.get("archived", False))) for p in products if isinstance(p, dict))
    missing_offer = sum(not p.get("offer_id") for p in products if isinstance(p, dict))
    missing_name = sum(not p.get("name") for p in products if isinstance(p, dict))
    statuses = Counter(clean(p.get("status", p.get("state"))) for p in products if isinstance(p, dict))
    def first(p, keys):
        return next((p.get(k) for k in keys if p.get(k) not in (None, "")), None)
    priced = [p for p in products if isinstance(p, dict) and first(p, ["price", "marketing_price", "min_price"]) is not None]
    stock_known = [p for p in products if isinstance(p, dict) and ("stocks" in p or "stocks" in p.get("stocks", {}))]
    lines = [
        "# Ozon catalog report", "",
        f"- Products received: **{len(products)}**",
        f"- Detailed records received: **{payload.get('details_received', 'unknown')}**",
        f"- Archived: **{archived}**",
        f"- Without offer_id: **{missing_offer}**",
        f"- Without name: **{missing_name}**",
        f"- Products with a price field: **{len(priced)}**",
        "",
        "> Read-only report. A field is shown only when returned by Ozon; missing values are not estimated.",
        "", "## Product status distribution", "",
        "| Status | Count |", "|---|---:|"
    ]
    for status, count in statuses.most_common():
        lines.append(f"| {status.replace('|', '/')} | {count} |")
    lines += ["", "## Products", "", "| Product ID | Offer ID | Name | Price | Old price | Stock data | Status |", "|---:|---|---|---:|---:|---|---|"]
    for p in products[:100]:
        if not isinstance(p, dict):
            continue
        pid = clean(first(p, ["product_id", "id"]), 30).replace("|", "/")
        offer = clean(p.get("offer_id"), 50).replace("|", "/")
        name = clean(p.get("name"), 90).replace("|", "/")
        price = clean(first(p, ["price", "marketing_price", "min_price"]), 30).replace("|", "/")
        old = clean(p.get("old_price"), 30).replace("|", "/")
        stocks = p.get("stocks")
        if isinstance(stocks, dict):
            stock_text = clean(json.dumps(stocks, ensure_ascii=False), 90)
        else:
            stock_text = clean(stocks, 90)
        status = clean(first(p, ["status", "state"]), 40).replace("|", "/")
        lines.append(f"| {pid} | {offer} | {name} | {price} | {old} | {stock_text} | {status} |")
    lines += ["", "## Interpretation", "", "- Product details are retrieved through `/v3/product/info/list`.", "- If price or stock fields are absent, this endpoint/account response did not provide them; no values are inferred.", "- Sales, commissions, logistics fees, and profit require additional read-only endpoints and a separate validated calculation.", ""]
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text("\n".join(lines), encoding="utf-8")
    print(f"Report created: {DESTINATION}")

if __name__ == "__main__":
    main()
