# Content creator ops (publish, community, ops rollup)

## Quick answers (Platform Help / CEO FAQ)

**What is Company Operate?** After Company setup (or from the operate page), Flolah can provision day-to-day operate workflows and goals for packs such as **content_creator** — content production, social publish, comment ingest, community triage, and a weekly ops rollup.

**How do I post to Facebook?** Connect **Facebook** under **Connectors → MCPs** (platform server `mcp-meta-graph`). Graph API can post to a **Facebook Page** you manage — not a personal profile timeline. Use a **Page ID** from Graph (`/me/accounts` or Page settings), not the numeric id in a personal `profile.php?id=…` URL.

Full MCP / OAuth / App ID setup (admin platform defaults, optional CEO App ID override, callback URL): **[31-mcp-connectors-oauth.md](./31-mcp-connectors-oauth.md)**.

**Where do I put `page_id`?** In the **content production / publish workflow run input** (or in the weekly COO content goal text if your graph reads it from the trigger). There is no separate Channel Publisher goal field just for `page_id`.

**Does social publish use OpenConnector?** Facebook Page posts use an **MCP tool** node (`mcp-meta-graph`, e.g. `create_page_post`). LinkedIn (and similar) may use **OpenConnector** when that connector is linked. Browser Session is for browser automation paths, not the default Meta Graph path.

OpenConnector SaaS setup (GitHub, Gmail, LI when certified, Connector node): see **OpenConnector** sections in [16-connectors-openconnector.md](./16-connectors-openconnector.md) and operator detail [OPENCONNECTOR-WEBHOOKS.md](../OPENCONNECTOR-WEBHOOKS.md).

**Who publishes?** After CEO approval on the production loop, **Channel Publisher** (or the publish workflow) runs **`content-publish-social`**. The agent needs tool grant **`agent_workflow_trigger`** (and related enquire/runs tools) so it can start that workflow.

**How do comments get triaged?** Workflow **`content-comments-ingest`** (chat: **sync social comments**) pulls comments via MCP into Master Data **`comment_inbox`**. Community Manager runs **community triage** (chat: **run community triage**) — drafts, Kanban **CEO approval** for replies, optional `notify_ceo` on escalations.

**Does the Ops Reporter email me?** **No.** The weekly **Ops Reporter** scheduled goal and **operate → Weekly ops rollup** workflow call **`notify_ceo`**, which fills the **in-app bell** only. Outbound email needs separate `email_send` / SMTP (Brevo) setup and is not the default ops rollup path.

**How do I run ops rollup now?** **Scheduled goals → Run now** on **Weekly ops rollup for CEO**, chat Ops Reporter, or chat workflow phrases: **run ops rollup**.

## Roles (content_creator pack)

| Role | Job |
|------|-----|
| **COO** | Holds weekly content goals; **triggers** production / operate workflows; can probe with tools |
| **Content Strategist / Media / Reviewer** | Draft and review in the production loop |
| **Channel Publisher** | Triggers **`content-publish-social`** after approval; MCP/OpenConnector publish |
| **Community Manager** | Inbox triage, draft replies, CEO gate for public replies |
| **Ops Reporter** | Weekly rollup of pipeline / goals / connectors — **`notify_ceo` (bell)** |

## Workflows and chat phrases (typical)

| Workflow | Phrase / trigger | Outcome |
|----------|------------------|---------|
| Content production loop | **run content production** | Drafts → review → CEO approval → publisher path |
| `content-publish-social` | Started by Channel Publisher / trigger | Page post (FB MCP) and/or other channels |
| `content-comments-ingest` | **sync social comments** | Comments into `comment_inbox` |
| Community triage operate | **run community triage** | Drafts + CEO approval tasks |
| Weekly ops rollup | **run ops rollup** / scheduled goal | Rollup text + **bell** via `notify_ceo` |

Exact names can be prefixed with `Operate — ` and include your CEO id. List published graphs under **Workflows**.

