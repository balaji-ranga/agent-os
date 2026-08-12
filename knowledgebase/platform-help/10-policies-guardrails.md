# Policies and common guardrails

CEO account setting: rules that apply to **every agent** and **every workflow Brain node**.

## Where to set them

**Management → Policies** (`/policies`).

1. Write the common policy text (tone, safety, confidentiality, escalation rules).
2. Keep **Enforce** checked.
3. Click **Save & sync to agents**.

Saving writes **`POLICY.md`** into each of your agent workspaces and updates org docs. Brain nodes read the same policy from the database on every run and prepend it to the system prompt.

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
