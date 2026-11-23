from app.analytics.catalog_intelligence import analyze_catalog_product


def test_sparse_product_flags_missing_content_without_sales_history():
    result = analyze_catalog_product({"product_id": 1, "offer_id": "A-1"})

    assert result["evidence"]["sales_history_required"] is False
    assert result["card_quality_score"] == 10
    assert result["price_analysis"] is None
    assert result["pre_sales_potential_score"] >= 0
    codes = {issue["code"] for issue in result["issues"]}
    assert {"weak_title", "weak_description", "few_images", "low_attribute_coverage"} <= codes


def test_complete_product_with_comparables_and_search_terms():
    product = {
        "product_id": 123,
        "offer_id": "MODEL-X",
        "name": "Электрический чайник модель X 1.7 литра",
        "description": "Надёжный электрический чайник объёмом 1.7 литра. Автоотключение, защита от включения без воды, удобная ручка и фильтр. Подходит для ежедневного использования дома и в офисе, легко очищается и не занимает много места на кухне.",
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
    assert "price_index_unavailable" in codes
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


def test_ozon_price_index_provides_price_position_without_sales_history():
    result = analyze_catalog_product({
        "product_id": 77,
        "name": "Подробное название товара для проверки",
        "price": {"marketing_price": "1200"},
        "price_indexes": {
            "color_index": "RED",
            "external_index_data": {"price_index": 1.24},
            "ozon_index_data": {"price_index": 1.08},
        },
    })

    assert result["price_analysis"]["source"] == "Ozon Seller API price index"
    assert result["price_analysis"]["color_index"] == "RED"
    assert result["price_analysis"]["external_price_index"] == 1.24
    assert result["price_analysis"]["score"] == 35
    assert any(issue["code"] == "ozon_price_index_warning" for issue in result["issues"])


def test_search_metrics_and_real_query_terms_are_returned_separately_from_sales():
    result = analyze_catalog_product({
        "name": "Подробное название товара для SEO проверки",
        "description": "Описание для проверки поисковой оптимизации. Товар для SEO анализа",
        "search_metrics": {"unique_search_users": 120, "unique_view_users": 35, "view_conversion": 0.29, "position": 18},
        "search_terms": ["подробное название товара", "товар для SEO"],
    })

    assert result["search_metrics"]["unique_search_users"] == 120
    assert result["evidence"]["search_terms_supplied"] == 2
    assert result["evidence"]["search_terms_matched"] == 2
    assert result["evidence"]["sales_history_required"] is False


def test_search_opportunity_ranks_products_relative_to_this_catalog():
    from app.analytics.catalog_intelligence import rank_search_opportunities

    products = [
        {"search_metrics": {"unique_search_users": 1000, "position": 80, "view_conversion": 0.05}, "recommendations": []},
        {"search_metrics": {"unique_search_users": 500, "position": 10, "view_conversion": 0.30}, "recommendations": []},
        {"search_metrics": {"unique_search_users": 0}, "recommendations": []},
    ]

    ranked = rank_search_opportunities(products)

    assert ranked[0]["search_opportunity"]["score"] > ranked[1]["search_opportunity"]["score"]
    assert ranked[0]["search_opportunity"]["level"] == "high"
    assert ranked[0]["search_opportunity"]["catalog_search_rank"] == 1
    assert ranked[1]["search_opportunity"]["catalog_search_rank"] == 2
    assert ranked[2]["search_opportunity"] is None
    assert any("Высокий поисковый интерес" in text for text in ranked[0]["recommendations"])


def test_search_opportunity_uses_neutral_percentile_for_single_product_and_ties():
    from app.analytics.catalog_intelligence import rank_search_opportunities

    single = [{"search_metrics": {"unique_search_users": 25}, "recommendations": []}]
    rank_search_opportunities(single)
    assert single[0]["search_opportunity"]["score"] == 50

    tied = [
        {"search_metrics": {"unique_search_users": 100}, "recommendations": []},
        {"search_metrics": {"unique_search_users": 100}, "recommendations": []},
    ]
    rank_search_opportunities(tied)
    assert tied[0]["search_opportunity"]["score"] == tied[1]["search_opportunity"]["score"]
    assert tied[0]["search_opportunity"]["catalog_search_rank"] == tied[1]["search_opportunity"]["catalog_search_rank"]
