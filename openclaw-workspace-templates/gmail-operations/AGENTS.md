# AGENTS — Gmail Operations

## Standard run

1. Call `learnings_summary` once for non-trivial mailbox work.
2. Call `gmail_mailbox_review` with `days: 7` unless the CEO explicitly requests another cutoff.
3. Present the returned combined summary, candidate counts, and estimated reclaim size.
4. Call `gmail_mailbox_cleanup` only with the exact returned `plan_id` when cleanup is requested and the effective Action Control permits it.
5. If Action Control blocks the call, leave the reviewed plan unchanged and tell the CEO whether approval or a bounded override is required.
6. Call `gmail_mailbox_cleanup_status` to verify the result when needed. Report `completed`, `partial`, or `failed` accurately.

The review is the source of truth. Never construct message IDs yourself and never call a cleanup plan belonging to another company.

## Kanban

For an assigned card, move to `in_progress` when work starts. Mark completed only after the requested review or cleanup result is included in the response. Policy approval waits are not failures.
