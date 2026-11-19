from app.analytics.returns_attribution import attribute_returns_to_delivered_postings


def test_return_requires_exact_delivered_posting_and_sku_match():
    returns = [
        {"id": 1, "posting_number": "FBO-1", "type": "ClientReturn",
         "product": {"sku": 123, "quantity": 2, "price": {"price": "250.00", "currency_code": "RUB"}}},
        {"id": 2, "posting_number": "FBO-1", "type": "ClientReturn",
         "product": {"sku": 999, "quantity": 1, "price": {"price": "10", "currency_code": "RUB"}}},
        {"id": 3, "type": "FullReturn",
         "product": {"sku": 123, "quantity": 1, "price": {"price": "250", "currency_code": "RUB"}}},
        {"id": 4, "posting_number": "OLD-1", "type": "ClientReturn",
         "product": {"sku": 123, "quantity": 1, "price": {"price": "250", "currency_code": "RUB"}}},
    ]
    delivered = [{"posting_number": "FBO-1", "fulfillment_type": "FBO", "skus": ["123", "456"]}]

    result = attribute_returns_to_delivered_postings(returns, delivered)

    assert result["matched_count"] == 1
    assert result["unmatched_count"] == 3
    assert result["matched_events"][0]["fulfillment_type"] == "FBO"
    assert result["summary"] == [{
        "fulfillment_type": "FBO", "sku": "123", "currency": "RUB",
        "return_type": "ClientReturn", "quantity": 2,
        "returned_value": "500.00", "priced_quantity": 2, "return_records": 1,
    }]
    assert {row["unmatched_reason"] for row in result["unmatched_events"]} == {
        "sku_not_in_posting", "missing_posting_number", "posting_not_in_delivered_period"
    }


def test_return_price_is_not_invented_when_missing_or_invalid():
    result = attribute_returns_to_delivered_postings(
        [{"id": 5, "posting_number": "P-1", "product": {"sku": "S", "quantity": 1,
          "price": {"price": "NaN", "currency_code": "RUB"}}}],
        [{"posting_number": "P-1", "fulfillment_type": "FBS", "skus": ["S"]}],
    )
    assert result["matched_count"] == 1
    assert result["summary"][0]["returned_value"] == "0"
    assert result["summary"][0]["priced_quantity"] == 0
    assert result["matched_events"][0]["returned_value"] is None
