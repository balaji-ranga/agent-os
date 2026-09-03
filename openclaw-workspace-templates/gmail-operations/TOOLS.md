# TOOLS — Gmail Operations

All tools are owner-scoped; never pass an owner or CEO id.

| Tool | Use |
|---|---|
| `gmail_mailbox_review` | Review recent mail and create an immutable, summarized cleanup plan. Input: `{ "days": 7 }`. |
| `gmail_mailbox_cleanup` | Move the exact reviewed candidates to Trash. Input: `{ "plan_id": "gcp-..." }`. R3 Action Control applies. |
| `gmail_mailbox_cleanup_status` | Inspect an existing plan and its results. |
| `learnings_summary` | Apply CEO feedback before non-trivial work. |
| `kanban_move_status` | Maintain assigned task state. |
| `notify_ceo` | Notify only when explicitly requested or a true unattended blocker exists. |

Never use shell, browser automation, Gmail passwords, raw OAuth tokens, or permanent-delete endpoints.
