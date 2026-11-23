"""Explainable pre-sales catalog audit; deliberately independent of sales history."""
from __future__ import annotations

from statistics import median
from typing import Any, Iterable


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _attribute_count(value: Any) -> int:
    if not isinstance(value, list):
        return 0
    count = 0
    for item in value:
        if not isinstance(item, dict):
            continue
        raw = item.get("values")
        if isinstance(raw, list):
            populated = any(
                isinstance(entry, dict) and _text(entry.get("value"))
                for entry in raw
            )
        else:
            populated = bool(_text(item.get("value")))
        count += int(populated)
    return count


def _image_count(product: dict[str, Any]) -> int:
    for key in ("images", "primary_image", "image_url", "images360"):
        value = product.get(key)
        if isinstance(value, list):
            count = 0
            for item in value:
                if isinstance(item, str):
                    count += int(bool(item.strip()))
                elif isinstance(item, dict):
                    candidate = item.get("file_name") or item.get("url") or item.get("src")
                    count += int(isinstance(candidate, str) and bool(candidate.strip()))
            return count
        if isinstance(value, str) and value.strip():
            return 1
    return 0

def _price_value(value: Any) -> float | None:
    if isinstance(value, dict):
        value = value.get("marketing_price") or value.get("price") or value.get("old_price")
    try:
        number = float(str(value).replace(",", ".").replace(" ", ""))
    except (TypeError, ValueError):
        return None
    return number if number > 0 and number < float("inf") else None


def _score_price(product_price: float, comparable_prices: Iterable[Any]) -> dict[str, Any] | None:
    prices = [p for raw in comparable_prices if (p := _price_value(raw)) is not None]
    if not prices:
        return None
    benchmark = float(median(prices))
    index = product_price / benchmark if benchmark else None
    deviation = abs(index - 1) if index is not None else 1
    score = 100 if deviation <= .05 else 85 if deviation <= .10 else 65 if deviation <= .20 else 40
    return {
        "score": score,
        "seller_price": round(product_price, 2),
        "comparable_median": round(benchmark, 2),
        "price_index": round(index, 3),
        "deviation_percent": round((index - 1) * 100, 1),
        "sample_size": len(prices),
        "basis": "median of supplied comparable offers; not an Ozon market-wide benchmark",
    }


