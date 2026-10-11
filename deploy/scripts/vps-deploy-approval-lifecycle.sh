#!/usr/bin/env bash
# Merge only this reviewed patch into captured production source; protect parallel
# releases, existing Compose overlays, tenant volumes and image rollback points.
set -euo pipefail
: "${APPROVAL_PATCH:?Reviewed patch required}"
: "${RELEASE_REVISION:?Release identifier required}"
[[ "$RELEASE_REVISION" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
root=/opt/agent-os
release="$root/releases/approval-$RELEASE_REVISION"
[[ ! -e "$release" ]] || { echo 'Release already exists'; exit 1; }
mkdir -p "$release/context/backend" "$release/context/frontend" "$release/context/deploy/docker" "$release/context/deploy/nginx"
chmod 700 "$release"
old_backend="$(docker inspect -f '{{.Image}}' agent-os-backend-1)"
old_frontend="$(docker inspect -f '{{.Image}}' agent-os-frontend-1)"
old_worker="$(docker inspect -f '{{.Image}}' agent-os-knowledge-worker-1)"
backend_tag="$(docker inspect -f '{{.Config.Image}}' agent-os-backend-1)"
frontend_tag="$(docker inspect -f '{{.Config.Image}}' agent-os-frontend-1)"
files="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' agent-os-backend-1)"
docker tag "$old_backend" "agent-os-backend:approval-rollback-$RELEASE_REVISION"
docker tag "$old_frontend" "agent-os-frontend:approval-rollback-$RELEASE_REVISION"
for item in src scripts package.json package-lock.json; do
  docker cp "agent-os-backend-1:/opt/agent-os/backend/$item" "$release/context/backend/$item"
done
# Frontend source comes from the existing deployment checkout, never a stale whole
# local tree. Verify every affected source against that checkout before building.
for item in src scripts public package.json package-lock.json index.html vite.config.js; do
  cp -a "$root/frontend/$item" "$release/context/frontend/$item"
done
cp "$root/THIRD_PARTY_NOTICES.md" "$release/context/"
cp "$root/deploy/docker/frontend.Dockerfile" "$release/context/deploy/docker/"
cp "$root/deploy/nginx/frontend.conf" "$release/context/deploy/nginx/"
cp "$root/.dockerignore" "$release/context/"
cp "$APPROVAL_PATCH" "$release/reviewed.patch"
source_fingerprint() {
  (cd "$root"; find frontend/src frontend/scripts frontend/public frontend/package.json frontend/package-lock.json frontend/index.html frontend/vite.config.js \
    backend/src/services/chat-action-approval.js backend/src/services/action-policy.js backend/src/services/tool-risk-mappings.js \
    backend/src/routes/kanban.js backend/src/routes/platform-notifications.js backend/src/db/seed-content-tools-meta.js \
    backend/package.json -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum)
}
source_before="$(source_fingerprint)"
git -C "$root" apply --check --ignore-space-change "$release/reviewed.patch"
cd "$release/context"
git init -q
git apply --check --ignore-space-change "$release/reviewed.patch"
git apply --ignore-space-change "$release/reviewed.patch"
backend="agent-os-backend:approval-$RELEASE_REVISION"
frontend="agent-os-frontend:approval-$RELEASE_REVISION"
build="agent-os-frontend:approval-build-$RELEASE_REVISION"
docker build --network none -f deploy/docker/backend.approval-lifecycle.Dockerfile \
  --build-arg "BASE_IMAGE=agent-os-backend:approval-rollback-$RELEASE_REVISION" --build-arg "RELEASE_REVISION=$RELEASE_REVISION" -t "$backend" .
for test in test-notify-approval-lifecycle.mjs test-action-policy-autonomy.mjs test-tool-tenant-boundaries.mjs \
  test-channel-user-kanban-actions.mjs test-connector-execution-policy.mjs test-tool-risk-mappings.mjs \
  test-agent-mcp-capability-binding.mjs test-router-planner-focused.mjs test-kanban-sla-policy.mjs test-knowledge-efficiency.mjs; do
  docker run --rm --network none -e NODE_ENV=test --entrypoint node "$backend" "scripts/$test"
done
docker build -f deploy/docker/frontend.Dockerfile --target build --build-arg VITE_API_URL=/api -t "$build" .
docker run --rm --network none --entrypoint npm "$build" run test:action-approval
docker run --rm --network none --entrypoint npm "$build" run test:chat
docker build -f deploy/docker/frontend.Dockerfile --build-arg VITE_API_URL=/api -t "$frontend" .
[[ "$(source_fingerprint)" == "$source_before" ]] || { echo 'Concurrent source change; no cutover'; exit 1; }
[[ "$(docker inspect -f '{{.Image}}' agent-os-backend-1)" == "$old_backend" ]] || exit 1
[[ "$(docker inspect -f '{{.Image}}' agent-os-frontend-1)" == "$old_frontend" ]] || exit 1
[[ "$(docker inspect -f '{{.Image}}' agent-os-knowledge-worker-1)" == "$old_worker" ]] || exit 1
git -C "$root" apply --check --ignore-space-change "$release/reviewed.patch"
compose_release() {
  (cd "$root/deploy"; COMPOSE_FILE="$files" COMPOSE_PATH_SEPARATOR=, docker compose -p agent-os up -d --no-deps --no-build --force-recreate backend frontend)
}
rollback() {
  trap - ERR
  docker tag "$old_backend" "$backend_tag"
  docker tag "$old_frontend" "$frontend_tag"
  compose_release || true
  docker exec agent-os-nginx-1 nginx -s reload || true
  echo 'Captured images restored; no tenant database rollback.'
}
trap rollback ERR
docker tag "$backend" "$backend_tag"
docker tag "$frontend" "$frontend_tag"
compose_release
healthy=false
for attempt in $(seq 1 60); do
  if [[ "$(docker inspect -f '{{.State.Health.Status}}' agent-os-backend-1)" == healthy && \
        "$(docker inspect -f '{{.State.Health.Status}}' agent-os-frontend-1)" == healthy ]]; then healthy=true; break; fi
  sleep 2
done
[[ "$healthy" == true ]]
docker exec agent-os-nginx-1 nginx -t
docker exec agent-os-nginx-1 nginx -s reload
[[ "$(curl -s -o /dev/null -w '%{http_code}' https://login.flolah.cloud/api/kanban/tasks)" == 401 ]]
curl -fsS https://login.flolah.cloud/ >/dev/null
docker exec agent-os-backend-1 node scripts/test-notify-approval-lifecycle.mjs
git -C "$root" apply --ignore-space-change "$release/reviewed.patch"
[[ "$(docker inspect -f '{{.Image}}' agent-os-knowledge-worker-1)" == "$old_worker" ]]
printf 'old_backend=%s\nold_frontend=%s\nsource_release=%s\n' "$old_backend" "$old_frontend" "$RELEASE_REVISION" > "$release/release.txt"
trap - ERR
echo "APPROVAL_LIFECYCLE_DEPLOYED_HEALTHY $RELEASE_REVISION"
