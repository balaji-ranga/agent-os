#!/usr/bin/env bash
# Source-controlled backend-only release. Does not run the full regression pack.
# Usage: bash deploy/scripts/vps-deploy-backend-focused.sh
set -euo pipefail
ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo 'Refusing release: tracked VPS source is dirty.' >&2; exit 1
fi
revision="$(git rev-parse HEAD)"
old_image="$(docker inspect --format '{{.Image}}' agent-os-backend-1)"
image_tag="$(docker inspect --format '{{.Config.Image}}' agent-os-backend-1)"
checkpoint="agent-os-backend:rollback-${revision:0:12}"
docker image tag "$old_image" "$checkpoint"
echo "Backend checkpoint: $checkpoint ($old_image); releasing $revision"
source "$ROOT/deploy/scripts/compose-file-defaults.sh"
export_vps_compose_file "$ROOT/deploy/.env"
cd "$ROOT/deploy"
# Build and test before touching the healthy running backend.
docker compose build backend
docker run --rm --network none --entrypoint node "$image_tag" scripts/test-router-planner-focused.mjs
docker compose up -d --no-deps --force-recreate backend
for attempt in $(seq 1 140); do
  status="$(docker inspect --format '{{.State.Health.Status}}' agent-os-backend-1)"
  if [[ "$status" == healthy ]]; then
    docker compose exec -T nginx nginx -t
    docker compose exec -T nginx nginx -s reload
    echo "DEPLOYED_HEALTHY $revision"
    exit 0
  fi
  sleep 3
done
echo "Backend health deadline exceeded. Restoring image $checkpoint" >&2
docker image tag "$checkpoint" "$image_tag"
docker compose up -d --no-deps --force-recreate backend
docker compose exec -T nginx nginx -s reload || true
echo 'Rollback image restored; source revision retained for diagnosis. Check health.' >&2
exit 1
