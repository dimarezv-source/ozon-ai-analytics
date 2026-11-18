from decimal import Decimal
from app.analytics.finance_reconciliation import collect_components, normalize_accrual_records, money


def test_money_rejects_invalid_and_nonfinite():
    assert money({"amount":"12.50"}) == Decimal("12.50")
    assert money("NaN") is None
    assert money("bad") is None


def test_collects_components_only_when_type_and_accrued_pair_present():
    row={"item_fees":{"fees":[{"type_id":7,"accrued":{"amount":"-5","currency":"RUB"}}]},
         "unpaired":{"type_id":9,"value":4}}
    result=collect_components(row)
    assert len(result)==1
    assert result[0]["type_id"]=="7"
    assert result[0]["amount"]==Decimal("-5")


def test_unknown_types_are_not_semantically_guessed_from_sign():
    records=[{"non_item_fee":{"type_id":999,"accrued":{"amount":"-100","currency":"RUB"}}}]
    result=normalize_accrual_records(records, {})
    row=result["components"][0]
    assert row["classification"]=="unknown_type"
    assert row["label"] is None
    assert result["metrics"]["unknown_type_count"]==1
    assert result["metrics"]["known_type_amount"]=="0"


def test_exact_posting_match_only_and_dictionary_labels():
    records=[
        {"posting_number":"A-1","fee":{"type_id":10,"accrued":{"amount":"-30","currency":"RUB"}}},
        {"posting_number":"A-2","fee":{"type_id":10,"accrued":{"amount":"-20","currency":"RUB"}}},
        {"fee":{"type_id":10,"accrued":{"amount":"-5","currency":"RUB"}}},
    ]
    result=normalize_accrual_records(records,{"10":{"name":"Known service"}},[
        {"posting_number":"A-1","fulfillment_type":"FBS"}])
    assert result["components"][0]["posting_match"]=="matched"
    assert result["components"][0]["fulfillment_type"]=="FBS"
    assert result["components"][1]["posting_match"]=="unmatched"
    assert result["components"][2]["posting_match"]=="unmatched"
    assert result["metrics"]["posting_match_count"]==1
    assert result["metrics"]["known_type_count"]==3


def test_allocates_only_exact_delivered_postings_and_separates_fbo_fbs():
    records = [
        {"posting_number": "FBO-1", "fee": {"type_id": 7, "accrued": {"amount": "-12.50", "currency": "RUB"}}},
        {"posting": {"posting_number": "FBS-1"}, "fee": {"type_id": 7, "accrued": {"amount": "-8.00", "currency": "RUB"}}},
        {"posting_number": "NOT-DELIVERED", "fee": {"type_id": 7, "accrued": {"amount": "-4.00", "currency": "RUB"}}},
        {"fee": {"type_id": 9, "accrued": {"amount": "-3.00", "currency": "KZT"}}},
    ]
    result = normalize_accrual_records(
        records,
        {"7": {"name": "Delivery"}},
        [
            {"posting_number": "FBO-1", "fulfillment_type": "FBO"},
            {"posting_number": "FBS-1", "fulfillment_type": "FBS"},
            # A non-delivered posting is intentionally absent from the delivered list.
        ],
    )
    assert [(x["fulfillment_type"], x["amount"], x["currency"]) for x in result["fulfillment_summary"]] == [
        ("FBO", "-12.50", "RUB"),
        ("FBS", "-8.00", "RUB"),
    ]
    assert result["metrics"]["posting_match_count"] == 2
    assert result["metrics"]["posting_unmatched_count"] == 2
    assert result["metrics"]["posting_match_percent"] == 50
    assert result["unmatched_summary"] == [
        {"type_id": "7", "label": "Delivery", "currency": "RUB", "amount": "-4.00", "components": 1},
        {"type_id": "9", "label": None, "currency": "KZT", "amount": "-3.00", "components": 1},
    ]
    # Never add RUB and KZT into one misleading scalar total.
    assert result["metrics"]["total_component_amount"] is None
    assert result["metrics"]["total_component_amount_by_currency"] == {"KZT": "-3.00", "RUB": "-24.50"}


def test_allows_single_currency_legacy_totals():
    result = normalize_accrual_records([
        {"posting_number": "FBO-1", "fee": {"type_id": 1, "accrued": {"amount": "-5", "currency": "RUB"}}}
    ], {}, [{"posting_number": "FBO-1", "fulfillment_type": "FBO"}])
    assert result["metrics"]["total_component_amount"] == "-5"
    assert result["metrics"]["matched_amount"] == "-5"


def test_collects_only_explicit_sku_context_for_product_fee_allocation():
    record = {
        "posting_number": "FBS-22",
        "item_fees": {
            "sku": 123456,
            "fees": [
                {"type_id": 7, "accrued": {"amount": "-12.50", "currency": "RUB"}},
                {"type_id": 8, "accrued": {"amount": "-2.00", "currency": "RUB"}},
            ],
        },
        "non_item_fee": {
            "type_id": 9, "accrued": {"amount": "-5.00", "currency": "RUB"}
        },
    }
    result = normalize_accrual_records(
        [record], {"7": {"name": "Delivery"}, "8": {"name": "Commission"}},
        [{"posting_number": "FBS-22", "fulfillment_type": "FBS"}],
    )
    assert [(row["sku"], row["type_id"], row["amount"]) for row in result["components"]] == [
        ("123456", "7", Decimal("-12.50")),
        ("123456", "8", Decimal("-2.00")),
        (None, "9", Decimal("-5.00")),
    ]
    assert [(row["sku"], row["fulfillment_type"], row["type_id"], row["amount"])
            for row in result["product_fee_summary"]] == [
        ("123456", "FBS", "7", "-12.50"),
        ("123456", "FBS", "8", "-2.00"),
    ]
    assert result["metrics"]["sku_attributed_count"] == 2
    assert result["metrics"]["sku_unattributed_count"] == 1


def test_unknown_type_amounts_are_reported_separately_by_currency():
    result = normalize_accrual_records([
        {"fee": {"type_id": 7, "accrued": {"amount": "-12.50", "currency": "RUB"}}},
        {"fee": {"type_id": 999, "accrued": {"amount": "-3.25", "currency": "RUB"}}},
        {"fee": {"type_id": 998, "accrued": {"amount": "4.00", "currency": "KZT"}}},
    ], {"7": {"name": "Delivery"}})
    assert result["metrics"]["known_type_amount_by_currency"] == {"RUB": "-12.50"}
    assert result["metrics"]["unknown_type_amount_by_currency"] == {"KZT": "4.00", "RUB": "-3.25"}
    assert result["metrics"]["total_component_amount_by_currency"] == {"KZT": "4.00", "RUB": "-15.75"}
