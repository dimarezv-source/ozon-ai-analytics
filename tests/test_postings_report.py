import json
import os
import runpy
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PostingExportTests(unittest.TestCase):
    def test_current_cursor_response_is_parsed(self):
        module = runpy.run_path(str(ROOT / "scripts" / "fetch_postings.py"))
        postings, cursor, has_next = module["extract_page"](
            {"postings": [{"posting_number": "A-1"}], "cursor": "next", "has_next": True},
            "/v3/posting/fbo/list",
        )
        self.assertEqual(len(postings), 1)
        self.assertEqual(cursor, "next")
        self.assertTrue(has_next)

    def test_report_counts_delivered_only_and_estimates_gmv(self):
        sample = {
            "period": {"since": "2026-11-10T00:00:00Z", "to": "2026-11-16T23:59:59Z", "days": 7},
            "postings": [
                {
                    "schema": "FBO",
                    "posting_number": "FBO-1",
                    "order_number": "ORDER-1",
                    "status": "delivered",
                    "products": [{"sku": 123, "offer_id": "mirror", "name": "Mirror", "quantity": 2, "price": "100.00", "currency": "RUB"}],
                },
                {
                    "schema": "FBS",
                    "posting_number": "FBS-1",
                    "order_number": "ORDER-2",
                    "status": "cancelled",
                    "products": [{"sku": 123, "offer_id": "mirror", "name": "Mirror", "quantity": 1, "price": "100.00", "currency": "RUB"}],
                },
            ],
        }
        module = runpy.run_path(str(ROOT / "scripts" / "build_postings_report.py"))
        with tempfile.TemporaryDirectory() as tmp:
            old_cwd = os.getcwd()
            try:
                os.chdir(tmp)
                Path("output").mkdir()
                Path("output/ozon-postings.json").write_text(json.dumps(sample), encoding="utf-8")
                module["main"]()
                report = Path("output/postings-report.md").read_text(encoding="utf-8")
            finally:
                os.chdir(old_cwd)
        self.assertIn("Delivered postings (current status): **1**", report)
        self.assertIn("Cancelled postings (current status): **1**", report)
        self.assertIn("Delivered GMV estimate: **200.00**", report)
        self.assertIn("Delivered units: **2**", report)


if __name__ == "__main__":
    unittest.main()
