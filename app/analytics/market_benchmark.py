"""Normalize private Ozon market/category exports without inventing missing metrics."""
from __future__ import annotations

import csv
import io
import math
import re
from pathlib import Path
from typing import Any


ALIASES = {
    "name": ("товар", "название", "наименование", "product", "search query", "поисковый запрос", "запрос", "категория", "category"),
    "demand": ("искали", "поиска", "запросов", "searched", "searches", "уникальных покупателей", "продано", "реализовано", "sold", "sales pcs", "штук"),
    "revenue": ("продаж", "выруч", "gmv", "оборот", "sales rub", "monthly sales"),
    "price": ("средняя цена", "average price", "цена товара", "avg price"),
    "sellers": ("продавцов", "количество продавцов", "sellers", "конкуренц"),
    "views": ("просмотр", "viewed", "views"),
    "cart": ("в корзин", "добавили", "cart", "add to cart"),
    "competition": ("уровень конкуренции", "competition level", "конкуренция"),
    "category": ("категория", "category", "ниша"),
}


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else None
    raw = str(value).strip().replace("\u00a0", "").replace(" ", "").replace("₽", "").replace("%", "").replace(",", ".")
    if not raw or raw in {"-", "—", "н/д", "нет данных"}:
        return None
    raw = re.sub(r"[^0-9.]", "", raw)
    try:
        result = float(raw)
        return result if math.isfinite(result) and result >= 0 else None
    except ValueError:
        return None


def _header_key(value: Any) -> str:
    return re.sub(r"[^a-zа-я0-9]+", " ", str(value or "").lower()).strip()


def _detect_columns(header: list[Any]) -> dict[str, int]:
    normalized = [_header_key(value) for value in header]
    found: dict[str, int] = {}
    for field, aliases in ALIASES.items():
        for index, label in enumerate(normalized):
            if any(_header_key(alias) in label for alias in aliases):
                found[field] = index
                break
    return found


def _read_rows(filename: str, content: bytes) -> tuple[list[list[Any]], str]:
    suffix = Path(filename.lower()).suffix
    if suffix == ".csv":
        text = content.decode("utf-8-sig")
        sample = text[:8192]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=";,\\t")
        except csv.Error:
            dialect = csv.excel
        return list(csv.reader(io.StringIO(text), dialect)), "CSV"
    if suffix == ".xlsx":
        from openpyxl import load_workbook
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        sheet = workbook.active
        rows = [list(row) for row in sheet.iter_rows(values_only=True)]
        workbook.close()
        return rows, "XLSX"
    if suffix == ".xls":
        import xlrd
        book = xlrd.open_workbook(file_contents=content, on_demand=True)
        sheet = book.sheet_by_index(0)
        rows = [sheet.row_values(i) for i in range(sheet.nrows)]
        book.release_resources()
        return rows, "XLS"
    raise ValueError("Поддерживаются файлы CSV, XLS и XLSX.")


def _percentile(values: list[float], value: float, reverse: bool = False) -> float:
    ordered = sorted(values, reverse=reverse)
    if len(ordered) <= 1:
        return 50.0
    better = sum(1 for item in ordered if item < value) if reverse else sum(1 for item in ordered if item > value)
    return round(100 * better / (len(ordered) - 1), 1)


