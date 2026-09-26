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

Flolah uses the binding exactly. It does not guess an action from prompt keywords.

## Create an event subscription

Choose a provider, event type, and target:

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
- **Invalid webhook secret**: rotate the subscription secret and update the sender.
- **Failed/dead-letter event**: open the inbox error, correct the connector or target, and choose Replay.
- **Approval required**: approve the generated action request or create a bounded Action Control override; replay after approval.
- **Nothing reaches the workflow**: confirm the workflow belongs to the same company, is published, is not paused, and has event triggers enabled.

