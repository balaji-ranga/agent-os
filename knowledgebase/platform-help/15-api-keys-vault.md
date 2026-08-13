# API Keys vault (Settings → API Keys)

## What it is

Path: **Settings → API Keys** (`/api-keys`).

A per-CEO **named secret vault** for:

- Workflow **Brain / API / MCP / External agent** auth
- Prefer for static keys you also use outside Connectors (agents/workflows by **key name**)
- **BYOK** (bring your own key) for OpenAI / OpenRouter agent chat

**Note:** Connectors → OpenConnector **Save API key** stores the key on the **OpenConnector connection**, not in this vault. Optional CEO **App ID/secret override** for OAuth apps is also separate (help **16**). Secrets are **never** shown again after save (list shows name + hint only). Platform access logs redact API Keys routes and never print Authorization headers or key bodies.

## Add a key

1. Open **API Keys**.
2. **Key name** — stable id (letters, digits, `.` `_` `-`), e.g. `openai-prod`, `brave-search`.
3. **API key** — the secret (`sk-…`, provider token, …).
4. **Encryption phrase** (optional) — extra passphrase so the secret is encrypted at rest (requires platform `USER_API_KEYS_KEK` to be configured by ops).
5. Click **Add**.

### Edit

- Change **name** anytime.
- Leave **API key** blank to keep the existing secret; fill only when rotating.
- Set a new encryption phrase only when you want to re-encrypt.

### Delete

1. Delete the key.
2. If workflows / MCP / Connectors / External agents still **reference** it, Flolah shows dependencies and asks you to **confirm force delete**.

## Auto-seeded slots (non-platform Profile)

When Profile LLM is **not** Platform default (Ollama free, DeepSeek, OpenAI, OpenRouter, …), Agent OS seeds empty vault slots so CEOs know which keys to fill:

| Key name | Used for |
|----------|----------|
| **`Platform_BYOK`** | OpenAI / OpenRouter agent chat |
| **`Replicate_BYOK`** | `generate_video` |
| **`BRAVE_SEARCH_BYOK`** | `brave_web_search` / social research search |
| **`GOOGLE_PLACES_BYOK`** | `google_places_nearby` / `business_discover` |
| **`X_API_BYOK`** | `social_research_x` official X API v2 timeline |
| **`INSTAGRAM_SESSIONID`** | `social_research_instagram` Instaloader session cookie |
| **`elevenlabs-key`** | Avatar / workflow ElevenLabs TTS templates |

Slots appear with hint **`unset`** until you **Edit** and paste a real secret. Resolvers treat unset as missing (no platform fall-back for Brave/Replicate on BYOK Profiles). Seeding runs on CEO register (non-platform provider), Profile provider change, and when opening **API Keys**.

**Platform default** Profile does not seed these — ops `.env` covers Brave / Replicate for that mode.

## Platform_BYOK (required for OpenAI / OpenRouter)

For agent chat with **your** OpenAI or OpenRouter key:

1. Open **API Keys** — on a non-platform Profile the **`Platform_BYOK`** row is usually already seeded as **unset**.
2. **Edit** it (or **Add** if missing) and paste your provider API key.
3. Open **Profile** → choose OpenAI or OpenRouter **and** a **chat model** (curated list or custom id).

AgentSystem then uses vault **`Platform_BYOK`** against the provider endpoint from the internal catalog (OpenAI → `api.openai.com`, OpenRouter → `openrouter.ai`, …). On **Profile**, pick the **chat model** from the curated list (or a custom model id). Saving Profile syncs that provider + model into AgentSystem for your tenant agents.

Do **not** paste keys on Register or Profile anymore — Profile only selects the provider and model; the secret lives in API Keys.

**Platform default** model (no BYOK) uses the admin-selected platform LLM — no `Platform_BYOK` needed.

**Per-tool model (optional):** Profile chooses the default chat model; **Tools → Model** on `/content-tools` can override the model for individual BYOK-aware tools (keys still come from this vault / platform). See [11-content-tools-scripts-profile.md](./11-content-tools-scripts-profile.md).

