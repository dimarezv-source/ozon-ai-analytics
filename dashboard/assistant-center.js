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
    source.textContent = item ? 'Источник: существующий модуль Ozon AI Analytics. Данные откроются в рабочем разделе.' : 'Доступны команды навигации по существующим разделам.';
    right.append(source);
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
    const reply = item ? 'Нашла раздел «' + item.title + '». Открыть его с данными?' : 'Я пока не распознала нужный раздел. Скажи, например: покажи продажи, финансы, товары или остатки.';
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