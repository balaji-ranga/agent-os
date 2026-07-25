# A2A, External agents, and AgentExchange

## Two directions

1. **Consume** third-party agents → register under **External agents**, call from workflow **External Agent (A2A)** nodes.
2. **Publish** your workflows as A2A agents → **Publish A2A** in the workflow editor → appear on **AgentExchange**.

---

## Onboard an external A2A agent

Path: **External agents** → `/integrations/external-agents`.

1. **Register** with:
   - Name, description
   - **Agent card URL** (preferred)
   - Optional endpoint override, skill id, auth header (for third-party agents that require a static Bearer or custom header)
2. Click **Discover** — the platform tries `/.well-known/agent-card.json` then `agent.json`.
3. **Test A2A invoke** with a sample message.
4. Note the registered id for workflow nodes.

### Workflow wiring

1. Add **External Agent (A2A)**.
2. Set `externalAgentId` (and optional `skillId`).
3. Bind `message` from previous step; optional `contextId` for conversation continuity.
4. Configure `waitForCompletion` and `timeoutMs`.
5. **Auth (static or dynamic):**
   - **Static (registry):** put Bearer / headers on **External agents** when registering (used if the node leaves overrides blank).
   - **Static (node):** set **Bearer token override** or extra headers on the External Agent node.
   - **Dynamic:** set Bearer to `{{api-login.body.accessToken}}` (or put the same in a header value) after an upstream **API** login step that returns the token in `body`. Node overrides merge over registry auth; a node Bearer wins for `Authorization`.
6. Use outputs: `text`, `result`, `task_id`, `task_state`, `ok`.

If the remote agent is **secured with OAuth client credentials** (as Flolah secured publishes are), use an **API** node against their `tokenUrl`, then pass `{{api-….body.access_token}}` into the External Agent node Bearer field (or refresh the registry header manually when tokens expire).

---

## Publish your workflow as A2A

From a **Published** workflow, open **Publish A2A**.

### Visibility (Public vs Private)

| Visibility | Default | Behaviour |
|------------|---------|-----------|
| **Public** | Yes | Listed on AgentExchange for other CEOs. Public card / invoke / OAuth / enquiry follow the **Security** IP policy (`Deny all` / `Allow all` / `IP whitelist`). |
| **Private** | No | **Public calling is disabled** (card, invoke, token, enquire always denied). Hidden from other CEOs on AgentExchange. Only the **COO** or the agent's **org reports-to lead** (after **Add to org**) can invoke it via COO delegation / org path. Owner **Test agent** still works. |

Set visibility in the Publish A2A modal, or later under AgentExchange → **⋯** menu → **Security**.

### Auth mode (orthogonal to visibility)

1. Build and **Publish** the workflow (normal publish first).
2. Open **Publish A2A** in the editor.
3. Confirm card metadata / skill id as prompted.
4. Choose **Visibility**: **Public** (default, listed) or **Private** (org-only; public endpoints denied).
5. Choose **Invoke mode**:
   - **Sync** — HTTP holds until the run finishes (or ~2 minutes timeout). Response text is the final step output; `result.metadata.run` includes run id, status, steps, etc.
   - **Async** — returns immediately with `task.status.state = working` and a `task.id`. Callers can:
     1. Set a **Callback URL** (at publish time, or per-invoke via `params.metadata.callbackUrl`) — Flolah POSTs final output + run metadata when the run completes/fails.
     2. Poll with skill **`enquire-progress`** (on the agent card) or JSON-RPC **`tasks/get`** / **`tasks/enquire`** using `taskId` (or `runId`).
6. Choose **Access** (auth mode — only meaningful when Visibility is Public):
   - **Public auth** — anyone with the endpoint can invoke (no token), subject to Security IP policy.
   - **Secured** — OAuth2 **client credentials**: platform issues `client_id` + `client_secret` (**secret shown once** — copy it immediately). Clients POST to the token URL, then call A2A with `Authorization: Bearer <access_token>`.