## Replicate_BYOK (video when not on Platform default)

For **`generate_video`** (Replicate):

| Profile LLM | Video key used |
|-------------|----------------|
| **Platform default** | Platform `REPLICATE_API_TOKEN` (ops `.env`) — no vault key |
| **Anything else** (OpenAI, OpenRouter, Ollama, …) | Vault entry named exactly **`Replicate_BYOK`** — platform token is **not** used |

1. Create **`Replicate_BYOK`** under **API Keys** with your Replicate API token.
2. Keep Profile on a non-platform provider (or switch back to Platform default to use the shared platform token).

Missing `Replicate_BYOK` while Profile is not Platform default → video tool returns an error (no silent fall-back to the platform key).

## BRAVE_SEARCH_BYOK (web search when not on Platform default)

For agent tool **`brave_web_search`**:

| Profile LLM | Brave key used |
|-------------|----------------|
| **Platform default** | Platform `BRAVE_API_KEY` (ops `.env`) — no vault key |
| **Anything else** (OpenAI, OpenRouter, Ollama, …) | Vault entry named exactly **`BRAVE_SEARCH_BYOK`** — platform key is **not** used |

1. Create **`BRAVE_SEARCH_BYOK`** under **API Keys** with your Brave Search subscription token.
2. Keep Profile on a non-platform provider (or switch back to Platform default to use the shared platform key).

Missing `BRAVE_SEARCH_BYOK` while Profile is not Platform default → `brave_web_search` returns an error (no silent fall-back). Workflow Brave MCP nodes still pass headers/vault refs separately (MCP container does not read env).

For **Google Places** (`google_places_nearby`, `business_discover`):

| Profile LLM | Places key used |
|-------------|-----------------|
| **Platform default** | Platform `GOOGLE_PLACES_API_KEY`, or vault **`GOOGLE_PLACES_BYOK`** if the platform key is unset |
| **Anything else** | Vault **`GOOGLE_PLACES_BYOK` only** — platform key is **not** used |

Enable **Places API (New)** on the Google Cloud key. See [42-social-research-business-discovery.md](./42-social-research-business-discovery.md).

**Instagram captions:** vault **`INSTAGRAM_SESSIONID`** (browser `sessionid` cookie) is always preferred over a shared platform env cookie. Without it, Instagram still hydrates post **images** from public `/p/` URLs.

**X official timeline:** same Profile rule as Brave — platform `X_BEARER_TOKEN` vs vault **`X_API_BYOK`**. Tweet text/media hydration from status URLs works without that key. See [42-social-research-business-discovery.md](./42-social-research-business-discovery.md).

## Use vault keys in workflows

Prefer a **Vault key** / named reference in node auth fields (Brain `apiKey`, API auth, MCP headers, External agent Bearer) instead of pasting literals into the graph.

Also supported:

- Dynamic templates from prior steps: `{{api-login.body.accessToken}}` — see [14-workflow-dynamic-values.md](./14-workflow-dynamic-values.md)
- Per-run Trigger input for one-off secrets (less preferred than vault)

Exporting a workflow should **not** embed live secrets when you used vault refs.

## Related pages

| Page | Relationship |
|------|----------------|
| **Profile** | Provider preference; points here for `Platform_BYOK` |
| **Connectors** | Prefer vault for reusable named keys; OpenConnector **Save API key** / OAuth App override live on Connectors (help **16**), not this vault list |
| **MCP / External agents / Workflows** | Auth fields can reference vault keys |
| **Efficiency / AI Snipper** | Usage analytics — unrelated to storing secrets |

## Tips

- One key name per purpose (`openai-chat`, `brave-mcp`) so you can rotate without hunting graphs.
- If encryption phrase is set and you forget it, you must **replace** the API key value (you cannot recover the old secret from the UI).
- Ask **Platform Help**: “How do I set Platform_BYOK?” or “How do I use a vault key in Brain?”
