(() => {
  const $ = (id) => document.getElementById(id);
  const state = { products: [], loadedAt: null };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
  const money = (value, currency) => value == null ? "—" :
    new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(value)) + " " + (currency || "₽");
  const score = (value) => '<span class="catalog-score ' +
    (value >= 80 ? "good" : value >= 60 ? "mid" : "bad") + '">' + esc(value) + "/100</span>";

  function filtered() {
    const query = ($("catalogIntelSearch")?.value || "").trim().toLowerCase();
    return state.products.filter((item) =>
      !query || [item.title, item.offer_id, item.product_id].some((v) => String(v || "").toLowerCase().includes(query))
    );
  }

  function render() {
    const rows = filtered();
    $("catalogIntelRows").innerHTML = rows.length ? rows.map((item) => {
      const issues = (item.issues || []).map((issue) =>
        '<li><b>' + esc(issue.severity) + ':</b> ' + esc(issue.message) + '</li>'
      ).join("");
      const recommendations = (item.recommendations || []).map((value) => '<li>' + esc(value) + '</li>').join("");
      const searchTerms = (item.search_terms || []).map((value) => '<li>' + esc(value) + '</li>').join("");
      const ratingGroups = (item.content_rating_groups || []).map((group) =>
        '<li>' + esc(group.name || group.title || group.id || "Показатель") + ': ' + esc(group.rating ?? group.value ?? "—") + '</li>'
      ).join("");
      const detail = (item.issues?.length || item.recommendations?.length || ratingGroups || searchTerms || item.search_metrics)
        ? '<details class="catalog-intel-details"><summary>Проблемы и действия (' + esc(item.issues?.length || 0) + ')</summary>' +
          (issues ? '<b>Найдено</b><ul>' + issues + '</ul>' : '') +
          (recommendations ? '<b>Рекомендуется</b><ul>' + recommendations + '</ul>' : '') +
          (ratingGroups ? '<b>Группы контент-рейтинга Ozon</b><ul>' + ratingGroups + '</ul>' : '') +
          (searchTerms ? '<b>Поисковые фразы Ozon</b><ul>' + searchTerms + '</ul>' : '') + '</details>'
        : '<span class="hint">Критичных замечаний по текущим данным нет</span>';
      const searchActivity = item.search_metrics
        ? esc(item.search_metrics.unique_search_users ?? "—") + '<small>поиск / ' + esc(item.search_metrics.unique_view_users ?? "—") + ' просмотров</small>'
        : '<span class="hint">Нет данных</span>';
      const price = item.price_analysis
        ? money(item.seller_price, item.currency_code) + (item.price_analysis.source === "Ozon Seller API price index"
          ? '<small>Индекс Ozon: ' + esc(item.price_analysis.color_index) + '</small>'
          : '<small>Отклонение ' + esc(item.price_analysis.deviation_percent) + '% от медианы</small>')
        : money(item.seller_price, item.currency_code) + '<small>Индекс Ozon недоступен</small>';
      return '<tr><td><b>' + esc(item.title) + '</b><small>' + esc(item.offer_id || item.product_id || "") + '</small></td>' +
        '<td>' + price + '</td><td>' + score(item.card_quality_score) + '</td><td>' + (item.ozon_content_rating == null ? '—' : score(item.ozon_content_rating)) + '</td><td>' + searchActivity + '</td><td>' + score(item.seo_score) + '</td>' +
        '<td>' + score(item.pre_sales_potential_score) + '<small>' + esc(item.confidence) + ' уверенность</small></td><td>' + detail + '</td></tr>';
    }).join("") : '<tr><td colspan="8" class="hint">По фильтру ничего не найдено.</td></tr>';
    $("catalogIntelExport").disabled = !state.products.length;
    $("catalogIntelCount").textContent = rows.length + " из " + state.products.length;
  }

  async function load() {
    const button = $("catalogIntelRun");
    const status = $("catalogIntelStatus");
    button.disabled = true;
    status.classList.remove("error");
    status.textContent = "Загружаю каталог и характеристики из Ozon…";
    try {
      const limit = Math.max(1, Math.min(10000, Number($("catalogIntelLimit").value) || 5000));
      const response = await fetch("/api/catalog/intelligence?limit=" + limit, { credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Не удалось проанализировать каталог.");
      state.products = Array.isArray(data.products) ? data.products : [];
      state.loadedAt = new Date();
      $("catalogIntelTotal").textContent = data.product_count;
      $("catalogIntelWeak").textContent = data.summary.weak_cards;
      $("catalogIntelSeo").textContent = data.summary.low_seo;
      $("catalogIntelAverage").textContent = data.summary.average_card_quality + "/100";
      status.textContent = "Готово · " + state.products.length + " товаров · " +
        state.loadedAt.toLocaleTimeString("ru-RU") + ". " + (data.content_rating_available ? "Контент-рейтинг Ozon получен. " : "Контент-рейтинг Ozon недоступен по текущему ключу. ") +
        (data.search_metrics_available ? "Метрики поиска получены. " : "Метрики поиска не вернулись. ") +
        (data.search_terms_available ? "Поисковые фразы подключены. " : "Фактические поисковые фразы недоступны. ") + data.notice;
      render();
    } catch (error) {
      status.classList.add("error");
      status.textContent = error.message || "Ошибка загрузки каталога.";
    } finally {
      button.disabled = false;
    }
  }

  function exportCsv() {
    const columns = ["product_id", "offer_id", "title", "seller_price", "currency_code",
      "card_quality_score", "ozon_content_rating", "unique_search_users", "unique_view_users", "view_conversion", "position", "search_terms", "seo_score", "pre_sales_potential_score", "confidence", "issues"];
    const quote = (value) => '"' + String(value ?? "").replace(/"/g, '""') + '"';
    const lines = [columns.join(";")].concat(state.products.map((item) => [
      item.product_id, item.offer_id, item.title, item.seller_price, item.currency_code,
      item.card_quality_score, item.ozon_content_rating, item.search_metrics?.unique_search_users, item.search_metrics?.unique_view_users, item.search_metrics?.view_conversion, item.search_metrics?.position, (item.search_terms || []).join(" | "), item.seo_score, item.pre_sales_potential_score, item.confidence,
      (item.issues || []).map((issue) => issue.message).join(" | ")
    ].map(quote).join(";")));
    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ozon-catalog-intelligence.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("catalogIntelRun")?.addEventListener("click", load);
    $("catalogIntelExport")?.addEventListener("click", exportCsv);
    $("catalogIntelSearch")?.addEventListener("input", render);
  });
})();