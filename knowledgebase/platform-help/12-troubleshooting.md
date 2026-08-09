# Troubleshooting (CEO)

## Lists look incomplete or “nothing more to delete”

Some screens load a **page** of rows (Content Explorer, Master Data documents, Admin users, workflow definitions) rather than the full history.

1. Use **Next** / **Prev** or switch filters (Kanban **All** loads further pages automatically).
2. Search/filter tools that only apply client-side act on the **current page** (Content Explorer).
3. Tool/monitor logs are already paged (`limit`/`offset`); same idea for Kanban task activity.

## Chat / agent not responding

1. Confirm you are logged in as CEO and opened the correct agent chat.
2. Check OpenClaw gateway is up (admin/ops). Symptom: gateway errors or timeouts.
3. Clear the agent session and retry a short message.
4. Verify **Tools access** if the agent should call tools but tool icons never appear.
5. Ask **COO** or **Platform Help**; for gateway pairing errors ops use `knowledgebase/GATEWAY-PAIRING-1008.md`.

## Agent gave wrong how-to steps

1. Ask **Platform Help** explicitly; it should call `master_data_rag`.
2. Open **Master Data → Documents** and confirm Platform Help docs are present (they show a **protected** badge and cannot be deleted/purged).
3. Re-ask with keywords from the doc title (“workflow nodes IF operator”, “MCP register”).
4. If help docs are missing: restart backend or re-run `node backend/scripts/reupload-platform-help-docs.js` (admin/ops) — register/startup also re-seeds them.

## Purge removed the wrong files?

**Purge all uploads** only deletes **your** uploaded documents. Platform Help and the Flolah User Guide are skipped. If you purged by mistake, re-upload your files — help/guide docs remain.

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
4. `403` / IP whitelist: your public IP must match a rule under **Settings → IP Whitelists** (or the federated UI that shares that store), or remove entries so empty optional lists allow any IP again.
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

1. On a non-platform Profile, open **API Keys** — recommended slots should already exist with hint **unset**. Edit **`Platform_BYOK`** and paste your key before selecting OpenAI/OpenRouter on Profile.
2. Key name spelling must match (case-sensitive vault names). Unset placeholders are not usable until you paste a real secret.
3. After rotate, re-select or re-save the workflow node that references the vault key.
4. Delete blocked by dependencies → review the confirm list (workflows / MCP / Connectors / External agents).
5. Missing `Replicate_BYOK` / `BRAVE_SEARCH_BYOK` on a non-platform Profile → video / `brave_web_search` fail with no platform fall-back — fill those slots or switch Profile to Platform default.
6. Wrong model on one tool only: open **Tools → Model** and clear that tool (Profile default) or pick a model your Profile key supports. Mappings do not replace vault keys.

## Connectors / Connector node fails

1. Provision runtime token on **Connectors**.
2. App connected for **this** CEO? OAuth expired → reconnect.
3. Workflow **Connector** node has the correct app + action.
4. Admin may need to configure OAuth client id/secret for that app.

## Agent blocked: "budget exhausted"

An agent refuses chat (HTTP 429) or its delegated Kanban card fails with a budget reason when it
hits **100% of its monthly token budget**, or its monthly failure rate reaches the **error budget**
after at least 10 terminal calls.

1. Open **Efficiency View → Agent View**, pick the agent, and read the two gauges.
2. **Edit budget** to raise the monthly token allowance or error budget %, or clear the field for
   unlimited. To keep the budget as-is and just clear what has been spent this month, use
   **Reset usage** (that agent) or **Reset all usage**.
3. If tokens look wrong, note that rows without provider-reported usage are **estimated**
   (`chars/4`) — the token total shows how much is estimated.
4. Budgets reset each calendar month and carry the previous month's values forward.
5. Failure rate high but tasks look fine? Check Kanban for cards left in **failed** by optional side
   errors and correct them — see "Kanban stuck or wrong status" above.

## COO won't delegate to my external / A2A agent

1. The agent must be added via **Add to org** (External Agents or AgentExchange) — registry entries
   alone are not routable.
2. It needs a **purpose**; the COO classifies on purpose text.
3. It needs a **department** and an internal **reports-to** agent.
4. Run **Resync ORG.md & AGENTS.md** from the Dashboard so the COO's roster picks it up.
5. Check its budget state in **Efficiency View → Agent View** — a blocked member is skipped before
   the outbound call.
6. Confirm a direct **Test agent** / external test invoke succeeds; delegation uses the same path.

## Agent won't delete, or comes back after deleting

Removing an agent is now a single all-or-nothing step, so this should no longer happen. What you may still see:

- **"Cannot delete the COO agent"** — the COO is the delegation root and is never deletable. Remove the specialists under it instead.
- **"Agent not found"** — the agent is not in your workspace. You can only remove agents you own or were granted.

What removal does: the agent's chat history, standup responses, delegation records and tool grants are deleted; its **Kanban cards are kept and simply unassigned** so your board history survives; and any agents reporting to it move up to its parent. Removal is recorded, so the agent will not reappear after a platform restart or after **Sync from OpenClaw**.

