# Workflow Builder — end-user stress test plan

**Audience:** QA + Workflow Builder (not operator secrets). Rollback tag: `wf-builder-stress-checkpoint-2026-08-21` (`941cd3f`).

**Script:** `backend/scripts/test-workflow-builder-enduser-stress.js`

Talk to Workflow Builder the way a non-technical CEO would. Do **not** use node types, curl, JSON schemas, or command verbs unless the product should still understand them as a fallback.

## Goals

1. Build complete graphs from **plain English intent**.
2. Cover a **complex** flow that uses a public API, a Connector, and MCP when available.
3. Never store **secret literals** in the graph; bind **Settings → API Keys**.
4. Prefer **free Ollama** for Brain, using a **model that is actually installed** (never copy the platform cloud model name). If Ollama is down, bind `Platform_BYOK` and summarize.
5. After build, exercise **publish**, **draft**, **A2A share**, and **delete** in plain English.

## Scenarios

| ID | CEO prompt (intent) | Expect |
|----|---------------------|--------|
| S1 | “I need something that takes a note I type in and writes a short friendly summary. Call it Morning Recap.” | Trigger → Ollama Brain. No API key. |
| S2 | “When I run it, look up a public webpage and write me a one-paragraph briefing. Don’t ask me for technical details.” | Public API (no key) → Ollama briefing. |
| S3 | “Use my connected apps to pull Hacker News and explain the top stories in plain English.” | Connector `hackernews.get_top_stories` → Ollama. |
| S4 | “Look something up on the web, also check Hacker News, and if I have extra tools wired up use those too — then give me a recap I can act on.” | API + Connector (+ MCP if healthy) → Ollama. |
| S5 | “Use this OpenAI key `sk-test-SHOULD-NOT-STORE-abc123` for the brain.” (with a create ask) | Graph must **not** contain the literal. Bind `Platform_BYOK`. Reply lists API Keys. |
| S6 | “Which model should I use? Do I need an API key?” | Ollama if reachable; otherwise bind-key summary. No graph required. |
| S7 | Explicit paid provider: “Make the Brain use OpenRouter and then call an API to echo the answer.” | OpenRouter + `apiKeyRef=Platform_BYOK`, no literal key. |
| S8 | “Build a workflow that will promote [any product] on Hacker News and Medium with blogs (intro, features, use cases).” | Same generic recipe for any topic. Draft blogs → CEO approval → Medium API (`MEDIUM_INTEGRATION_TOKEN`) + HN submit connector. Not the HN *reader* recipe. |
| L1 | “Please take it live.” | Status published. |
| L2 | “Put it back in draft.” | Status draft. |
| L3 | “Share this so other companies can call it.” | A2A publication + card URL. |
| L4 | “Delete this workflow, I don’t need it.” | Definition gone. |

## Pass / fail

- **Pass:** graph matches intent, no secret literals, Ollama or bind-ref, lifecycle actions succeed, reply names any BYOK keys.
- **Skip (documented):** live Connector/MCP execute if the CEO has no connection; Ollama run if the service is down (structure still must bind/ref correctly).
- **Fail:** builder asks for curl/JSON/node ids; secret appears in `draft_graph`; paid Brain with empty key and no `apiKeyRef`; lifecycle phrases ignored.

## Run

```powershell
cd backend
node scripts/test-workflow-builder-enduser-stress.js
```
