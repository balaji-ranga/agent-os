# External tools & APIs (keys and dependencies)

**Audience:** CEOs, Platform Help, and operators configuring Flolah.  
**Scope:** Third-party services the platform calls that typically need an **API key**, **token**, or **SMTP credentials**. Internal-only secrets (`AgentSystem_GATEWAY_TOKEN`, `TOOLS_API_KEY`, `AGENT_OS_INTERNAL_TOKEN`) are omitted — those are not vendor APIs.

Related: [15-api-keys-vault.md](./15-api-keys-vault.md) (how CEOs store secrets), [08-mcp-integrations.md](./08-mcp-integrations.md) (Brave MCP BYOK), [20-ibkr-monthly-trading.md](./20-ibkr-monthly-trading.md) (FMP + IBKR).

## How keys are supplied

| Layer | Who sets it | Typical use |
|-------|-------------|-------------|
| **Platform `.env`** (`deploy/.env`) | Ops / Admin | Default agent chat LLM, SMTP, FMP, Replicate, optional Anthropic |
| **API Keys vault** (`Platform_BYOK`, `Replicate_BYOK`, `BRAVE_SEARCH_BYOK`, `elevenlabs-key`, …) | CEO | BYOK chat, video/Brave when Profile ≠ platform default, ElevenLabs TTS, workflow Brain / MCP / Connector secrets. Non-platform Profiles auto-seed those named slots as unset. |
| **Workflow node / MCP headers** | CEO / Workflow Builder | Per-run or vault-ref keys (DeepSeek Brain, Brave `X-Subscription-Token`, etc.) |
| **Connectors (OpenConnector)** | CEO | OAuth or API key per SaaS app |

---

## Master table — external dependencies that need a key

