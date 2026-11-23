from app.analytics.catalog_intelligence import analyze_catalog_product


def test_sparse_product_flags_missing_content_without_sales_history():
    result = analyze_catalog_product({"product_id": 1, "offer_id": "A-1"})

    assert result["evidence"]["sales_history_required"] is False
    assert result["card_quality_score"] == 15
    assert result["price_analysis"] is None
    assert result["pre_sales_potential_score"] >= 0
    codes = {issue["code"] for issue in result["issues"]}
    assert {"weak_title", "weak_description", "few_images", "low_attribute_coverage"} <= codes


def test_complete_product_with_comparables_and_search_terms():
    product = {
        "product_id": 123,
        "offer_id": "MODEL-X",
        "name": "Электрический чайник модель X 1.7 литра",
        "description": "Надёжный электрический чайник объёмом 1.7 литра. Автоотключение, защита от включения без воды, удобная ручка и фильтр.",
        "brand": "Example",
        "category": "Чайники",
        "price": "2490",
        "images": [{"file_name": f"image-{i}.jpg"} for i in range(5)],
        "attributes": [{"values": [{"value": f"value-{i}"}]} for i in range(10)],
    }
    result = analyze_catalog_product(
        product,
        comparable_prices=[2390, 2490, 2590],
        search_terms=["электрический чайник", "1.7 литра"],
    )

    assert result["card_quality_score"] == 100
    assert result["seo_score"] == 100
    assert result["price_analysis"]["sample_size"] == 3
    assert result["price_analysis"]["score"] == 100
    assert result["confidence"] == "high"
    assert result["pre_sales_potential_score"] == 100


def test_price_and_keyword_data_are_not_fabricated_when_missing():
    result = analyze_catalog_product({
        "name": "Товар с коротким названием",
        "description": "Короткое описание",
        "price": "1000",
    })

    codes = {issue["code"] for issue in result["issues"]}
    assert result["price_analysis"] is None
    assert "comparables_unavailable" in codes
    assert "search_terms_unavailable" in codes
    assert result["evidence"]["search_terms_supplied"] == 0


def test_comparable_prices_ignore_invalid_values_and_use_median():
    result = analyze_catalog_product(
        {"name": "Тестовый товар с достаточно подробным названием", "price": "1500"},
        comparable_prices=["не цена", 1000, 2000, 3000],
    )

    assert result["price_analysis"]["sample_size"] == 3
    assert result["price_analysis"]["comparable_median"] == 2000
    assert result["price_analysis"]["deviation_percent"] == -25.0


def test_malformed_attributes_and_images_are_safe():
    result = analyze_catalog_product({
        "name": "Нормальное название товара для карточки",
        "attributes": [None, {"values": []}, {"values": [{"value": "Материал"}]}],
        "images": [None, {}, {"url": "https://example.test/image.jpg"}],
    })

    assert result["evidence"]["populated_attribute_count"] == 1
    assert result["evidence"]["image_count"] == 1
