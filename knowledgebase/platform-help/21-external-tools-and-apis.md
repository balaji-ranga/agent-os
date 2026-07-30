# External tools & APIs (keys and dependencies)

**Audience:** CEOs, Platform Help, and operators configuring Flolah.  
**Scope:** Third-party services the platform calls that typically need an **API key**, **token**, or **SMTP credentials**. Internal-only secrets (`OPENCLAW_GATEWAY_TOKEN`, `TOOLS_API_KEY`, `AGENT_OS_INTERNAL_TOKEN`) are omitted — those are not vendor APIs.

Related: [15-api-keys-vault.md](./15-api-keys-vault.md) (how CEOs store secrets), [08-mcp-integrations.md](./08-mcp-integrations.md) (Brave MCP BYOK), [20-ibkr-monthly-trading.md](./20-ibkr-monthly-trading.md) (FMP + IBKR).

## How keys are supplied

| Layer | Who sets it | Typical use |
|-------|-------------|-------------|
| **Platform `.env`** (`deploy/.env`) | Ops / Admin | Default agent chat LLM, SMTP, FMP, Replicate, optional Anthropic |
| **API Keys vault** (`Platform_BYOK` and named keys) | CEO | BYOK chat (OpenAI / OpenRouter), workflow Brain / MCP / Connector secrets |
| **Workflow node / MCP headers** | CEO / Workflow Builder | Per-run or vault-ref keys (DeepSeek Brain, Brave `X-Subscription-Token`, etc.) |
| **Connectors (OpenConnector)** | CEO | OAuth or API key per SaaS app |

---

## Master table — external dependencies that need a key

| Service / provider | What Flolah uses it for | Key / credential | Where configured | Required? | Notes |
|--------------------|-------------------------|------------------|------------------|-----------|-------|
| **DeepSeek** | Platform default OpenAI-compatible LLM (agent chat, COO, many tools); optional Brain `modelSource=deepseek` | `OPENAI_API_KEY` (+ `OPENAI_BASE_URL=https://api.deepseek.com/v1`) or Brain `apiKey` | Platform `.env` **or** Brain / vault | **Yes** for cloud primary (unless you switch primary elsewhere) | Production default model is often `deepseek-v4-flash`. Brain does **not** read platform `.env` — put the key on the node or vault. |
| **OpenAI** | Secondary / BYOK chat; image content tool (`TOOLS_IMAGE_*`); optional OpenSearch embeddings | `OPENAI_SECONDARY_API_KEY` or vault **`Platform_BYOK`**; embeddings reuse OpenAI-compatible key when enabled | Platform `.env` and/or **API Keys** | Optional | Profile → OpenAI preference needs `Platform_BYOK`. Image gen needs a key that can call GPT-image (or compatible host). |
| **Anthropic (Claude)** | OpenClaw gateway models (`anthropic/…`, e.g. Claude Opus) | `ANTHROPIC_API_KEY` | Platform `.env` | Optional | Only needed if OpenClaw model slug is Anthropic. |
| **OpenRouter** | BYOK agent chat; Brain `modelSource=openrouter` | Vault **`Platform_BYOK`** or `OPENROUTER_API_KEY` / Brain `apiKey` | **API Keys** (preferred) or `.env` / node | Optional | Profile → OpenRouter + `Platform_BYOK`. Optional `OPENROUTER_HTTP_REFERER` / `OPENROUTER_SITE_TITLE`. |
| **Ollama (local)** | Free / local BYOK chat; Brain `ollama`; optional OpenClaw fallback | Usually no real key (`ollama` / `OLLAMA_API_KEY` placeholder) | Local Ollama service + Profile / Brain | Optional | Not a paid vendor API; needs the Ollama process and pulled models. |
| **Brevo (SMTP)** | MFA email OTP, workflow **Send Email**, `email_send` tool (ICS invites), COO status HTML email | `WORKFLOW_SMTP_HOST` / `USER` / `PASS` / `FROM` (Brevo: `smtp-relay.brevo.com`) | Platform `.env` (or per-node SMTP) | **Yes** for outbound email / email MFA | Sender domain must be verified in Brevo. In-app `notify_ceo` does **not** need SMTP. |
| **Brave Search** | Web search via Brave Search MCP (`brave_web_search`, etc.) | Brave subscription token | Workflow / MCP **headers** (BYOK) or vault key referenced on the node | Optional | Platform `BRAVE_API_KEY` is **not** injected into the MCP container — pass `X-Subscription-Token` or Bearer from the workflow. |
| **Financial Modeling Prep (FMP)** | Market regime, screener, history, fundamentals (IBKR monthly trading tools) | `MARKET_DATA_API_KEY` | Platform `.env` | Optional (required for live market tools) | Default base `https://financialmodelingprep.com/stable`. Free tier has daily call limits; paid recommended for daily screens. |
| **Replicate** | Video content tool | `REPLICATE_API_TOKEN` | Platform `.env` | Optional | Used when agents/workflows call video generation. |
| **ElevenLabs** | Workflow **ElevenLabs** node (TTS / STT) and avatar Virtual Room | `ELEVENLABS_API_KEY` or vault name **`elevenlabs-key`** (avatar templates) or **`ElevenLabs`** | Platform `.env` and/or **API Keys** | Optional (required for avatar voice) | Media artifacts are stored per CEO under `media/{ceo}/`. |
| **Hunyuan3D** | Text/image → GLB on **Avatars** page | No vendor key for self-host; needs GPU container | `HUNYUAN3D_URL` + profile `optional-hunyuan3d` | Optional | See [23-avatars-virtual-room.md](./23-avatars-virtual-room.md). |
| **Interactive Brokers (IBKR)** | Account snapshot, paper/live orders via local Gateway + optional desktop bridge | IBKR account + Gateway session; bridge `LOCAL_BRIDGE_TOKEN` | Laptop Gateway + local bridge env (not cloud API key) | Optional (trading features) | Not a SaaS API key in `.env` for market data — FMP covers that. See IBKR help. |
| **OpenConnector SaaS apps** | Workflow **Connector** node (Gmail, Slack, HubSpot, etc.) | OAuth token or vendor API key per app | **Connectors** UI + optional **API Keys** vault | Per app | Catalog varies; each connected app is its own external dependency. |
| **OpenSearch (self-hosted)** | Document / Platform Help RAG indices | `OPENSEARCH_USERNAME` / `OPENSEARCH_PASSWORD` | Platform `.env` | If OpenSearch enabled | Infra credential, not a public SaaS product key. Vector embeddings (when `OPENSEARCH_EMBEDDINGS_ENABLED=1`) typically need an **OpenAI-compatible embedding** key as well. |

