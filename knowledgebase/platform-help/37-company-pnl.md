# Company P&L (cost & income) — design roadmap

**Status: design roadmap.** Full automated company P&L is **not fully shipped**. This guide is so Platform Help can answer “how will I measure run cost and income?” without inventing live screens that do not exist yet.

Canonical engineering/product plan: repo `knowledgebase/AUTOMATED-PNL.md`.

## What you can measure today

| Area | Where | Notes |
|------|--------|--------|
| **LLM tokens & budgets** | Efficiency → Agent View; department budgets | Durable `token_usage`; warn-then-block on token/error budgets — see [18-agent-budgets-and-org-members.md](./18-agent-budgets-and-org-members.md) |
| **BYOK vs platform models** | Profile + **API Keys** | You pay provider keys under BYOK; platform default is separate — [15-api-keys-vault.md](./15-api-keys-vault.md) |
| **CRM pipeline** | **CRM** (Twenty when enabled) | People, companies, opportunities/deals — [32-business-core-crm-erp.md](./32-business-core-crm-erp.md) |
| **ERP books** | **ERP** (ERPNext when enabled) | General ledgers and invoices live in ERP when profile-bound — same **32** guide |
| **IBKR P&L** | **IBKR Summary** | Fills / realized metrics for trading workflows — [20-ibkr-monthly-trading.md](./20-ibkr-monthly-trading.md). Paper ≠ company success books by default |
| **Ops score (not money)** | **Home OEI** | Operating effectiveness 0–100 — [36-operational-effectiveness.md](./36-operational-effectiveness.md). Not revenue |
| **Digest agent rates** | This Week / Digest explain | Imputed “AI hourly” management estimates — **not** CRM invoices or cash income |

## What automated P&L will add (target)

Three layers:

1. **Facts** — usage meters (tokens, media units, …) and income events (CRM, channels, IBKR, manual)
2. **Valuation** — price books (usage → $) and recognition rules (forecast vs invoice vs cash)
3. **Books** — period rollups into ERP (draft PIs / sales invoices / JEs; Maker → Checker)

**Cost buckets:** Flolah plan (free now → paid later) · BYOK/API spend · outside opex (ads, freelancers) · memo-only shadow/imputed items.

**Income buckets:** CRM commercial (lead → won → invoice → paid) · channel (e.g. YouTube payouts CSV/API later) · IBKR **realized** (separate trading block) · manual other. Flolah’s own subscription revenue is **not** your company revenue.

**Success card (target):** operating margin from real recognized/collected operating income minus cash run cost; pipeline as a **leading** metric; OEI stays ops-only; trading optional separate block.

## How to work today without the feature

1. Track token burn and budgets under Efficiency / Agent View.
2. Keep commercial pipeline in **CRM**; issue invoices in **ERP** when you use Business Core.
3. Manually log outside costs and bank income you care about (spreadsheet or ERP expenses/income until Flolah `cost_lines` / `income_events` ship).
4. Treat Digest $ rates and OEI as **management/ops**, not P&L lines.
5. For IBKR, use Summary for trading reality; do not treat paper or unrealized P&L as operating revenue.

## Related Platform Help

- Budgets & tokens: **18**
- API Keys / BYOK: **15**
- Business Core CRM/ERP: **32**
- IBKR: **20**
- OEI: **36**
