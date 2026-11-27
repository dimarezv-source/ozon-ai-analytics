require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.set("trust proxy", 1);
const PORT = Number(process.env.PORT || 3000);
const AI_PROVIDER = (process.env.AI_PROVIDER || "openai").trim().toLowerCase();
const MODEL_DEFAULTS = {
  openai: "gpt-4.1-mini",
  gemini: "gemini-3.1-flash-lite-preview",
  groq: "openai/gpt-oss-20b"
};
const MODEL = process.env.AI_MODEL || process.env.OPENAI_MODEL || MODEL_DEFAULTS[AI_PROVIDER] || "gpt-4.1-mini";
const API_KEYS = {
  openai: process.env.OPENAI_API_KEY || "",
  gemini: process.env.GEMINI_API_KEY || "",
  groq: process.env.GROQ_API_KEY || ""
};
const API_KEY = API_KEYS[AI_PROVIDER] || "";
const APP_USER = process.env.APP_USER || "lilu";
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const SYSTEM_PROMPT = "Ты Лилу — дружелюбный русскоязычный AI-компаньон. Отвечай естественно, тепло и по делу. Помогай с проектами, идеями и повседневными задачами. Не утверждай, что выполнила действия, если инструменты их не выполняли.";

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: "32kb" }));

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function makeSession(expires) {
  const signature = crypto.createHmac("sha256", APP_PASSWORD).update(`${APP_USER}:${expires}`).digest("base64url");
  return `${expires}.${signature}`;
}
function hasValidSession(req) {
  if (!APP_PASSWORD) return false;
  const cookies = (req.headers.cookie || "").split(";").map(x => x.trim());
  const item = cookies.find(x => x.startsWith("lilu_session="));
  if (!item) return false;
  let value = "";
  try { value = decodeURIComponent(item.slice("lilu_session=".length)); } catch { return false; }
  const dot = value.indexOf(".");
  if (dot < 1) return false;
  const expires = Number(value.slice(0, dot));
  if (!Number.isSafeInteger(expires) || expires <= Date.now()) return false;
  return safeEqual(value, makeSession(expires));
}
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
app.get("/login", (req, res) => {
  res.set("Cache-Control", "no-store");
  if (hasValidSession(req)) return res.redirect("/");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});
app.post("/api/logout", (req, res) => {
  res.set("Set-Cookie", "lilu_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict");
  res.set("Cache-Control", "no-store");
  res.json({ ok: true });
});
app.get("/api/health", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }), (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, provider: AI_PROVIDER, apiConfigured: Boolean(API_KEY), model: MODEL });
});
app.post("/api/login", loginLimiter, (req, res) => {
  if (!APP_PASSWORD) return res.status(503).json({ error: "Авторизация не настроена на сервере." });
  const username = typeof req.body?.username === "string" ? req.body.username : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!safeEqual(username, APP_USER) || !safeEqual(password, APP_PASSWORD)) {
    return res.status(401).json({ error: "Неверный логин или пароль." });
  }
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const token = encodeURIComponent(makeSession(expires));
  res.set("Set-Cookie", `lilu_session=${token}; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Strict`);
  res.set("Cache-Control", "no-store");
  res.json({ ok: true });
});
app.use((req, res, next) => {
  if (!APP_PASSWORD) return res.status(503).send("LILU setup incomplete: APP_PASSWORD is not configured.");
  if (hasValidSession(req)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Требуется вход в LILU." });
  return res.redirect(302, "/login");
});
app.use(express.static(path.join(__dirname, "public"), { index: false, fallthrough: true }));
app.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.use("/api/", rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }));

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-10).filter(item =>
    item && ["user", "assistant"].includes(item.role) && typeof item.content === "string"
  ).map(item => ({ role: item.role, content: item.content.slice(0, 5000) }));
}
async function readUpstream(upstream) {
  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const message = data?.error?.message || data?.message || `AI provider error ${upstream.status}`;
    const error = new Error(message);
    error.status = upstream.status;
    throw error;
  }
  return data;
}
async function askOpenAI(input) {
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, instructions: SYSTEM_PROMPT, input, store: false }),
    signal: AbortSignal.timeout(45000)
  });
  const data = await readUpstream(upstream);
  return (data.output || []).flatMap(x => x.content || []).filter(x => x.type === "output_text").map(x => x.text).join("\n").trim();
}
async function askGemini(history, message) {
  const contents = [...history, { role: "user", content: message }].map(item => ({
    role: item.role === "assistant" ? "model" : "user",
    parts: [{ text: item.content }]
  }));
  const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: { temperature: 0.8, maxOutputTokens: 900 }
    }),
    signal: AbortSignal.timeout(45000)
  });
  const data = await readUpstream(upstream);
  return (data.candidates?.[0]?.content?.parts || []).filter(part => typeof part.text === "string").map(part => part.text).join("\n").trim();
}
async function askGroq(history, message) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map(item => ({ role: item.role, content: item.content })),
    { role: "user", content: message }
  ];
  const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.8, max_tokens: 900 }),
    signal: AbortSignal.timeout(45000)
  });
  const data = await readUpstream(upstream);
  return data.choices?.[0]?.message?.content?.trim() || "";
}
app.post("/api/chat", async (req, res) => {
  try {
    if (!["openai", "gemini", "groq"].includes(AI_PROVIDER)) {
      return res.status(503).json({ error: "Неизвестный AI_PROVIDER. Доступны openai, gemini и groq." });
    }
    if (!API_KEY) {
      const envName = { openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY" }[AI_PROVIDER];
      return res.status(503).json({ error: `Для провайдера ${AI_PROVIDER} добавьте ${envName} в переменные окружения сервера.` });
    }
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const history = cleanHistory(req.body?.history);
    if (!message || message.length > 5000) return res.status(400).json({ error: "Сообщение пустое или превышает 5000 символов." });
    const answer = AI_PROVIDER === "openai"
      ? await askOpenAI([...history, { role: "user", content: message }])
      : AI_PROVIDER === "gemini"
        ? await askGemini(history, message)
        : await askGroq(history, message);
    if (!answer) return res.status(502).json({ error: "Модель вернула пустой ответ." });
    res.json({ answer, provider: AI_PROVIDER, model: MODEL });
  } catch (err) {
    const status = Number.isInteger(err.status) ? err.status : 500;
    console.error("lilu_chat_error", AI_PROVIDER, status, err.message);
    res.status(status >= 500 ? 502 : status).json({
      error: status === 429 ? "Достигнут бесплатный лимит запросов AI-провайдера. Попробуй позже." :
        status === 401 || status === 403 ? "AI-провайдер отклонил ключ или доступ к модели. Проверь настройки провайдера." :
        status === 502 ? "AI-провайдер временно недоступен. Попробуй ещё раз." :
        err.name === "TimeoutError" ? "AI-провайдер отвечает слишком долго. Попробуй ещё раз." :
        "Не удалось получить ответ от AI-провайдера."
    });
  }
});
app.listen(PORT, "0.0.0.0", () => console.log(`LILU listening on ${PORT}; provider=${AI_PROVIDER}; model=${MODEL}`));
