# Local router and planner tests with real LLMs

## Tenant metadata mode

`--inventory-file <local-json>` imports a credential-free snapshot into the disposable database and uses the snapshot's active slot. `export-planning-inventory.mjs` exports Balaji's agent/tool grants, connector-action descriptions, human and workflow catalog metadata with read-only SQL. It does not export OAuth credentials or mailbox/CRM content. Keep snapshots and reports outside Git. This mode still does not execute business actions or prove runtime connector access.

`--capture-request <local-json>` captures the first request body and a readable `.metadata.json` companion without sending any provider request. Its intentional offline denial makes scenario assertions fail; it is an inspection mode, not a passing test report.

The September 4 local fixes clarify routing ownership, separate nested reportees from selectable planner executors, deduplicate capability descriptions, preserve repair context, and explain valid dependency/callback contracts. The latest focused live-model run passed all seven checks with the real tenant catalog. No production deployment or runtime success is implied by that result.

Run the production router, goal maker/checker and retrieval validator locally **before deploying**. No Flolah server, VPS deployment or running OpenClaw is needed.

## Safety boundary

- A fresh temporary SQLite database contains only synthetic company/agent/tool metadata.
- The harness calls the real production functions. LLM responses are not mocked.
- Only the two configured `/chat/completions` URLs are permitted by the network guard. Business connectors, agents, web browsing and goal execution cannot run.
- Credentials are read from an existing local environment file. Only model-related settings are loaded; keys are not printed, copied into fixtures or included in reports.
- Both direct provider endpoints must be configured. The active slot is the maker/router; the other slot is the checker/adjudicator. Ollama is not substituted.
- This harness deliberately bypasses the private VPS LiteLLM gateway. It tests model behavior and application contracts, not production gateway/networking.
- The temporary database/workspace is deleted after a normal pass or failure. Reports contain synthetic inputs, model decisions, timing and usage, not credentials. A forcibly killed process may leave its temporary directory for manual cleanup.

## Commands

From the repository `backend` directory, inspect configuration without making any model calls:

```powershell
npm run test:router-planner:live-local -- --env-file "C:\path\to\existing\deploy\.env" --slot secondary
```

Run the focused live-model suite:

```powershell
npm run test:router-planner:live-local -- --env-file "C:\path\to\existing\deploy\.env" --slot secondary --suite all --run --max-calls 18 --report tmp/local-live-llm-report.json
```

Use `--slot primary` to reverse maker/checker roles. The slot is explicit: a disposable local database does not silently read the Admin selection from production.

Use `--suite router`, `--suite planner`, or `--suite rag` for a smaller run. Optional `--primary-model` and `--secondary-model` overrides affect only the local process. Never put keys on the command line.

The default limit is 18 model HTTP attempts and 600 seconds. The hard configurable limits are 30 attempts and 1,800 seconds. Provider billing applies; token usage is recorded in the report when returned by the provider. Exit code 0 means every selected case passed; 1 means failure.

## Cases and assertions

1. COO inbox organization → delegate to the mailbox specialist, preserving the original instruction.
2. Mailbox specialist read-only request → direct tool route, not an unnecessary goal.
3. Multi-stage nested orchestration → goal route.
4. Local-business discovery → CRM lead creation → Gmail drafts plan, with all three expected specialists and independent checker approval.
5. COO → Content Orchestrator → Story Agent plan: an actual entitled CEO-profile read precedes creative work, no root-to-grandchild shortcut, nested handoff/export instructions and independent approval.
6. Retrieval relevance: unrelated fictional résumé excluded; relevant fictional clinic retained with source evidence.

The normal execution plan is not run. Consequently, a passing plan test does **not** prove Gmail OAuth, CRM writes, OpenClaw callbacks, user approvals, production grants, or terminal reporting work end to end. Run narrowly scoped deployment smoke tests for those separately.

Assertions are independent of the model's own verdict: a checker-approved plan can still fail a scenario assertion. Failed generated plans are retained in the report for inspection. The fixture validates representative capabilities, not an export of any real user's configuration.

Run the offline focused contract checks independently:

```powershell
npm run test:router-planner:focused
```

These cover invalid routing combinations/confidence, capability ownership, active-slot reversal, correction context, three-round exhaustion, requirement coverage, relevance failure, write-evidence denial, nested tenant-scoped handoffs, and chat context isolation. This is not the full regression pack.

## Release gate

1. Offline focused tests pass.
2. Relevant local live-model cases pass; inspect decisions, not only the aggregate result.
3. Review the diff and exclude environment files/reports containing company data.
4. Commit source and tests, create a rollback checkpoint, and rebuild the backend image.
5. The backend-focused deployment script tests the built image offline before replacing the running backend and checks health after replacement.
6. Run targeted VPS checks. Never claim universal reliability or a 95% success rate from a handful of cases.
