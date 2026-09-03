# TOOLS — Gmail Operations

All tools are owner-scoped; never pass an owner or CEO id.

| Tool | Use |
|---|---|
| `gmail_mailbox_review` | Review recent mail and create an immutable, summarized cleanup plan. Input: `{ "days": 7 }`. |
| `gmail_mailbox_cleanup` | Move the exact reviewed candidates to Trash. Input: `{ "plan_id": "gcp-..." }`. R3 Action Control applies. |
| `gmail_mailbox_cleanup_status` | Inspect an existing plan and its results. |
| `connector_search_actions` | Discover the connected Gmail action id when needed. |
| `connector_get_action_guide` | Read the required input schema before executing a connector action. |
| `connector_execute_action` | Execute only action-level-granted Gmail actions. Use `gmail.create_email_draft` (or `gmail.create_draft`) to save drafts. Sending and destructive actions are not granted. |
| `learnings_summary` | Apply CEO feedback before non-trivial work. |
| `kanban_move_status` | Maintain assigned task state. |
| `notify_ceo` | Notify only when explicitly requested or a true unattended blocker exists. |

Never use shell, browser automation, Gmail passwords, raw OAuth tokens, send actions, or permanent-delete endpoints.
