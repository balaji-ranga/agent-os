#!/usr/bin/env bash
# Backend-only conflict-checked overlay. Does not reset the dirty VPS checkout,
# mutate tenant data, replace frontend/Knowledge worker, or change trading settings.
set -euo pipefail
: "${TENANT_PATCH:?Reviewed patch required}"
: "${RELEASE_REVISION:?Release identifier required}"
[[ "$RELEASE_REVISION" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
root=/opt/agent-os
release="$root/releases/tenant-$RELEASE_REVISION"
[[ ! -e "$release" ]] || { echo 'Release directory already exists'; exit 1; }
mkdir -p "$release/context/backend" "$release/context/deploy/docker"
chmod 700 "$release"
old="$(docker inspect -f '{{.Image}}' agent-os-backend-1)"
tag="$(docker inspect -f '{{.Config.Image}}' agent-os-backend-1)"
frontend="$(docker inspect -f '{{.Image}}' agent-os-frontend-1)"
worker="$(docker inspect -f '{{.Image}}' agent-os-knowledge-worker-1)"
files="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' agent-os-backend-1)"
docker tag "$old" "agent-os-backend:rollback-$RELEASE_REVISION"
for item in src scripts package.json package-lock.json; do
  docker cp "agent-os-backend-1:/opt/agent-os/backend/$item" "$release/context/backend/$item"
done
cp "$TENANT_PATCH" "$release/reviewed.patch"
cd "$release/context"
git init -q
git apply --check --ignore-space-change "$release/reviewed.patch"
git apply --ignore-space-change "$release/reviewed.patch"
candidate="agent-os-backend:tenant-$RELEASE_REVISION"
docker build --network none -f deploy/docker/backend.tenant-boundaries.Dockerfile \
  --build-arg "BASE_IMAGE=agent-os-backend:rollback-$RELEASE_REVISION" \
  --build-arg "RELEASE_REVISION=$RELEASE_REVISION" -t "$candidate" .
for test in test-tool-credential-broker.mjs test-critical-security-hardening.mjs \
  test-action-policy-autonomy.mjs test-connector-execution-policy.mjs \
  test-gmail-mailbox-operations.mjs test-ibkr-portfolio-strategy-sme.mjs \
  test-ibkrnew-sme-evidence.mjs test-router-planner-focused.mjs \
  test-knowledge-controls.mjs test-channel-user-kanban-actions.mjs \
  test-agent-mcp-capability-binding.mjs; do
  docker run --rm --network none -e NODE_ENV=test \
    -e AGENT_OS_INTERNAL_TOKEN=tenant-regression-fixture-internal-token \
    --entrypoint node "$candidate" "scripts/$test"
done
[[ "$(docker inspect -f '{{.Image}}' agent-os-backend-1)" == "$old" ]] || { echo 'Concurrent backend release detected; no cutover'; exit 1; }
[[ "$(docker inspect -f '{{.Image}}' agent-os-frontend-1)" == "$frontend" ]] || exit 1
[[ "$(docker inspect -f '{{.Image}}' agent-os-knowledge-worker-1)" == "$worker" ]] || exit 1
# Persist precisely these reviewed changes in the checkout as well as the image.
# A second apply check protects divergent tracked/uncommitted VPS files.
git -C "$root" apply --check --ignore-space-change "$release/reviewed.patch"
compose_backend() {
  (cd "$root/deploy"; COMPOSE_FILE="$files" COMPOSE_PATH_SEPARATOR=, \
    docker compose -p agent-os up -d --no-deps --no-build --force-recreate backend)
}
rollback() {
  trap - ERR
  docker tag "$old" "$tag"
  compose_backend || true
  docker exec agent-os-nginx-1 nginx -s reload || true
  echo 'Captured backend restored; no database rollback or tenant mutation.'
}
trap rollback ERR
docker tag "$candidate" "$tag"
compose_backend
healthy=false
for attempt in $(seq 1 60); do
  if [[ "$(docker inspect -f '{{.State.Health.Status}}' agent-os-backend-1)" == healthy ]]; then healthy=true; break; fi
  sleep 2
done
[[ "$healthy" == true ]]
docker exec agent-os-nginx-1 nginx -t
docker exec agent-os-nginx-1 nginx -s reload
# HTTP checks hit the deployed service (anonymous only); fixture harness uses the
# running code with a disposable database, not any production tenant's data.
for endpoint in quant-signal/runs strategy-bundles ibkrnew/paper/strategy-status; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "https://login.flolah.cloud/api/ibkr-trading/$endpoint")"
  [[ "$code" == 401 ]] || { echo "Anonymous guard failed: $endpoint status=$code"; exit 1; }
done
docker exec agent-os-backend-1 node scripts/test-tool-tenant-boundaries.mjs
git -C "$root" apply --ignore-space-change "$release/reviewed.patch"
[[ "$(docker inspect -f '{{.Image}}' agent-os-frontend-1)" == "$frontend" ]]
[[ "$(docker inspect -f '{{.Image}}' agent-os-knowledge-worker-1)" == "$worker" ]]
trap - ERR
echo "TENANT_BOUNDARIES_DEPLOYED_HEALTHY $RELEASE_REVISION"