## Facebook (Meta Graph MCP) — CEO steps

1. Admin/operator has set Meta **App ID** + **App Secret** on the platform (`FACEBOOK_APP_*` or Connectors MCPs admin config). Optional: set **your own** App ID/secret under **App ID / secret override** ([31](./31-mcp-connectors-oauth.md)).
2. Open **Connectors → MCPs → Facebook** / Meta Graph → **Connect** and finish OAuth.
3. In Meta Developer portal, enable the Page use case (**Manage everything on your Page** or equivalent) and mark required permissions **Ready for testing** (e.g. `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`, `business_management` as your app needs).
4. Confirm you have a **Page** the app can act on; note its **Page ID**.
5. Run content production; when publishing, supply `page_id` + post body in run input as the workflow expects.

Development-mode apps only work for app Admin/Tester roles. Meta "API access blocked" is an app restriction — not Flolah deleting posts.

## LinkedIn and other channels

- **LinkedIn** via **OpenConnector** when that connection is active under Connectors → OpenConnector ([16](./16-connectors-openconnector.md)).
- Readiness is **honest fail-closed**: if a connector is not linked, Channel Publisher / MCP tools should **not** invent a successful post.

## CEO approvals

- **Kanban → waiting you** for draft content and sensitive community replies.
- Approve with a clear decision; production graphs may pass an **approved content summary** into the publisher leg.
- After approval, ensure **Channel Publisher** is allowed to **trigger** the publish workflow.

## Scheduled goals for content ops

Typical perpetual goals after operate seed:

| Title (example) | Agent | Cadence | Delivery |
|-----------------|-------|---------|----------|
| Weekly content / topic brief | COO or produce path | Weekly | Production loop |
| Community triage | Community Manager | As configured | Kanban + optional bell |
| **Weekly ops rollup for CEO** | **Ops Reporter** | e.g. Mon 09:00 local | **Bell (`notify_ceo`), not email** |

Manage under **Scheduled goals** ([28-scheduled-goals.md](./28-scheduled-goals.md)). **Run now** to test.

## Operator notes (deploy)

- Compose profile **`optional-meta-graph-mcp`** → service **`meta-graph-mcp`**. Seed: `node backend/scripts/seed-meta-graph-mcp.js`.
- **`deploy/scripts/ensure-platform-mcps.sh`** (from `up.sh` / `vps-deploy-latest.sh`) starts Brave + Meta Graph platform MCPs and seeds registry (`is_platform=1`).
- Smoke: `deploy/scripts/vps-smoke-meta-graph-mcp.sh`.
- Optional seed owner after deploy: `SEED_CONTENT_MEDIA_OWNER=<ceo-user-id>` for `content-publish-social` + comments ingest.
- Full day-0/1 content ops helper: `backend/scripts/complete-content-ops-pipeline.js` (operator tooling).
- Requires **`USER_API_KEYS_KEK`** for encrypted OAuth app secrets and vaulted tokens ([31](./31-mcp-connectors-oauth.md)).

## Related

- MCP OAuth / Facebook setup: [31-mcp-connectors-oauth.md](./31-mcp-connectors-oauth.md)
- Connectors page (OpenConnector + MCPs overview): [16-connectors-openconnector.md](./16-connectors-openconnector.md)
- MCP registry: [08-mcp-integrations.md](./08-mcp-integrations.md)
- Scheduled goals: [28-scheduled-goals.md](./28-scheduled-goals.md)
- Notify vs email: [04-kanban-standups-broadcast.md](./04-kanban-standups-broadcast.md), [21-external-tools-and-apis.md](./21-external-tools-and-apis.md)
- Company setup packs: [29-company-setup.md](./29-company-setup.md)
- Design amendment (engineers): [AMENDMENT-CONTENT-MEDIA-API-PUBLISH.md](../AMENDMENT-CONTENT-MEDIA-API-PUBLISH.md)
