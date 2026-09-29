---
title: Company Email channels
---

# Company Email channels

Path: **Connectors → Company channels**.

Connect one CEO company's Gmail or Microsoft 365/Outlook mailbox using OAuth. Save the mailbox, choose the route for non-campaign messages, then **Connect OAuth**, **Test** and **Enable**. The default five-minute poll can also be run immediately with **Sync now**.

This does not create another inbox:

- campaign replies are attributed to the latest eligible send and appear in **Marketing → Leads & follow-up**;
- other messages appear as `email.message.received` in **Connectors → Events & Productivity → Live event inbox**;
- the event subscription can stop at the inbox, run an owner-scoped workflow, or create a goal for an enabled company agent.

OAuth secrets stay in the connector vault. Routing receipts keep provider IDs, a masked sender and route result, but not the message body. Event history follows the CEO profile's data-retention period. External sends and replies remain governed by **Action Control → External messages / publish (R2)**.

For first setup, choose a lookback from one hour to seven days to capture a recent reply. Gmail and Outlook connections are provider-specific: connect the same provider selected for the mailbox.

Related: [Events & Productivity](./event-productivity.md), [Marketing](./marketing.md), and [Connectors and MCP](./connectors-and-mcp.md).
