# Troubleshooting (CEO)

## Chat / agent not responding

1. Confirm you are logged in as CEO and opened the correct agent chat.
2. Check OpenClaw gateway is up (admin/ops). Symptom: gateway errors or timeouts.
3. Clear the agent session and retry a short message.
4. Verify **Tools access** if the agent should call tools but tool icons never appear.
5. Ask **COO** or **Platform Help**; for gateway pairing errors ops use `knowledgebase/GATEWAY-PAIRING-1008.md`.

## Agent gave wrong how-to steps

1. Ask **Platform Help** explicitly; it should call `master_data_rag`.
2. Open **Master Data → Documents** and confirm Platform Help docs are present.
3. Re-ask with keywords from the doc title (“workflow nodes IF operator”, “MCP register”).

## Workflow won’t run

1. Is it **Published**? Drafts do not run.
2. Trigger mode fields filled (cron / chat phrase / event secret)?
3. Required inputs bound? Check empty `{{…}}` templates (node id typo? nested path?). See **Workflow Dynamic Values** help (`14-workflow-dynamic-values`).
4. Auth failures: confirm Bearer/header uses `{{api-….body.token}}` (or Trigger `trigger_input`) — MCP Brave needs BYOK headers, not platform env.
5. Inspect run step errors (API non-2xx, MCP error, approval waiting).
6. Ask **Workflow Builder** to inspect the draft and heal (or Platform Help for how-to).

## Download for Windows fails or package won’t start

1. Workflow must be **Published** before **Download for Windows**.
2. Re-download after Flolah updates if `Run-Workflow.ps1` errors on special characters (use a fresh zip).
3. Lite package: Node 18+ must be on PATH. Full package: use `runtime\node.exe` (no install).
4. `403` / IP whitelist: your public IP must match a rule, or clear whitelist entries.
5. `401` invalid/revoked token: re-download a new package or check **Revoke** list in the modal.
6. Connector / Brain failures are **service-side** (credentials, OpenConnector link) — desktop path reached Flolah; fix the integration, then re-run the PS1.
7. Full guide: [17-desktop-windows-download.md](./17-desktop-windows-download.md).

## CEO Approval stuck

Open **Kanban**, find the approval card, approve or reject with a comment. IF nodes using `approved`/`rejected` then continue.

## MCP tool missing in workflow

1. Server registered under **MCP**?
2. **Test** playground shows the tool?
3. Node `mcpServerId` and tool name exact?
4. Auth headers set on Test or node?

## External A2A fails

1. Discover agent card succeeded?
2. Test invoke from External agents page?
3. Workflow `externalAgentId` matches registry?
4. Timeout / `waitForCompletion` appropriate?
5. If the remote agent is **secured**: did you obtain a fresh Bearer **access token** from its token URL (client credentials)? Do not use `client_secret` as the invoke Bearer.

## Publish A2A / AgentExchange

1. Workflow itself must be **Published** before **Publish A2A**.
2. **Deny all 403** — new A2A listings default to **Deny all**. External clients see `403` on card, invoke, OAuth token, and enquiry until the owner sets **Allow all** or adds their IP to the **whitelist** (check **Your IP** on the Security panel). On VPS Docker, ensure deploy uses `docker-compose.vps-client-ip.yml` so whitelist sees real client IPs, not the bridge gateway. **Admins** can inspect every blocked/successful attempt under **Admin → A2A logs** (`/admin/a2a-invocations`).
3. **Test agent** — owners can invoke from AgentExchange **Test agent** even while **Deny all** is on (`bypassed_access: true`). Use this to validate before opening public access. Non-owners testing someone else's agent still need IP allow + OAuth token.
4. **Secured**: save `client_secret` when shown — it is not listed again on AgentExchange.
5. Invoke without a token on a secured agent → Unauthorized; rotate credentials if the secret was lost.
6. Token expired → request a new one from `/api/a2a/:publishId/oauth/token`.
7. **Async callbacks** — use `/api/a2a-callback-inbox` as the callback URL for smoke tests; GET (CEO auth) lists received webhook JSON.

## Notifications missing

1. Did you ask the agent to **notify you** / call `notify_ceo`?
2. Check bell clear/dismiss — item may have been cleared.
3. For “have X contact me”, COO must **sessions_send** to X so **X** notifies (not the COO).
4. Ordinary live chat replies intentionally **do not** notify (shared ops) — say “notify me when done” if you want a bell ping after async work.

## Kanban stuck or wrong status

1. Research/build cards stay **in_progress** until the agent posts a real deliverable and moves to **completed**.
2. **awaiting confirmation** needs **your** approve/reject — agents will not auto-advance those.
3. Optional side failures (missing Master Data table, notify/email) should not leave a good deliverable as **failed**.
4. Agents should not invent Kanban from a casual Dashboard chat unless you asked to track it.

## API Keys / BYOK not working

1. Create **`Platform_BYOK`** under **API Keys** before selecting OpenAI/OpenRouter on Profile.
2. Key name spelling must match (case-sensitive vault names).
3. After rotate, re-select or re-save the workflow node that references the vault key.
4. Delete blocked by dependencies → review the confirm list (workflows / MCP / Connectors / External agents).

## Connectors / Connector node fails

1. Provision runtime token on **Connectors**.
2. App connected for **this** CEO? OAuth expired → reconnect.
3. Workflow **Connector** node has the correct app + action.
4. Admin may need to configure OAuth client id/secret for that app.

## Wrong agent got the work

Rephrase with a clear specialty outcome, or name the agent. Multi-intent COO asks can go to **two** specialists. Use **Broadcast** only when many agents should hear the same message. Resync org docs after adding agents.

## Job pipeline idle

Confirm **Job profile** is complete and pipeline/cron is enabled for your environment. Check **Job workflows** run history and Kanban.

## Who to escalate

| Issue | Ask |
|-------|-----|
| Product how-to | **Platform Help** |
| Build/fix graph | **Workflow Builder** |
| Delegation / standup / email | **COO** |
| Research / social / expense specialty | Matching specialist |
| Gateway, SMTP, DNS, deploy | Platform admin / ops |
