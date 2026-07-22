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
   - Optional endpoint override, skill id, auth header
2. Click **Discover** — the platform tries `/.well-known/agent-card.json` then `agent.json`.
3. **Test A2A invoke** with a sample message.
4. Note the registered id for workflow nodes.

### Workflow wiring

1. Add **External Agent (A2A)**.
2. Set `externalAgentId` (and optional `skillId`).
3. Bind `message` from previous step; optional `contextId` for conversation continuity.
4. Configure `waitForCompletion` and `timeoutMs`.
5. Use outputs: `text`, `result`, `task_id`, `task_state`, `ok`.

---

## Publish your workflow as A2A

1. Build and **Publish** the workflow (normal publish).
2. Open **Publish A2A** in the editor.
3. Confirm card metadata / skill id as prompted.
4. Choose **Access**:
   - **Public** — anyone with the endpoint can invoke (no token).
   - **Secured** — OAuth2 **client credentials**: platform issues `client_id` + `client_secret` (secret shown once). Clients POST to the token URL, then call A2A with `Authorization: Bearer <access_token>`.
5. The workflow becomes reachable via agent card + JSON-RPC under `/api/a2a/:publishId`.
6. **Unpublish** removes it from AgentExchange and revokes access tokens.

Agent card: `/api/a2a/:publishId/.well-known/agent-card.json`.

### Secured invoke (client credentials)

```http
POST /api/a2a/:publishId/oauth/token
Content-Type: application/json

{ "grant_type": "client_credentials", "client_id": "...", "client_secret": "..." }
```

Response: `{ "access_token", "token_type": "Bearer", "expires_in": 3600 }`.

Then:

```http
POST /api/a2a/:publishId
Authorization: Bearer <access_token>
Content-Type: application/json

{ "jsonrpc": "2.0", "method": "message/send", "params": { ... } }
```

Secured agent cards include `securitySchemes.oauth2` (client credentials) and `tokenUrl`. You can rotate the client secret from **Update A2A** (invalidates the old secret and outstanding tokens).

---

## AgentExchange (`/agent-exchange`)

- Browse published A2A workflow agents across the platform.
- Cards show **Public** vs **Secured** (OAuth client credentials) and token URL when secured.
- Copy card URL, skill id, and endpoints for partners.
- Use discovered endpoints when registering an external agent in another tenant or system.

---

## When to use what

| Goal | Use |
|------|-----|
| Call your own OpenClaw specialist | **Agent** node |
| Call a third-party A2A service | **External Agent** node |
| Expose your automation to others | **Publish A2A** |
| Browse marketplace of published workflows | **AgentExchange** |
| Call MCP tools (not full agents) | **MCP** node / Brain MCP loop |
