# Marketing Operations and Marketing Specialist

## What this adds

**Run & Operate → Marketing** (`/marketing`) is the CEO's AI-native marketing control room. It supports:

- objective-linked campaign plans and budgets;
- reusable email templates, social posts, WhatsApp messages, ad copy, creative briefs and telemarketing scripts;
- channel readiness for email, WhatsApp, Facebook, Google Ads, LinkedIn, Instagram and telemarketing;
- campaign metrics, recipient-level email evidence and cross-channel outcome analytics;
- privacy-safe engagement evidence, periodic social/provider watches and follow-up status;
- cross-campaign lead correlation, interest profiles and CRM handoff;
- CRM audience references and Knowledge/RAG context without duplicating those systems.

The page uses tenant-scoped Knowledge tables for campaigns, assets, channels, metrics, engagement events, a generic campaign outcome ledger, watch definitions, effectiveness strategies and lead interest profiles. CRM remains the source of truth for people, companies, consent, segments, leads, opportunities and revenue outcomes.

## Planned audience versus observed recipients

Open **Marketing → Audience lists** to create a reusable distribution list without CRM. Add one entry per channel destination: an email address, WhatsApp/telephone number, provider audience ID, or provider identity/profile reference. Every entry records consent status and source; destinations are encrypted at rest and entries follow the company data-retention policy. A CRM person link is optional.

Open **Marketing → Campaigns** and edit a campaign. Select one or more Marketing distribution lists, optional named CRM people, a CRM filter, or a CRM list/segment. CRM is an enrichment and sales-handoff option, not a prerequisite.

**Observed run recipients** shows privacy-safe recipient evidence captured from completed sends. It can include recipients supplied directly to an agent or workflow at run time even when the original campaign had no saved named audience. Flolah shows the display label and masked destination from the receipt, not a newly copied raw email address. Planned and observed counts are deliberately separate so an operator can see configuration drift.

## Campaign Outcome Ledger and reports

Open **Run & Operate → Marketing → Analytics**, then select a campaign under **Campaign outcome report**. The report shows receipt-backed email sends, unique open signals, open-signal rate, recipient status, per-channel outcome totals and the underlying evidence ledger.

The ledger is generic; each channel keeps its native outcome types:

- email: `send_accepted`, `open_signal`, `link_click`, `reply`, `bounce`, `unsubscribe`;
- WhatsApp: `send_accepted`, `delivered`, `read`, `link_click`, `reply`, `opt_out`;
- Facebook, LinkedIn and Instagram: `published`, `reaction`, `comment`, `share`, `link_click`, `message`, `lead_form`;
- Google Ads: `impression`, `click`, `conversion`, `lead_form`, `spend`;
- telemarketing: `attempted`, `connected`, `interested`, `callback_requested`, `qualified`, `do_not_call`.

Provider webhooks, connector responses, saved browser watches and agents write the evidence through `marketing_campaign_outcome_record`. Campaign-bound `marketing_engagement_record` calls are mirrored into the ledger automatically. The ledger stores a privacy-safe identity hash, optional human-readable CRM/display label and masked destination; it does not store the raw destination as its identity key. Outcome records follow the CEO profile's data-retention period.

For older email tool receipts that did not carry campaign IDs, Flolah reconciles a send only when exactly one recipient-specific tracking trail matches and the send occurred after that campaign/asset/tracking setup and before its open signal. Earlier emails to the same address are not retrospectively attached to a new campaign.

### What “Email open tracking setup” does

This section is a setup utility, not the report. It creates a signed, recipient-specific invisible image tag for an HTML email. When the recipient's mail client or image proxy retrieves the image, Flolah records an `open_signal` in the Campaign Outcome Ledger. Image blocking can miss a real open, and mail proxying/caching can produce a signal without proving that a person read the message.

For a Marketing Specialist send, pass `campaign_id`, the approved `asset_id`, and one recipient per `email_send` action. Flolah adds the recipient-specific pixel when one is not already present, records the send receipt and later joins any open signal to the same privacy-safe recipient row.

## Channel effectiveness

Every supported channel has a configurable strategy defining tracked signals, score weights, attribution window, qualification threshold, follow-up preference and suppression signals:

- Email: delivery, open signal, click, reply, unsubscribe and bounce. A signed 1×1 pixel can supply an open signal, but image proxying/blocking means it is not proof that a human read the message.
- WhatsApp: delivery, read, click, reply and opt-out receipts.
- Facebook, LinkedIn and Instagram: provider receipts when available; otherwise a saved read-only browser recipe periodically compares the live post reference with the stored asset and records reactions, comments, shares, clicks, messages or lead-form signals.
- Google Ads: impressions, clicks, conversions, lead forms and spend from the connected provider.
- Telemarketing: attempted, connected, interested, callback, qualified and do-not-call outcomes.

Engagement and campaign outcome history follow the company profile retention period.

## Leads & follow-up portfolio, prior interests and CRM

Use **Marketing → Leads & follow-up** or `marketing_lead_prepare` to correlate evidence. This is a multi-record portfolio: one campaign may create many lead/opportunity rows, and one CRM person may hold several rows for materially different opportunities. It is not a single lead form.

The page provides campaign, qualification and follow-up filters; a portfolio table; CRM-backed person and opportunity selectors; campaign/channel/evidence multi-selects; lifecycle and contact-permission choices; a dated follow-up queue; and a correlation panel showing the selected person's other opportunities. Marketing stores CRM references and campaign evidence while CRM remains the system of record.

Identity and opportunity are separate:

- the same CRM person and the same need updates an existing opportunity;
- the same CRM person with a materially different need creates a distinct opportunity without duplicating the person;
- uncertain name/handle matches are reported for verification and are never automatically merged.

Select a CRM person and opportunity when they exist. If CRM is unavailable, a consented identity reference can be used temporarily and linked later. Choose campaign and engagement records instead of typing their IDs. Free text is limited to useful narrative context, a specific interest not already suggested, and the next action. Contact permission marked **Denied / opted out** forces suppression regardless of score.

Each portfolio row can carry `lifecycle_stage`, `followup_status`, `followup_channel`, `followup_due_at`, `next_action`, `crm_person_reference`, and `crm_opportunity_reference`. Passing its stable `lead_id` to `marketing_lead_prepare` updates that exact row instead of creating another opportunity.

The Marketing Specialist uses the `marketing-lead-intelligence` skill. It reports prior campaign interests, strongest evidence, consented channel, confidence, duplicate/fatigue/suppression risk and the recommended next action. Qualified eligible leads are created or updated in CRM using the agent's CRM tools, and the returned CRM reference is written back to the Marketing lead profile.

## Hire the Marketing Specialist

1. Open **Company Tools → AI Employees**.
2. Choose **Hire AI employee**.
3. Select the standard **Marketing Specialist** template.
4. Complete the employee setup and review its tool grants.

The template includes Marketing APIs, CRM reads, Knowledge/RAG, objective/goal context, reusable workflow controls, connector discovery/execution, browser recipes, content generation, Kanban, notifications and work-history reporting.

## Agentic setup — the page is optional

The **Marketing page is optional**. A CEO can describe the desired outcome directly to the Marketing Specialist. The agent reads the linked Objective, Knowledge/RAG and CRM context, then uses the same owner-scoped APIs as the page to configure campaigns, assets/templates, channel references, watches and effectiveness strategies.

For a complete setup from chat, the agent asks only for missing decisions such as the outcome, audience, campaign window, channels, offer, tone, topics, cadence, content volume, budget and stop conditions. It then uses `marketing_campaign_configure`. Before any send, publish, call or advertising action it uses `marketing_campaign_run_prepare` to validate the Objective/goal, budgets, enabled channel readiness and approved assets. External effects still run through the existing email, connector, browser-recipe, workflow or calling tools and remain governed by Action Control.

### Recurring campaigns use Scheduled Goals

Flolah does not maintain a second Marketing scheduler. When the agreed strategy is recurring, the Marketing Specialist calls `marketing_campaign_schedule_upsert`. This creates or updates one normal Scheduled Goal owned by that Marketing Specialist and links its ID back to the campaign.

