#!/usr/bin/env bash
# Preserve the parallel deployment. Build/gate before backend-only cutover.
set -euo pipefail
ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT"
: "${EXPECTED_BACKEND_IMAGE:?Capture and inspect the running immutable backend image first}"
: "${RELEASE_REVISION:?Supply the tested source revision}"
[[ "$RELEASE_REVISION" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
current="$(docker inspect --format '{{.Image}}' agent-os-backend-1)"
[[ "$current" == "$EXPECTED_BACKEND_IMAGE" ]] || { echo 'Concurrent backend release detected; reconcile before deployment.' >&2; exit 1; }
image_tag="$(docker inspect --format '{{.Config.Image}}' agent-os-backend-1)"
release_tag="agent-os-backend:efficiency-$RELEASE_REVISION"
rollback_tag="agent-os-backend:efficiency-rollback-$RELEASE_REVISION"
docker image tag "$current" "$rollback_tag"
# BuildKit resolves a bare sha256 ID as a registry name. The private checkpoint
# tag pins the captured local image; verify its ID before and after the build.
[[ "$(docker image inspect --format '{{.Id}}' "$rollback_tag")" == "$current" ]] || exit 1
docker build -f deploy/docker/backend.efficiency.Dockerfile --build-arg "BASE_IMAGE=$rollback_tag" --build-arg "RELEASE_REVISION=$RELEASE_REVISION" -t "$release_tag" .
[[ "$(docker image inspect --format '{{.Id}}' "$rollback_tag")" == "$current" ]] || exit 1
for test in test-efficiency-ollama-transport.mjs test-efficiency-controls.mjs test-model-routing-registry.mjs test-router-planner-focused.mjs test-work-steering.mjs test-steering-completion.mjs test-chat-live-activity.mjs; do
  docker run --rm --network none --entrypoint node "$release_tag" "scripts/$test"
done
# The BYOK fixture must not inherit the image's production OpenClaw path.
docker run --rm --network none -e OPENCLAW_CONFIG_PATH= -e MODEL_ROUTING_ENABLED=0 --entrypoint node "$release_tag" scripts/test-user-dual-byok-e2e.mjs
[[ "$(docker inspect --format '{{.Image}}' agent-os-backend-1)" == "$current" ]] || { echo 'Concurrent backend release detected during build.' >&2; exit 1; }
checkpoint="$ROOT/releases/efficiency-$RELEASE_REVISION"
mkdir -p "$checkpoint"
chmod 700 "$checkpoint"
docker exec -e EFFICIENCY_BACKUP_PATH="/tmp/efficiency-$RELEASE_REVISION.db" agent-os-backend-1 node --input-type=module -e 'import {getDb} from "./src/db/schema.js"; const db=getDb(); await db.backup(process.env.EFFICIENCY_BACKUP_PATH); db.close();'
docker cp "agent-os-backend-1:/tmp/efficiency-$RELEASE_REVISION.db" "$checkpoint/database-before.db"
chmod 600 "$checkpoint/database-before.db"
printf 'old_image=%s\nnew_image=%s\nrollback_tag=%s\nsource_revision=%s\n' "$current" "$(docker image inspect --format '{{.Id}}' "$release_tag")" "$rollback_tag" "$RELEASE_REVISION" > "$checkpoint/release.txt"
source "$ROOT/deploy/scripts/compose-file-defaults.sh"
export_vps_compose_file "$ROOT/deploy/.env"
cd "$ROOT/deploy"
docker image tag "$release_tag" "$image_tag"
rollback() {
  echo 'Cutover failed; restoring captured backend image (never restoring DB over ongoing writes).' >&2
  docker image tag "$rollback_tag" "$image_tag"
  docker compose up -d --no-deps --no-build --force-recreate backend
  docker compose exec -T nginx nginx -s reload || true
}
if ! docker compose up -d --no-deps --no-build --force-recreate backend; then rollback; exit 1; fi
for attempt in $(seq 1 100); do
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' agent-os-backend-1)" == healthy ]]; then
    if docker compose exec -T nginx nginx -t && docker compose exec -T nginx nginx -s reload; then
      echo "EFFICIENCY_DEPLOYED_HEALTHY $RELEASE_REVISION"
      exit 0
    fi
    break
  fi
  sleep 3
done
rollback
exit 1
