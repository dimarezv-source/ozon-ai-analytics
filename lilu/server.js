require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
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
// Serve the authenticated avatar UI and its local assets.
app.use(express.static(path.join(__dirname, "public"), { index: false, fallthrough: true }));
app.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use("/api/", rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }));

app.get("/api/health", (_req, res) => res.json({ ok: true, apiConfigured: Boolean(API_KEY), model: MODEL }));
app.post("/api/chat", async (req, res) => {
  try {
    if (!API_KEY) return res.status(503).json({ error: "Для живого диалога добавьте OPENAI_API_KEY в переменные окружения сервера." });
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];
    if (!message || message.length > 5000) return res.status(400).json({ error: "Сообщение пустое или превышает 5000 символов." });
    const input = [];
    for (const item of history) {
      if (!item || !["user","assistant"].includes(item.role) || typeof item.content !== "string") continue;
      input.push({ role: item.role, content: item.content.slice(0,5000) });
    }
    input.push({ role:"user", content:message });
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method:"POST",
      headers:{ "Authorization":`Bearer ${API_KEY}`, "Content-Type":"application/json" },
      body:JSON.stringify({ model:MODEL, instructions:SYSTEM_PROMPT, input, store:false })
    });
    const data = await upstream.json().catch(()=>({}));
    if (!upstream.ok) return res.status(upstream.status >= 500 ? 502 : upstream.status).json({ error:data?.error?.message || `OpenAI API error ${upstream.status}` });
    const answer = (data.output || []).flatMap(x=>x.content || []).filter(x=>x.type==="output_text").map(x=>x.text).join("\n").trim();
    if (!answer) return res.status(502).json({ error:"Модель вернула пустой ответ." });
    res.json({ answer, model:MODEL });
  } catch (err) {
    console.error("lilu_chat_error", err.message);
    res.status(500).json({ error:"Внутренняя ошибка сервера." });
  }
});
app.listen(PORT,"0.0.0.0",()=>console.log("LILU listening on "+PORT));
