import json
import os
import runpy
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ReturnsReportTests(unittest.TestCase):
    def test_report_groups_returns_without_claiming_refund_amount(self):
        sample = {
            "period": {"time_from": "2026-10-18T00:00:00Z", "time_to": "2026-11-17T23:59:59Z", "days": 31},
            "returns": [
                {
                    "id": "101",
                    "schema": "Fbs",
                    "type": "FullReturn",
                    "return_reason_name": "Customer refused",
                    "visual": {"status": {"display_name": "At the pick-up point"}},
                    "product": {
                        "sku": "123",
                        "offer_id": "mirror",
                        "name": "Mirror",
                        "quantity": 2,
                        "price": {"price": "250.00", "currency_code": "RUB"},
                    },
                }
            ],
        }
        module = runpy.run_path(str(ROOT / "scripts" / "build_returns_report.py"))
        with tempfile.TemporaryDirectory() as tmp:
            old_cwd = os.getcwd()
            try:
                os.chdir(tmp)
                Path("output").mkdir()
                Path("output/ozon-returns.json").write_text(json.dumps(sample), encoding="utf-8")
                module["main"]()
                report = Path("output/returns-report.md").read_text(encoding="utf-8")
            finally:
                os.chdir(old_cwd)
        self.assertIn("Return records: **1**", report)
        self.assertIn("Returned item quantity: **2**", report)
        self.assertIn("Product-price value of returned items: **500.00**", report)
        self.assertIn("not a confirmed refund", report)


if __name__ == "__main__":
    unittest.main()
