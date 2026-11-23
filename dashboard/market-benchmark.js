(() => {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money = v => v == null ? "—" : new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0}).format(v)+" ₽";
  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("marketBenchmark")) return;
    const section = document.createElement("section");
    section.id = "marketBenchmark";
    section.className = "card";
    section.style.margin = "0 0 18px";
    section.innerHTML = `
      <div class="sectionhead"><div><h2>Рыночный бенчмарк и конкурентная среда</h2><p>Импорт официальной аналитики Ozon «Что продавать» — спрос, средняя цена и конкуренция</p></div><span class="tag">MARKET INTEL</span></div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0">
        <input id="marketFile" type="file" accept=".csv,.xls,.xlsx" style="max-width:320px">
        <button id="marketImport" type="button" class="primary">Загрузить и оценить</button>
        <button id="marketExport" type="button" disabled>Экспорт CSV</button>
      </div>
      <p id="marketStatus" class="hint" aria-live="polite">Загрузи выгрузку Ozon в CSV/XLS/XLSX. Данные обрабатываются локально на сервере только во время запроса и не сохраняются.</p>
      <div class="kpis" style="margin:12px 0">
        <div class="card"><small>Строк в отчёте</small><div id="marketRows" class="kvalue">—</div></div>
        <div class="card"><small>Высокий потенциал</small><div id="marketHigh" class="kvalue">—</div></div>
        <div class="card"><small>Средняя цена</small><div id="marketPrice" class="kvalue">—</div></div>
        <div class="card"><small>Спрос в выгрузке</small><div id="marketDemand" class="kvalue">—</div></div>
      </div>
      <div class="accrual-table-wrap"><table class="accrual-table"><thead><tr><th>Товар / запрос / категория</th><th>Спрос</th><th>Продавцы</th><th>Средняя цена</th><th>В корзину</th><th>Потенциал</th><th>Рекомендация</th></tr></thead><tbody id="marketRowsBody"><tr><td colspan="7" class="hint">Ожидается файл Ozon.</td></tr></tbody></table></div>
      <p class="accrual-caveat">Рейтинг относительный внутри загруженного отчёта. Для «Что продавать на Ozon» Ozon предоставляет аналитику по товарам, категориям и популярным поисковым запросам; доступные поля зависят от выгрузки и подписки. Не загружай отчёт, если условия твоей подписки запрещают его обработку сторонним ПО.</p>`;
    const anchor = document.querySelector("main .footer") || document.querySelector("main");
    anchor.parentNode.insertBefore(section, anchor);
    let data = null;
    const $ = id => document.getElementById(id);
    $("marketImport").addEventListener("click", async () => {
      const file = $("marketFile").files[0];
      if (!file) { $("marketStatus").textContent = "Сначала выбери файл выгрузки."; return; }
      $("marketImport").disabled = true; $("marketStatus").classList.remove("error"); $("marketStatus").textContent = "Читаю таблицу и рассчитываю относительный потенциал…";
      try {
        const response = await fetch("/api/market/benchmark/import", {method:"POST", credentials:"same-origin", headers:{"Content-Type":"application/octet-stream","X-File-Name":encodeURIComponent(file.name)}, body:await file.arrayBuffer()});
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || "Не удалось обработать файл.");
        data = result;
        $("marketRows").textContent = result.row_count;
        $("marketHigh").textContent = result.summary.high_opportunity;
        $("marketPrice").textContent = money(result.summary.average_price);
        $("marketDemand").textContent = result.summary.demand_total == null ? "—" : new Intl.NumberFormat("ru-RU").format(result.summary.demand_total);
        $("marketRowsBody").innerHTML = result.rows.map(r => '<tr><td><b>'+esc(r.name)+'</b>'+(r.category?'<small>'+esc(r.category)+'</small>':'')+'</td><td>'+esc(r.demand ?? r.revenue ?? "—")+'</td><td>'+esc(r.seller_count ?? r.competition_label ?? "—")+'</td><td>'+money(r.average_price)+'</td><td>'+esc(r.cart_adds ?? "—")+'</td><td><b>'+(r.market_opportunity_score == null ? "—" : esc(r.market_opportunity_score)+"/100")+'</b><small>'+esc(r.score_confidence)+'</small></td><td>'+esc(r.recommendation || "Недостаточно метрик")+'</td></tr>').join("") || '<tr><td colspan="7">Нет строк для отображения</td></tr>';
        $("marketStatus").textContent = "Готово · "+result.row_count+" строк · оценено "+result.scored_count+". Не найдены метрики: "+(result.missing_metrics.join(", ") || "нет")+". "+result.notice;
        $("marketExport").disabled = !result.rows.length;
      } catch (e) { $("marketStatus").classList.add("error"); $("marketStatus").textContent = e.message || "Ошибка импорта."; }
      finally { $("marketImport").disabled = false; }
    });
    $("marketExport").addEventListener("click", () => {
      if (!data) return;
      const fields=["rank","name","category","demand","revenue","average_price","seller_count","views","cart_adds","market_opportunity_score","score_confidence","recommendation"];
      const q=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
      const csv=[fields.join(";"),...data.rows.map(r=>fields.map(f=>q(r[f])).join(";"))].join("\r\n");
      const a=document.createElement("a"); const u=URL.createObjectURL(new Blob(["\\ufeff"+csv],{type:"text/csv;charset=utf-8"})); a.href=u; a.download="ozon-market-benchmark.csv"; a.click(); URL.revokeObjectURL(u);
    });
  });
})();