7. The workflow becomes reachable via agent card + JSON-RPC under `/api/a2a/:publishId` (unless Private).
8. Optional: set **Input JSON Schema** on the Trigger (or override in Publish A2A). It is advertised on the A2A agent card skill as `inputSchema` and validates invocations.
9. **Publish as a new agent** — same workflow can be published multiple times under different agent names/endpoints (e.g. one sync + one async). Pass `as_new_agent: true` (UI checkbox) or `publish_id` when updating a specific listing.
10. **Update A2A** can rotate the client secret (invalidates the old secret and outstanding tokens).
10. **Network access defaults to Deny all.** In **AgentExchange → ⋯ → Security**, the owner can choose:
    - **Deny all** — card, invoke, OAuth token and enquiry endpoints return `403`.
    - **Allow all** — any client IP may reach the A2A endpoints (authentication still applies for Secured agents).
    - **IP whitelist** — add exact IPv4/IPv6 addresses or **IPv4 CIDR** ranges; all other IPs are denied. **IPv6 must be an exact address** (CIDR ranges like `2001:db8::/32` are rejected — the matcher does not support IPv6 subnets yet).
11. **Unpublish** from the AgentExchange card **⋯** menu removes that agent and disables all its public A2A endpoints, revokes OAuth access tokens and deletes its IP whitelist. The underlying workflow remains published and private to authenticated UI/API use.

Agent card: `/api/a2a/:publishId/.well-known/agent-card.json`. When a schema is set, the skill includes `inputSchema` and `defaultInputModes` prefer `application/json`. Async cards also advertise the `enquire-progress` skill and set `capabilities.pushNotifications` when a callback URL is configured.

### Async callback payload

Flolah POSTs **webhook JSON** (not an A2A JSON-RPC envelope) to your callback URL when the workflow run reaches a terminal state:

| `event` | When |
|---------|------|
| `a2a.workflow.completed` | Run finished successfully |
| `a2a.workflow.failed` | Run failed |
| `a2a.workflow.cancelled` | Run cancelled |

Example (completed):

```json
{
  "event": "a2a.workflow.completed",
  "task_id": "...",
  "publish_id": "...",
  "final_output": "...",
  "run": { "run_id": 123, "status": "completed", "steps": [] },
  "status": { "state": "completed" }
}
```

Failed/cancelled payloads use the same shape with `event` / `status.state` set accordingly and `final_output` often carrying the error message.

**Where is the final step output on a callback?** Top-level **`final_output`** — the text of the last completed workflow step (same extraction as enquire). Full run status / step list is under **`run`**. Terminal A2A-style state is **`status.state`**.

On **AgentExchange**, every **async** listing shows **Callback (i)** and **Enquire (i)** tips with sample webhook JSON, enquiry input (`taskId` / `runId`), and a sample A2A enquire response. The **Test agent** panel autofills primary-skill schema input or enquiry `{ "taskId": "…" }`, and after an async accept offers a one-click switch to poll `enquire-progress`.

Platform mock inbox for tests: `POST/GET /api/a2a-callback-inbox` (GET requires CEO auth; returns `sample_callback_json` plus recent entries). Point your publish **Callback URL** or per-invoke `params.metadata.callbackUrl` at `{AGENT_OS_PUBLIC_URL}/api/a2a-callback-inbox` for quick async smoke tests.

### Enquire progress

Poll until `result.task.status.state` is terminal (`completed` / `failed` / `cancelled`), or keep polling while it is `working`.

```http
POST /api/a2a/:publishId
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "tasks/get",
  "params": { "id": "<taskId>" }
}
```

Or `message/send` with `metadata.skillId: "enquire-progress"` and a JSON/data part `{ "taskId": "..." }` (optional alternative: `runId`).

#### Enquire / tasks/get response — where attributes live

