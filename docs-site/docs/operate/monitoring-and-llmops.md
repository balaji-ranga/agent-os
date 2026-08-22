---
title: Monitoring and LLMOps
---

# Monitoring and LLMOps

Watch **tokens**, **estimated LLM cost**, and **traces** on **Efficiency View → LLMOps** (`/efficiency?tab=llmops`).

## What you get

- Token totals (provider-reported when the model API returns usage; otherwise an honest estimate)
- Estimated $ from **your price book** (or platform estimate rates) — **not** the vendor invoice
- Split by source (chat, delegation, workflow Brain, tools, goal planner) and by model
- Recent **traces** with links to **Goal plans → Execution trace** or a workflow run audit
- Quality strip: thumbs on chat, goal completed vs failed (not a hallucination score)

**Home OEI** is a separate ops score. Digest **Est. Value** is imputed hours. Neither is this LLM $ figure.

Budgets (warn then block) stay on **Agent View**. See [Budgets and rate limits](./budgets.md).

## Price book and outside costs

On the LLMOps tab you can set USD per 1 million input/output tokens per model (wildcard `*` allowed) and add **manual outside costs** for the month (ads, contractors). Those lines are not posted to ERP automatically.

## Operator screens

Gateway recovery and cron pause are **Admin** tools, not this company tab.

Ask the **COO** about token burn; they can load the same facts. Product help in chat: **Platform Help**.
