# Autonomous Workflow Certify (Maker / Checker)

**Audience:** CEOs using Workflow Builder (UI chat or OpenClaw **Workflow Builder** agent).

## What it is

Ask Workflow Builder to **build, test, and certify** a workflow from a plain-language goal. The platform runs a Maker/Checker loop:

1. **Maker** (strong platform LLM) proposes graph fixes via builder actions  
2. Runner publishes/tests the workflow  
3. **Checker** grades acceptance criteria (deterministic; optional LLM soft check)  
4. Loop until **certified**, **blocked on input**, or budget exhausted  

OpenClaw Workflow Builder is the **face**: it starts the job and reports progress **when you ask**.

## How to use (OpenClaw / Workflow Builder chat)

| You say | Agent does |
|---------|------------|
| “Build a URL summarizer and certify until it works” | `agent_workflow_certify_start` → returns a `job_id` |
| “Any update?” / “Status on summarizer” | `agent_workflow_certify_status` |
| Provides an API key after blocked | `agent_workflow_certify_resume` with the requested keys |

You do **not** need to babysit the loop. Ask for status when you want an update.

## Status meanings

| Status | Meaning |
|--------|---------|
| `testing` | Loop is running (heal → publish → test → check) |
| `blocked_on_input` | Needs something only you can provide (API key, MCP id, agent id, clarification) |
| `certified` | Acceptance criteria passed |
| `budget_exhausted` / `failed` | Could not certify within attempt budget — ask Builder to inspect and continue |

Definition overlay `certify_state` mirrors the latest job (`testing` / `blocked_on_input` / `certified`) without replacing draft/published.

## vs until_success

- **until_success** — short sync build-test-heal (good for small edits)  
- **certify_start / until_certified** — goal + acceptance + ask-for-inputs + status polling (preferred for end-to-end autonomy)

## Tips

- Prefer content tools from the catalog over inventing raw API nodes  
- For Brain nodes, local `ollama` needs no key; cloud providers need a key on the node  
- When blocked, answer with the exact keys listed in the status reply  
