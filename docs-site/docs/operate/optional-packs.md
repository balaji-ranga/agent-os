---
title: Optional packs
---

# Optional packs

Features you can ignore until you need them.

## Job search pipeline

**Job profiles** and **Job workflows** run a discovery → score → tailor → apply path on Kanban. Set a profile and resume context first. This is separate from the visual **Workflows** builder.

## Business Discovery and social research

**Business Discovery** finds local businesses (places search), researches public web/social, optionally tracks, then **Act** (CRM handoff). **Social Researcher** supports indexed social search. You may need API keys for maps or social in **API Keys** (only fill what you use).

Act with handoff creates Kanban work for CRM Maker — do not duplicate leads blindly.

## IBKR monthly trading

If your company uses the paper/live trading pack: Connectors download a **local bridge**, workflows W1–W5 cover plan vs execute, and **IBKR Summary** shows portfolio and day plans. **Clear data** resets transactional rows and keeps budget variables. W1/W3/W5 run in the cloud on a schedule (cron is the **server timezone**); W2 and the bridge run on your laptop at US open / through the session. W1 picks new buys from the market screener (optional W1 allowlist if you set one — not the legacy paper Maker/Checker workflow). After about a month, use IBKR Summary plus the weekly review to judge P&L and trades.

Treat live trading as high risk. Use Maker/Checker and budgets. This guide does not document brokerage credentials or server layout.

## Video and content creator

See [Content and media](../systems/content-and-media.md).