| Service / provider | What Flolah uses it for | Key / credential | Where configured | Required? | Notes |
|--------------------|-------------------------|------------------|------------------|-----------|-------|
| **DeepSeek** | Platform default OpenAI-compatible LLM (agent chat, COO, many tools); optional Brain `modelSource=deepseek` | `OPENAI_API_KEY` (+ `OPENAI_BASE_URL=https://api.deepseek.com/v1`) or Brain `apiKey` | Platform `.env` **or** Brain / vault | **Yes** for cloud primary (unless you switch primary elsewhere) | Production default model is often `deepseek-v4-flash`. Brain does **not** read platform `.env` — put the key on the node or vault. |
| **OpenAI** | Secondary / BYOK chat; image content tool (`TOOLS_IMAGE_*`); **analyze_image** vision (platform primary or BYOK `Platform_BYOK`) | `OPENAI_SECONDARY_API_KEY` or vault **`Platform_BYOK`** | Platform `.env` and/or **API Keys** | Optional | Profile → OpenAI preference needs `Platform_BYOK`. Image gen needs a key that can call GPT-image (or compatible host). Vision uses platform **primary** for Platform default Profiles (fails if primary is text-only); BYOK Profiles use vault only. Master Data **embeddings use local Qwen**, not this key. |
| **Anthropic (Claude)** | AgentSystem gateway models (`anthropic/…`, e.g. Claude Opus) | `ANTHROPIC_API_KEY` | Platform `.env` | Optional | Only needed if AgentSystem model slug is Anthropic. |
| **OpenRouter** | BYOK agent chat; Brain `modelSource=openrouter` | Vault **`Platform_BYOK`** or `OPENROUTER_API_KEY` / Brain `apiKey` | **API Keys** (preferred) or `.env` / node | Optional | Profile → OpenRouter + `Platform_BYOK`. Optional `OPENROUTER_HTTP_REFERER` / `OPENROUTER_SITE_TITLE`. |
| **Ollama (local)** | Free / local BYOK chat; Brain `ollama`; optional AgentSystem fallback | Usually no real key (`ollama` / `OLLAMA_API_KEY` placeholder) | Local Ollama service + Profile / Brain | Optional | Not a paid vendor API; needs the Ollama process and pulled models. |
| **Brevo (SMTP)** | MFA email OTP, workflow **Send Email**, `email_send` tool (ICS invites), COO status HTML email | `WORKFLOW_SMTP_HOST` / `USER` / `PASS` / `FROM` (Brevo: `smtp-relay.brevo.com`) | Platform `.env` (or per-node SMTP) | **Yes** for outbound email / email MFA | Sender domain must be verified in Brevo. In-app `notify_ceo` does **not** need SMTP. |
| **Brave Search** | Agent content tool `brave_web_search`; also workflow Brave MCP | Platform: `BRAVE_API_KEY`; non-platform Profile: vault **`BRAVE_SEARCH_BYOK`** | Platform `.env` **or** **API Keys** | Optional | Platform default Profile → ops key. Any other Profile → CEO `BRAVE_SEARCH_BYOK` only (no platform fall-back). Workflow MCP remains header/vault BYOK on the node. |
| **Google Places API (New)** | `google_places_geocode` / `google_places_nearby` / `business_discover` | Platform: `GOOGLE_PLACES_API_KEY`; non-platform Profile: vault **`GOOGLE_PLACES_BYOK`** | Platform `.env` **or** **API Keys** | Optional | Enable Places API (New). See [42-social-research-business-discovery.md](./42-social-research-business-discovery.md). |
| **Instagram (Instaloader)** | `social_research_instagram` captions/timestamps | Vault **`INSTAGRAM_SESSIONID`** (cookie); optional platform `INSTAGRAM_SESSIONID` | **API Keys** (preferred) | Optional | Anonymous Instaloader is 429-blocked from VPS IPs. Without the cookie, post **images** still hydrate from `/p/{shortcode}/media`. |
| **X API v2** | `social_research_x` official timeline | Platform: `X_BEARER_TOKEN`; non-platform Profile: vault **`X_API_BYOK`** | Platform `.env` **or** **API Keys** | Optional | Tweet hydration from status URLs works without this key. Free tiers often cannot read other users’ tweets. |
| **Financial Modeling Prep (FMP)** | Market regime, screener, history, fundamentals (IBKR monthly trading tools) | `MARKET_DATA_API_KEY` | Platform `.env` | Optional (required for live market tools) | Default base `https://financialmodelingprep.com/stable`. Free tier has daily call limits; paid recommended for daily screens. |
| **Replicate** | Video content tool (`generate_video`) | Platform: `REPLICATE_API_TOKEN`; non-platform Profile: vault **`Replicate_BYOK`** | Platform `.env` **or** **API Keys** | Optional | Platform default Profile → ops token. Any other Profile → CEO `Replicate_BYOK` only (no platform fall-back). |
| **Whisper + Piper** | Free STT/TTS (`speech_stt` / `speech_tts` tools, chat mic, workflow nodes) | None (self-host) | `SPEECH_STT_URL` / `SPEECH_TTS_URL` + Compose profile `optional-voice` | Optional (required for free speech tools) | See [25-speech-and-published-scenes.md](./25-speech-and-published-scenes.md). |
| **Hunyuan3D** | Text/image → GLB on **Avatars** page | No vendor key for self-host; needs GPU container | `HUNYUAN3D_URL` + profile `optional-hunyuan3d` | Optional | See [23-avatars-virtual-room.md](./23-avatars-virtual-room.md). |
| **Interactive Brokers (IBKR)** | Account snapshot, paper/live orders via local Gateway + optional desktop bridge | IBKR account + Gateway session; bridge `LOCAL_BRIDGE_TOKEN` | Laptop Gateway + local bridge env (not cloud API key) | Optional (trading features) | Not a SaaS API key in `.env` for market data — FMP covers that. See IBKR help. |
| **OpenConnector SaaS apps** | Workflow **Connector** node (Gmail, Slack, HubSpot, etc.) | OAuth token or vendor API key per app | **Connectors** UI + optional **API Keys** vault | Per app | Catalog varies; each connected app is its own external dependency. |
| **OpenSearch (self-hosted)** | Document / Platform Help RAG indices | `OPENSEARCH_USERNAME` / `OPENSEARCH_PASSWORD` | Platform `.env` | If OpenSearch enabled | Infra credential, not a public SaaS product key. Vector embeddings use **local Qwen** (`ensure-embeddings-env.sh` → `embeddings` container); **not** OpenAI. |

---

## By product area

### Agent chat & AgentSystem

| Need | Provider(s) | Key path |
|------|-------------|----------|
| Default platform LLM | DeepSeek (or whatever `OPENAI_BASE_URL` points at) | `OPENAI_API_KEY` |
| Admin secondary LLM | OpenAI / DeepSeek / other OpenAI-compatible | `OPENAI_SECONDARY_*` |
| CEO BYOK chat | OpenAI or OpenRouter | Vault name exactly **`Platform_BYOK`** (auto-seeded unset on non-platform Profiles) + Profile **provider + chat model** (`GET /api/auth/llm-catalog`) |
| Claude models | Anthropic | `ANTHROPIC_API_KEY` |
| Local free | Ollama | No paid key; service must be up |

### Content tools

