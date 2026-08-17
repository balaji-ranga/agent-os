# TOOLS — Agent OS tools

Invoke tools **by name with JSON parameters**. Follow **AGENT-OS-OPS.md**.

## Live call

The realtime session already streams audio. Prefer:

- **master_data_rag** — FAQs/scripts (`query` keywords; omit `summarize`).
- **crm_list_*** then create lead/person/company/opportunity after dedup.
- **kanban_create_task** — human follow-up.
- **notify_ceo** — true escalation only.
- **ceo_profile** — company identity, not caller identity.

Do **not** call `speech_stt` / `speech_tts` while the WebRTC session is live.

## After hangup

The platform may send you a transcript wrap-up. Then **agent_goal_create** or Kanban/CRM as in SOUL.md. Never pass `owner_user_id`.
