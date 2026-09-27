# Marketing Operations and Marketing Specialist

## What this adds

**Run & Operate → Marketing** (`/marketing`) is the CEO's AI-native marketing control room. It supports:

- objective-linked campaign plans and budgets;
- reusable email templates, social posts, WhatsApp messages, ad copy, creative briefs and telemarketing scripts;
- channel readiness for email, WhatsApp, Facebook, Google Ads, LinkedIn, Instagram and telemarketing;
- campaign metrics and channel-level analytics;
- privacy-safe engagement evidence, periodic social/provider watches and follow-up status;
- cross-campaign lead correlation, interest profiles and CRM handoff;
- CRM audience references and Knowledge/RAG context without duplicating those systems.

The page uses tenant-scoped Knowledge tables for campaigns, assets, channels, metrics, engagement events, watch definitions, effectiveness strategies and lead interest profiles. CRM remains the source of truth for people, companies, consent, segments, leads, opportunities and revenue outcomes.

## Channel effectiveness

Every supported channel has a configurable strategy defining tracked signals, score weights, attribution window, qualification threshold, follow-up preference and suppression signals:

- Email: delivery, open signal, click, reply, unsubscribe and bounce. A signed 1×1 pixel can supply an open signal, but image proxying/blocking means it is not proof that a human read the message.
- WhatsApp: delivery, read, click, reply and opt-out receipts.
- Facebook, LinkedIn and Instagram: provider receipts when available; otherwise a saved read-only browser recipe periodically compares the live post reference with the stored asset and records reactions, comments, shares, clicks, messages or lead-form signals.
- Google Ads: impressions, clicks, conversions, lead forms and spend from the connected provider.
- Telemarketing: attempted, connected, interested, callback, qualified and do-not-call outcomes.

Engagement history follows the company profile retention period.

## Leads, prior interests and CRM

Use **Marketing → Leads & follow-up** or `marketing_lead_prepare` to correlate evidence. Identity and opportunity are separate:

- the same CRM person and the same need updates an existing opportunity;
- the same CRM person with a materially different need creates a distinct opportunity without duplicating the person;
- uncertain name/handle matches are reported for verification and are never automatically merged.

The Marketing Specialist uses the `marketing-lead-intelligence` skill. It reports prior campaign interests, strongest evidence, consented channel, confidence, duplicate/fatigue/suppression risk and the recommended next action. Qualified eligible leads are created or updated in CRM using the agent's CRM tools, and the returned CRM reference is written back to the Marketing lead profile.

## Hire the Marketing Specialist

1. Open **Company Tools → AI Employees**.
2. Choose **Hire AI employee**.
3. Select the standard **Marketing Specialist** template.
4. Complete the employee setup and review its tool grants.

The template includes Marketing APIs, CRM reads, Knowledge/RAG, objective/goal context, reusable workflow controls, connector discovery/execution, browser recipes, content generation, Kanban, notifications and work-history reporting.

## Agentic setup — the page is optional

The **Marketing page is optional**. A CEO can describe the desired outcome directly to the Marketing Specialist. The agent reads the linked Objective, Knowledge/RAG and CRM context, then uses the same owner-scoped APIs as the page to configure campaigns, assets/templates, channel references, watches and effectiveness strategies.

For a complete setup from chat, the agent uses `marketing_campaign_configure`. Before any send, publish, call or advertising action it uses `marketing_campaign_run_prepare` to validate the Objective/goal, budgets, enabled channel readiness and approved assets. External effects still run through the existing email, connector, browser-recipe, workflow or calling tools and remain governed by Action Control.

## Build a campaign

1. In **Marketing → Campaigns**, link the campaign to an objective, choose channels, set outcome and budget, and reference a CRM segment/filter.
2. In **Templates & assets**, save approved reusable content. Template variables are JSON and can be filled by a workflow or agent.
3. In **Channels**, select the execution mode and store only a connector, account, sender or recipe reference.
4. Add OAuth/API credentials under **Connectors**, never in Marketing.
5. Use one reusable multi-channel workflow or the Marketing Specialist to select the correct asset and channel action.
6. External sends, posts, calls, ad changes and submissions must pass **Policies → Action control**. Internal campaign/template/config changes do not themselves publish anything.
7. Record provider receipts and numeric metrics. **Analytics** aggregates these observations; CRM remains the source for lead and revenue attribution.

## Agent tools

| Tool | Purpose | Risk |
|---|---|---|
| `marketing_workspace_read` | Read campaigns, assets, channel readiness and metrics | R0 |
| `marketing_campaign_upsert` | Create/update internal campaign plans | R1 |
| `marketing_campaign_configure` | Configure a campaign plus assets, channel references, watches and strategies from an intent or Objective | R1 |
| `marketing_campaign_run_prepare` | Validate objective, budget, channels and approved assets before execution | R0 |
| `marketing_asset_upsert` | Create/update reusable internal assets | R1 |
| `marketing_channel_config_upsert` | Store non-secret channel references/settings | R1 |
| `marketing_strategy_upsert` | Configure evidence, scoring, attribution, consent and follow-up strategy | R1 |
| `marketing_metric_record` | Idempotently record a numeric observation | R1 |
| `marketing_tracking_pixel_create` | Create signed email open-signal HTML without storing raw audience identity | R1 |
| `marketing_engagement_record` | Record an attributable channel event | R1 |
| `marketing_watch_upsert` / `marketing_watches_due` / `marketing_watch_result_record` | Configure and operate read-only social/provider monitoring | R1 / R0 / R1 |
| `marketing_lead_prepare` | Correlate prior interests, score, suppress and prepare CRM follow-up | R1 |
| `marketing_followup_update` | Close or suppress follow-up with evidence | R1 |

Publishing is deliberately separate. The specialist must use the specific `email_send`, connector action, browser recipe, advertising or calling tool. Those tools keep their own grants and Action Control classification.

## Security and tenancy

- Every Marketing API resolves the authenticated company owner; a body-supplied owner ID is not accepted.
- Agent tool calls resolve the owner from the authenticated tool session.
- Marketing rejects configuration keys that look like passwords, tokens, secrets or API keys.
- Knowledge tables are company scoped. Another company cannot see or update them.
- Connector credentials remain in the existing secret store and are referenced by identifier only.