def analyze_catalog_product(
    product: dict[str, Any],
    *,
    comparable_prices: Iterable[Any] | None = None,
    search_terms: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Return explainable card, SEO, price and pre-sales readiness scores.

    Comparable prices and search terms must be supplied by a separately verified
    data source. Missing external evidence is represented as unavailable.
    """
    if not isinstance(product, dict):
        raise ValueError("Product must be an object")

    title = _text(product.get("name") or product.get("title"))
    description = _text(product.get("description") or product.get("annotation"))
    attributes = _attribute_count(product.get("attributes"))
    images = _image_count(product)
    offer_id = _text(product.get("offer_id"))
    product_id = _text(str(product.get("product_id") or product.get("id") or ""))
    brand = _text(product.get("brand") or product.get("brand_name"))
    category = _text(product.get("category") or product.get("type_name") or str(product.get("description_category_id") or ""))
    seller_price = _price_value(product.get("price") or product.get("marketing_price"))
    content_rating = _price_value(product.get("content_rating"))
    content_rating_groups = product.get("content_rating_groups") if isinstance(product.get("content_rating_groups"), list) else []

    issues: list[dict[str, str]] = []
    recommendations: list[str] = []

    title_points = 20 if len(title) >= 25 else 12 if len(title) >= 10 else 0
    description_points = 15 if len(description) >= 120 else 10 if len(description) >= 40 else 0
    image_points = 20 if images >= 5 else 15 if images >= 3 else 8 if images else 0
    attribute_points = 25 if attributes >= 10 else 18 if attributes >= 5 else 8 if attributes else 0
    identity_points = 10 if offer_id and product_id else 5 if offer_id or product_id else 0
    classification_points = (5 if brand else 0) + (5 if category else 0)
    card_score = title_points + description_points + image_points + attribute_points + identity_points + classification_points

    if title_points < 20:
        issues.append({"severity": "high", "code": "weak_title", "message": "Название короткое или недостаточно информативное."})
        recommendations.append("Уточнить название: тип товара, модель и ключевые отличительные характеристики.")
    if description_points < 15:
        issues.append({"severity": "medium", "code": "weak_description", "message": "Описание короткое или отсутствует."})
        recommendations.append("Добавить структурированное описание с назначением, преимуществами и характеристиками.")
    if images < 3:
        issues.append({"severity": "high" if images == 0 else "medium", "code": "few_images", "message": f"Изображений обнаружено: {images}; для визуальной оценки карточки этого мало."})
        recommendations.append("Добавить качественные изображения товара и инфографику; проверить требования категории.")
    if attributes < 5:
        issues.append({"severity": "medium", "code": "low_attribute_coverage", "message": f"Заполненных атрибутов обнаружено: {attributes}; обязательность полей не проверялась."})
        recommendations.append("Проверить и заполнить релевантные характеристики, особенно фильтруемые параметры.")
    if not brand:
        issues.append({"severity": "low", "code": "missing_brand", "message": "Бренд в данных карточки не найден."})
    if not category:
        issues.append({"severity": "low", "code": "missing_category", "message": "Категория в данных карточки не найдена."})

    terms = [_text(term).lower() for term in (search_terms or []) if _text(term)]
    title_lower, description_lower = title.lower(), description.lower()
    matched_terms = [term for term in terms if term in title_lower or term in description_lower]
    seo_weights = 40 + 30 + 20 + (10 if terms else 0)
    seo_points = (
        (40 if title_points == 20 else 24 if title_points else 0)
        + (30 if description_points == 15 else 18 if description_points else 0)
        + (20 if attributes >= 5 else 8 if attributes else 0)
        + (10 * len(matched_terms) / len(terms) if terms else 0)
    )
    seo_score = round(seo_points / seo_weights * 100)
    if terms and len(matched_terms) < len(terms):
        issues.append({"severity": "medium", "code": "keyword_coverage", "message": f"В тексте карточки найдено {len(matched_terms)} из {len(terms)} переданных поисковых фраз."})
        recommendations.append("Естественно добавить релевантные поисковые фразы в название и описание, не перегружая текст.")
    elif not terms:
        issues.append({"severity": "info", "code": "search_terms_unavailable", "message": "Фактические поисковые фразы не переданы; SEO оценено только по структуре карточки."})

    price_analysis = _score_price(seller_price, comparable_prices or []) if seller_price is not None else None
    if seller_price is None:
        issues.append({"severity": "info", "code": "seller_price_unavailable", "message": "Цена продавца не найдена в данных товара."})
    elif price_analysis is None:
        issues.append({"severity": "info", "code": "comparables_unavailable", "message": "Нет подтверждённых сопоставимых цен; конкурентность цены не оценивалась."})
    elif price_analysis["score"] <= 65:
        issues.append({"severity": "medium", "code": "price_outside_benchmark", "message": f"Цена отличается от медианы переданной выборки на {price_analysis['deviation_percent']}%."})
        recommendations.append("Проверить сопоставимость аналогов, комплектацию и экономику перед корректировкой цены.")

    # This is a catalog-readiness proxy, not a demand or sales forecast.
    if price_analysis:
        potential_score = round(card_score * .60 + seo_score * .25 + price_analysis["score"] * .15)
        confidence = "high" if images >= 3 and attributes >= 5 and price_analysis["sample_size"] >= 3 else "medium"
        basis = "card quality 60%, structural SEO 25%, supplied comparable-price positioning 15%"
    else:
        potential_score = round(card_score * .70 + seo_score * .30)
        confidence = "low" if not title and not description and not images else "medium"
        basis = "card quality 70%, structural SEO 30%; price and demand evidence unavailable"

    return {
        "product_id": product_id or None,
        "offer_id": offer_id or None,
        "title": title or "Без названия",
        "seller_price": round(seller_price, 2) if seller_price is not None else None,
        "currency_code": _text(product.get("currency_code")) or None,
        "ozon_content_rating": round(content_rating, 1) if content_rating is not None else None,
        "content_rating_groups": content_rating_groups,
        "card_quality_score": card_score,
        "seo_score": seo_score,
        "price_analysis": price_analysis,
        "pre_sales_potential_score": potential_score,
        "confidence": confidence,
        "potential_basis": basis,
        "evidence": {
            "title_characters": len(title),
            "description_characters": len(description),
            "image_count": images,
            "populated_attribute_count": attributes,
            "search_terms_supplied": len(terms),
            "search_terms_matched": len(matched_terms),
            "sales_history_required": False,
        },
        "issues": issues,
        "recommendations": list(dict.fromkeys(recommendations)),
        "notice": "Оценка готовности каталога до первых продаж. Не является прогнозом спроса, продаж или гарантией результата.",
    }
