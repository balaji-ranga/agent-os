# Troubleshooting (CEO)

## Lists look incomplete or “nothing more to delete”

Some screens load a **page** of rows (Content Explorer, Master Data documents, Admin users, workflow definitions) rather than the full history.

1. Use **Next** / **Prev** or switch filters (Kanban **All** loads further pages automatically).
2. Search/filter tools that only apply client-side act on the **current page** (Content Explorer).
3. Tool/monitor logs are already paged (`limit`/`offset`); same idea for Kanban task activity.

## Workspace says “No open tasks” but Kanban has open cards

1. Confirm you are the same CEO (no stale impersonation / wrong tab account).
2. Hard-refresh `/work` (Workspace) — data is `GET /api/workspace-boards/default` with live hydrate, not a cached digest-only snapshot.
3. Prefer **Seed operating template** in Workspace Builder if the default board’s task list binding was removed or pointed elsewhere.
4. Open cards are always **owner-scoped** (`owner_user_id`); unassigned cards still count. Platform stores Kanban for multi-tenant CEOs; Workspace lists them the same way as **/kanban**.
5. Still empty after a platform deploy that included the workspace boards fix? Ask ops to restart backend so `listKanbanTasksForOwner` is live.

## Bell says “Kanban: Provide your status…” but Org standup is empty

That title is the **Get work from team** status prompt. A visible standup should exist for a click you made on Dashboard. If you did **not** click it and there is no standup today, older operator deploy probes used to fan out against the live CEO then delete the standup, leaving bells behind. Current deploys dry-run that check (no cards, no bells). Dismiss the leftover bells; they are not a new standup.

## Chat / agent not responding

1. Confirm you are logged in as CEO and opened the correct agent chat.
2. Check AgentSystem gateway is up (admin/ops). Symptom: gateway errors or timeouts.
3. If the assistant literally says **“No response from AgentSystem.”**, the gateway ran but returned an empty payload — often because the agent’s `tools.allow` list stripped built-ins (`sessions_history`, `read`, `sessions_send`). Ops: redeploy backend (runtime tools are always merged into allowlists) and retry; use **New chat** if needed.
4. Clear the agent session and retry a short message.
5. Verify **Tools access** if the agent should call tools but tool icons never appear. Content tools need grants + successful `/api/tools` log rows; native AgentSystem tools (especially **`browser`**) need session transcripts under the shared AgentSystem agents directory (backend `AgentSystem_DIR` volume).
6. Ask **COO** or **Platform Help**; for gateway pairing errors ops use `knowledgebase/GATEWAY-PAIRING-1008.md`.

## Agent gave wrong how-to steps

1. Ask **Platform Help** explicitly; it should call `master_data_rag` on the **platform** help corpus (not your Master Data uploads).
2. Flolah Help is **not** listed under **Master Data → Documents** (that UI is your uploads only). Admins confirm the corpus under **Admin → Documents RAG**.
3. Re-ask with keywords from the doc title (“workflow nodes IF operator”, “MCP register”, “Twenty CRM lead prospect”, “ERPNext order to cash”).
4. If help is stale after a product update: ops rebuild **backend** and re-run `node backend/scripts/reupload-platform-help-docs.js` — register/startup also re-seeds them.

## CRM / ERP agent says it has no help docs

1. That is outdated. Specialists already retrieve Flolah Help via `master_data_rag` (`corpus=platform-help`) even when **Master Data → Documents** is empty. CRM/ERP workspaces also have **DOMAIN.md** (Twenty Lead→Order / ERPNext O2C–P2P).
2. Start a **new chat** with CRM Maker / Checker or ERP Maker / Checker so SOUL and DOMAIN.md reload.
3. Ask them to RAG `Twenty CRM lead prospect opportunity order process stages` or `ERPNext order to cash purchase to pay`.
4. Still empty after a help-doc deploy? Ops: rebuild backend (help is COPY’d into the image) and run `refresh-business-core-workspace-docs.js`. Help **05** / **32** / **39** / **40**.

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

The **Connectors** catalog is about **1,300** SaaS apps via [Open Connector](https://github.com/oomol-lab/open-connector) ([openconnector.dev/#connectors](https://openconnector.dev/#connectors)). Search there in-product; we do not list every app in this help file.

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

What removal does: the agent's chat history, standup responses, delegation records and tool grants are deleted; its **Kanban cards are kept and simply unassigned** so your board history survives; and any agents reporting to it move up to its parent. Removal is recorded, so the agent will not reappear after a platform restart or after **Sync from AgentSystem**.

To bring the same agent back, create it again from **Agent Workspaces → Add agent** — recreating an agent explicitly clears the removal record.

## A scheduled job never ran

1. Check what you own first:
   - **Scheduled goals** (`/scheduled-goals`) — status must be **active** (not paused/deleted); cadence and local time must match. Use **Run now** or ask the COO. Guide: [28-scheduled-goals.md](./28-scheduled-goals.md).
   - **Generate draft plan** disabled — the selected employee is not the COO. **Save & schedule** instead, or set **Who runs it** to the COO for a nested specialty ladder.
   - Business Discovery ran but CRM stayed empty — Act needs `business_discover` **persist true** and **handoff true**. Wait for the Kanban orphan watcher (~5 min) or Reopen the assigned card (help **04** / **42**). Do not put a lettered **B) CRM Maker** block on a BD schedule.
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

## Tool says rate limit reached

