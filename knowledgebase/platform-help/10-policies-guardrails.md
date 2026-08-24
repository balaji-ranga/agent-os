# Policies and common guardrails

CEO account setting: rules that apply to **every agent** and **every workflow Brain node**.

## Where to set them

**Management → Policies** (`/policies`).

1. Write the common policy text (tone, safety, confidentiality, escalation rules).
2. Keep **Enforce** checked.
3. Click **Save & sync to agents**.

Saving writes **`POLICY.md`** into each of your agent workspaces and updates org docs. Brain nodes read the same policy from the database on every run and prepend it to the system prompt.

## Action control

On the same **Policies** page, set three states per action family for **your company**:

| Family | Default | Examples |
|--------|---------|----------|
| Read / research | Autonomous | Search, CRM list, Business Discovery |
| Internal writes | Autonomous | Create CRM records, Kanban drafts |
| External messages / publish | Approval required | `email_send`, public posts |
| Financial / destructive | Prohibited until you allow | Delete, refund, live trade |

**Approval required** blocks the tool unless it carries a short-lived, owner-scoped approval grant issued by Flolah for that action. An agent cannot approve itself with request flags. Grants can be single-use and constrained to a tool, recipient, campaign, or maximum amount. **Prohibited** always blocks, even when a grant is supplied. These rules are enforced on read and write tool invokes for the entitled CEO — they do not replace tool grants or Maker/Checker.

### Scoped overrides and recurring grants

Below Action control, add a narrower override for a specific **goal**, **workflow**, **employee/agent**, or **tool**. Flolah resolves the first applicable policy in this order:

1. goal;
2. workflow;
3. employee/agent;
4. tool;
5. company Action control fallback.

For an approved recurring automation such as a daily status email, create an **Autonomous grant** for the workflow, agent, or `email_send` tool. Bound it with permitted email IDs, an expiry, and a maximum use count. Public publishing can likewise be restricted to permitted website domains. An active override whose recipient/domain constraints do not match fails closed. Expired or exhausted overrides fall back to the next applicable policy.

## How agents see it

- Workspace file: `POLICY.md` (also referenced from `ORG.md`).
- AgentSystem bootstrap reloads `POLICY.md` with other workspace MD files.
- Agents must treat POLICY.md as a **prerequisite** before SOUL / AGENTS / user requests.

## How Brain nodes see it

Workflow **Brain** nodes automatically prepend the active CEO policy to their system prompt (before the node’s own `systemPrompt`). Disabling the policy on `/policies` stops both agent sync content and Brain prepend.

## Tips

- Keep the policy short and unambiguous.
- Use Resync ORG.md & AGENTS.md on the Dashboard if you change org membership after saving policies (save already syncs POLICY.md).
- Per-node Brain `systemPrompt` still works for task-specific instructions; CEO policy always comes first when enabled.
- Constrained pipeline outcomes (no unapproved send, spend cap): [48-pipeline-under-constraints.md](./48-pipeline-under-constraints.md) (example stress test run).
