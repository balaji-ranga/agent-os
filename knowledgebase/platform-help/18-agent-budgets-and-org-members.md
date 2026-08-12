# Agent budgets, Agent View, and external agents in your org

Covers three connected features:

1. **Department purpose + monthly token budget** (Master Data → `departments`)
2. **Per-agent monthly token and error budgets** with warn-then-block enforcement
3. **External / published-A2A agents as leaf members** of your org chart, delegable by the COO

---

## 1. Departments: purpose and monthly token budget

Departments live in **Master Data → tables → `departments`** with three columns:

| Column | Meaning |
|--------|---------|
| `name` | Department label shown in every department dropdown |
| `purpose` | What the department is responsible for. Synced into agent workspaces via **ORG.md** so agents understand the org |
| `monthly_token_budget` | Planning figure for the department (tokens/month). Blank = no target |

Where to edit:

- **Dashboard / Org designer → department picker** — pick a department, click **Edit**, set purpose and budget.
- **Master Data → `departments`** — edit the row directly (same columns).

New CEO accounts are seeded with seven departments (Executive, Research, Finance, Social,
Engineering, Operations, Job Pipeline) including a starter purpose. Existing accounts get the two
new columns added automatically on backend startup; existing rows keep their name and start with an
empty purpose and no budget.

Department purpose appears in **ORG.md** under a **Departments** section, so any agent reading its
workspace knows which department owns which kind of work.

---

## 2. Agent monthly token and error budgets

Every org member — internal agent or external leaf member — can carry two budgets per month:

| Budget | Meaning |
|--------|---------|
| **Monthly token budget** | LLM tokens the member may spend this calendar month. Blank = unlimited |
| **Error budget** | Maximum share of terminal calls that may fail, e.g. `5` for 5% |

### Where to set them

- **Agent Workspaces → Add agent** and **Org designer → Add agent**: two fields on the create form.
- **Efficiency View → Agent View → Edit budget**: change them any time.
- **External Agents / AgentExchange → Add to org**: set them when placing an external agent.

Budgets are stored per month (`YYYY-MM`). When a new month starts, the previous month's budget is
carried forward automatically on first use, so you set it once.

### What counts as usage

Tokens come from the durable `token_usage` ledger. It records:

| Source | When |
|--------|------|
| `AgentSystem_chat` | Dashboard / agent chat turns |
| `delegation` | COO-delegated runs executed by an agent |
| `workflow_brain` | Brain node LLM calls |
| `a2a_outbound` | Calls out to an external / published-A2A leaf member |

Provider-reported usage is used whenever the model API returns it. When it does not, the row is an
estimate (`chars/4`) and is flagged as estimated — the Agent View tooltip tells you how much of the
month's total is estimated.

**Who a Brain node bills.** A workflow published over A2A *is* the leaf member doing the work, so
Brain calls in an A2A-invoked run land on the `a2a:<publishId>` leaf and count against its budget.
Runs an agent started (COO delegation, agent tool call, sub-workflow) bill that agent. Manual,
scheduled, and webhook runs have no org member to charge, so their Brain tokens sit in a
workflow-scoped bucket that Agent View does not list.

A leaf member with no LLM node in its workflow (a trigger-only or pure-integration workflow) has no
Brain rows at all — its token line is just the small `a2a_outbound` estimate of the request and reply
text.

Failure rate is computed from terminal outcomes in the month: completed/failed Kanban tasks for
internal agents (delegations land on Kanban too), and recorded outbound invocations for leaf
members.

### Warn then block

| Threshold | Behaviour |
|-----------|-----------|
| 80% of either budget (configurable warn %) | Bell notification to the CEO, once per day per agent, linking to Agent View. Work continues |
| 100% of the token budget | New chat and delegated work is refused with a clear message |
| Failure rate at/over the error budget **and** at least 10 terminal calls in the month | New chat and delegated work is refused |

The 10-call minimum stops a single early failure from blocking a low-volume agent.

When an agent is blocked:

- **Chat** returns HTTP 429 with the reason.
- **COO delegation to an internal agent** is refused **before** Kanban / AgentSystem work is
  created. The COO replies with `Blocked by budget: …` (same wording as for leaf members). A late
  pending-task worker also fails any leftover task if the agent went over budget between enqueue
  and run.
- **Outbound external/A2A calls** are refused before the network call, so no Kanban card is created
  for the refused request.

A refusal is not counted as a failed call: the member never ran, so budget and access-control blocks
never spend the error budget. Only real terminal outcomes move the failure rate.

To unblock, raise the budget in **Efficiency View → Agent View → Edit budget**, wait for the
next month, or **Reset usage** / **Reset all usage** to clear month-to-date tokens used back to 0
(budgets themselves are unchanged).

---

## 3. Efficiency View → Org / Department / Agent View

**Efficiency View** (`/efficiency`) has three tabs:

- **Org** — fleet-level view (tasks, feedback, workflow runs) plus **Storage (MB)** for your account's estimated data footprint.
- **Department** — month-to-date tokens used by every agent (and external / A2A leaf member) in a
  department, compared to that department's `monthly_token_budget` from Master Data. Pick a
  department to see the gauge and a per-member breakdown. Department budgets are planning figures —
  they do not block work by themselves; per-agent budgets still enforce.
- **Agent View** — one agent at a time.

