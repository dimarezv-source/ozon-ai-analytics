from app.analytics.finance_posting_attribution import normalize_posting_accruals


def test_normalize_posting_accruals_groups_explicit_sku_and_keeps_currency_separate():
    rows = [
        {"posting_number": "FBO-1", "accruals": [
            {"sku": 123, "type_id": 7, "accrued": {"amount": "-10.25", "currency": "RUB"}, "quantity": 1},
            {"sku": 123, "type_id": 7, "accrued": {"amount": "-2", "currency": "KZT"}, "quantity": 1},
            {"sku": 123, "type_id": 8, "accrued": {"amount": "3", "currency": "RUB"}, "quantity": 1},
            {"type_id": 7, "accrued": {"amount": "-99", "currency": "RUB"}},
        ]},
        {"posting_number": "NO-MATCH", "accruals": [
            {"sku": 456, "type_id": 999, "accrued": {"amount": "-4", "currency": "RUB"}, "quantity": 2},
        ]},
    ]
    result = normalize_posting_accruals(
        rows, {"7": {"name": "Delivery"}, "8": {"description": "Compensation"}},
        [{"posting_number": "FBO-1", "fulfillment_type": "FBO"}],
    )
    assert result["posting_accrual_metrics"] == {
        "posting_count": 2, "sku_record_count": 4, "unmatched_posting_count": 1,
    }
    assert [(r["sku"], r["type_id"], r["currency"], r["amount"]) for r in result["posting_product_summary"]] == [
        ("123", "7", "KZT", "-2"), ("123", "7", "RUB", "-10.25"),
        ("123", "8", "RUB", "3"), ("456", "999", "RUB", "-4"),
    ]
    assert result["posting_product_summary"][-1]["fulfillment_type"] == "UNMATCHED"
    assert result["posting_product_summary"][-1]["label"] is None


def test_normalize_posting_accruals_ignores_invalid_money_and_missing_sku():
    result = normalize_posting_accruals([{
        "posting_number": "P-1", "accruals": [
            {"sku": 1, "type_id": 1, "accrued": {"amount": "NaN", "currency": "RUB"}},
            {"sku": 2, "type_id": 1, "accrued": {"amount": "1", "currency": "RUB"}},
            {"sku": 3, "type_id": 1, "accrued": {"amount": "2", "currency": "RUB"}},
        ],
    }])
    assert len(result["posting_accruals"]) == 1
    assert result["posting_product_summary"][0]["sku"] == "3"
