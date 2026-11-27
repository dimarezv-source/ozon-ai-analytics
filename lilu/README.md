# LILU Voice Avatar

A standalone Node.js web app inside the repository's `lilu/` directory.

## Features
- Distinct Lilu avatar and responsive UI.
- Russian speech recognition through browser Web Speech API (Chrome/Edge recommended).
- Russian text-to-speech through browser speech synthesis.
- Chat endpoint backed by OpenAI Responses API.
- HTTP Basic Auth, rate limiting, security headers.
- API key remains server-side; never expose it in frontend code.

## Deploy on Render
Create a Docker web service using this repository, branch `lilu/voice-avatar-v1`, Docker context `lilu`, Dockerfile path `lilu/Dockerfile`. Set `APP_USER`, `APP_PASSWORD`, and `OPENAI_API_KEY` as secret environment variables. Use HTTPS (Render subdomain).

## Local run
```sh
cd lilu
cp .env.example .env
npm install
npm start
```
Open http://localhost:3000. Never commit `.env`.

## Important
The browser voice is speech recognition plus speech synthesis, not a realtime full-duplex voice model. Lip-sync/3D animation and integrations with other project tools are future phases. Do not expose this app without a strong password and a valid API key.
