# Monitoring and LLMOps

## Quick answers

**Where do I watch tokens, estimated LLM cost, and traces?** **Efficiency View → LLMOps** (`/efficiency?tab=llmops`). Same login as the rest of Efficiency. Owner-scoped (your company only).

**Is estimated $ my provider invoice?** No. It is **tokens × your price book** (or the platform estimate catalog). BYOK invoices still come from the model vendor. Digest **Est. Value** is imputed hours. Home **OEI** is ops, not money.

**Does this cost extra LLM tokens to load?** No. The dashboard is SQL + your price book. Asking the **COO** (`llmops_summary`) also does not call a second model to invent spend — it returns the same facts.

**Who can load it?** Your CEO login (or a person with the Efficiency permission). APIs never trust a body `ceo_user_id`.

**Where is gateway recovery?** **Admin → AgentSystem recovery** (help **43**) and **Admin → Crons**. Those are operator screens, not this CEO tab.

---

## What you already have (one ledger)

| Surface | What it shows |
|---------|----------------|
| **LLMOps tab** | Tokens, estimated $, by source / model, traces, thumbs, goal outcomes, price book, outside costs |
| **Agent View** | Per-employee tokens vs budget, error budget, activity, **tokens by source**, top tools |
| **Goal plans → Execution trace** | Steps, plan versions, KPI/spend, telemetry (`goal_created` … `goal_completed`) |
| **Workflows → Run instances** / `/workflows/runs/:id` | Step audit, Brain / tool log |
| **Chat** | Turns + tool-call chips |
| **Policies / Maker-Checker** | Guardrails and review quality (help **10**, **38**) |
| **Home OEI** | Ops readiness 0–100, rules-only (help **36**) |

There is no separate vendor tracing product in Flolah. Correlation uses a **trace id** on the same owner-scoped rows (`token_usage`, tool logs, goal events, workflow runs).

---

## Token meter

Every owner-aware LLM path writes `token_usage` when tokens can be attributed:

| Ledger `source` | When |
|-----------------|------|
| `openclaw_chat` | Agent Chat / AgentSystem turns |
| `delegation` | COO-delegated runs |
| `workflow_brain` | Workflow Brain LLM |
| `a2a_outbound` | Calls to external / published-A2A leaf members |
| `content_tool` | Tools that call chat LLM (summarize, classify, …) |
| `goal_planner` | Goal-plan intent classification |
| `chat_completions` | Other platform chat LLM (fallback) |

Provider-reported usage is stored when the model API returns it. Otherwise the row is a `chars/4` **estimate** and Agent View / LLMOps say so.

Unattributed platform calls (no AI employee) land on the COO when one exists, else `llm:unattributed` — visible on **LLMOps**, not as a named Agent View member.

Budget warn-then-block is unchanged: help **18**.

---

## Traces

A **trace id** ties one stretch of work:

- Goal plan → `agr-…` (opens **Execution trace**)
- Workflow run → `wf:{id}` (opens the run audit)
- Chat session → `sess:{session}`

LLMOps lists recent traces with token totals. Drill into the goal or workflow for the step ladder. Quality signals on the same tab: thumbs-up %, goal completed vs failed, policy-decision events.

Reuse **Maker/Checker**, **Policies**, and pipeline scorecards (help **48**) for process quality. Do not treat thumbs as a hallucination score.

---

## Estimated cost (price book)

**Efficiency → LLMOps → Price book** stores **your** USD per 1M input/output tokens (optional wildcard `*`). Platform catalog rows are estimates you can override.

- **Payer** label: **BYOK** vs **platform** from Profile / API Keys — not a credit-card feed.
- **Outside costs**: manual USD lines for ads, contractors, and other opex this calendar month. Not posted to ERP automatically.
- Full income + ERP period close remains the design in `knowledgebase/AUTOMATED-PNL.md` and help **37**.

---

## COO tool

Ask the COO about token burn or estimated LLM spend. Tool **`llmops_summary`** (optional `days`, default 30) returns the same owner-scoped facts. The COO should point you to **Efficiency → LLMOps**, not invent invoices.

---

## Operator vs product (do not mix)

| Product (this company) | Operator (platform admin) |
|------------------------|---------------------------|
| Efficiency, Goal traces, workflow audit, Policies, budgets | Admin → AgentSystem recovery, Admin → Crons, `PLATFORM_LOG_LEVEL` |

Gateway health and feeder-queue drain are **not** on the LLMOps tab.

### Admin models and routing

Platform admins can open **Admin → Models & routing** (`/admin/models`) to inspect the model registry, logical routes, deployments, capability metadata, health, and sanitized routing history.

- Logical aliases keep platform primary/secondary, owner BYOK, efficiency, realtime, and embedding consumers stable while deployments change.
- A route can select a primary and optional fallback deployment. Disabled or capability-incompatible deployments cannot be selected.
- LiteLLM is an internal OpenAI-compatible transport for platform-managed chat models; it has no public host port. Flolah avoids a second application retry loop when LiteLLM owns transport failover.
- Route changes affect new platform-managed requests. Owner identifiers and secrets are omitted from routing history; registry records secret references, not provider keys.
- Agent/route eligibility remains tenant-aware: an inactive model slot or unavailable capability is not advertised to the planner as executable.

This is an operator capability, not a per-company model bill or replacement for **Efficiency → LLMOps**.

Optional third-party trace UIs (if you use them) belong on **Connectors → MCPs** with your own keys — not a Flolah-only schema.

---

## APIs (login, owner-scoped)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/efficiency/llmops?days=7\|14\|30\|90\|all` | Dashboard payload |
| GET / PUT | `/api/efficiency/price-book` | List / replace **your** rates (platform catalog unchanged) |
| GET / POST | `/api/efficiency/cost-lines` | List / add manual outside costs |
| DELETE | `/api/efficiency/cost-lines/:id` | Delete one of **your** manual lines |
| POST | `/api/tools/llmops-summary` | COO tool |

## Related

- Budgets: [18-agent-budgets-and-org-members.md](./18-agent-budgets-and-org-members.md)
- Company P&L roadmap: [37-company-pnl.md](./37-company-pnl.md)
- OEI: [36-operational-effectiveness.md](./36-operational-effectiveness.md)
- Admin recovery: [43-admin-agentsystem-recovery.md](./43-admin-agentsystem-recovery.md)
- Public site: `/docs/operate/monitoring-and-llmops`
