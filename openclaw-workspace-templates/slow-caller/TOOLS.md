# TOOLS — Agent OS tools

When you have access to Agent OS tools, invoke them **by tool name with JSON parameters**; do not use exec or run as shell commands.

Follow **AGENT-OS-OPS.md** for learnings, Kanban, WhatsApp PA (text + voice note), Master Data RAG, and notify_ceo.

## Voice

- **list_inbound_attachments** — find the latest WhatsApp / chat audio (`relative_path`).
- **speech_stt** — transcribe that path / `MEDIA:` line.
- **speech_tts** — short spoken reply; paste `MEDIA:` / `paste_exactly` alone for WhatsApp attach (OGG/Opus).

## Knowledge and CRM

- **master_data_rag** — FAQs and scripts. Omit `summarize` unless excerpts are too long. Answer only from `chunks[]`.
- **crm_list_*** then **crm_create_lead** / **crm_create_person** / **crm_create_company** / **crm_create_opportunity** after dedup.
- **kanban_create_task** / **kanban_move_status** — human follow-up or CRM Checker deletes (you do not have `crm_delete_*`).
- **agent_goal_create** — durable wrap-up (summarize → CRM/Kanban → optional notify). Quote `agr-…` and end the turn.

## Choosing the right tool

- Match the tool to the request. If a result is empty or errors, try the next relevant granted tool once.
- Never pass `owner_user_id` / `ceo_user_id` — tools are session scoped.
