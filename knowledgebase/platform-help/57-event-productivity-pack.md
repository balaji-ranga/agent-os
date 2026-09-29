# Events, calendars, documents, spreadsheets, Slack, and Teams

Use **Connectors → Events & Productivity** when an agent or workflow should react to an external event or work with productivity data through a connected account.

## What it does

The pack receives provider events in one durable inbox. A subscription can keep an event in the inbox, start one of your published event-enabled workflows, or create a durable goal plan for the COO/selected agent. Duplicate provider deliveries are ignored safely.

Available capability families are Google Workspace (Calendar, Drive, Docs, Sheets), Microsoft 365 (Outlook Calendar, OneDrive, SharePoint, Word, Excel), Slack, and Microsoft Teams. The required account must first be connected under **Connectors → OpenConnector**.

## Configure an action

1. Connect the application under **Connectors → OpenConnector**.
2. Discover its action and copy the exact app/action ID.
3. Open **Events & Productivity → Capability binding**.
4. Select the semantic operation, provider, app ID, action ID, and connection name when needed.
5. For writes, add a read/get action as the verification action when the provider offers one.

**App ID** and **Action ID** are picklists rather than free text. App ID shows compatible applications connected for your company through OpenConnector. After you select an app, Action ID shows the actions that connector reports as supported. The optional verification-action picklist uses the same live catalog.

Compatibility is checked for both the provider and the selected operation. For example, an Outlook **mail** connection is not offered for `calendar_list_events`; that capability requires a connected app that actually publishes calendar actions, such as `outlook_calendar`. Flolah rejects an action ID from a different app instead of allowing a semantically incorrect binding.

The capability is the stable intent an agent or workflow requests, such as `calendar_list_events`. The binding is the company-owned routing rule from that intent and provider to an exact connector action. At run time Flolah resolves the owner-scoped binding, applies Action Control, executes only the selected action, suppresses a retry with the same idempotency key, and stores an action receipt. Flolah does not guess an App ID or Action ID from prompt keywords.

## Create an event subscription

Choose a provider, event type, and target. **Event type** is a provider-aware dropdown so the subscription always uses a canonical supported trigger. Changing the provider refreshes the choices; arbitrary free-text event names and unsupported provider/event combinations are rejected by the API.

Google Workspace and Microsoft 365 support email received, calendar created/changed/cancelled, and file created/changed/deleted triggers. Slack and Microsoft Teams support message created/updated/flagged and reaction-added triggers.

- **Inbox only** lets agents inspect and acknowledge it.
- **Workflow** needs a workflow ID owned by your company; the workflow must be published and event-enabled.
- **Goal** starts a durable goal plan. You can use `{{event_id}}` and `{{event_type}}` in the prompt template.

Copy the webhook secret when shown. It is not displayed again; rotate it if lost. Configure the provider/bridge to POST to the displayed webhook URL with `X-Flolah-Event-Secret`.

## Guardrails

Reads/searches are R0. Internal document and spreadsheet writes are R1. Calendar invitations, comments, and Slack/Teams sends are R2 external communications and follow **Policies → Action control**, including approval or scoped overrides. Destructive and financial actions are outside this pack.

## Testing a calendar or document connector

Start read-only: list a small date window or search a uniquely named test document, then read its metadata. For an authorized write test, create a temporary uniquely prefixed item and configure a verification action to read it back. Clean up only through an explicitly permitted action. Without a connected OAuth account, Flolah can validate the adapter contract but cannot claim the provider was tested live.

## Troubleshooting

- **No enabled binding**: configure the exact operation/provider binding.
- **No compatible app is listed**: the connected account does not publish actions for that operation. Connect the matching calendar/file/document app; do not bind an unrelated mail action as a workaround.
- **Agent has many tool grants**: Flolah keeps the grants but sends a bounded, request-relevant tool subset to the model for that chat turn. This prevents provider tool-count limits without permanently removing employee access.
- **Invalid webhook secret**: rotate the subscription secret and update the sender.
- **Failed/dead-letter event**: open the inbox error, correct the connector or target, and choose Replay.
- **Approval required**: approve the generated action request or create a bounded Action Control override; replay after approval.
- **Nothing reaches the workflow**: confirm the workflow belongs to the same company, is published, is not paused, and has event triggers enabled.
