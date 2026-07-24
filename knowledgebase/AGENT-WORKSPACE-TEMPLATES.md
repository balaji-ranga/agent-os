# Agent workspace templates (platform)

Shared (not per-CEO) Markdown workspace templates for custom agents.

## Who can do what

| Actor | Action |
|-------|--------|
| **CEO** | Agent Workspace → pick a **published** template → **Apply** (prepopulates SOUL, AGENTS, MEMORY, TOOLS, IDENTITY, AGENT-OS-OPS). Optionally **Publish this agent as template**. |
| **Admin** | Admin → **Agent workspace templates**: create (draft or publish), edit files, publish / unpublish / delete (cannot delete Platform standard). |

## Default template

**Platform standard template** (`platform-standard`) is seeded on backend startup. It embeds shared Kanban/learnings/tool guidance (same substance as `openclaw-workspace-templates/_shared/AGENT-OS-OPS.md`) into TOOLS + SOUL/AGENTS and stores **AGENT-OS-OPS.md** as `ops`.

OpenClaw bootstrap watcher loads `AGENT-OS-OPS.md` when present.

## APIs

- `GET /api/agents/workspace-templates` — published list (CEO)
- `POST /api/agents/:id/workspace/apply-template` `{ template_id }`
- `POST /api/agents/:id/workspace/publish-template` `{ name?, description? }`
- Admin: `GET|POST /api/admin/workspace-templates`, `PUT …/:id`, `POST …/:id/publish|unpublish`, `DELETE …/:id`

## Smoke test

```bash
docker compose -f deploy/docker-compose.yml exec -T -w /opt/agent-os/backend backend \
  node scripts/vps-test-workspace-templates.js
```
