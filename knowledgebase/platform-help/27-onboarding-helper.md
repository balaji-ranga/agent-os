# Onboarding Helper - strategic org setup

**Audience:** CEOs and Platform Help / Onboarding Helper.  
**Surfaces:** Dashboard chat with **Onboarding Helper** (`onboardinghelper`) | User menu -> **Onboarding** (`/onboarding`).

## What it does

Guided setup for purpose, vision, goals, and recommended **departments**, **agents**, **tools**, and workflow *ideas*.

Two paths that share one draft (`ceo_org_strategy`):

1. **Chat with Onboarding Helper** - coach the proposal, then call tools to save (and optionally apply).
2. **Onboarding page** - fixed step wizard + **Review** cards with **selective checkboxes** and **Apply override**.

Lean default if you skip Onboarding: COO + Workflow Builder + Platform Help.

## Agent tools (owner-scoped)

| Tool | Purpose |
|------|---------|
| `onboarding_save_proposal` | Write structured departments / agents / tools / workflows / channels / `md_files` into the Onboarding draft and jump to **Review**. Does **not** create agents by itself. |
| `onboarding_apply_proposal` | Create selected departments + agents (+ MD notes). Requires `confirm_override: true` after you explicitly say apply. |
| `master_data_rag` / `learnings_summary` / `notify_ceo` | Context and rare notify only |

Workflow graphs are **not** created by Onboarding Apply - hand off to **Workflow Builder**.

## Selective review and apply

1. After the helper saves a proposal, open **`/onboarding`** (banner shows when the draft came from AgentSystem).
2. On **Review**, check/uncheck departments, agents, workflow notes, MD files.
3. Acknowledge override if you already have custom agents.
4. Click **Apply override** - or tell the helper in chat to call `onboarding_apply_proposal`.

Unselected items are skipped. Existing custom agents are **not** deleted; Apply creates new ones (additive unless you manage removals elsewhere).

## Prompt recipes (E2E reference)

Use these (or adapt) when retesting onboarding + Workflow Builder **via chat only**. Public site: `https://flolah.cloud` (not `flolah.com`).

### A - Onboarding Helper: MarketWatcher

**Prompt 1 - create + instruct tools**

```
Create and onboard this custom agent end-to-end now:

Department: Trading (purpose: market monitoring and alerts)
Agent: MarketWatcher - reports to COO
Role: Watch a configurable equity/crypto watchlist; when price dips by a configurable X% from recent high, alert via email_send + notify_ceo. Additive only (do not remove existing agents).

Include tools: learnings_summary, master_data_rag, notify_ceo, email_send, brave_web_search (if available).
Include MD files for MarketWatcher: MEMORY note about watchlist+threshold and a short WATCHLIST.md template.

When ready:
1) Call onboarding_save_proposal with structured departments, agents, tools, workflow notes, md_files.
2) I explicitly confirm APPLY OVERRIDE - call onboarding_apply_proposal with confirm_override=true.

Use the tools; do not only coach.
```

**Prompt 2 - confirm apply**

```
Yes - apply override now. Call onboarding_apply_proposal with confirm_override true for the MarketWatcher proposal.
```

Expect: Trading department + agent id like `marketwatcher`; Onboarding status `applied`; draft `proposal_source=onboardinghelper`.

### B - Workflow Builder: agent + Ollama validate loop

After MarketWatcher exists (use the real `agent_id`, e.g. `marketwatcher`):

**Prompt 1 - build + certify**

```
Build and publish a new workflow end-to-end (use mutate + certify tools):

Name: MarketWatcher validate loop
Goal: Trigger runs agent marketwatcher with inputs (watchlist, dip_threshold_pct, context). Ollama brain validates agent output. On FAIL loop back to agent with brain feedback (max 3). On PASS finish.

Requirements:
1) create_workflow titled "MarketWatcher validate loop"
2) trigger with JSON inputs
3) agent node agent_id="marketwatcher" using {{trigger-1.trigger_input.*}}
4) brain modelSource="ollama" PASS/FAIL + feedback
5) if/while loop FAIL->agent, PASS->end
6) publish or certify_start / until_success

Call learnings_summary then agent_workflow_mutate. Report workflow_id.
```

**Prompt 2 - confirm**

```
Confirm MarketWatcher validate loop exists; paste workflow_id and node summary.
```

Expect graph shape: `trigger -> agent -> brain -> if -> end`, with fail edge **if -> agent**. Example id: `marketwatcher-validate-loop-*` (may stay `draft` while certify runs).

## Automated retest script

From a laptop with CEO session token (or email/password):

```powershell
$env:BASE_URL = "https://flolah.cloud"
$env:TOKEN = "<ceo-session-token>"
# or: $env:CEO_EMAIL=...; $env:CEO_PASSWORD=...
node backend/scripts/e2e-onboarding-wf-prompts.mjs
```

After deploy, ensure tools exist and helper is granted (startup seeds `onboarding_*` tools; re-seed helper if needed):

```bash
docker exec -w /opt/agent-os/backend agent-os-backend-1 node scripts/seed-onboarding-helper-agent.js
```

## Related

- Plan / history: `knowledgebase/ONBOARDING-HELPER-PLAN.md`
- Workflow certify: [13-workflow-autonomous-certify.md](./13-workflow-autonomous-certify.md)
- Nodes (brain / agent / if): [07-workflow-nodes-reference.md](./07-workflow-nodes-reference.md)
- Deploy: `deploy/README.md` (sync-to-vps, public URL `AGENT_OS_PUBLIC_URL`)
