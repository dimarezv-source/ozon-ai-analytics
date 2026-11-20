(() => {
  const root = document.getElementById('assistantCenter');
  if (!root) return;
  const body = document.body;
  const mic = document.getElementById('assistantMic');
  const input = document.getElementById('assistantInput');
  const send = document.getElementById('assistantSend');
  const mode = document.getElementById('assistantMode');
  const status = document.getElementById('assistantStatus');
  const transcript = document.getElementById('assistantTranscript');
  const left = document.getElementById('assistantLeftContent');
  const right = document.getElementById('assistantRightContent');
  const stop = document.getElementById('assistantStop');
  let recognition = null;
  let activeTarget = null;

  const destinations = [
    { keys: ['продаж','выруч','оборот','заказ'], title: 'Продажи', description: 'Продажи за выбранный период и разбивка по товарам.', selector: '#salesBreakdown', panel: 'sales' },
    { keys: ['финанс','комисс','удержан','начислен','сверк'], title: 'Финансы', description: 'Финансовая сверка, начисления и структура удержаний.', selector: '#reconciliationPanel', panel: 'finance' },
    { keys: ['остат','склад','запас','fbo','fbs'], title: 'Остатки и склад', description: 'Наличие, резерв, оборачиваемость и рекомендации по пополнению.', selector: '#inventory', panel: 'inventory' },
    { keys: ['товар','артикул','sku','маржин','прибыл','себестоим'], title: 'Товары и экономика', description: 'Юнит-экономика, прибыльность и сравнение товарных позиций.', selector: '#productGrid', panel: 'products' },
    { keys: ['тариф','логистик','эквайринг'], title: 'Тарифы и расходы', description: 'Комиссии, логистика и известные удержания.', selector: '#fees', panel: 'fees' },
    { keys: ['качеств данных','источник данных','полнота'], title: 'Качество данных', description: 'Проверка полноты источников и ограничений расчётов.', selector: '#data', panel: 'quality' }
  ];

  function setStatus(label, state) {
    status.textContent = label;
    root.dataset.state = state || 'ready';
  }
  function addMessage(text, kind) {
    const item = document.createElement('div');
    item.className = 'assistant-message ' + (kind || 'assistant');
    item.textContent = text;
    transcript.appendChild(item);
    transcript.scrollTop = transcript.scrollHeight;
  }
  function findDestination(query) {
    const normalized = query.toLocaleLowerCase('ru');
    return destinations.find(item => item.keys.some(key => normalized.includes(key))) || null;
  }
  const live = { sales: null, ranking: null, inventory: null, updatedAt: {} };
  const money = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value) || 0) + ' ₽';
  const number = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Number(value) || 0);
  function metric(label, value, note) {
    const card = document.createElement('div');
    card.className = 'assistant-live-metric';
    const caption = document.createElement('small'); caption.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = value;
    card.append(caption, strong);
    if (note) { const hint = document.createElement('span'); hint.textContent = note; card.append(hint); }
    right.append(card);
  }
  function renderLiveData(item) {
    right.replaceChildren();
    if (!item) return;
    if (item.panel === 'sales') {
      const d = live.sales;
      if (!d) { metric('Продажи', 'Нет данных', 'Выбери период и загрузи продажи в классической панели.'); return; }
      metric('Оборот доставленных заказов', money(d.sales_gmv), 'До возвратов');
      metric('Продано единиц', number(d.delivered_units) + ' шт.', (d.delivered_postings || 0) + ' отправлений');
      metric('Период', (d.period?.date_from || '—') + ' — ' + (d.period?.date_to || '—'), 'UTC');
      const note = document.createElement('p'); note.textContent = 'Разбивка строится по доставленным отправлениям Ozon. Это оборот до возвратов, не чистая прибыль.'; right.append(note);
    } else if (item.panel === 'products') {
      const d = live.ranking;
      if (!d) { metric('Экономика товаров', 'Нет расчёта', 'Сначала загрузи продажи и каталог; для прибыли нужна заполненная себестоимость и тарифы.'); return; }
      metric('Расчётная прибыль', d.includedUnits ? money(d.estimatedProfit) : '—', 'Только товары с полными исходными данными');
      metric('Покрытие', number(d.coveragePercent) + '%', (d.includedUnits || 0) + ' из ' + (d.totalUnits || 0) + ' шт.');
      metric('Товаров в рейтинге', number((d.items || []).length), 'На основе доступной юнит-экономики');
      (d.items || []).slice(0, 5).forEach(row => metric(row.name || ('SKU ' + (row.sku ?? '—')), money(row.profit), 'Маржа ' + number(row.marginPercent) + '% · ' + row.fulfillmentType));
      const note = document.createElement('p'); note.textContent = 'Это предварительная расчётная прибыль, не фактическая выплата Ozon. Исключённые продажи и ограничения указаны в разделе экономики.'; right.append(note);
    } else if (item.panel === 'inventory') {
      const d = live.inventory;
      if (!d) { metric('Остатки', 'Нет данных', 'Обнови остатки Ozon в разделе «Остатки и склад».'); return; }
      metric('Позиций с сигналом', number((d.items || []).length), 'Критические и предупреждающие позиции');
      if (d.frozen) metric('Заморожено в остатках', money(d.frozen.knownValue), 'Оценка по заполненной себестоимости');
      (d.items || []).slice(0, 5).forEach(row => metric(row.name || ('SKU ' + (row.sku ?? '—')), number(row.available) + ' шт.', row.level === 'critical' ? 'Критический остаток' : 'Низкий запас'));
      const note = document.createElement('p'); note.textContent = 'Остатки — снимок на момент последней загрузки. Стоимость залежавшегося товара является оценкой, не гарантированной суммой возврата.'; right.append(note);
    } else {
      const note = document.createElement('p'); note.textContent = 'Для этого раздела пока нет отдельной сводки в AI-центре. Открой рабочий раздел, чтобы увидеть первичные данные.'; right.append(note);
    }
    const updated = live.updatedAt[item.panel];
    if (updated) { const stamp = document.createElement('small'); stamp.className = 'assistant-data-stamp'; stamp.textContent = 'Получено в этой сессии: ' + updated.toLocaleTimeString('ru-RU'); right.append(stamp); }
  }
  function remember(panel, data) {
    live[panel] = data;
    live.updatedAt[panel] = new Date();
    if (activeTarget && activeTarget.panel === panel) renderLiveData(activeTarget);
  }
  window.addEventListener('ozon:sales-loaded', event => remember('sales', event.detail || null));
  window.addEventListener('ozon:ranking-updated', event => remember('ranking', event.detail || null));
  window.addEventListener('ozon:inventory-updated', event => remember('inventory', event.detail || null));

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU';
    utterance.rate = 1;
    utterance.onstart = () => setStatus('Отвечаю голосом', 'speaking');
    utterance.onend = () => setStatus('Готова слушать', 'ready');
    window.speechSynthesis.speak(utterance);
  }
  function answerFor(item) {
    if (!item) return 'Не удалось определить тему. Спроси про продажи, прибыль, товары или остатки.';
    if (item.panel === 'sales') {
      const d = live.sales;
      if (!d) return 'Продажи за период ещё не загружены. Открой классическую панель, выбери даты и нажми «Показать».';
      const period = (d.period?.date_from || '—') + ' — ' + (d.period?.date_to || '—');
      return 'За период ' + period + ' оборот доставленных заказов составил ' + money(d.sales_gmv) + ', продано ' + number(d.delivered_units) + ' шт. в ' + number(d.delivered_postings) + ' отправлениях. Важно: это оборот до возвратов, не чистая прибыль.';
    }
    if (item.panel === 'products') {
      const d = live.ranking;
      if (!d) return 'Расчёт экономики товаров ещё не готов. Сначала загрузи каталог и продажи, затем проверь себестоимость и тарифы.';
      if (!d.includedUnits) return 'Пока нет продаж с полными исходными данными для расчёта прибыли. Заполни себестоимость и тарифы; неполные позиции не буду выдавать за прибыль.';
      return 'Предварительная расчётная прибыль по учтённым товарам — ' + money(d.estimatedProfit) + '. В расчёт вошло ' + number(d.includedUnits) + ' из ' + number(d.totalUnits) + ' проданных единиц (' + number(d.coveragePercent) + '% покрытия). Это оценка по юнит-экономике, не фактическая выплата Ozon.';
    }
    if (item.panel === 'inventory') {
      const d = live.inventory;
      if (!d) return 'Актуальные остатки ещё не загружены. Открой раздел «Остатки и склад» и нажми «Обновить остатки».';
      const totals = d.totals || {};
      const alerts = Array.isArray(d.items) ? d.items : [];
      const critical = alerts.filter(row => row.level === 'critical');
      const warning = alerts.filter(row => row.level === 'warning');
      let reply = 'По последнему снимку: FBO — ' + number(totals.FBO) + ' шт., FBS — ' + number(totals.FBS) + ' шт., в резерве — ' + number(totals.reserved) + ' шт. Позиций с сигналами: ' + number(alerts.length) + ' (критических — ' + number(critical.length) + ', предупреждений — ' + number(warning.length) + ').';
      if (alerts.length) reply += ' В первую очередь проверь: ' + alerts.slice(0, 3).map(row => (row.name || 'Товар') + ' — ' + number(row.available) + ' шт.').join('; ') + '.';
      reply += ' Это снимок на момент последнего обновления.';
      return reply;
    }
    return 'Сводка для раздела «' + item.title + '» пока не подключена к ответам помощника. Могу открыть раздел с исходными данными.';
  }

  function showDestination(item, query) {
    activeTarget = item;
    left.replaceChildren();
    right.replaceChildren();
    const heading = document.createElement('strong');
    heading.textContent = item ? item.title : 'Уточним запрос';
    const detail = document.createElement('p');
    detail.textContent = item ? item.description : 'Пока умею находить основные разделы панели. Попробуй спросить про продажи, финансы, товары, прибыль, комиссии или остатки.';
    left.append(heading, detail);
    const source = document.createElement('div');
    source.className = 'assistant-source';
    source.textContent = item ? 'Источник: данные текущей сессии из существующих модулей Ozon AI Analytics.' : 'Доступны команды навигации по существующим разделам.';
    right.append(source);
    if (item) renderLiveData(item);
    if (item) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'assistant-open-section';
      open.textContent = 'Открыть раздел ' + item.title;
      open.addEventListener('click', () => {
        body.classList.remove('assistant-mode');
        mode.setAttribute('aria-pressed', 'false');
        mode.textContent = 'Открыть AI-центр';
        const target = document.querySelector(item.selector);
        if (target) {
          target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
          target.classList.add('assistant-highlight');
          window.setTimeout(() => target.classList.remove('assistant-highlight'), 1600);
        }
      });
      right.append(open);
    }
    const reply = answerFor(item) + (item ? '\\n\\nМогу открыть раздел «' + item.title + '» и показать подробности.' : '');
    addMessage(reply, 'assistant');
    setStatus('Запрос обработан', 'ready');
    if (root.dataset.voiceReply === 'on') speak(reply);
  }
  function submitQuery(value) {
    const query = String(value || '').trim();
    if (!query) return;
    addMessage(query, 'user');
    input.value = '';
    setStatus('Анализирую запрос', 'thinking');
    showDestination(findDestination(query), query);
  }

  send.addEventListener('click', () => submitQuery(input.value));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') submitQuery(input.value);
  });
  mode.addEventListener('click', () => {
    const enabled = body.classList.toggle('assistant-mode');
    mode.setAttribute('aria-pressed', String(enabled));
    mode.textContent = enabled ? 'Классическая панель' : 'Открыть AI-центр';
    if (enabled) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  stop.addEventListener('click', () => {
    if (recognition) recognition.stop();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setStatus('Остановлено', 'ready');
  });

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    mic.disabled = true;
    mic.title = 'Голосовой ввод не поддерживается этим браузером. Используй текстовое поле.';
    setStatus('Голос недоступен · текстовый режим активен', 'fallback');
  } else {
    recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => setStatus('Слушаю тебя…', 'listening');
    recognition.onresult = event => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
        else interimText += event.results[i][0].transcript;
      }
      input.value = finalText || interimText;
      if (finalText.trim()) submitQuery(finalText);
    };
    recognition.onerror = event => setStatus(event.error === 'not-allowed' ? 'Нет доступа к микрофону' : 'Не удалось распознать речь', 'error');
    recognition.onend = () => {
      if (root.dataset.state === 'listening') setStatus('Готова слушать', 'ready');
    };
    mic.addEventListener('click', () => {
      try { recognition.start(); }
      catch (_) { setStatus('Микрофон уже активен', 'listening'); }
    });
  }
  document.querySelectorAll('.assistant-example').forEach(button => {
    button.addEventListener('click', () => submitQuery(button.textContent));
  });
  setStatus('Готова слушать', 'ready');
  mode.setAttribute('aria-pressed', 'true');
  mode.textContent = 'Классическая панель';
  body.classList.add('assistant-mode');
})();