On **Agent View** you can also **Reset usage** (selected agent) or **Reset all usage** (every
agent and leaf member). That deletes this month's `token_usage` ledger rows so gauges and budget
enforcement restart at 0 used — configured monthly budgets and error budgets are not changed.

Agent View shows:

- An agent selector covering internal agents **and** external/A2A leaf members, plus a badge for the
  current budget state (within budget / warning / blocked).
- KPI strip: prompts, tool calls, tasks ok/failed, feedback positive %, average delegation latency.
- Two gauges: tokens used vs monthly budget, failure rate vs error budget.
- Charts: **Activity** (prompts + tool calls), **Outcomes** (successful vs failed),
  **Token budget** (cumulative tokens against the monthly budget line), **Reliability** (rolling
  failure rate against the error-budget ceiling).
- **Top tools** with ok/error counts.

The same range control as the Org tab applies (7 / 14 / 30 / 90 / all).

**Leaf members show fewer KPIs.** Prompts, tool calls, and feedback come from chat turns, tool logs,
and thumb ratings, which only exist for internal agents — an external/A2A member has no chat session
here, so those tiles show **n/a** (with a tooltip explaining why). What a leaf member does report:
tasks ok/failed, failure rate, average latency (from its recorded invocations), and tokens.

---

## 4. External and published-A2A agents as org members

Registered **External Agents** and your own **workflow AgentExchange** publications can join the org chart as
**leaf members**: they get a department and report to an internal agent, but they can never manage
other agents. That path is unchanged.

**Published AI employees** (Flolah / Public on Agent Exchange) are different: **Add to org** imports
a real AI employee into the buyer’s **Agent Workspace** (chat, tools, org chart) — not a leaf.
See [09-a2a-agent-exchange.md](./09-a2a-agent-exchange.md).

### Adding one

- **External Agents** page → **Add to org** on the agent card.
- **AgentExchange** → **Add to org** on a publication you own.

In the dialog set: display name, purpose (this is what the COO routes on), department, reports-to
(an internal agent), and optional token / error budgets.

Leaf members appear in the org designer with an **External** or **A2A** badge and a dashed border,
and in the Dashboard **Chart** (List and Graph) under their reports-to parent with the same badge.
They are not drag-and-drop targets because they cannot manage anyone.

### Removing from the org (not deleting the agent)

Use **Remove from org** to drop the placement only — the External Agent registry entry or A2A
publication stays intact:

- **Org chart** (Dashboard Chart / Org designer) → **Remove from org** on the leaf
- **External Agents** card → **Remove from org**
- **AgentExchange** ⋯ menu → **Remove from org**

That clears the **In org:** tag on the External / AgentExchange card. It does **not** rewrite
**ORG.md** / COO **AGENTS.md** automatically — run Dashboard **Resync** (or Sync org) when you want
those files updated.

### Auto-cleanup when the agent is deleted

Deleting an External Agent or **Unpublishing** an A2A publication also removes any org placements
for that agent (across CEOs who had tagged it). Again, Resync is manual for ORG.md / AGENTS.md.

### COO delegation to leaf members

Once added, leaf members are written into **ORG.md** and the COO's **AGENTS.md** with their member
key (`ext:<id>` or `a2a:<id>`) and purpose when you sync. Dashboard **Resync** refreshes those roster sections
only — it does not wipe Role / Priorities / Tools / Guardrails or other manual edits in the COO
AGENTS.md. The COO's intent classifier can then pick leaf members for matching work. When it does:

1. The budget guard runs first — a blocked member is refused before any network call.
2. A Kanban card is created and moved to in-progress.
3. The agent is invoked over A2A: external agents through the registered endpoint, your own
   publications through the owner-authenticated path (same bypass the AgentExchange **Test agent**
   uses, so your own IP allowlist does not block your own delegation). An external agent whose
   endpoint points back at one of your own publications (`…/api/a2a/<publishId>`) takes that same
   in-process path, so a **Private** / `deny_all` publication cannot 403 its own COO.
4. The outcome is recorded for the error budget, a token estimate is written to the ledger, and the
   Kanban card is completed or failed with the result.

### Security

- Only your own external agents and your own A2A publications can be placed in your org.
- Public A2A access policies (`deny_all` / `whitelist` / OAuth) are unchanged for third parties.
- **Private** A2A publications: public endpoints always denied. Org invoke is limited to the **COO**
  or the leaf's **reports-to** internal lead (peers are refused). Owner **Test agent** still works.
- Reports-to must be an internal agent you are entitled to.

---

## API reference

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/efficiency/agents` | Selectable members + current-month budget state |
| `GET` | `/api/efficiency/agents/:memberKey?days=30` | Agent View metrics |
| `PUT` | `/api/efficiency/agents/:memberKey/budget` | Set monthly token / error budget |
| `GET` | `/api/efficiency/departments` | Month-to-date tokens vs budget, by department |
| `POST` | `/api/efficiency/usage/reset` | Zero month-to-date tokens (`member_key` omitted = all members) |
| `GET` | `/api/org-members` | List org leaf members |
| `POST` | `/api/org-members` | Add / update a leaf member (kind, ref_id, department, parent_id, budgets) |
| `DELETE` | `/api/org-members/:id` | Remove a leaf member from the org chart only (does not delete External/A2A agent; does not auto-sync ORG.md / AGENTS.md) |

All routes are CEO-scoped: reads and writes are filtered by the signed-in CEO's owner id.
