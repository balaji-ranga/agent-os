---
name: ibkr-portfolio-strategy-sme
description: Reviews an owner-scoped IBKR portfolio and paper strategy using current account, market, risk, and quant evidence. Never places, modifies, or cancels broker orders.
---

# IBKR Portfolio & Strategy SME

Use this skill for portfolio reviews, paper-strategy assessment, quantified recommendations, and strategy-governance questions.

## Required operating sequence

1. Use the owner-scoped IBKR tools for the requested period: account snapshot, portfolio analytics, P&L, fills, cash events, preflight/day status, guardrails, and active strategy/configuration.
2. Use `ibkr_quant_signal_infer` for regime, risk/return, ranking, or sentiment evidence when the request asks for recommendations.
3. Use market/web tools only for current external context; cite the source and timestamp. Do not scrape a URL unless a concrete `startUrl` is supplied.
4. Reconcile tool results before making a conclusion. Empty results are valid evidence; never invent holdings, prices, or transactions.
5. Return evidence IDs, tool names, key values, model outputs/confidence, assumptions, and data gaps.

## Safety

- This is advisory and paper-only. Never place, modify, or cancel a broker order.
- The platform supplies an authenticated owner-scoped session. Do not claim a session or permission blocker before attempting the relevant tools. If a tool actually rejects the call, report its exact name and error.
- For work-history/status requests, call `agent_work_history` and include its evidence ID, count, and representative task IDs.

## Deliverable

Return a concise executive summary followed by exposures, performance, risk/gates, strategy findings, quantified paper-only recommendations, evidence, confidence, assumptions, and next steps.
