from app.analytics.product_commission import normalize_product_commissions


def test_extracts_explicit_sale_commission_and_keeps_it_separate_by_fulfillment_and_currency():
    records = [
        {
            "posting_number": "FBO-1",
            "posting": {"products": [{
                "sku": 123, "price": {"currency_code": "RUB"},
                "commission": {
                    "seller_price": "1000.00", "sale_price": "1200.00",
                    "sale_commission": "-150.00", "commission_ratio": 12.5,
                },
            }]},
        },
        {
            "posting": {"posting_number": "FBS-1", "products": [{
                "sku": 456,
                "commission": {
                    "seller_price": {"amount": "200", "currency": "KZT"},
                    "sale_commission": {"amount": "-25", "currency": "KZT"},
                },
            }]},
        },
    ]
    result = normalize_product_commissions(records, [
        {"posting_number": "FBO-1", "fulfillment_type": "FBO", "skus": ["123"]},
        {"posting_number": "FBS-1", "fulfillment_type": "FBS", "skus": ["456"]},
    ])

    assert result["product_commission_metrics"] == {
        "record_count": 2, "matched_count": 2,
        "unmatched_count": 0, "currency_unspecified_count": 0,
    }
    assert [(row["fulfillment_type"], row["sku"], row["currency"],
             row["seller_price"], row["sale_commission"])
            for row in result["product_commission_summary"]] == [
        ("FBO", "123", "RUB", "1000.00", "-150.00"),
        ("FBS", "456", "KZT", "200", "-25"),
    ]
    assert result["product_commission_summary"][0]["sale_commission_coverage"] == "complete"
    assert result["product_commission_summary"][1]["sale_commission_coverage"] == "unknown"


def test_partial_commission_coverage_is_not_marked_complete():
    records = [{
        "posting_number": "FBO-1",
        "posting": {"products": [{
            "sku": 123, "price": {"currency_code": "RUB"},
            "commission": {"sale_commission": "-15"},
        }]},
    }]
    delivered = [
        {"posting_number": "FBO-1", "fulfillment_type": "FBO", "skus": ["123"]},
        {"posting_number": "FBO-2", "fulfillment_type": "FBO", "skus": ["123"]},
    ]
    row = normalize_product_commissions(records, delivered)["product_commission_summary"][0]
    assert row["expected_postings"] == 2
    assert row["sale_commission_postings"] == 1
    assert row["sale_commission_coverage"] == "partial"


def test_commission_coverage_requires_explicit_sku_posting_and_rub_currency():
    records = [{
        "posting_number": "FBO-1",
        "posting": {"products": [{
            "sku": 123,
            "commission": {"sale_commission": "-15"},
        }]},
    }]
    delivered = [{"posting_number": "FBO-1", "fulfillment_type": "FBO", "skus": ["123"]}]
    row = normalize_product_commissions(records, delivered)["product_commission_summary"][0]
    assert row["sale_commission_coverage"] == "unknown"


def test_unmatched_posting_and_unspecified_currency_are_not_guessed():
    result = normalize_product_commissions([{
        "posting_number": "NOT-DELIVERED",
        "posting": {"products": [{
            "sku": 789,
            "commission": {"sale_commission": "-7.50"},
        }]},
    }], [])

    assert result["product_commission_metrics"] == {
        "record_count": 1, "matched_count": 0,
        "unmatched_count": 1, "currency_unspecified_count": 1,
    }
    row = result["product_commissions"][0]
    assert row["fulfillment_type"] is None
    assert row["reconciliation_status"] == "unmatched"
    assert row["currency"] == ""
    assert row["sale_commission"] == "-7.50"


def test_ignores_missing_or_invalid_commission_amounts():
    result = normalize_product_commissions([
        {"posting_number": "P1", "posting": {"products": [
            {"sku": 1, "commission": {"sale_commission": "NaN"}},
            {"sku": 2, "commission": {"commission_ratio": 10}},
        ]}},
    ])
    assert result["product_commissions"] == []
    assert result["product_commission_summary"] == []
    assert result["product_commission_metrics"]["record_count"] == 0
