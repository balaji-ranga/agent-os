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

## Campaign audiences

In **Marketing → Audience lists**, create reusable distribution lists without depending on CRM. Each entry has a channel destination (email, WhatsApp/phone, or a provider identity/audience reference), consent state/source, and an optional CRM link. Destinations are encrypted at rest and list entries follow the company retention policy.

In **Marketing → Campaigns**, select one or more Marketing distribution lists and optionally add named CRM people, a CRM segment/list reference, or an audience filter. CRM remains useful for enrichment and sales follow-up, but it is not required to run a campaign.

When editing a saved campaign, **Observed run recipients** separately lists recipients proven by send receipts, using a display label and masked destination. This matters when an agent or workflow received email addresses directly at execution time: they were used for that run, but were not silently added to the campaign's planned audience. The campaign portfolio shows planned and observed recipient counts so the difference is visible.

To run a campaign, make it active, approve an asset for each channel, configure the channel, and select **Validate for run**. The validator checks the Objective/goal, budgets, assets, connections, audience destinations and consent. Then open the Marketing Specialist from the result and ask it to run the campaign; every external send or publish still passes Action Control.

For recurring campaigns, describe the desired result to the Marketing Specialist and answer only the missing strategy questions: audience, window, offer, tone, topics, cadence, content volume, budget and stop conditions. The agent saves that strategy and creates one standard Scheduled Goal. Each run rereads current evidence, creates only the next non-duplicate content, uses the configured channel capability, and records its receipt. Manage pause, resume, completion or deletion in **Run & Operate → Scheduled Goals**. Marketing does not add a separate calendar.

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

Legacy email receipts without campaign IDs are inferred only when there is one unambiguous recipient-specific tracking trail and the send falls inside that campaign's lifetime. A historical email to the same address is not attributed to a campaign created later.

- **Email open tracking setup** creates a recipient-specific signed invisible image tag for an HTML email. It is a setup utility, not the report. An image request is an open signal, not guaranteed human reading, because mail clients may proxy, cache or block images.
- WhatsApp uses delivery/read/reply receipts from its connected channel.
- Facebook, LinkedIn and Instagram can use provider APIs or a saved read-only browser recipe tied to the stored campaign asset and live post reference.
- Google Ads uses provider impressions, clicks, lead forms, conversions and spend.
- Telemarketing records connected, interested, callback, qualified and do-not-call outcomes.

## Manage multiple leads and opportunities

Open **Marketing → Leads & follow-up** for the campaign-to-CRM pipeline. The portfolio can contain many lead/opportunity rows from one campaign. The same CRM person can also have several distinct opportunities, while shared prior interests remain visible for next-best-action advice.

Use the filters to narrow by campaign, qualification or follow-up state, then select a row to edit it. CRM people and opportunities, campaigns, channels and engagement evidence are selected from existing records rather than retyped as IDs. Lifecycle stage, contact permission, follow-up state, channel and due date use controlled choices. The correlation panel shows other opportunities for the same person, and the scheduled queue shows due work across the portfolio.

CRM remains the system of record for people and sales pipeline. Marketing stores the CRM references, attribution, privacy-safe evidence, qualification and follow-up plan. Uncertain identity matches are not auto-merged. Qualified, consent-eligible profiles are handed to CRM; suppressions always override score.

Marketing rejects password, token, secret and API-key fields. Do not paste credentials into templates or channel settings.
