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

If the remote agent is **secured with OAuth client credentials** (as Flolah secured publishes are), obtain an access token from their `tokenUrl` first, then put `Authorization: Bearer <access_token>` in the external-agent auth header (refresh when the token expires).

### Workflow wiring

1. Add **External Agent (A2A)**.
2. Set `externalAgentId` (and optional `skillId`).
3. Bind `message` from previous step; optional `contextId` for conversation continuity.
4. Configure `waitForCompletion` and `timeoutMs`.
5. Use outputs: `text`, `result`, `task_id`, `task_state`, `ok`.

---

## Publish your workflow as A2A

1. Build and **Publish** the workflow (normal publish first).
2. Open **Publish A2A** in the editor.
3. Confirm card metadata / skill id as prompted.
4. Choose **Access**:
   - **Public** — anyone with the endpoint can invoke (no token).
   - **Secured** — OAuth2 **client credentials**: platform issues `client_id` + `client_secret` (**secret shown once** — copy it immediately). Clients POST to the token URL, then call A2A with `Authorization: Bearer <access_token>`.
5. The workflow becomes reachable via agent card + JSON-RPC under `/api/a2a/:publishId`.
6. Optional: set **Input JSON Schema** on the Trigger (or override in Publish A2A). It is advertised on the agent card skill as `inputSchema` and validates invocations.
7. **Update A2A** can rotate the client secret (invalidates the old secret and outstanding tokens).
8. **Unpublish** removes it from AgentExchange and revokes access tokens.

Agent card: `/api/a2a/:publishId/.well-known/agent-card.json`. When a schema is set, the skill includes `inputSchema` and `defaultInputModes` prefer `application/json`.

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
- Cards show **Public** vs **Secured** and the **token URL** when secured.
- Copy card URL, skill id, and endpoints for partners.
- Use discovered endpoints when registering an external agent in another tenant or system.
- `client_secret` is never listed on AgentExchange (only shown once at publish/rotate time to the publisher).

---

## When to use what

| Goal | Use |
|------|-----|
| Call your own OpenClaw specialist | **Agent** node |
| Call a third-party A2A service | **External Agent** node |
| Expose your automation openly | **Publish A2A** → Public |
| Expose your automation with credentials | **Publish A2A** → Secured (OAuth) |
| Browse marketplace of published workflows | **AgentExchange** |
| Call MCP tools (not full agents) | **MCP** node / Brain MCP loop |
