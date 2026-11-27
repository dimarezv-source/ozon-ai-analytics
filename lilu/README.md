# LILU Voice Avatar

A standalone Node.js web app inside the repository's `lilu/` directory.

## Features
- Responsive LILU companion interface with distinct idle, listening, thinking, speaking, happy, surprised, and empathetic/sad avatar face states.
- Animated blinking, subtle hair motion, expression-specific eye direction and mouth shapes.
- Russian speech recognition through the browser Web Speech API (Chrome/Edge recommended).
- Russian text-to-speech through browser speech synthesis.
- Server-side AI adapter for OpenAI Responses, Google Gemini Developer API, Groq Chat Completions, or OpenRouter Free Models Router.
- HMAC-signed, HttpOnly session cookie; separate login page; rate limiting and security headers.
- API keys remain server-side and are never sent to the browser.

## AI provider selection

The default remains `AI_PROVIDER=openai` to preserve the existing deployment. No provider is silently switched and no automatic fallback sends conversation data to another company.

Set one of the following in the Render service environment. See [FREE_AI_SETUP.md](./FREE_AI_SETUP.md) for the account/key steps:

| Provider | `AI_PROVIDER` | Default model | Key variable |
| --- | --- | --- | --- |
| OpenAI | `openai` | `gpt-4.1-mini` | `OPENAI_API_KEY` |
| Google Gemini | `gemini` | `gemini-3.1-flash-lite-preview` | `GEMINI_API_KEY` |
| Groq | `groq` | `openai/gpt-oss-20b` | `GROQ_API_KEY` |
| OpenRouter free router | `openrouter` | `openrouter/free` | `OPENROUTER_API_KEY` |

Optionally set `AI_MODEL` to override the default model. For OpenAI, `OPENAI_MODEL` remains supported as a legacy fallback.

**Free-tier and privacy notes:** Google documents a free Gemini API tier for selected models, but says content submitted on that tier may be used to improve Google products. Review the current terms before sending personal or confidential information. Groq documents a free-plan rate-limit table; quotas can change and the account's actual limits are authoritative. OpenRouter offers free model routing without a credit purchase for free variants; its current free-model limit is 50 requests/day and 20 requests/minute. The router selects from available upstream models, so model quality, availability, and upstream data handling may vary. Availability, account eligibility, and signup requirements are determined by each provider. No payment method or free access is guaranteed by this application. Do not add billing or a payment method unless you independently choose to do so.

## Deploy on Render

Create a Docker web service using this repository, branch `lilu/voice-avatar-v1`, Docker context `lilu`, Dockerfile path `lilu/Dockerfile`.

Keep the existing `APP_USER` and `APP_PASSWORD` settings. Set `AI_PROVIDER` and only the matching provider key when intentionally switching providers. Never paste API keys into chat, source code, or frontend files.

## Local run

```sh
cd lilu
cp .env.example .env
npm install
npm start
```

Open http://localhost:3000. Never commit `.env`.

## Voice and animation limitations

Browser voice uses speech recognition plus speech synthesis, not a full-duplex streaming voice model. Avatar face states are switched by the app and speech playback; the mouth animation is expressive approximation, not phoneme-level audio lip-sync. True real-time lip-sync and a 3D rig remain future work.

## Full-body VRM avatar (optional)

The web client now includes a progressive Three.js + `@pixiv/three-vrm` runtime. It keeps the approved PNG portrait visible as a fallback and only switches to the rigged avatar when a compatible model is present.

- Put the approved, licensed VRM 1.0 character model at `lilu/public/lilu-avatar.vrm`. A rigged GLB is also supported as a fallback at `lilu/public/lilu-avatar.glb`.
- The model should preserve LILU's approved identity (sky-blue bob, brown eyes). VRM gives the best facial-expression support; GLB needs a humanoid skeleton and useful morph targets/animation clips for comparable results.
- The runtime drives subtle idle breathing/body sway, head and arm gestures, blinking, expression changes and speech-word mouth cues. For GLB, it maps common humanoid bone names and plays an embedded idle clip when present.
- If the model is missing, WebGL is unavailable, or loading fails, the original PNG remains in use.
- No third-party avatar service or paid API key is required. The browser downloads Three.js and three-vrm ES modules from jsDelivr; deployments that block that CDN will keep the PNG fallback.

**Important:** a VRM model asset is not bundled yet. The runtime is integrated, but genuine 3D full-body animation becomes active only after a correctly rigged LILU VRM file is added. Do not substitute an unrelated stock character.
