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
3. Required inputs bound? Check empty `{{…}}` templates.
4. Inspect run step errors (API non-2xx, MCP error, approval waiting).
5. Ask **Workflow Builder** to inspect the draft and heal.

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

## Notifications missing

1. Did you ask the agent to **notify you** / call `notify_ceo`?
2. Check bell clear/dismiss — item may have been cleared.
3. For “have X contact me”, COO must **sessions_send** to X so **X** notifies (not the COO).

## Wrong agent got the work

Rephrase with a clear specialty outcome, or name the agent. Use **Broadcast** only when many agents should hear the same message. Resync org docs after adding agents.

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
