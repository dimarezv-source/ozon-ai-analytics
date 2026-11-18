"""Conservative, explainable loss-detection rules for estimated product economics."""
from decimal import Decimal, InvalidOperation


def _number(value):
    try:
        result = Decimal(str(value))
        return result if result.is_finite() else None
    except (InvalidOperation, ValueError, TypeError):
        return None


def build_loss_alerts(ranking=None, fee_rows=None, *, low_margin_percent=10,
                      anomaly_percent=50, anomaly_min_delta=100):
    """Create prioritized alerts from explicit estimated-profit and fee data.

    Fee anomalies require a comparable previous amount for the same type/currency.
    Unknown fee labels are flagged without guessing what they mean.
    """
    ranking = ranking if isinstance(ranking, dict) else {}
    items = ranking.get("items") if isinstance(ranking.get("items"), list) else []
    alerts = []
    for item in items:
        if not isinstance(item, dict):
            continue
        profit = _number(item.get("profit"))
        margin = _number(item.get("marginPercent"))
        if profit is not None and profit < 0:
            alerts.append({"kind": "loss_sku", "severity": "critical",
                "title": "Товар убыточен", "product": item.get("name"),
                "sku": item.get("sku"), "profit": str(profit),
                "margin_percent": str(margin) if margin is not None else None,
                "recommendation": "Проверить цену, себестоимость и расходы; не менять цену автоматически.",
                "basis": "Расчётная прибыль из подключенной модели экономики."})
        elif margin is not None and margin < Decimal(str(low_margin_percent)):
            alerts.append({"kind": "low_margin", "severity": "warning",
                "title": "Низкая маржа", "product": item.get("name"),
                "sku": item.get("sku"), "profit": str(profit) if profit is not None else None,
                "margin_percent": str(margin),
                "recommendation": "Проверить цену и расходы; рассмотреть тест цены.",
                "basis": "Расчётная маржа; порог задаётся параметром."})

    fee_rows = fee_rows if isinstance(fee_rows, list) else []
    for fee in fee_rows:
        if not isinstance(fee, dict):
            continue
        label = fee.get("label") or fee.get("name")
        amount, previous = _number(fee.get("amount")), _number(fee.get("previous_amount"))
        currency = fee.get("currency") or "валюта не указана"
        if not label:
            alerts.append({"kind": "unknown_fee", "severity": "warning",
                "title": "Неизвестное удержание", "type_id": fee.get("type_id"),
                "amount": str(amount) if amount is not None else None, "currency": currency,
                "recommendation": "Сверить тип начисления со справочником Ozon; смысл не предполагается.",
                "basis": "В записи отсутствует понятное название типа."})
        if amount is not None and previous is not None and previous != 0:
            delta = amount - previous
            change = abs(delta) / abs(previous) * 100
            if change >= Decimal(str(anomaly_percent)) and abs(delta) >= Decimal(str(anomaly_min_delta)):
                alerts.append({"kind": "fee_anomaly", "severity": "warning",
                    "title": "Изменение удержания", "fee": label,
                    "type_id": fee.get("type_id"), "amount": str(amount),
                    "previous_amount": str(previous), "delta": str(delta),
                    "change_percent": str(change.quantize(Decimal("0.01"))),
                    "currency": currency,
                    "recommendation": "Проверить детализацию начисления и сопоставимость периодов.",
                    "basis": "Сравнение переданных текущего и предыдущего значений одного типа и валюты."})

    priority = {"critical": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: (priority.get(a.get("severity"), 9), a.get("kind", "")))
    return {"alerts": alerts, "alert_count": len(alerts),
            "critical_count": sum(a["severity"] == "critical" for a in alerts),
            "basis": "Rules-based alerts; estimates and comparisons are not automatically confirmed facts."}