def analyze_market_export(filename: str, content: bytes) -> dict[str, Any]:
    if not content:
        raise ValueError("Файл пуст.")
    if len(content) > 15 * 1024 * 1024:
        raise ValueError("Максимальный размер файла — 15 МБ.")
    rows, file_type = _read_rows(filename, content)
    header_index = -1
    columns: dict[str, int] = {}
    for index, row in enumerate(rows[:30]):
        candidate = _detect_columns(row)
        if "name" in candidate and len(candidate) >= 2:
            header_index, columns = index, candidate
            break
    if header_index < 0:
        raise ValueError("Не удалось распознать заголовки. Нужны столбцы с названием товара/запроса и хотя бы одной метрикой спроса, цены или конкуренции.")
    normalized = []
    for row in rows[header_index + 1:]:
        if not row or not any(str(cell or "").strip() for cell in row):
            continue
        def cell(field: str):
            idx = columns.get(field)
            return row[idx] if idx is not None and idx < len(row) else None
        name = str(cell("name") or "").strip()
        if not name:
            continue
        competition_raw = str(cell("competition") or "").strip().lower()
        competition_score = None
        if competition_raw:
            if any(word in competition_raw for word in ("низ", "low", "слаб")):
                competition_score = 90.0
            elif any(word in competition_raw for word in ("сред", "medium", "умер")):
                competition_score = 60.0
            elif any(word in competition_raw for word in ("выс", "high", "силь")):
                competition_score = 25.0
        normalized.append({
            "name": name[:300],
            "category": str(cell("category") or "").strip()[:200] or None,
            "demand": _number(cell("demand")),
            "revenue": _number(cell("revenue")),
            "average_price": _number(cell("price")),
            "seller_count": _number(cell("sellers")),
            "views": _number(cell("views")),
            "cart_adds": _number(cell("cart")),
            "competition_label": competition_raw or None,
            "_competition_score": competition_score,
        })
    if not normalized:
        raise ValueError("В распознанной таблице нет строк с названиями товаров, запросов или категорий.")
    demand_values = [r["demand"] for r in normalized if r["demand"] is not None]
    seller_values = [r["seller_count"] for r in normalized if r["seller_count"] is not None]
    demand_key = "demand" if demand_values else "revenue"
    demand_values = [r[demand_key] for r in normalized if r[demand_key] is not None]
    for item in normalized:
        parts, weights = [], []
        demand = item[demand_key]
        if demand is not None and demand_values:
            parts.append(_percentile([math.log1p(v) for v in demand_values], math.log1p(demand)))
            weights.append(0.5)
        if item["_competition_score"] is not None:
            parts.append(item["_competition_score"]); weights.append(0.3)
        elif item["seller_count"] is not None and seller_values:
            parts.append(_percentile([math.log1p(v) for v in seller_values], math.log1p(item["seller_count"]), reverse=True))
            weights.append(0.3)
        if item["demand"] and item["cart_adds"] is not None and item["cart_adds"] <= item["demand"]:
            rates = [r["cart_adds"] / r["demand"] for r in normalized if r["demand"] and r["cart_adds"] is not None and r["cart_adds"] <= r["demand"]]
            parts.append(_percentile(rates, item["cart_adds"] / item["demand"])); weights.append(0.2)
        item["market_opportunity_score"] = round(sum(p * w for p, w in zip(parts, weights)) / sum(weights), 1) if weights else None
        item["score_confidence"] = "высокая" if len(parts) == 3 else "средняя" if len(parts) == 2 else "низкая" if len(parts) == 1 else "нет данных"
        item.pop("_competition_score", None)
    ranked = sorted((r for r in normalized if r["market_opportunity_score"] is not None), key=lambda r: r["market_opportunity_score"], reverse=True)
    for rank, item in enumerate(ranked, 1):
        item["rank"] = rank
        score = item["market_opportunity_score"]
        item["recommendation"] = "Изучить нишу в первую очередь" if score >= 70 else "Проверить экономику и карточки конкурентов" if score >= 40 else "Высокая конкуренция или слабый спрос по этому срезу"
    missing = [field for field in ("demand", "seller_count", "average_price", "cart_adds") if not any(r.get(field) is not None for r in normalized)]
    return {
        "status": "ok", "source": "user_uploaded_ozon_export", "file_type": file_type,
        "filename": Path(filename).name[:160], "row_count": len(normalized),
        "scored_count": len(ranked), "missing_metrics": missing,
        "summary": {
            "high_opportunity": sum((r["market_opportunity_score"] or 0) >= 70 for r in ranked),
            "average_price": round(sum(r["average_price"] for r in normalized if r["average_price"] is not None) / max(1, sum(r["average_price"] is not None for r in normalized)), 2) if any(r["average_price"] is not None for r in normalized) else None,
            "demand_total": round(sum(r[demand_key] or 0 for r in normalized), 2) if demand_values else None,
            "demand_metric": demand_key,
        },
        "rows": ranked,
        "notice": "Оценка относительная: сравнивает только строки загруженного файла. Это не прогноз продаж и не оценка всего рынка. Неизвестные показатели не подменяются нулями. Данные остаются в браузере текущей сессии и не сохраняются на сервере.",
    }
