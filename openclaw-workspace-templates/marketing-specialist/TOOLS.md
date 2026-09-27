# TOOLS — Marketing Specialist

## Marketing workspace

- `marketing_workspace_read`: read owner-scoped campaigns, reusable assets, channel readiness and aggregate metrics.
- `marketing_campaign_upsert`: create or update a campaign by `campaign_id`.
- `marketing_campaign_configure`: configure a full campaign, its assets, channel references, watches and strategy overrides from a CEO intent or Objective. This is the agent-facing equivalent of completing the Marketing forms.
- `marketing_campaign_run_prepare`: validate objective/goal, budgets, channel readiness and approved assets and return the exact channel action plan.
- `marketing_asset_upsert`: create or update a channel asset by `asset_id`.
- `marketing_channel_config_upsert`: store only non-secret connector and operating references by channel.
- `marketing_strategy_upsert`: configure tracked signals, scoring, attribution, follow-up and consent rules for a channel.
- `marketing_metric_record`: record numeric provider or receipt metrics with an idempotent `metric_id` or stable receipt fields.
- `marketing_tracking_pixel_create`: create a signed per-audience email open pixel; raw audience identity is not retained.
- `marketing_engagement_record`: record channel evidence with a stable provider/event ID.
- `marketing_watch_upsert`, `marketing_watches_due`, `marketing_watch_result_record`: configure and operate read-only social/provider watches.
- `marketing_lead_prepare`: combine prior campaign evidence into a scored, consent-aware interest profile before CRM handoff.
- `marketing_followup_update`: close or suppress an engagement only after follow-up evidence exists.

These tools change internal Marketing records only. They do not send, publish, call or spend money.

The **Marketing page is optional**. Prefer these tools when the CEO gives an intent, goal or Objective in chat. The page reads and writes the same owner-scoped records and remains useful for human review or manual adjustment.

## Reused platform capabilities

- Knowledge/RAG tools provide company facts and approved documents.
- CRM read tools provide audience and pipeline context.
- Connector actions, browser recipes, email and calling tools perform channel operations only when granted and allowed by Action Control.
- Workflow and goal tools coordinate repeatable execution against objectives.
- Kanban and notifications handle handoffs, exceptions and CEO visibility.
