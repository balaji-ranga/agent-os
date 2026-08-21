---
title: API keys
---

# API keys

Path: **Settings → API Keys**.

This is your **named secret vault**. Keys are shown once at save time; the list only shows the name and a hint. Never paste production secrets into chat. Workflow Builder binds these **names** into graphs (it will list which names to fill after a build). Brain steps that use free Ollama need no key. Medium drafts bind **`MEDIUM_INTEGRATION_TOKEN`**. Hacker News uses Connectors.

**Platform default** on Profile uses the platform language model — you do **not** need `Platform_BYOK`. Fill other rows only for features you use. **Tools → Rate limits** caps daily/monthly **calls** (not dollars).

## Language models (one vault key)

Chat, vision, image generation, and **live Call / Realtime Caller** share **`Platform_BYOK`** when you bring your own key. Profile chooses the provider; the secret stays in this vault.

| Tools / scope | BYOK key | Possible keys (who issues the secret) |
|---------------|----------|----------------------------------------|
| **Chat completions** — employee chat, COO, summaries, RAG answers, intent, workflow certify, job-fit / resume tools, autonomous browser decisions | **`Platform_BYOK`** | **OpenAI** · **OpenRouter** (OpenAI, **Claude**, Gemini, DeepSeek models on one OpenRouter key) · or **no key**: Platform default, or local Ollama |
| **Vision** — `analyze_image` (describe / OCR) | **`Platform_BYOK`** (same) | **OpenAI** or **OpenRouter** with a **vision** model. Text-only local/DeepSeek chat often cannot see images |
| **Image generation** — `generate_image` | **`Platform_BYOK`** (OpenAI-compatible image API) | **OpenAI** (GPT-image). OpenRouter / Claude / Ollama typically **do not** generate images here |
| **Realtime Caller + live Call** (WebRTC barge-in, including COO **Call**) | **`Platform_BYOK`** must be an **OpenAI** key on `api.openai.com` | **OpenAI only**. OpenRouter, Claude, DeepSeek, and Ollama **cannot** mint a live session |

**Claude:** pick **OpenRouter** on Profile and a Claude model in the list, then paste your **OpenRouter** key as `Platform_BYOK`. Direct Anthropic is not a Profile choice today.

Optional: **Tools → Model** overrides the **model** for one tool; it does not change which vault key is used.

## Other vendor keys (separate names)

| Tools / scope | BYOK key | Possible keys |
|---------------|----------|----------------|
| `brave_web_search` / social search | **`BRAVE_SEARCH_BYOK`** | **Brave Search** token (or platform Brave if Profile is platform default) |
| `google_places_*` / `business_discover` | **`GOOGLE_PLACES_BYOK`** | **Google** Places API (New) key |
| `generate_video` | **`Replicate_BYOK`** | **Replicate** token (or platform Replicate if Profile is platform default) |
| Avatar / workflow ElevenLabs TTS | **`elevenlabs-key`** | **ElevenLabs**. Home **Speak** / Slow Caller can use **free** self-hosted Piper instead (no key) |
| `social_research_instagram` captions | **`INSTAGRAM_SESSIONID`** | Instagram **sessionid** cookie (not a Meta app key) |
| `social_research_x` official timeline | **`X_API_BYOK`** | **X** (Twitter) API v2 bearer |
| `email_send` / MFA email | *(platform SMTP)* | **Brevo** (or other SMTP) — set by ops, not this vault |
| Market / IBKR screens | *(platform)* | **Financial Modeling Prep** on the server if those tools are on |
| CRM / ERP tools | *(Business Core)* | No extra OpenAI-style key; enable CRM/ERP in Profile |
| Chat mic / Slow Caller STT-TTS | *(none)* | Self-hosted Whisper + Piper |
| Knowledge **embeddings** | *(none)* | Local embedding service, not OpenAI |

Workflow **Brain** can also use a vault **name** you create (`openai-prod`, …) instead of `Platform_BYOK`. **Connectors** store OAuth/API keys on the connection, not in this list.

## Rough cost for an SME (your vendor bills)

These are **order-of-magnitude USD per month** if **you** pay BYOK (list prices change). They are **not** a Flolah invoice. A small company: one CEO, about **8–15 AI employees**, daily COO chat, some research, light media.

| How you run | What you typically fill | Ballpark extra API spend / month |
|-------------|-------------------------|----------------------------------|
| **Lean** | Platform default chat; optional Places or Brave | **$0–40** (maps/search if you use them) |
| **Core SME** | `Platform_BYOK` (GPT-4o mini **or** OpenRouter mini / DeepSeek) + Places + Brave | **$40–150** |
| **+ live voice** | Same OpenAI key; 5–15 hours of Realtime Call | **+$80–400** (audio is the expensive part) |
| **+ light content** | Image gen weekly; a few Replicate clips | **+$30–150** |
| **Heavier / Claude-class chat** | OpenRouter Claude or GPT-4o for most turns | **$200–600+** |
| **Full stack** | Core + voice + images + some video + market data | **$250–700** |

**What moves the bill:** live Call minutes, image/video count, “smart” models (Claude / GPT-4o) on every chat, and Places/Brave volume — not the number of hired employees by itself. Live Call on OpenAI’s mini realtime class is often on the order of **$0.15–$0.40 per minute** of audio (full realtime is several times that). Keep **Action control** on approval for send; cap calls on **Tools → Rate limits**. Prefer **explained shortfall** over inventing contacts (that also wastes spend).

## Add a key

1. Open **API Keys**.
2. Choose a stable **name** (letters, digits, `.` `_` `-`).
3. Paste the secret.
4. Optional extra encryption phrase if the product offers it.
5. **Add**.

To rotate: edit the row and paste a new secret; leave the secret blank to keep the existing one.

When Profile is **not** platform default, Flolah may seed **empty** slots so you know which names to fill. Empty slots are not active keys.

## Connectors vs this vault

**Connectors** can store an OAuth connection or an API key **on that connection**. That is separate from this vault. Optional “use my own app id/secret” for a connector is also separate.

If you delete a vault key that workflows still reference, Flolah lists those dependencies and asks you to confirm.

Related: [Profile and model](./profile-and-model.md), [Connectors and MCP](../systems/connectors-and-mcp.md), [Tools rate limits](../operate/budgets.md).