| Tool capability | External API | Key |
|-----------------|--------------|-----|
| `summarize_url` / LLM summaries | Same as platform / secondary LLM | `OPENAI_*` / DeepSeek |
| Image generation | OpenAI-compatible image API | Same primary LLM key + `TOOLS_IMAGE_MODEL` |
| `analyze_image` (vision / OCR) | Multimodal chat on the CEO's LLM path | Platform default → **effective** platform primary (same Admin primary/secondary switch as chat). BYOK Profile → vault **`Platform_BYOK`** + Profile primary. Optional ops override: `TOOLS_VISION_*` |
| Video generation | Replicate | Platform default Profile → `REPLICATE_API_TOKEN`; else vault **`Replicate_BYOK`** |
| `brave_web_search` | Brave Search | Platform default Profile → `BRAVE_API_KEY`; else vault **`BRAVE_SEARCH_BYOK`** |
| `speech_tts` / `speech_stt` | Self-host Piper + Whisper | None — `SPEECH_*_URL` + `optional-voice` |
| `email_send` | SMTP (Brevo) | `WORKFLOW_SMTP_*` |
| `forex_rates` | Frankfurter (ECB) | **None** — public HTTP API |
| Market / IBKR tools | FMP + IBKR Gateway | `MARKET_DATA_API_KEY` + local IBKR |

**Delivery (image / video / TTS):** tools return `MEDIA:/abs/path` for WhatsApp disk attach and auth-only `/api/media/…` for Dashboard inline players. Not world-public unless ops sets `MEDIA_PUBLIC_SIGNED=1`. See [11](./11-content-tools-scripts-profile.md), [24](./24-agent-channels.md).
### Workflows

| Node / feature | External dependency | Key |
|----------------|---------------------|-----|
| Brain (`openai` / `anthropic` / `openrouter` / `deepseek`) | Matching LLM vendor | Node `apiKey` or vault ref (not platform `.env` for Brain) |
| Brain (`ollama`) | Local Ollama | Usually none |
| Send Email | SMTP (Brevo) | `useEnvSmtp` → `WORKFLOW_SMTP_*` or node SMTP fields |
| MCP Brave Search | Brave | Header / vault token (BYOK) |
| Connector | Connected SaaS | OAuth or API key in Connectors / vault |
| ElevenLabs | ElevenLabs API | Vault **elevenlabs-key** / **ElevenLabs** or `ELEVENLABS_API_KEY` |
| 3D Model / Avatars | CEO model files + optional Hunyuan | Upload on Avatars; `HUNYUAN3D_URL` for generate |

---

## Free / no-key external APIs (for clarity)

| Service | Used for | API key? |
|---------|----------|----------|
| **Frankfurter** (`api.frankfurter.app`) | `forex_rates` content tool | No |
| **Ollama** (self-hosted) | Local models | No paid vendor key |

---

## Operator checklist (platform `.env`)

Minimum for a typical Flolah VPS:

1. **`OPENAI_API_KEY`** + DeepSeek (or other) **`OPENAI_BASE_URL` / model** — agent chat and most LLM tools  
2. **`WORKFLOW_SMTP_*`** (Brevo) — MFA email + outbound mail  
3. Optional: **`MARKET_DATA_API_KEY`** (FMP) if monthly trading / market tools are used  
4. Optional: **`REPLICATE_API_TOKEN`** if video tools are granted  
5. Optional: **`ANTHROPIC_API_KEY`** if Claude is the AgentSystem model  
6. Optional secondary: **`OPENAI_SECONDARY_*`** for Admin failover  

CEOs still add **`Platform_BYOK`** (chat), **`Replicate_BYOK`** (video when Profile ≠ platform default), and Brave / Brain keys under **Settings → API Keys** when they bring their own keys.

## Tips for Platform Help answers

- “Where do I put my OpenAI key?” → **API Keys** vault as **`Platform_BYOK`**, then Profile provider = OpenAI.  
- “Why doesn’t Brave search work?” → Agent tool: Platform default needs ops `BRAVE_API_KEY`; other Profiles need vault **`BRAVE_SEARCH_BYOK`**. Workflow MCP still needs the token on the node headers (container does not use env).  
- “Emails / MFA OTP fail?” → Check Brevo SMTP `WORKFLOW_SMTP_*` and verified sender.  
- “Market screener empty / 402?” → FMP plan limits; see FMP free vs paid notes in IBKR maker tools docs.  
- “Brain DeepSeek 401?” → Key must be on the Brain node or vault ref — not only in platform `.env`.