Sample shape:

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "kind": "message",
    "messageId": "…",
    "role": "agent",
    "parts": [{ "kind": "text", "text": "…final step output…" }],
    "task": { "id": "<taskId>", "status": { "state": "completed" } },
    "metadata": {
      "run": {
        "run_id": 123,
        "status": "completed",
        "progress_pct": 100,
        "error_message": null,
        "steps": [
          { "node_id": "…", "node_type": "…", "node_label": "…", "status": "completed" }
        ]
      },
      "run_id": 123,
      "callback_delivered": false,
      "invoke_mode": "async"
    }
  }
}
```

| What you need | Attribute |
|---------------|-----------|
| **Final / last completed step output (text)** | **`result.parts[0].text`** |
| Task state (`working` / `completed` / `failed` / `cancelled`) | `result.task.status.state` |
| Task id | `result.task.id` |
| Workflow run id | `result.metadata.run_id` or `result.metadata.run.run_id` |
| Run status / progress % | `result.metadata.run.status`, `result.metadata.run.progress_pct` |
| Per-step statuses (no per-step output payload) | `result.metadata.run.steps[]` (`node_id`, `node_type`, `node_label`, `status`, `error_message`) |
| Whether the HTTP callback was posted | `result.metadata.callback_delivered` |

While still running, `result.parts[0].text` is typically `"Workflow still running."` and `result.task.status.state` is `working`.

**How `parts[0].text` is chosen when completed:** Flolah walks workflow steps from the end and takes the first non-empty of: step `output.text` → `output.result` (string) → `output.result.text` / `.summary` / `.message`. If none, it falls back to `"Workflow completed successfully."` On failure/cancel, the text is usually the run error message.

**Callback vs enquire for the same output:**

| Channel | Final output field |
|---------|-------------------|
| Enquire / `tasks/get` / sync invoke | `result.parts[0].text` |
| Async HTTP callback webhook | `final_output` |

`result.metadata.run.steps[]` lists step **status** only — it does **not** include each step’s full output object. Only the last completed text is surfaced (as above).

### Secured invoke (client credentials)

```http
POST /api/a2a/:publishId/oauth/token
Content-Type: application/json

{ "grant_type": "client_credentials", "client_id": "...", "client_secret": "..." }
```

Also accepted: HTTP Basic with `client_id:client_secret`, or form-urlencoded body.

Response: `{ "access_token", "token_type": "Bearer", "expires_in": 3600 }` (TTL configurable via `A2A_ACCESS_TOKEN_TTL_SEC`).

Then:

```http
POST /api/a2a/:publishId
Authorization: Bearer <access_token>
Content-Type: application/json

