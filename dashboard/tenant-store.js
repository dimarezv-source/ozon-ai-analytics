(() => {
  "use strict";

  const originalFetch = window.fetch.bind(window);
  let selectedStoreId = null;
  let selectedStoreName = "";
  let releaseRequests;
  const storeReady = new Promise(resolve => { releaseRequests = resolve; });
  const cookieValue = name => {
    const row = document.cookie.split("; ").find(item => item.startsWith(name + "="));
    return row ? decodeURIComponent(row.slice(name.length + 1)) : "";
  };

  // All analytics requests wait until a tenant session and an explicit store
  // selection exist. The server still revalidates this ID against membership.
  window.fetch = (input, init = {}) => {
    const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const url = new URL(rawUrl, window.location.origin);
    if (url.origin !== window.location.origin ||
        !url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/api/auth/")) {
      return originalFetch(input, init);
    }
    return storeReady.then(() => {
      const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method === "GET" && selectedStoreId && !url.searchParams.has("store_id")) {
        url.searchParams.set("store_id", selectedStoreId);
      }
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        const csrf = cookieValue("ozon_user_csrf");
        if (csrf) headers.set("X-CSRF-Token", csrf);
      }
      return originalFetch(url.pathname + url.search + url.hash, {
        ...init, method, headers, credentials: "same-origin"
      });
    });
  };

  const gate = document.createElement("section");
  gate.id = "tenantAccessGate";
  gate.innerHTML = `
    <div class="tenant-gate-card">
      <div class="tenant-gate-brand">OZON AI ANALYTICS</div>
      <h1 id="tenantGateTitle">Рабочее пространство</h1>
      <p id="tenantGateDescription">Войдите или создайте первое рабочее пространство, чтобы открыть аналитику.</p>
      <div id="tenantGateForm"></div>
      <p id="tenantGateStatus" role="status" aria-live="polite"></p>
    </div>`;
  const style = document.createElement("style");
  style.textContent = `
    #tenantAccessGate{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:18px;background:rgba(15,20,42,.78);backdrop-filter:blur(8px)}
    .tenant-gate-card{width:min(100%,480px);max-height:92vh;overflow:auto;padding:28px;border:1px solid #e7eaf2;border-radius:20px;background:#fff;color:#171b2d;box-shadow:0 30px 90px #0005;font:14px/1.5 Inter,system-ui,sans-serif}
    .tenant-gate-brand{font-size:10px;font-weight:900;letter-spacing:2px;color:#ff6b35}
    .tenant-gate-card h1{font-size:24px;margin:8px 0}.tenant-gate-card p{color:#737b91;font-size:12px}
    .tenant-gate-form{display:grid;gap:12px;margin-top:18px}
    .tenant-gate-form label{display:grid;gap:5px;color:#555e72;font-size:11px;font-weight:700}
    .tenant-gate-form input,.tenant-gate-form select{width:100%;padding:11px 12px;border:1px solid #dfe4ee;border-radius:9px;background:#fff;color:#171b2d;font:inherit}
    .tenant-gate-form button{padding:12px;border:0;border-radius:9px;background:linear-gradient(110deg,#ff6b35,#ff9b54);color:#241c25;font-weight:800;cursor:pointer}
    .tenant-gate-form button.secondary{background:#f4f5fa;color:#343b59;border:1px solid #e2e5ee}
    #tenantGateStatus{min-height:18px;margin:12px 0 0;color:#b8324b}
    .tenant-store-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .tenant-store-toolbar select{max-width:230px;padding:8px 10px;border:1px solid #e1e5ee;border-radius:9px;background:#fff;color:#343b59;font:inherit;font-size:12px}
    .tenant-store-toolbar button{padding:8px 10px;border:1px solid #e1e5ee;border-radius:9px;background:#fff;color:#343b59;font:inherit;font-size:11px;cursor:pointer}
    @media(max-width:650px){.tenant-gate-card{padding:21px}}
  `;
  document.head.appendChild(style);
  document.body.appendChild(gate);

  const formRoot = gate.querySelector("#tenantGateForm");
  const status = gate.querySelector("#tenantGateStatus");
  const title = gate.querySelector("#tenantGateTitle");
  const description = gate.querySelector("#tenantGateDescription");
  const setStatus = message => { status.textContent = message || ""; };
  const field = (label, name, type = "text", autocomplete = "off") =>
    `<label>${label}<input name="${name}" type="${type}" autocomplete="${autocomplete}" required></label>`;
  const form = (html, submitText, secondaryText = "") => {
    formRoot.innerHTML = `<form class="tenant-gate-form">${html}<button type="submit">${submitText}</button>${secondaryText ? `<button class="secondary" type="button" id="tenantGateSwitch">${secondaryText}</button>` : ""}</form>`;
    return formRoot.querySelector("form");
  };
  const jsonRequest = async (path, body, csrf = false) => {
    const headers = { "Content-Type": "application/json" };
    if (csrf) headers["X-CSRF-Token"] = cookieValue("ozon_user_csrf");
    const response = await originalFetch(path, {
      method: "POST", credentials: "same-origin", headers, body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Не удалось выполнить запрос.");
    return data;
  };

  function showLogin() {
    title.textContent = "Вход в рабочее пространство";
    description.textContent = "Используйте учётную запись Ozon AI Analytics. Если это первый запуск, создайте владельца пространства.";
    const el = form(field("Электронная почта", "email", "email", "username") +
      field("Пароль", "password", "password", "current-password"), "Войти", "Первый запуск — создать пространство");
    el.addEventListener("submit", async event => {
      event.preventDefault(); setStatus("Проверяем учётную запись…");
      const data = Object.fromEntries(new FormData(el));
      try {
        await jsonRequest("/api/auth/login", data);
        await loadStores();
      } catch (error) { setStatus(error.message); }
    });
    formRoot.querySelector("#tenantGateSwitch").addEventListener("click", showBootstrap);
  }

  function showBootstrap() {
    title.textContent = "Создание рабочего пространства";
    description.textContent = "Первый владелец создаёт аккаунт. Bootstrap-токен вводится только здесь и не передаётся в чат.";
    const el = form(field("Bootstrap-токен сервера", "bootstrap_token", "password") +
      field("Название пространства", "tenant_name") +
      field("Электронная почта", "email", "email", "username") +
      field("Пароль (не менее 12 символов)", "password", "password", "new-password"),
      "Создать владельца", "У меня уже есть аккаунт");
    el.addEventListener("submit", async event => {
      event.preventDefault(); setStatus("Создаём рабочее пространство…");
      const data = Object.fromEntries(new FormData(el));
      try {
        await jsonRequest("/api/auth/bootstrap", data);
        await loadStores();
      } catch (error) { setStatus(error.message); }
    });
    formRoot.querySelector("#tenantGateSwitch").addEventListener("click", showLogin);
  }

  function showConnectStore() {
    title.textContent = "Подключение магазина";
    description.textContent = "Временное подключение по read-only API-ключу. Ключ будет зашифрован на сервере. Позже подключим OAuth Ozon Private App.";
    const el = form(field("Название магазина", "name") +
      field("Ozon Client ID", "client_id") +
      field("Ozon API key (только чтение)", "api_key", "password"),
      "Проверить и подключить");
    el.addEventListener("submit", async event => {
      event.preventDefault(); setStatus("Проверяем read-only доступ Ozon…");
      const data = Object.fromEntries(new FormData(el));
      try {
        await jsonRequest("/api/auth/stores", data, true);
        await loadStores();
      } catch (error) { setStatus(error.message); }
    });
  }

  function addStoreToolbar(stores) {
    const header = document.querySelector(".top > div:last-child");
    if (!header) return;
    const toolbar = document.createElement("div");
    toolbar.className = "tenant-store-toolbar";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Выбранный магазин");
    stores.filter(item => item.is_active).forEach(item => {
      const option = document.createElement("option");
      option.value = item.store_id;
      option.textContent = item.name;
      select.appendChild(option);
    });
    const saved = localStorage.getItem("ozon_selected_store_id");
    const current = stores.find(item => item.store_id === saved && item.is_active) || stores.find(item => item.is_active);
    if (!current) return;
    select.value = current.store_id;
    selectedStoreId = current.store_id;
    selectedStoreName = current.name;
    localStorage.setItem("ozon_selected_store_id", selectedStoreId);
    select.addEventListener("change", () => {
      selectedStoreId = select.value;
      localStorage.setItem("ozon_selected_store_id", selectedStoreId);
      window.location.reload();
    });
    const add = document.createElement("button");
    add.type = "button"; add.textContent = "Добавить магазин";
    add.addEventListener("click", showConnectStore);
    const logout = document.createElement("button");
    logout.type = "button"; logout.textContent = "Выйти";
    logout.addEventListener("click", async () => {
      try { await jsonRequest("/api/auth/logout", {}, true); } catch (_) {}
      localStorage.removeItem("ozon_selected_store_id");
      window.location.href = "/login";
    });
    toolbar.append(select, add, logout);
    header.appendChild(toolbar);
  }

  async function loadStores() {
    setStatus("Загружаем список магазинов…");
    const response = await originalFetch("/api/auth/stores", { credentials: "same-origin" });
    if (response.status === 401) { showLogin(); return; }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setStatus(data.detail || "Не удалось получить магазины."); return; }
    const stores = Array.isArray(data.stores) ? data.stores : [];
    const active = stores.filter(item => item.is_active);
    if (!active.length) { showConnectStore(); return; }
    const saved = localStorage.getItem("ozon_selected_store_id");
    const selected = active.find(item => item.store_id === saved) || (active.length === 1 ? active[0] : null);
    if (!selected) {
      title.textContent = "Выберите магазин";
      description.textContent = "Выберите магазин, с которым будет работать аналитика.";
      const el = form(`<label>Магазин<select name="store_id">${active.map(item => `<option value="${item.store_id}">${item.name.replace(/[&<>"]/g, "")}</option>`).join("")}</select></label>`, "Продолжить");
      el.addEventListener("submit", event => {
        event.preventDefault();
        localStorage.setItem("ozon_selected_store_id", new FormData(el).get("store_id"));
        window.location.reload();
      });
      return;
    }
    selectedStoreId = selected.store_id;
    selectedStoreName = selected.name;
    localStorage.setItem("ozon_selected_store_id", selectedStoreId);
    addStoreToolbar(active);
    gate.remove();
    releaseRequests();
    window.dispatchEvent(new CustomEvent("ozon-store-ready", { detail: { storeId: selectedStoreId, storeName: selectedStoreName } }));
  }

  async function boot() {
    try {
      const response = await originalFetch("/api/auth/me", { credentials: "same-origin" });
      if (response.status === 401) { showLogin(); return; }
      if (!response.ok) throw new Error("Не удалось проверить сессию рабочего пространства.");
      await loadStores();
    } catch (error) { setStatus(error.message); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();