# Operational Effectiveness Index (OEI)

## Quick answers

**What is OEI?** A Home score (0-100) that estimates how effective your AI company is operating: vision, team, scheduled goals, workflows, autonomous loops, CRM, and governance. **Green >= 75**, **Amber 50-74**, **Red 0-49**. Rolling window: **14 days**.

**Where do I see it?** **Home** (`/`) — KPI chip with an **i** / explain popover for domain scores, KPIs, and improve links. It is **not** on Digest (`/this-week`).

**Does it cost LLM tokens?** No. Rules-only (deterministic SQL + config). No BYOK chat call.

**Who can load it?** Your login only (owner-scoped). Authenticated `GET /api/operational-effectiveness`. APIs never trust a body `ceo_user_id`.

**Can the COO explain it?** Yes. COO tool **`operational_effectiveness`** returns the same score, domains, KPIs, and improve actions. Ask how effective the company is, or why the OEI is Amber/Red.

**Is OEI the same as Digest Time Saved / Est. Value?** No. Digest is weekly hours x hourly rates (dollar proxy). OEI is ops readiness and fire-loop health.

**Is OEI the same as Efficiency LLMOps estimated $?** No. LLMOps estimates LLM spend from tokens × a price book (help **50**). OEI is not money.

## Domains (equal weight average)

| Domain | What it scores (examples) |
|--------|---------------------------|
| **Vision** | Company setup / company memory signals (mission, DNA, identity) |
| **Org** | AI employees hired, org shape readiness |
| **Goals** | Active **scheduled goals**, **run counts**, success vs fail |
| **Workflows** | Published graphs, recent run success rate |
| **Autonomy** | Standups, delegations, **scheduled goal runs**, CEO notifies |
| **CRM** | Platform Twenty CRM **or** MCA/OpenConnector CRM-class app connected |
| **Governance** | Policies/guardrails, budgets, related control signals |

## Goal KPIs (important)

Earlier builds used labels like "Goals fired (14d)" while counting **distinct goals** that ran at least once (so one daily goal always showed **1** even after many days of emails).

Current metrics (from `scheduled_goal_runs` history when available):

| KPI | Meaning |
|-----|---------|
| **Active scheduled goals** | Rows with status `active` for your CEO |
| **Goal runs (14d)** | **Count of firings** in the last 14 days (daily goal roughly scales with days fired) |
| **Distinct goals that ran (14d)** | How many **different** goals ran at least once |
| **Successful runs (14d)** | Runs marked success/ok/completed (failure count when any) |
| **Scheduled goal runs (14d)** (Autonomy) | Same fire count signal for the autonomy domain |

Daily emails from a **scheduled goal** should show as **multiple runs**, not 1, when history rows exist. If runs are lower than expected:

1. Confirm the mail comes from **Scheduled goals** (`/scheduled-goals`) and not only another path.
2. Confirm the goal is **active** and has **Run now** / recent `last_run_at`.
3. History older than when `scheduled_goal_runs` started will not backfill; only new fires count.

Related: [28-scheduled-goals.md](./28-scheduled-goals.md). Platform COO **status checker** email: [19-scheduled-jobs-and-crons.md](./19-scheduled-jobs-and-crons.md).

## Bands and improve actions

- **Green (>= 75)** — operating loop looks healthy across domains.
- **Amber / Red** — expand the Home **i** popover; follow improve links (Company setup, hire, Scheduled goals, Workflows, CRM, Policies, etc.).
- Raising score means doing the work (active goals that fire, successful workflows, CRM connected when you need CRM ops).

## APIs and tools

| Surface | Detail |
|---------|--------|
| REST | `GET /api/operational-effectiveness` (session auth, owner scope) |
| COO | `POST /api/tools/operational-effectiveness` → tool name `operational_effectiveness` |
| Public | Not a public page; login required |

## Related

- Navigation / Home chrome: [02-navigation-and-chrome.md](./02-navigation-and-chrome.md)
- Digest (different metrics): same file, Digest section
- Scheduled goals: [28-scheduled-goals.md](./28-scheduled-goals.md)
- Content tools catalog: [11-content-tools-scripts-profile.md](./11-content-tools-scripts-profile.md)
