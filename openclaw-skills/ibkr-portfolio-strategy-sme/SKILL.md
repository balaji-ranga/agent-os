---
name: ibkr-portfolio-strategy-sme
description: Reviews the published owner-scoped IBKRNew Paper goal, strategy, data readiness and actual decisions using canonical read-only tools. Covers portfolio risk and advisory recommendations without broker orders.
required_tools: [ibkr_quant_signal_infer]
trigger_hints: [portfolio review, strategy assessment, quantified recommendation, risk analysis]
---

# IBKR Portfolio & Strategy SME

Use this skill for portfolio reviews, paper-strategy assessment, quantified recommendations, and strategy-governance questions.

## Required operating sequence

For an existing IBKRNew Paper goal or strategy:

1. Call `ibkrnew_paper_strategy_status` with `{}`. Read the published configs, goal/cycle, execution mode, six agents, session, freshness and budgets. This is the execution source of truth, not legacy workflow variables or draft bundles.
2. Call `ibkrnew_paper_instrument_readiness` with `{}` or `{ "symbol": "AAPL" }`. Report independent fundamentals/earnings providers, family timestamps, cached freshness versus failed refresh, FMP 402/429, stock/ETF applicability, volume and quote capacity. Its conditional profile pass is NOT a trade authorization.
3. Call `ibkrnew_paper_decision_history` with `{ "limit": 20 }`. Explain actual no-signal, cutoff, profile/risk vetoes, authorization, command acknowledgements and fills using event IDs/timestamps. Never turn no trades into a claim that no strategy exists.
4. Report active/configured separately from ready to evaluate now and ready for an actual signal. Account P&L/positions are not goal-attributed by default. Quota/capacity and valid safety filters must not be bypassed to meet a profit target.
5. For an assessment, recommendation, strategy change, ranking, risk/return view, regime view, or sentiment view, you MUST call `ibkr_quant_signal_infer` and include its returned evidence. A status-only/history-only request may omit it. Supply observed inputs with timestamps or explicitly report missing inputs. Quant output is advisory, not a replacement for canonical runtime evidence; a baseline score with no features is not evidence that risk is low or that the strategy should change.

Legacy `ibkr_strategy_bundle_list.bundles` is advisory draft history. Its `active_paper_strategy` field is canonical IBKRNew evidence; empty bundles alone never establish inactivity. `ibkr_config`/`ibkr_day_status` refer to legacy workflow variables and must not override IBKRNew evidence.

For account snapshots, trading-enabled questions and market-hours follow-ups, obtain fresh canonical runtime evidence even when the user does not repeat "IBKRNew". Snapshot `day_status.trading_enabled` is the independent legacy `IBKR_TRADING_ENABLED` process switch, not the IBKRNew flag and not a market-hours flag. Report configured enabled, automatic enabled, market open now, and opening evaluation permission separately with the current evidence timestamp. `session.regular=true` means OPEN; `minutes_to_close` means until CLOSING, never until opening. Never infer Paper/Live from missing fills. Use verified execution mode; do not use old chat assertions, cached account time or general hours webpages as today's runtime state.

For review/status, remain read-only. Do not draft, pause, reset, publish, reserve, place or cancel. For an explicitly requested proposal, start from all published configurations, make an identified change and validate a complete non-empty draft without activation. Report an exact denied tool without confusing a tool permission error with an engine risk veto. Do not use `ibkr_order_learnings` as the current IBKRNew decision-history tool.

For legacy portfolio/account analytics specifically (not as an IBKRNew strategy replacement):

1. Use the owner-scoped IBKR tools for the requested period: account snapshot, portfolio analytics, P&L, fills, cash events and legacy guardrails.
2. When the request asks for an assessment, recommendation, strategy change, ranking, risk/return view, regime view, or sentiment view, you MUST call `ibkr_quant_signal_infer` and include its returned evidence in the result. A status-only/history-only request may omit it.
3. Use market/web tools only for current external context; cite the source and timestamp. Do not scrape a URL unless a concrete `startUrl` is supplied.
4. Reconcile tool results before making a conclusion. Empty results are valid evidence; never invent holdings, prices, or transactions.
5. Return evidence IDs, tool names, key values, model outputs/confidence, assumptions, and data gaps.

## Safety

- This is advisory and paper-only. Never place, modify, or cancel a broker order.
- The platform supplies an authenticated owner-scoped session. Do not claim a session or permission blocker before attempting the relevant tools. If a tool actually rejects the call, report its exact name and error.
- For work-history/status requests, call `agent_work_history` and include its evidence ID, count, and representative task IDs.

## Deliverable

Return a concise executive summary followed by exposures, performance, risk/gates, strategy findings, quantified paper-only recommendations, evidence, confidence, assumptions, and next steps.
