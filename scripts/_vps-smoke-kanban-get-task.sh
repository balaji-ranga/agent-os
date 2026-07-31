#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
TASK_JSON=$(docker compose exec -T backend node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
initDb();
const db = getDb();
const row = db.prepare(
  `SELECT k.id, k.title, k.status, k.owner_user_id,
          length(COALESCE(d.response_content,'')) AS resp_len
   FROM kanban_tasks k
   LEFT JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
   WHERE k.status = 'completed'
     AND length(COALESCE(d.response_content,'')) > 40
   ORDER BY k.id DESC LIMIT 1`
).get();
if (!row) { console.error('No completed Kanban task'); process.exit(1); }
console.log(JSON.stringify(row));
NODE
)
echo "TASK_PICK=$TASK_JSON"
TASK_ID=$(printf '%s' "$TASK_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
OWNER=$(printf '%s' "$TASK_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("owner_user_id") or "")')
echo "task_id=$TASK_ID owner=$OWNER"
TOOLS_KEY=$(grep -E '^TOOLS_API_KEY=' /opt/agent-os/deploy/.env | head -1 | cut -d= -f2- | tr -d '"'"'"'')
AGENT_HDR="t-${OWNER}--balserve"
RESP=$(curl -sS -X POST http://127.0.0.1:3001/api/tools/kanban-get-task \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOOLS_KEY}" \
  -H "x-openclaw-agent-id: ${AGENT_HDR}" \
  -d "{\"task_id\": ${TASK_ID}, \"owner_user_id\": \"${OWNER}\"}")
printf '%s' "$RESP" > /tmp/kanban-get-task-smoke.json
python3 - <<'PY'
import json
j=json.load(open("/tmp/kanban-get-task-smoke.json"))
out={
  "ok": j.get("ok"),
  "task_id": j.get("task_id"),
  "status": j.get("status"),
  "title": str(j.get("title") or "")[:80],
  "has_deliverable": bool(str(j.get("deliverable") or "").strip()),
  "deliverable_len": len(str(j.get("deliverable") or "")),
  "has_delegation_response": bool(str(j.get("delegation_response") or "").strip()),
  "delegation_response_len": len(str(j.get("delegation_response") or "")),
  "messages": len(j.get("messages") or []),
  "chat_turns": (j.get("chat_context") or {}).get("turn_count"),
  "chat_source": (j.get("chat_context") or {}).get("source"),
  "artifact_count": j.get("artifact_count"),
  "done": j.get("done"),
  "error": j.get("error"),
  "deliverable_preview": str(j.get("deliverable") or j.get("delegation_response") or "").replace("\n"," ")[:160],
}
print(json.dumps(out, indent=2))
if not j.get("ok"):
  raise SystemExit(2)
if not out["has_deliverable"] and not out["has_delegation_response"] and out["messages"]==0 and not (out["chat_turns"] or 0)>0:
  raise SystemExit("SMOKE_FAIL: no content")
print("KANBAN_GET_TASK_CONTENT_SMOKE_OK")
PY
grep -q deliverable /opt/agent-os/openclaw-workspace-templates/balserve/TOOLS.md && echo TOOLS_OK
grep -q kanban_get_task /opt/agent-os/openclaw-workspace-templates/_shared/AGENT-OS-OPS.md && echo OPS_OK
# also confirm loader is in running container
docker compose exec -T backend grep -q loadKanbanTaskContent /app/src/services/kanban-watch.js && echo LOADER_IN_IMAGE_OK