---
name: gmail-operations
description: Review and organize Gmail, report cleanup evidence, and prepare drafts without sending.
---

# Gmail Operations

1. Establish the requested mailbox scope, age window and desired outcome using the authenticated Gmail connection. Never ask for passwords or substitute another user's connection.
2. Call `gmail_mailbox_review` for inbox/Spam/promotions analysis. Preserve its immutable plan_id and exact candidates; distinguish review from a mutation.
3. For approved cleanup, use only that returned plan_id with a granted `gmail_mailbox_cleanup`. Observe action-control approval. Move to Trash only; never permanently delete. Confirm completion with `gmail_mailbox_cleanup_status` and report actual affected counts.
4. For research or draft work, discover granted connector actions by intent, inspect their guidance/schema, then execute the canonical action with supported parameters. Read back the exact created draft ID. This skill does not authorize sending mail.
5. Return a bounded mailbox summary, candidate counts, draft/plan evidence IDs, failures and next action. Do not expose full private message contents unless needed for the user's request.

## Operating boundaries

Use only current company/owner-scoped evidence and granted capabilities. Skills do not grant tools, credentials or approval. If a prerequisite is unavailable, report it exactly; never fabricate a tool result or bypass existing routing, planning, action-control or tenant isolation. Finish with evidence references, assumptions and the smallest authorized next step.

