import json
import os
import runpy
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SalesReconciliationTests(unittest.TestCase):
    def test_matched_returns_reduce_net_units_and_gmv(self):
        postings = {
            "period": {"since": "2026-10-18T00:00:00Z", "to": "2026-11-17T23:59:59Z", "days": 31},
            "postings": [{
                "schema": "FBO",
                "posting_number": "FBO-1",
                "order_number": "ORDER-1",
                "status": "delivered",
                "products": [{
                    "sku": 123, "offer_id": "mirror", "name": "Mirror",
                    "quantity": 3, "price": "100.00", "currency": "RUB"
                }],
            }],
        }
        returns = {
            "period": {"time_from": "2025-11-18T00:00:00Z", "time_to": "2026-11-17T23:59:59Z", "days": 365},
            "returns": [
                {
                    "id": "1", "type": "FullReturn", "posting_number": "FBO-1",
                    "product": {"sku": 123, "quantity": 1},
                },
                {
                    "id": "2", "type": "Unknown", "posting_number": "FBO-1",
                    "product": {"sku": 123, "quantity": 1},
                },
                {
                    "id": "3", "type": "PartialReturn", "posting_number": "OTHER",
                    "product": {"sku": 999, "quantity": 1},
                },
            ],
        }
        module = runpy.run_path(str(ROOT / "scripts" / "build_sales_reconciliation.py"))
        with tempfile.TemporaryDirectory() as tmp:
            old_cwd = os.getcwd()
            try:
                os.chdir(tmp)
                Path("output").mkdir()
                Path("output/ozon-postings.json").write_text(json.dumps(postings), encoding="utf-8")
                Path("output/ozon-returns.json").write_text(json.dumps(returns), encoding="utf-8")
                module["main"]()
                report = Path("output/sales-reconciliation.md").read_text(encoding="utf-8")
            finally:
                os.chdir(old_cwd)
        self.assertIn("Delivered units before observed returns: **3**", report)
        self.assertIn("Confirmed returned/cancelled units: **1**", report)
        self.assertIn("Net units after observed returns: **2**", report)
        self.assertIn("Units in unclassified return records: **1**", report)
        self.assertIn("Net GMV estimate after matched returns: **200.00**", report)
        self.assertIn("Unmatched return records: **1**", report)


if __name__ == "__main__":
    unittest.main()