1. Open **Tools → Rate limits**. Check **Used today / Used month** vs **Max / day** and **Max / month** for that tool (your login only).
2. Wait for the next calendar day/month, or click **Day** / **Month** / **Both** to reset actuals (the previous budget vs used is stored in **Audit**).
3. Agents should fall back to **Browser Session** (`browse_task_start` / recipes) or server Playwright — not retry the same API tool in a loop.
4. Per-agent **token** budgets on Efficiency → Agent View are a different cap; this one is API **calls** per tool per CEO.

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
6. Desktop Local worker offline / jobs fail — Connectors shows Offline: run `Start-BrowserWorker.ps1`, check `.env` token + `AGENT_OS_BASE_URL`, firewall outbound HTTPS, optional IP whitelist match.
7. Video Flavour 1 (`flow_browser`) needs worker **Online** and Google signed in **inside the worker window**. Default channel is Chrome (`browser-profile-chrome\`). If Google blocks the window, stop the worker, run `Start-ChromeForGoogleLogin.ps1`, set `BROWSER_CDP_URL=http://127.0.0.1:9222`, then start the worker again. Clips are **≤8s per scene** and **serial** (one scene at a time); assemble with **run video assembly** → status `video_generated` (help **41**).
8. Video Flavour 2 needs vault **`Replicate_BYOK`** (or platform `REPLICATE_API_TOKEN`) and Tools→Model for `generate_video` / `video_media_generate`.
9. Lost sessions after restart — you need headed worker with `BROWSER_USER_DATA_DIR` (re-download package if old ephemeral build); log in again once.
10. Full guide: [22-browser-session-and-recipes.md](./22-browser-session-and-recipes.md); desktop ops [BROWSER-SESSION-DESKTOP-LOCAL.md](../BROWSER-SESSION-DESKTOP-LOCAL.md).

## Google Places / Business Discovery

1. “Places not configured” while you already added **`GOOGLE_PLACES_BYOK`** — Platform default uses the vault key when `GOOGLE_PLACES_API_KEY` is unset. Start a **new chat** so the employee does not reuse old memory. Enable **Places API (New)** on the Google Cloud key. Help **42**.
2. Research table invented from ClinicGeek / Brave — the employee must call **`business_discover`** in that turn. Do not permanently track unless you asked to Track or Act.

## Agent Chat 502 / Unknown model

1. Chat returns **502** with `Unknown model: openai/…` after a gateway recreate — the live model catalog was wiped. **CEOs:** wait for ops; do not invent a new model on Profile.

## Agent Chat queued then fails

1. The AgentSystem gateway lane is full (delegations, goal-plan recovery, scheduled goals). New chat sits in queue and then errors.
2. **CEOs:** wait; do not spam retry. Pause your own scheduled goals if you started a noisy loop.
3. **Admins:** **Admin → AgentSystem recovery** (`/admin/openclaw-recovery`) — OTP unlock (30 min), **Unblock lane** for the CEO, optional gateway restart. Details: [43-admin-agentsystem-recovery.md](./43-admin-agentsystem-recovery.md). You can also pause `delegation_queue` / `scheduled_goals` / `kanban_orphan_watcher` on **Admin → Crons**.

## WhatsApp / Slack “Media failed” or no audio

1. Agents must paste **`MEDIA:/abs/path`** (`paste_exactly` from the tool) on its **own line** so WhatsApp attaches from the shared AgentSystem disk. Auth-only `https://…/api/media/…` links fail without a browser session.
2. Leave ops flag **`MEDIA_PUBLIC_SIGNED`** off unless you deliberately need legacy signed public fetch.
3. For TTS on WhatsApp, the file must be **OGG/Opus, 48 kHz, mono**, sent with MIME **`audio/ogg; codecs=opus`**. The gateway sends all audio as a voice note (PTT); WAV/MP3 PTT shows **Media error**. Platform `speech_tts` dual-writes OGG/Opus for `MEDIA:` paste.
4. Scheduled-goal WhatsApp copies: if the text says a voice note is attached but there is no bubble, the platform extracts `MEDIA:` (own line or markdown) and sends the file as a follow-up voice note. If the employee called the native `message` tool with `target: "whatsapp"` instead of pasting `MEDIA:`, that send fails. Dashboard may have shown **⚠️ ✉️ Message failed** — that is the gateway banner for the failed native send, not a failed web chat. The platform still copies the final reply; the banner is stripped from chat and channel copies.
5. Dashboard blank / broken media — hard-refresh while logged in; players need Bearer. “Open full size” opening a new tab for audio meant an older UI bug (audio should show an inline player).
6. Full delivery rules: [11-content-tools-scripts-profile.md](./11-content-tools-scripts-profile.md), [24-agent-channels.md](./24-agent-channels.md).

## Inbound voice / image not seen by the agent

1. Confirm the agent’s **Channels** row is **enabled** (WhatsApp / Slack).
2. Wait a few seconds for mirror into workspace **`inbound/attachments/`** (AgentSystem stages inbound media first).
3. If the chat shows “[whatsapp attachment unavailable]”, still try the latest file under `inbound/attachments/` with `speech_stt` or the summarize-inbound workflow.
4. Web paperclip uploads always go to Master Data + `inbound/attachments/` for that CEO.

## Voice Call / public widget fails

1. **Call** and `/p/voice/:slug` need an **OpenAI Realtime** key (Profile BYOK or platform OpenAI). OpenRouter, Ollama, and DeepSeek cannot mint live sessions — you get **503** with that message. Help **46**.
2. Browser needs **HTTPS** (or localhost) and microphone permission.
3. Public widget guests may look up FAQs/CRM lists only. Hangup on the widget stores the transcript; it does **not** run CRM wrap-up. Use in-app **Call** as the CEO for wrap-up.
4. Phone numbers are not in this product — that is a later telephony MCP.

## Platform feedback status

1. Ask COO / Platform Help to run **`platform_feedback_enquire`** with the id, or filter by status/category.
2. Admins update status at **Admin → Platform feedback** (`/admin/platform-feedback`): `open` | `implemented` | `rejected` (reject can include a reason).
