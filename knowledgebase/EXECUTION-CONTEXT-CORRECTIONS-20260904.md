# Execution context and outcome corrections

Rollback base: `f87659c`; checkpoint branch `checkpoint/browser-context-20260904`.

## Changes

1. Register the original request and resolved context against the authenticated OpenClaw execution session. Browser task creation supplements the agent's specific assignment with that trusted context. Delegated goal sessions retain their full step prompt. Owner and session must match; no agent-wide context fallback.
2. Desktop worker 2.1.2 invokes function-valued evaluation expressions, including async functions, and rejects undefined results. Browser document parsing rejects acknowledgement envelopes. Structured-document and early-summary paths now verify the requested outcome before declaring completion.
3. Specialty goal completion validates the assigned deliverable. Validation errors and incomplete outcomes enter the existing goal exception path. Retry instructions identify the same step, the attempt, previous results and missing work, and instruct the agent to check existing effects before repeating writes. Browser correction attempts use the owner's retry limit. This is not a guarantee of exactly-once external writes: connector/provider idempotency remains necessary.
4. Reply controls show a removable quoted preview and send `reply_to_message_id`. Backend lookup is constrained to owner and agent, including retained archived messages. The router binds that reference and keeps terminal-work restart protection. Browser outcomes are correlated by work unit and included for relevant follow-ups, not unrelated chats. Existing unlinked historical browser tasks are not guessed or backfilled.

## Focused validation

Run from repository root:

```
node backend/scripts/test-browser-evaluation-contract.mjs
node backend/scripts/test-execution-context-contract.mjs
node backend/scripts/test-outcome-validation-live.mjs <existing-env-file>
```

The live test makes four bounded provider calls using production validation prompts, without Gmail, CRM or browser mutations. Keys are read in place, never recorded in test reports. Harness tests cover evaluation, owner/agent/session isolation, historical replies, correlated browser results, invalid/timeout validation and correction instructions. These checks are not a full end-to-end regression.

## Deployment

Deploy the committed source using the existing VPS deployment script, selecting backend and frontend. No environment or Docker changes are needed for these fixes. Preserve deploy/.env and local credentials. Rebuild before recreation; skip full smoke/regression unless separately authorized. Verify container health and revision after deployment.

Download the new Desktop worker package and restart it: updating the VPS does not upgrade a worker already running on a user's PC. Browser tab cleanup still follows the existing configured retention interval and only closes task-owned tabs.

Rollback by deploying the checkpoint revision with the same build process. No destructive database migration is introduced.