On every scheduled run, the agent rereads the latest campaign, approved assets and outcome evidence; creates only the next non-duplicate content item(s); executes through the configured channel capability; records the receipt and monitoring evidence; and uses the results to adjust the next run. It stops publishing when the campaign ends, its measurable objective is reached, its budget is exhausted, the campaign is paused/completed, policy blocks execution, or another saved stop condition is met.

The CEO manages the schedule only under **Run & Operate → Scheduled Goals**. That existing page is where the CEO can pause, resume, complete or delete it. The campaign page shows the saved strategy and links to Scheduled Goals when a schedule exists; it does not contain a separate calendar.

## Build a campaign

1. In **Marketing → Audience lists**, create reusable manual lists with channel destinations and consent evidence. CRM is optional.
2. In **Marketing → Campaigns**, link the campaign to an objective, choose channels, set outcome and budget, and select Marketing lists and/or CRM audiences.
3. In **Templates & assets**, save approved reusable content. Template variables are JSON and can be filled by a workflow or agent.
4. In **Channels**, select the execution mode and store only a connector, account, sender or recipe reference. Company-page publishing uses this account; advertising can use a provider audience reference.
5. Add OAuth/API credentials under **Connectors**, never in Marketing.
6. Edit the campaign and select **Validate for run**. Resolve every audience, consent, channel, asset, objective and budget blocker.
7. Open the Marketing Specialist from the readiness result and ask it to run the campaign. For a recurring campaign, ask it to schedule the agreed strategy; the resulting entry is managed in **Scheduled Goals**.
8. External sends, posts, calls, ad changes and submissions must pass **Policies → Action control**. Internal campaign/template/config changes do not themselves publish anything.
9. Record provider receipts in the Campaign Outcome Ledger and numeric metrics in campaign metrics. **Analytics** aggregates these observations; CRM remains the source for optional lead and revenue attribution.

## Agent tools

| Tool | Purpose | Risk |
|---|---|---|
| `marketing_workspace_read` | Read campaigns, assets, channel readiness and metrics | R0 |
| `marketing_campaign_upsert` | Create/update internal campaign plans | R1 |
| `marketing_audience_list_upsert` | Create/update a reusable manual distribution list | R1 |
| `marketing_audience_member_upsert` | Add/update one encrypted, consent-tagged channel destination | R1 |
| `marketing_campaign_configure` | Configure a campaign plus assets, channel references, watches and strategies from an intent or Objective | R1 |
| `marketing_campaign_run_prepare` | Validate objective, budget, channels and approved assets before execution | R0 |
| `marketing_campaign_schedule_upsert` | Create/update this agent's recurring campaign in the shared Scheduled Goals scheduler | R1 |
| `marketing_asset_upsert` | Create/update reusable internal assets | R1 |
| `marketing_channel_config_upsert` | Store non-secret channel references/settings | R1 |
| `marketing_strategy_upsert` | Configure evidence, scoring, attribution, consent and follow-up strategy | R1 |
| `marketing_metric_record` | Idempotently record a numeric observation | R1 |
| `marketing_campaign_outcome_record` | Record idempotent channel-specific campaign evidence in the generic outcome ledger | R1 |
| `marketing_tracking_pixel_create` | Create signed email open-signal HTML without storing raw audience identity | R1 |
| `marketing_engagement_record` | Record an attributable channel event | R1 |
| `marketing_watch_upsert` / `marketing_watches_due` / `marketing_watch_result_record` | Configure and operate read-only social/provider monitoring | R1 / R0 / R1 |
| `marketing_lead_prepare` | Create or update one lead/opportunity portfolio row; correlate campaigns and prior interests, score, suppress and schedule CRM follow-up | R1 |
| `marketing_followup_update` | Close or suppress follow-up with evidence | R1 |

Publishing is deliberately separate. The specialist must use the specific `email_send`, connector action, browser recipe, advertising or calling tool. Those tools keep their own grants and Action Control classification.

## Security and tenancy

- Every Marketing API resolves the authenticated company owner; a body-supplied owner ID is not accepted.
- Agent tool calls resolve the owner from the authenticated tool session.
- Marketing rejects configuration keys that look like passwords, tokens, secrets or API keys.
- Knowledge tables are company scoped. Another company cannot see or update them.
- Connector credentials remain in the existing secret store and are referenced by identifier only.
