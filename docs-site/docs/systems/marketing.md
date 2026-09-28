---
title: Marketing operations
---

# Marketing operations

Open **Run & Operate → Marketing** to coordinate multi-channel work without creating another disconnected customer database.

## What lives here

- Campaign plans linked to objectives, budgets and CRM audience references
- Reusable email templates, social content, WhatsApp copy, ad copy, creative briefs and call scripts
- Channel readiness for email, WhatsApp, Facebook, Google Ads, LinkedIn, Instagram and telemarketing
- Campaign metrics, recipient-level email status and a generic cross-channel Campaign Outcome Ledger
- Channel effectiveness strategies, attributable engagement evidence and follow-up status
- Cross-campaign interest profiles linked to CRM people and opportunities

The records are stored in your company-scoped Knowledge tables. CRM remains the source of truth for people, companies, consent, pipeline and revenue.

## Hire the AI Marketing Specialist

Go to **Company Tools → AI Employees → Hire AI employee** and select **Marketing Specialist**. The standard template can read Marketing, CRM and Knowledge; plan against objectives; coordinate workflows; and use granted connectors or browser recipes.

Planning is not publishing. External email, social posts, WhatsApp messages, ad changes and calls use separate channel tools and remain governed by **Policies → Action control**.

## Connect a channel safely

1. Add OAuth or API credentials in **Connectors**.
2. In **Marketing → Channels**, save only the connector ID, provider account/page reference, sender or browser recipe name, readiness and non-secret options.
3. Create an approved reusable asset.
4. Run the company’s reusable campaign workflow or ask the Marketing Specialist to execute it.
5. Confirm the provider receipt and record outcomes under **Analytics**.

## Track effectiveness and prepare follow-up

Open **Marketing → Analytics → Campaign outcome report** and select a campaign. The report shows receipt-backed email sends, unique open signals, open-signal rate, recipient status, per-channel totals and the evidence ledger.

The ledger keeps channel-native outcomes rather than forcing every channel into email terminology. Email contributes send/open/click/reply/bounce evidence; WhatsApp contributes sent/delivered/read/reply/opt-out evidence; social channels contribute publish/reaction/comment/share/message/lead evidence; ads contribute impression/click/conversion/spend; and telemarketing contributes attempted/connected/interested/qualified/do-not-call outcomes. Records follow your company data-retention policy.

- **Email open tracking setup** creates a recipient-specific signed invisible image tag for an HTML email. It is a setup utility, not the report. An image request is an open signal, not guaranteed human reading, because mail clients may proxy, cache or block images.
- WhatsApp uses delivery/read/reply receipts from its connected channel.
- Facebook, LinkedIn and Instagram can use provider APIs or a saved read-only browser recipe tied to the stored campaign asset and live post reference.
- Google Ads uses provider impressions, clicks, lead forms, conversions and spend.
- Telemarketing records connected, interested, callback, qualified and do-not-call outcomes.

The Marketing Specialist correlates these events with the CRM person. The same person can have multiple opportunities, while prior campaign interests remain available for next-best-action advice. Uncertain identity matches are not auto-merged. Qualified, consent-eligible profiles are handed to CRM; suppressions always override score.

Marketing rejects password, token, secret and API-key fields. Do not paste credentials into templates or channel settings.
