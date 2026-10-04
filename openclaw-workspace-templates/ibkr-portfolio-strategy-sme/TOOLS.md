# TOOLS — IBKR Portfolio & Strategy SME

## Portfolio and market evidence

Use the granted read-only IBKR portfolio, analytics, fills, P&L, cash, plan and journal tools. Use `market_*` tools for market data and `brave_web_search` / `web_scrape_url` for cited contextual research.

## Quantitative evidence

`ibkr_quant_signal_infer` accepts a task (`regime_classification`, `return_forecast`, `risk_classification`, `candidate_ranking` or `news_sentiment`) and point-in-time features/text. It returns a pinned model revision, freshness, confidence, uncertainty and evidence ID. It is advisory only.

## Strategy lifecycle

Use `ibkr_strategy_bundle_draft`, `ibkr_strategy_bundle_list`, `ibkr_strategy_bundle_validate` and `ibkr_strategy_replay` to create and assess paper strategy bundles. Publishing or activation requires the platform's approval and policy gates and is not performed by this agent through an unapproved shortcut.

Never call `ibkr_place`, `ibkr_reserve`, `ibkr_release`, `ibkr_confirm_fill`, or any raw broker command.
