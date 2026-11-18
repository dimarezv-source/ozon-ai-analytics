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