---

## By product area

### Agent chat & OpenClaw

| Need | Provider(s) | Key path |
|------|-------------|----------|
| Default platform LLM | DeepSeek (or whatever `OPENAI_BASE_URL` points at) | `OPENAI_API_KEY` |
| Admin secondary LLM | OpenAI / DeepSeek / other OpenAI-compatible | `OPENAI_SECONDARY_*` |
| CEO BYOK chat | OpenAI or OpenRouter | Vault name exactly **`Platform_BYOK`** + Profile provider |
| Claude models | Anthropic | `ANTHROPIC_API_KEY` |
| Local free | Ollama | No paid key; service must be up |

### Content tools

| Tool capability | External API | Key |
|-----------------|--------------|-----|
| `summarize_url` / LLM summaries | Same as platform / secondary LLM | `OPENAI_*` / DeepSeek |
| Image generation | OpenAI-compatible image API | Same primary LLM key + `TOOLS_IMAGE_MODEL` |
| Video generation | Replicate | `REPLICATE_API_TOKEN` |
| `email_send` | SMTP (Brevo) | `WORKFLOW_SMTP_*` |
| `forex_rates` | Frankfurter (ECB) | **None** — public HTTP API |
| Market / IBKR tools | FMP + IBKR Gateway | `MARKET_DATA_API_KEY` + local IBKR |

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
5. Optional: **`ANTHROPIC_API_KEY`** if Claude is the OpenClaw model  
6. Optional secondary: **`OPENAI_SECONDARY_*`** for Admin failover  

CEOs still add **`Platform_BYOK`** (and Brave / Brain keys) themselves under **Management → API Keys** when they bring their own keys.

## Tips for Platform Help answers

- “Where do I put my OpenAI key?” → **API Keys** vault as **`Platform_BYOK`**, then Profile provider = OpenAI.  
- “Why doesn’t Brave search work?” → Pass Brave token on the workflow/MCP node; platform `BRAVE_API_KEY` alone does not feed the MCP container.  
- “Emails / MFA OTP fail?” → Check Brevo SMTP `WORKFLOW_SMTP_*` and verified sender.  
- “Market screener empty / 402?” → FMP plan limits; see FMP free vs paid notes in IBKR maker tools docs.  
- “Brain DeepSeek 401?” → Key must be on the Brain node or vault ref — not only in platform `.env`.