To bring the same agent back, create it again from **Agent Workspaces → Add agent** — recreating an agent explicitly clears the removal record.

## A scheduled job never ran

1. Check what you own first:
   - **Scheduled goals** (`/scheduled-goals`) — status must be **active** (not paused/deleted); cadence and local time must match. Use **Run now** or ask the COO. Guide: [28-scheduled-goals.md](./28-scheduled-goals.md).
   - Standup `scheduled_at`, workflow **schedule** trigger + cron expression, or Job profile schedule. A draft workflow never runs on a schedule.
2. Platform timers are shared. Ask your admin to open **Admin → Crons** (`/admin/crons`) — a job
   shown as **Paused** stays paused across restarts until someone hits **Resume**. Confirm **scheduled_goals** is not paused and `SCHEDULED_GOALS_CRON` is set. **Run now**
   executes one tick immediately so you can confirm the job itself works.
3. **Run status checker** on the Dashboard and **Purge data older than N days** are the manual
   equivalents of the daily status and retention jobs.
4. Full reference: [19-scheduled-jobs-and-crons.md](./19-scheduled-jobs-and-crons.md).

## Company setup redirects me every login

1. Complete the funnel or use **Skip for now** if offered.
2. Reopen anytime: avatar → **Company setup** (`/company-setup`). After Apply, gate is **completed**.
3. Company setup is not the same as Onboarding Helper (`/onboarding`). Guide: [29-company-setup.md](./29-company-setup.md).

## Storage (MB) did not drop after a purge

1. Retention only removes chats, chat history, standup conversations, workflow runs, and aged
   Content Explorer media older than your **Data persistence** window — Master Data **tables**,
   Master Data **documents**, and **OpenSearch RAG indices** are **not** purged by retention.
2. Lower the window on **Profile → Data persistence**, then **Purge aged data now**.
3. Master Data uploads need **Purge all uploads** (Documents panel) — that also removes the
   corresponding OpenSearch index docs/chunks. Platform Help and the User Guide are protected.
4. Storage totals **include** OpenSearch RAG size for your tenant. Click the **i** next to
   **Storage (MB)** for the component breakdown (chat vs Master Data files vs RAG meta/search, etc.).
5. Storage is a point-in-time estimate, so reopen **Efficiency View → Org** after the purge.

## Department budget looks wrong

1. Department budgets come from **Master Data → tables → `departments`** (`monthly_token_budget`);
   a blank cell shows as **No department budget**.
2. Members only roll up when their **department** matches the table row exactly.
3. Department figures are for planning — blocking is per agent, on **Agent View**.

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


## Browser Session / browse_* tools

1. Agent says browser unavailable after a successful `browse_task_*` / `browse_recipe_*` — that only means the **built-in** browser tool is denied; trust the content-tool result and `task_id`.
2. Recipe list empty for another CEO’s recipes — expected; recipes are per entitled CEO.
3. Agent can list but not play — grant **`browse_recipe_run`** in Workspace → Tool access.
4. Client Chrome not ready — Browser Session → opt in, attach tab, Mark ready.
5. Opens blocked — check URL allow/deny lists.
6. Full guide: [22-browser-session-and-recipes.md](./22-browser-session-and-recipes.md).

## WhatsApp / Slack “Media failed” or no audio

1. Agents must paste **`MEDIA:/abs/path`** (`paste_exactly` from the tool) on its **own line** so WhatsApp attaches from the shared OpenClaw disk. Auth-only `https://…/api/media/…` links fail without a browser session.
2. Leave ops flag **`MEDIA_PUBLIC_SIGNED`** off unless you deliberately need legacy signed public fetch.
3. For TTS on WhatsApp, prefer **OGG/Opus or MP3** — WAV often fails attach; Dashboard still plays WAV inline.
4. Dashboard blank / broken media — hard-refresh while logged in; players need Bearer. “Open full size” opening a new tab for audio meant an older UI bug (audio should show an inline player).
5. Full delivery rules: [11-content-tools-scripts-profile.md](./11-content-tools-scripts-profile.md), [24-agent-channels.md](./24-agent-channels.md).

## Inbound voice / image not seen by the agent

1. Confirm the agent’s **Channels** row is **enabled** (WhatsApp / Slack).
2. Wait a few seconds for mirror into workspace **`inbound/attachments/`** (OpenClaw stages under `~/.openclaw/media/inbound` first).
3. If the chat shows “[whatsapp attachment unavailable]”, still try the latest file under `inbound/attachments/` with `speech_stt` or the summarize-inbound workflow.
4. Web paperclip uploads always go to Master Data + `inbound/attachments/` for that CEO.

## Platform feedback status

1. Ask COO / Platform Help to run **`platform_feedback_enquire`** with the id, or filter by status/category.
2. Admins update status at **Admin → Platform feedback** (`/admin/platform-feedback`): `open` | `implemented` | `rejected` (reject can include a reason).
