# Governed Gmail Operations

## What it does

The standard **Gmail Operations** AI employee reviews a CEO's connected Gmail mailbox, prepares a traceable cleanup plan, moves only reviewed candidates to Gmail Trash when policy permits, and can create reply drafts through explicitly granted Gmail actions.

It acts only for the company/CEO that owns the employee and Gmail connection. It never receives another company's mailbox, OAuth token, cleanup plan, or connector-action grants.

## Set up

1. Open **Connectors → OpenConnector** and connect **Gmail** for this CEO.
2. Hire/apply the **Gmail Operations** role from **AI Employees** if it is not already present.
3. Open the employee's **Workspace → Tools access** and confirm `gmail_mailbox_review`, `gmail_mailbox_cleanup`, and `gmail_mailbox_cleanup_status` as required.
4. Under **Connector actions**, select Gmail and grant only the read/draft actions needed—for example `gmail.create_email_draft`, plus the exact read/list-draft actions used to fetch and verify messages.
5. Review **Policies → Action control**. Mailbox cleanup is destructive-class work and must be Autonomous or carry an applicable, bounded approval grant. Draft creation is an internal write; sending is a separate external action.

Do not grant Gmail send, reply-send, permanent-delete, or broad ad-hoc actions unless the company's policy explicitly requires and governs them.

## Review and recoverable cleanup

Ask: “Review my Gmail mailbox for the last 7 days and propose cleanup.”

1. `gmail_mailbox_review` reads owner-scoped Gmail pages sequentially, summarizes recent mail, groups cleanup candidates, estimates reclaim size, and stores an immutable plan (`gcp-…`).
2. Review the returned summary and candidate counts before authorizing cleanup.
3. `gmail_mailbox_cleanup` accepts only the exact `plan_id`. It rejects missing, expired, cross-company, or unsummarized plans.
4. Execution moves those reviewed message IDs to **Gmail Trash** in bounded batches. Flolah does not permanently delete them.
5. `gmail_mailbox_cleanup_status` reports `completed`, `partial`, or `failed`, including attempted/trashed/failed counts. Do not report success from the request alone.

If Gmail returns a quota/rate-limit response, Flolah preserves that error and paces/retries read-only paging safely. Do not loop destructive calls or fabricate a clean result.

## Create a reply draft

1. Fetch the exact source message/thread using an explicitly granted Gmail read action.
2. Read `connector_get_action_guide` for `gmail.create_email_draft` before the first call in a session.
3. Call `connector_execute_action` with the exact `to`, `subject`, `messageBody` (or `body`), and `threadId` for a threaded reply draft.
4. Verify the returned `draftId` using a granted `gmail.get_draft` or `gmail.list_drafts` action.
5. Tell the CEO that a draft was saved. A draft is **not sent**.

The employee must never invent message/thread IDs, claim a draft was sent, or turn a draft grant into permission to email externally.

## How the controls combine

Connector security is layered:

1. **CEO connection** — selects whose Gmail account is reachable.
2. **Employee tool grant** — allows connector tools or the bounded mailbox tools.
3. **Action-level grant** — names the exact Gmail actions the employee may execute.
4. **Action Control** — decides Autonomous, Approval required, or Prohibited for the operation's risk class.
5. **Immutable plan and audit** — cleanup can touch only reviewed IDs and records the final outcome.

Removing an employee's Gmail action grant does not disconnect the CEO's Gmail account or change grants for other employees.

## Troubleshooting

- **No Gmail connection:** connect Gmail under Connectors and verify the owner account.
- **Unknown or unavailable action:** refresh the app's action catalog and save an action that exists for the connected provider.
- **Action not granted:** open the employee Workspace → Tools access → Connector actions and save the exact action ID.
- **Approval required / prohibited:** review Policies → Action control; the employee cannot self-approve with a request flag.
- **Plan expired:** run a fresh mailbox review; never reuse or reconstruct candidate IDs.
- **Partial cleanup:** inspect status, keep the verified trashed count, and retry only after understanding the failed provider responses.
- **Draft missing:** verify `draftId`; do not substitute a send action.

Related: [Connectors](./16-connectors-openconnector.md), [Policies and guardrails](./10-policies-guardrails.md), [Agent workspaces](./03-dashboard-agents-chat.md), and [API keys vault](./15-api-keys-vault.md).