{ "jsonrpc": "2.0", "method": "message/send", "params": { ... } }
```

Do **not** send `client_secret` as the A2A Bearer token — only the short-lived `access_token` from the token endpoint.

Secured agent cards include `securitySchemes.oauth2` (client credentials) and `tokenUrl`.

---

## AgentExchange (`/agent-exchange`)

- Browse published A2A workflow agents across the platform.
- Cards show **Public** vs **Secured**, **Sync** vs **Async**, and the **token URL** when secured.
- Copy card URL, skill id, and endpoints for partners.
- Use discovered endpoints when registering an external agent in another tenant or system.
- `client_secret` is never listed on AgentExchange (only shown once at publish/rotate time to the publisher).
- Agent owners open the card **⋯** menu for **Copy endpoint**, **Copy card URL**, **Open card**, **Test agent**, **Add to org** / **Edit org placement**, **Security**, and **Unpublish**. Other users see copy/open/test actions but cannot modify another owner's agent.
- Every newly published A2A agent starts with **Deny all IPs**. Explicitly switch to **Allow all** or configure an **IP whitelist** before external clients can access its card/invoke/token/enquiry endpoints.

### Test agent (owner vs non-owner)

Each listing’s **⋯** menu opens a **Test agent** panel:

1. **Autofill** — loads `GET /api/agent-exchange/:publishId/test-sample` (optional `?skillId=enquire-progress`) and pre-fills input from the skill’s **`inputSchema`** / examples. Primary skill runs the workflow; **`enquire-progress`** polls with `{ "taskId": "…" }`.
2. **Help tips** — async cards show **Callback (i)** and **Enquire (i)** with sample payloads. Inside Test agent, skill-specific input help explains which JSON to send; after an async accept, use the one-click link to switch to enquire with that `taskId`.
3. **Invoke** — `POST /api/agent-exchange/:publishId/test` with skill id + JSON/text input. For **async** agents you can pass **`callbackUrl`** in the test body (same as per-invoke `params.metadata.callbackUrl`). For **secured** agents, non-owners paste a Bearer **access token** from the token URL.
4. **Owner bypass** — if you own the agent, the test path **skips IP deny/whitelist and OAuth** so you can exercise the workflow even while public access is still **Deny all**. The response includes `bypassed_access: true`. Public A2A endpoints still enforce policy.
5. **Non-owners** — test invoke still enforces **IP policy + OAuth** exactly like the public `/api/a2a/:publishId` endpoint.

Use **Test agent** to validate a draft listing before opening **Allow all** or adding partner IPs to the whitelist.

### Invocation history (Admin)

Every public A2A **card**, **OAuth token**, and **invoke** attempt is written to `workflow_a2a_invocation_logs` — including blocks that never start a workflow (Deny all, IP whitelist miss, missing/invalid OAuth token, agent not found, input schema errors).

| Outcome | Meaning |
|---------|---------|
| `denied` | IP policy or OAuth rejected the call |
| `error` | Bad request / not found / validation / unsupported method |
| `success` | Card served, token issued, or invoke accepted/completed |
| `failed` | Invoke reached a terminal failed/cancelled task state |

**Admin UI:** `/admin/a2a-invocations` (**A2A logs** in the admin nav) — filter by outcome, endpoint (`card` / `oauth_token` / `invoke`), source (`public` vs `agent_exchange_test`), client IP, and free-text search. Expand request/response payloads (secrets redacted).

**API:** `GET /api/admin/a2a-invocations` (admin role). Owner Test agent calls are logged with `source=agent_exchange_test` and `bypass_access=1` when the owner bypass applies.

### Add to org (leaf member)

Both **External Agents** and your own AgentExchange publications have an **Add to org** action. It
places the agent in your org chart as a **leaf member**: department + reports-to an internal agent,
with optional monthly token and error budgets. Leaf members cannot manage other agents.

Once placed, the member is written into **ORG.md** and the COO's **AGENTS.md** with a member key
(`ext:<id>` / `a2a:<id>`) and its purpose, so the **COO can delegate work to it** like an internal
specialist: budget guard → Kanban card → A2A invoke → outcome recorded. Delegation to your own
publications uses the same owner bypass as **Test agent**, so your IP policy does not block you.

**Private A2A publications:** if the listing is marked **Private**, public endpoints stay denied.
Only the **COO** or this leaf's **reports-to** internal lead may invoke it through the org path.
Peers that do not manage the leaf are refused.

**Registered your own publication as an External Agent?** That works too. When the endpoint URL of
an External Agent points back at this platform (`…/api/a2a/<publishId>`) and the publication belongs
to you, the org path, your own workflows' **External Agent** node, and your own **Invoke** test call
it **in-process** instead of going out over HTTP — so **Private**, **deny_all** and IP-whitelist
publications no longer answer `A2A HTTP 403` to their own COO. Entitlement is unchanged: the COO or
the leaf's reports-to lead only, and endpoints belonging to another CEO always take the public route.

Full details: [18-agent-budgets-and-org-members.md](./18-agent-budgets-and-org-members.md).

### VPS: real client IP for whitelist

On Docker VPS hosts, the default bridge proxy can make every client look like the gateway IP — **IP whitelist would never match**. Production deploy scripts set:

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml:docker-compose.vps-client-ip.yml
```

That override runs **nginx in host network mode** and binds backend/frontend to loopback only, so nginx sees the real `$remote_addr` for A2A access checks. **AgentExchange → Security** shows **Your IP** (`current_ip`) to help you whitelist the right address.

---

## When to use what

| Goal | Use |
|------|-----|
| Call your own OpenClaw specialist | **Agent** node |
| Call a third-party A2A service | **External Agent** node |
| Expose your automation openly | **Publish A2A** → Visibility Public + Public auth |
| Expose your automation with credentials | **Publish A2A** → Visibility Public + Secured (OAuth) |
| Keep an A2A agent org-only | **Publish A2A** → Visibility **Private** + **Add to org** (COO / reports-to lead only) |
| Browse marketplace of published workflows | **AgentExchange** |
| Call MCP tools (not full agents) | **MCP** node / Brain MCP loop |
| Let the COO delegate to an external/A2A agent | **Add to org** → department + reports-to |
