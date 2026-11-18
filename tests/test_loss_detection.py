from app.analytics.loss_detection import build_loss_alerts


def test_negative_profit_sku_is_critical():
    result = build_loss_alerts({"items":[{"name":"Item","sku":"A","profit":-25,"marginPercent":-5}]})
    assert result["critical_count"] == 1
    assert result["alerts"][0]["kind"] == "loss_sku"


def test_low_margin_threshold_and_positive_profit():
    result = build_loss_alerts({"items":[{"name":"Item","profit":5,"marginPercent":7}]})
    assert result["alerts"][0]["kind"] == "low_margin"
    assert result["critical_count"] == 0


def test_fee_anomaly_requires_delta_and_comparable_baseline():
    result = build_loss_alerts(fee_rows=[
        {"label":"Delivery","type_id":4,"currency":"RUB","amount":400,"previous_amount":200},
        {"label":"Small change","amount":20,"previous_amount":10},
    ])
    assert len(result["alerts"]) == 1
    assert result["alerts"][0]["kind"] == "fee_anomaly"
    assert result["alerts"][0]["change_percent"] == "100.00"


def test_unknown_fee_is_not_guess_classified():
    result = build_loss_alerts(fee_rows=[{"type_id":999,"amount":-50,"currency":"RUB"}])
    assert result["alerts"][0]["kind"] == "unknown_fee"
    assert "не предполагается" in result["alerts"][0]["recommendation"]


def test_invalid_inputs_do_not_crash_or_create_fake_alerts():
    result = build_loss_alerts({"items":[{"profit":"NaN","marginPercent":None}]}, fee_rows=[{}])
    assert result["alert_count"] == 1
    assert result["alerts"][0]["kind"] == "unknown_fee"
