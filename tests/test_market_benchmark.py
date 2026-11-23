import pytest

from app.analytics.market_benchmark import analyze_market_export


def test_csv_market_export_scores_demand_and_competition():
    content = (
        "Поисковый запрос;Искали за неделю;Добавили в корзину;Средняя цена;Продавцов\n"
        "Запрос А;10000;5000;1200;20\n"
        "Запрос Б;500;20;900;300\n"
        "Запрос В;5000;1500;1500;80\n"
    ).encode()
    result = analyze_market_export("market.csv", content)
    assert result["row_count"] == 3
    assert result["scored_count"] == 3
    assert result["rows"][0]["name"] == "Запрос А"
    assert result["rows"][0]["market_opportunity_score"] > result["rows"][1]["market_opportunity_score"]
    assert result["summary"]["high_opportunity"] >= 1


def test_market_export_does_not_invent_missing_metrics():
    result = analyze_market_export("market.csv", "Товар;Продано\nA;12\nB;4\n".encode())
    assert "seller_count" in result["missing_metrics"]
    assert result["rows"][0]["seller_count"] is None
    assert result["rows"][0]["market_opportunity_score"] is not None


def test_market_export_rejects_unknown_file():
    with pytest.raises(ValueError, match="Поддерживаются"):
        analyze_market_export("report.pdf", b"data")


def test_market_export_rejects_unrecognized_headers():
    with pytest.raises(ValueError, match="Не удалось распознать"):
        analyze_market_export("bad.csv", "foo;bar\nx;y".encode())
