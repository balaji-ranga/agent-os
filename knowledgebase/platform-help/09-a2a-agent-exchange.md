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
4. The workflow becomes reachable via public agent card + JSON-RPC under `/a2a/:publishId`.
5. **Unpublish** removes it from AgentExchange.

Public card example path: `/a2a/:publishId/.well-known/agent-card.json`.

---

## AgentExchange (`/agent-exchange`)

- Browse published A2A workflow agents across the platform.
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
