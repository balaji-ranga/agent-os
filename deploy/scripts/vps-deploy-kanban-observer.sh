#!/usr/bin/env bash
# Backend-only, reviewed overlay. Abort on concurrent source/image changes.
set -euo pipefail
: "${OBSERVER_PATCH:?Reviewed observer patch required}"
: "${RELEASE_REVISION:?Release identifier required}"
[[ "$RELEASE_REVISION" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
root=/opt/agent-os
release="$root/releases/kanban-observer-$RELEASE_REVISION"
[[ ! -e "$release" ]] || { echo 'Release already exists'; exit 1; }
mkdir -p "$release/context/backend" "$release/context/deploy/docker" "$release/context/deploy/scripts"
chmod 700 "$release"
old_backend="$(docker inspect -f '{{.Image}}' agent-os-backend-1)"
old_frontend="$(docker inspect -f '{{.Image}}' agent-os-frontend-1)"
old_worker="$(docker inspect -f '{{.Image}}' agent-os-knowledge-worker-1)"
backend_tag="$(docker inspect -f '{{.Config.Image}}' agent-os-backend-1)"
files="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' agent-os-backend-1)"
docker tag "$old_backend" "agent-os-backend:kanban-observer-rollback-$RELEASE_REVISION"
for item in src scripts package.json package-lock.json; do
  docker cp "agent-os-backend-1:/opt/agent-os/backend/$item" "$release/context/backend/$item"
done
if [[ -f "$root/deploy/docker/backend.kanban-observer.Dockerfile" ]]; then
  cp "$root/deploy/docker/backend.kanban-observer.Dockerfile" "$release/context/deploy/docker/"
fi
for file in deploy/KANBAN_TASK_OBSERVER.md deploy/scripts/vps-deploy-kanban-observer.sh; do
  if [[ -f "$root/$file" ]]; then cp "$root/$file" "$release/context/$file"; fi
done
cp "$OBSERVER_PATCH" "$release/reviewed.patch"
source_fingerprint() {
  (cd "$root"; git apply --numstat "$release/reviewed.patch" | cut -f3 | while IFS= read -r file; do
    if [[ -f "$file" ]]; then sha256sum "$file"; else printf 'absent %s\n' "$file"; fi
  done) | sha256sum
}
source_before="$(source_fingerprint)"
git -C "$root" apply --check --ignore-space-change "$release/reviewed.patch"
cd "$release/context"
git init -q
git apply --check --ignore-space-change "$release/reviewed.patch"
git apply --ignore-space-change "$release/reviewed.patch"
backend="agent-os-backend:kanban-observer-$RELEASE_REVISION"
docker build --network none -f deploy/docker/backend.kanban-observer.Dockerfile \
  --build-arg "BASE_IMAGE=agent-os-backend:kanban-observer-rollback-$RELEASE_REVISION" --build-arg "RELEASE_REVISION=$RELEASE_REVISION" -t "$backend" .
for test in test-kanban-task-observer.mjs test-observer-recovery-completion.mjs test-agent-actions-live.mjs test-notify-approval-lifecycle.mjs \
  test-channel-user-kanban-actions.mjs test-tool-tenant-boundaries.mjs test-efficiency-controls.mjs \
  test-kanban-sla-policy.mjs test-human-goal-kanban-delete-lifecycle.mjs test-kanban-status-only-reply.js test-action-policy-autonomy.mjs; do
  docker run --rm --network none -e NODE_ENV=test --entrypoint node "$backend" "scripts/$test"
done
[[ "$(source_fingerprint)" == "$source_before" ]] || { echo 'Concurrent source change; no cutover'; exit 1; }
[[ "$(docker inspect -f '{{.Image}}' agent-os-backend-1)" == "$old_backend" ]] || exit 1
[[ "$(docker inspect -f '{{.Image}}' agent-os-frontend-1)" == "$old_frontend" ]] || exit 1
[[ "$(docker inspect -f '{{.Image}}' agent-os-knowledge-worker-1)" == "$old_worker" ]] || exit 1
git -C "$root" apply --check --ignore-space-change "$release/reviewed.patch"
# Consistent SQLite backup before starting code that can reconcile task statuses.
# Private release directory; never print or export tenant data to the client.
docker exec -i agent-os-backend-1 node --input-type=module <<'JS'
import Database from 'better-sqlite3';
import { join } from 'node:path';
const db = new Database(join(process.env.AGENT_OS_DATA_DIR || '/opt/agent-os/backend/data', 'agent-os.db'), { readonly: true, fileMustExist: true });
await db.backup('/tmp/kanban-observer-predeploy.db');
db.close();
JS
docker cp agent-os-backend-1:/tmp/kanban-observer-predeploy.db "$release/predeploy.db"
chmod 600 "$release/predeploy.db"
compose_release() {
  (cd "$root/deploy"; COMPOSE_FILE="$files" COMPOSE_PATH_SEPARATOR=, docker compose -p agent-os up -d --no-deps --no-build --force-recreate backend)
}
rollback() {
  trap - ERR
  docker tag "$old_backend" "$backend_tag"
  compose_release || true
  docker exec agent-os-nginx-1 nginx -s reload || true
  echo 'Captured backend image restored; no tenant-data rollback.'
}
trap rollback ERR
docker tag "$backend" "$backend_tag"
compose_release
healthy=false
for attempt in $(seq 1 30); do
  if [[ "$(docker inspect -f '{{.State.Health.Status}}' agent-os-backend-1)" == healthy ]]; then healthy=true; break; fi
  sleep 2
done
[[ "$healthy" == true ]]
docker exec agent-os-nginx-1 nginx -t
docker exec agent-os-nginx-1 nginx -s reload
[[ "$(curl -s -o /dev/null -w '%{http_code}' https://login.flolah.cloud/api/kanban/tasks)" == 401 ]]
curl -fsS https://login.flolah.cloud/ >/dev/null
docker exec agent-os-backend-1 node scripts/test-kanban-task-observer.mjs
git -C "$root" apply --ignore-space-change "$release/reviewed.patch"
[[ "$(docker inspect -f '{{.Image}}' agent-os-frontend-1)" == "$old_frontend" ]]
[[ "$(docker inspect -f '{{.Image}}' agent-os-knowledge-worker-1)" == "$old_worker" ]]
printf 'old_backend=%s\nnew_backend=%s\nrevision=%s\n' "$old_backend" "$(docker inspect -f '{{.Image}}' agent-os-backend-1)" "$RELEASE_REVISION" > "$release/release.txt"
trap - ERR
echo "KANBAN_OBSERVER_DEPLOYED_HEALTHY $RELEASE_REVISION"
