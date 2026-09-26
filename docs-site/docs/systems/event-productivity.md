---
title: Events and productivity
sidebar_position: 12
---

# Events and productivity

**Connectors → Events & Productivity** turns calendar, file, document, spreadsheet, Slack, and Teams changes into governed Flolah work.

The generic flow is:

`provider event → durable inbox → workflow or goal → policy check → connector action → receipt and verification`

Connect Google Workspace, Microsoft 365, Slack, or Teams under **OpenConnector**, then bind each semantic operation to an exact connector action ID. Exact bindings prevent agents from guessing an external action from keywords.

Subscriptions can retain an event for inspection, start a published event-enabled workflow owned by your company, or start a durable goal plan. The webhook secret is displayed once and stored only as a hash.

Reads and searches are R0. Internal document/spreadsheet writes are R1. Calendar invitations, external comments, and Slack/Teams sends are R2 and follow Action Control approval and scoped overrides. The pack does not expose destructive or financial operations.

For testing, begin with a narrow read-only calendar range or a uniquely named document search. Live provider validation requires the matching OAuth account. A fixture/harness result validates Flolah's contract but is not a claim that Google or Microsoft was tested live.

Failed events retry with bounded backoff. After five attempts they remain in the owner-scoped dead-letter inbox, where the error can be corrected and the event replayed. Completed history and receipts follow the user's retention setting.
