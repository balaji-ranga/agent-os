# Event & Productivity Pack v1 — implementation reference

Status: implemented in source. This pack is generic infrastructure; provider-specific action IDs are configured as owner-scoped bindings rather than embedded in code.

## Outcome

Flolah can receive calendar, file, document, spreadsheet, Slack, and Teams events, normalize them into a durable owner-scoped inbox, and then:

- retain the event for an agent to read;
- start a published event-enabled workflow owned by the same company; or
- start a durable goal plan with the normalized event in its context.

Agents run productivity operations through exact bindings to the existing OpenConnector runtime. The flow is:

`provider event → webhook secret check → normalized inbox → dedupe/filter → workflow or goal → Action Control → exact connector action → receipt → optional verification`

## Connectors factored into v1

| Family | Connector applications | Read examples | Write examples |
|---|---|---|---|
| Google Workspace | Google Calendar, Drive, Docs, Sheets | list events, find slots, file search, document/sheet read | create/update/cancel event, create/update/comment document, sheet write |
| Microsoft 365 | Outlook Calendar, OneDrive, SharePoint, Word, Excel | list events, find slots, file search, document/sheet read | create/update/cancel event, Word/Excel write/comment |
| Slack | Slack | search messages, get thread | send or reply |
| Microsoft Teams | Teams | search/read thread | send or reply |

OpenConnector action IDs can change between connector releases. Therefore the platform does not guess or hardcode them. A CEO selects the precise `app_id`, `action_id`, optional `connection_name`, and optional verification action in **Connectors → Events & Productivity**.

## Action Control

- R0/read: capability discovery, calendar/list/free-busy, file search/metadata, document/spreadsheet reads, message search/thread.
- R1/write_internal: create/update internal documents and spreadsheets.
- R2/communicate_external: calendar actions that invite or notify people, comments, Slack/Teams send/reply.
- R3: not exposed in v1. Destructive file/account/payment operations are not part of this pack.

Policy overrides and approval grants use the existing platform Action Control middleware. The pack does not implement a bypass.

## Event contract

Create a subscription in the UI. The secret is returned once and stored only as a SHA-256 hash. Send JSON to:

`POST /api/event-productivity/webhooks/{subscription_id}`

Header: `X-Flolah-Event-Secret: {secret}`

Example body:

```json
{
  "provider_event_id": "provider-stable-id",
  "event_type": "calendar.event.changed",
  "subject_type": "calendar_event",
  "subject_id": "provider-event-id",
  "occurred_at": "2026-09-26T09:00:00Z",
  "payload": { "calendar_id": "primary", "change_type": "updated" }
}
```

Filters are structured exact matches such as `payload.calendar_id = primary`; no keyword-based routing or executable expressions are used. A provider event ID is the idempotency key. When absent, a deterministic content hash is used.

## Storage and privacy

- Every row has `owner_user_id`; target workflows must have the same owner.
- Connector OAuth tokens remain in the existing connector runtime and are never copied into event tables.
- Webhook secrets are hashed; they are displayed only at creation/rotation.
- Action receipts store request key names and byte counts, a minimal response summary, resource ID, and verification state—not full document/message bodies.
- Completed/dead-letter events and terminal receipts follow the CEO profile data-retention policy.

## Test strategy

1. Deterministic harness: fake connector executor, provider payload fixtures, owner A/B isolation, invalid secret, structured filter, duplicate delivery, retry/dead-letter, exact binding, action idempotency, risk metadata, retention.
2. Provider contract test: a fake Calendar/Drive/Graph/Slack service checks request and response mappings without external accounts.
3. VPS read-only integration: after OAuth is connected, list calendars/events, search a uniquely named test file, read metadata/content, and search a test message. Record no secrets or content in logs.
4. Live write validation, only when explicitly authorized: create a uniquely prefixed temporary event/document/sheet/message, verify it through the configured read action, and delete/clean it up using a separately authorized path. R2 actions must demonstrate approval-required and approved-override cases.

If OAuth is unavailable, report that live-provider validation is pending. A stub/harness pass must never be described as live connector validation.

## Operations

- Retry cron: `EVENT_PRODUCTIVITY_RETRY_CRON`, default every minute.
- Five failed attempts move an event to `dead_letter`.
- UI shows subscriptions, connected-app count, bindings, recent events/errors, replay/acknowledge controls, and receipts.
- The cron is visible to Admin with the other platform crons and can be paused as a kill switch.

## Automated command

```bash
docker compose -f deploy/docker-compose.yml exec -T backend npm run test:event-productivity-pack
```

Frontend validation:

```bash
docker compose -f deploy/docker-compose.yml exec -T frontend npm run build
```
