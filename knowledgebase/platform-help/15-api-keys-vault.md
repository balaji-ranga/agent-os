# API Keys vault (Management → API Keys)

## What it is

Path: **Management → API Keys** (`/api-keys`).

A per-CEO **named secret vault** for:

- Workflow **Brain / API / MCP / External agent** auth
- **Connectors** (OpenConnector) API-key apps
- **BYOK** (bring your own key) for OpenAI / OpenRouter agent chat

Secrets are **never** shown again after save (list shows name + hint only). Platform access logs redact API Keys routes and never print Authorization headers or key bodies.

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

## Platform_BYOK (required for OpenAI / OpenRouter)

For agent chat with **your** OpenAI or OpenRouter key:

1. Create a vault entry named exactly **`Platform_BYOK`** (name is shown on the API Keys page).
2. Paste your provider API key.
3. Open **Profile** → choose OpenAI or OpenRouter as the model preference.

Do **not** paste keys on Register or Profile anymore — Profile only selects the provider; the secret lives in API Keys.

**Platform default** model (no BYOK) uses the admin-selected platform LLM — no `Platform_BYOK` needed.

## Replicate_BYOK (video when not on Platform default)

For **`generate_video`** (Replicate):

| Profile LLM | Video key used |
|-------------|----------------|
| **Platform default** | Platform `REPLICATE_API_TOKEN` (ops `.env`) — no vault key |
| **Anything else** (OpenAI, OpenRouter, Ollama, …) | Vault entry named exactly **`Replicate_BYOK`** — platform token is **not** used |

1. Create **`Replicate_BYOK`** under **API Keys** with your Replicate API token.
2. Keep Profile on a non-platform provider (or switch back to Platform default to use the shared platform token).

Missing `Replicate_BYOK` while Profile is not Platform default → video tool returns an error (no silent fall-back to the platform key).

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
| **Connectors** | API-key apps can use vaulted secrets |
| **MCP / External agents / Workflows** | Auth fields can reference vault keys |
| **Efficiency / AI Snipper** | Usage analytics — unrelated to storing secrets |

## Tips

- One key name per purpose (`openai-chat`, `brave-mcp`) so you can rotate without hunting graphs.
- If encryption phrase is set and you forget it, you must **replace** the API key value (you cannot recover the old secret from the UI).
- Ask **Platform Help**: “How do I set Platform_BYOK?” or “How do I use a vault key in Brain?”
