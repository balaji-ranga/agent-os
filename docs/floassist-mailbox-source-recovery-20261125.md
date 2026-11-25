# WhatsApp mailbox source recovery — 25 November 2026

## Observed failure

The COO used a mailbox email address as `floassist_source_read.source_id`. Gmail rejected the address as an invalid thread identifier. An identical repeat in the same execution was blocked correctly, but the reply incorrectly described that block as an already-processed successful request. This was not a token-budget failure.

## Shared fix

- Whole-period summaries use the existing bounded source-period reviewer. An invented mailbox address is removed only when it is absent from the current user request. Explicitly requested addresses are validated rather than silently redirected.
- `relative_day` resolves today/yesterday against the authenticated FloAssist profile timezone, before discovery. Explicit date filters remain authoritative; contradictory filters are rejected.
- Mailbox addresses/labels are rejected before provider submission, with a server-generated discovery call. Draft selectors, task identities and authenticated page continuations keep their existing contracts.
- Specific ad hoc mailbox IDs must come from owner/session discovery or the owner's tracked task. Discovery evidence is isolated by owner, session and app. Provider OAuth, connector selection, caller grants and action policies remain enforced.
- Duplicate refusals retain the original failure and its executable correction. The gateway corrects misleading duplicate-success prose only for the exact session/run with a recorded invalid-source failure; successful recovery clears that state. No source content is retained by this reply guard.

## Verification

Network-disabled tests used disposable VPS containers and synthetic providers. The complete `test:floassist` suite passes, including the Outlook pipeline (176 checks over 13 scheduled runs), tracking, lifecycle, source paging, budgets, timezone and connector monitoring. Focused tests also verify actual gateway plugin hooks and admission of corrected discovery through the real duplicate governor.

Older harness expectations were aligned with existing main behavior: structured briefing JSON, source timestamp/label headers, managed local-checker gateway routing, and unrelated prompt guidance on inactive profiles. Runtime security/validation was not relaxed to satisfy those fixtures.

Live production backend verification used the owner's existing authorized Gmail connection: today's Singapore window was empty; seven-day discovery returned 13 threads; one discovered thread was read completely (2,271 characters, one page). Invalid mailbox-as-ID input was rejected. Only counts/coverage were logged; email bodies were not printed or submitted to a model. Cumulative paid model test calls/tokens/spend: 0 / 0 / 0.

## Rollout and retest

Only backend and gateway images were rebuilt from committed source using the repository's scoped Dockerfiles. Rollback images, manifests, build logs and test logs are retained under `/opt/agent-os-releases/floassist-source-20261125`. No full deployment, local laptop service startup, schedule resumption or quiet-hour change is required.

Handset acceptance remains distinct from backend and installed-hook validation. In the existing WhatsApp session ask: “Check my Gmail for today's emails and summarize anything important.” With an empty day the reply should say no messages were found in that Singapore day, rather than report a duplicate read or borrow previous messages. To exercise nonempty evidence, ask for the last seven days. No `/new` is required.
