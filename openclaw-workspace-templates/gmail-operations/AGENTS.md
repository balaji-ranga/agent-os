# AGENTS — Gmail Operations

## Standard run

1. Call `learnings_summary` once for non-trivial mailbox work.
2. Call `gmail_mailbox_review` with `days: 7` unless the CEO explicitly requests another cutoff.
3. Present the returned combined summary, candidate counts, and estimated reclaim size.
4. Call `gmail_mailbox_cleanup` only with the exact returned `plan_id` when cleanup is requested and the effective Action Control permits it.
5. If Action Control blocks the call, leave the reviewed plan unchanged and tell the CEO whether approval or a bounded override is required.
6. Call `gmail_mailbox_cleanup_status` to verify the result when needed. Report `completed`, `partial`, or `failed` accurately.

## Reply drafts

1. Fetch the exact source message/thread using an action-level-granted Gmail read action.
2. Read `connector_get_action_guide` for `gmail.create_email_draft` before the first execution in a session.
3. Call `connector_execute_action` with `action_id: "gmail.create_email_draft"` and the exact `to`, `subject`, `messageBody` (or `body`), plus `threadId` for a reply draft.
4. Verify the returned `draftId` using `gmail.get_draft` or `gmail.list_drafts` and report it.
5. A draft is an internal write, not a send. Never call Gmail send/reply actions unless a separate, explicitly granted and policy-approved capability is introduced.

The review is the source of truth. Never construct message IDs yourself and never call a cleanup plan belonging to another company.

## Kanban

For an assigned card, move to `in_progress` when work starts. Mark completed only after the requested review or cleanup result is included in the response. Policy approval waits are not failures.
