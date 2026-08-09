# Workflow dynamic values (templates, prior steps, variables)

How to pass data into node attributes at **run time** — static literals, prior-step outputs, workflow variables, and trigger input.

Platform Help and **Workflow Builder** both use this guide. Syntax is evaluated by the workflow runner (`{{…}}` templates), not by typing Mustache `steps.*` paths.

---

## Three ways to feed a node

| Mechanism | Where you set it | Typical use |
|-----------|------------------|-------------|
| **Input / Output binding** | Node panel → Input / Output | Wire `url`, `body`, `message`, `userMessage` from a previous node’s named output |
| **`{{…}}` templates** | Typed into attribute fields, prompts, headers, bearer tokens, static JSON | Compose strings that mix literals + prior outputs + variables |
| **Workflow variables** | Editor **Workflow variables** panel | Shared static config for the whole definition (`budget`, `baseUrl`, allowlists, …) |

Bindings and templates are evaluated **when that node runs**, using outputs already stored from completed upstream steps.

---

## Template syntax (canonical)

| Pattern | Meaning | Example |
|---------|---------|---------|
| `{{nodeId.outputKey}}` | Prior step’s named output | `{{brain-1.text}}`, `{{api-1.body}}`, `{{api-1.status}}` |
| Nested path | Walk JSON inside an output | `{{api-login.body.accessToken}}`, `{{trigger-1.trigger_input.braveApiKey}}` |
| `{{var.key}}` or `{{variables.key}}` | Workflow variable | `{{var.budget_usd}}`, `{{var.allowlist_keys}}` |
| Nested var | JSON workflow variable | `{{var.policy.max_trades}}` |
| `{{input}}` | Run / trigger payload shorthand (often prior text) | Agent / Brain prompts |

**Not supported:** `{{steps.login.output.token}}` or other framework-style paths. Always use the **canvas node id** (e.g. `api-login`, `trigger-1`).

Node ids appear on the canvas (and in Export JSON). Prefer stable ids when building with Workflow Builder.

---

## Previous-step outputs

1. Upstream node finishes and stores outputs (`text`, `body`, `ok`, … — see [07-workflow-nodes-reference.md](./07-workflow-nodes-reference.md)).
2. Downstream node either:
   - Sets an input to **Dynamic** and picks **source node** + **output key**, or
   - Leaves a field **Static** but embeds `{{upstreamId.key}}` / nested path in the string.

### Trigger JSON runs

When you Run with JSON (or a Trigger **input JSON Schema**), the Trigger stores:

- `trigger_input` — the object
- `text` — string form of the payload

Examples:

```text
{{trigger-1.trigger_input.query}}
{{trigger-1.trigger_input.brainApiKey}}
{{trigger-1.trigger_input.braveApiKey}}
```

### Auth from a login API step

1. `api-login` POST → response body `{ "accessToken": "…" }` (output key `body`).
2. Next **API** / **MCP** / **External Agent** / **Brain** auth field:

```text
{{api-login.body.accessToken}}
```

Or HTTP header value:

```text
Bearer {{api-login.body.accessToken}}
```

| Node | Auth fields that accept templates |
|------|-----------------------------------|
| **API** | Bearer / basic / API-key values; HTTP headers editor |
| **MCP** | Bearer + HTTP headers (also Brain per-server MCP auth) |
| **SSE Listen** | HTTP headers |
| **External Agent (A2A)** | Optional Bearer override + headers (else registry auth) |
| **Brain** | `apiKey` (and related), system prompt, MCP server auth headers |

Secrets look static in the editor; the runner substitutes them at execute time.

---

## Workflow variables (shared / “global” for one workflow)

There is **no platform-wide global variable store**. What people call “globals” in a graph are **workflow variables**:

- Edited in the workflow editor **Workflow variables** panel.
- Saved with the draft / published definition.
- Available to **every node** in that workflow as `{{var.key}}`.
- Static for the run (not overwritten by prior steps unless you also write them via scripts — normal graphs only *read* them).

Examples:

```text
Base URL: {{var.api_base}}
Budget: {{var.budget_usd}}
Allowlist: {{var.allowlist_keys}}
```

Use variables for config that should not live in every node (IBKR day-plan limits, shared endpoints, feature flags). Use prior-step templates for **secrets and data produced during the run** (tokens, search results, Brain text).

---

## Input binding modes (I/O panel)

| Mode | Behavior |
|------|----------|
| **Static** | Literal value; may still contain `{{…}}` templates |
| **Dynamic (previous step)** | Value = that node’s output key (optionally nested path as the key) |
| **Workflow variable** (when offered) | Value = `variables[key]` |

Prefer Dynamic bindings for whole fields (URL from prior step). Prefer templates when composing (“`Summarize: {{api-1.body}}`”) or for auth headers.

---

## Patterns that work well

### Prefer API Keys vault (recommended)

Store secrets under **Settings → API Keys**, then select the vault key on Brain / API / MCP / External agent auth fields. See [15-api-keys-vault.md](./15-api-keys-vault.md).

For OpenAI/OpenRouter **agent chat** BYOK, create vault name **`Platform_BYOK`** and pick the provider on Profile.

### BYOK keys from Trigger (per-run)

Run input:

```json
{ "brainApiKey": "sk-…", "braveApiKey": "BSA…", "query": "AgentOS" }
```

- Brain `apiKey`: `{{trigger-1.trigger_input.brainApiKey}}`
- MCP / API Brave header: `{{trigger-1.trigger_input.braveApiKey}}`

Do **not** rely on platform `.env` for workflow Brain keys or Brave MCP (Brave MCP is BYOK — headers / vault only). Prefer vault over putting secrets in Trigger when the key is long-lived.

### API → MCP → Brain

1. API login → token in `body`
2. MCP tool with `Authorization` / `X-Subscription-Token` = `{{api-login.body.accessToken}}`
3. Brain summarizes `{{mcp-1.text}}` with its own `apiKey` from vault, trigger, or var

### Workflow variable + prior step

```text
GET {{var.api_base}}/v1/items/{{api-create.body.id}}
```

---

## Troubleshooting empty templates

| Symptom | Check |
|---------|--------|
| Literal `{{api-1.body.token}}` sent to server | Field not on a template-aware attribute, or typo in node id |
| Empty string | Upstream not connected / not completed; wrong output key; nested path missing |
| Auth rejected | Token path wrong (`access_token` vs `accessToken`); Bearer vs raw token; vault key missing/rotated |
| Brain “API key required” | `apiKey` blank after render — use vault / trigger / template, not platform `.env` |

After a run, open the step’s input/output diagnostics to see resolved values (secrets may be redacted in logs).

---

## Workflow Builder

Workflow Builder already wires `{{input}}`, `input_bindings`, and Maker/Checker certify loops. It also receives this help corpus via Platform Help RAG when CEOs ask “how do I pass the token?”.

When **building** graphs, Builder should:

- Use canvas **node ids** in templates
- Put tokens in API/MCP/A2A/Brain auth fields as vault refs or `{{nodeId.path}}`
- Prefer workflow **variables** for static shared config
- Prefer Trigger `trigger_input.*` for per-run parameters (and only for one-off secrets)

If a generated graph hard-codes secrets or omits bindings, ask Builder to fix using this guide (or run certify / `until_success`).
