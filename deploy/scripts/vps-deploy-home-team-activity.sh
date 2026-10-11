#!/usr/bin/env bash
# Gated Home-only release, preserving parallel backend features and Compose overlays.
# Capture image IDs before syncing the reviewed, conflict-checked source files.
set -euo pipefail
ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT"
: "${EXPECTED_BACKEND_IMAGE:?Capture the running backend image first}"
: "${EXPECTED_FRONTEND_IMAGE:?Capture the running frontend image first}"
: "${RELEASE_REVISION:?Supply the tested source release identifier}"
[[ "$RELEASE_REVISION" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
check_images() {
  [[ "$(docker inspect --format '{{.Image}}' agent-os-backend-1)" == "$EXPECTED_BACKEND_IMAGE" &&
     "$(docker inspect --format '{{.Image}}' agent-os-frontend-1)" == "$EXPECTED_FRONTEND_IMAGE" ]] || {
    echo 'Concurrent deployment detected; reconcile before cutover.' >&2; return 1;
  }
}
check_images
backend_tag="$(docker inspect --format '{{.Config.Image}}' agent-os-backend-1)"
frontend_tag="$(docker inspect --format '{{.Config.Image}}' agent-os-frontend-1)"
backend_rollback="agent-os-backend:home-rollback-$RELEASE_REVISION"
frontend_rollback="agent-os-frontend:home-rollback-$RELEASE_REVISION"
backend_release="agent-os-backend:home-$RELEASE_REVISION"
frontend_release="agent-os-frontend:home-$RELEASE_REVISION"
frontend_build="agent-os-frontend:home-build-$RELEASE_REVISION"
docker image tag "$EXPECTED_BACKEND_IMAGE" "$backend_rollback"
docker image tag "$EXPECTED_FRONTEND_IMAGE" "$frontend_rollback"

# Detect a parallel source sync during the build, not just a container replacement.
source_fingerprint() {
  find frontend/src frontend/public frontend/scripts backend/src/routes/home.js \
    backend/src/services/home-team-activity.js backend/scripts/test-home-team-activity.mjs \
    backend/scripts/vps-test-home-team-activity-live.mjs \
    backend/package.json frontend/package.json frontend/package-lock.json \
    deploy/docker/frontend.Dockerfile deploy/docker/backend.home-team-activity.Dockerfile \
    deploy/nginx/frontend.conf THIRD_PARTY_NOTICES.md -type f -print0 \
    | sort -z | xargs -0 sha256sum | sha256sum
}
sources_before="$(source_fingerprint)"
docker build -f deploy/docker/backend.home-team-activity.Dockerfile \
  --build-arg "BASE_IMAGE=$backend_rollback" --build-arg "RELEASE_REVISION=$RELEASE_REVISION" \
  -t "$backend_release" .
for test in test-home-team-activity.mjs test-chat-live-activity.mjs test-agent-chat-work-history.mjs; do
  docker run --rm --network none --entrypoint node "$backend_release" "scripts/$test"
done
docker build -f deploy/docker/frontend.Dockerfile --target build \
  --build-arg VITE_API_URL=/api -t "$frontend_build" .
docker run --rm --network none --entrypoint npm "$frontend_build" run test:home-team-activity
docker build -f deploy/docker/frontend.Dockerfile --build-arg VITE_API_URL=/api -t "$frontend_release" .
[[ "$(source_fingerprint)" == "$sources_before" ]] || {
  echo 'Source changed during build; refusing cutover.' >&2; exit 1;
}
check_images
checkpoint="$ROOT/releases/home-$RELEASE_REVISION"
mkdir -p "$checkpoint"
chmod 700 "$checkpoint"
printf 'old_backend=%s\nold_frontend=%s\nnew_backend=%s\nnew_frontend=%s\nsource_release=%s\n' \
  "$EXPECTED_BACKEND_IMAGE" "$EXPECTED_FRONTEND_IMAGE" \
  "$(docker image inspect --format '{{.Id}}' "$backend_release")" \
  "$(docker image inspect --format '{{.Id}}' "$frontend_release")" "$RELEASE_REVISION" \
  > "$checkpoint/release.txt"
source "$ROOT/deploy/scripts/compose-file-defaults.sh"
export_vps_compose_file "$ROOT/deploy/.env"
cd "$ROOT/deploy"
docker image tag "$backend_release" "$backend_tag"
docker image tag "$frontend_release" "$frontend_tag"
rollback() {
  echo 'Home cutover failed; restoring captured images without restoring database writes.' >&2
  docker image tag "$backend_rollback" "$backend_tag"
  docker image tag "$frontend_rollback" "$frontend_tag"
  docker compose up -d --no-deps --no-build --force-recreate backend frontend
  docker compose exec -T nginx nginx -s reload || true
}
if ! docker compose up -d --no-deps --no-build --force-recreate backend frontend; then
  rollback; exit 1
fi
for attempt in $(seq 1 100); do
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' agent-os-backend-1)" == healthy &&
        "$(docker inspect --format '{{.State.Health.Status}}' agent-os-frontend-1)" == healthy ]]; then
    if docker compose exec -T nginx nginx -t && docker compose exec -T nginx nginx -s reload &&
       bash "$ROOT/deploy/scripts/assert-vps-ingress.sh"; then
      echo "HOME_DEPLOYED_HEALTHY $RELEASE_REVISION"
      exit 0
    fi
    break
  fi
  sleep 3
done
rollback
exit 1
