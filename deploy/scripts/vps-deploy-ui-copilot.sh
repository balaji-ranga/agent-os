#!/usr/bin/env bash
# Additive API/UI release. No gateway recreation, credentials or volume changes.
set -euo pipefail
: "${COPILOT_PATCH:?Reviewed Git patch required}"
: "${RELEASE_REVISION:?Release identifier required}"
[[ "$RELEASE_REVISION" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
root=/opt/agent-os
release="$root/releases/copilot-$RELEASE_REVISION"
[[ ! -e "$release" ]] || { echo 'Release directory already exists'; exit 1; }
mkdir -p "$release/context/backend" "$release/context/frontend" "$release/context/openclaw-workspace-templates" "$release/context/knowledgebase"
chmod 700 "$release"
declare -A old configs
for service in backend frontend; do
  old[$service]="$(docker inspect -f '{{.Image}}' "agent-os-$service-1")"
  configs[$service]="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "agent-os-$service-1")"
  docker tag "${old[$service]}" "agent-os-$service:copilot-rollback-$RELEASE_REVISION"
done
gateway="$(docker inspect -f '{{.Id}} {{.State.StartedAt}}' agent-os-openclaw-1)"
for item in src scripts package.json package-lock.json; do
  docker cp "agent-os-backend-1:/opt/agent-os/backend/$item" "$release/context/backend/$item"
done
docker cp agent-os-backend-1:/opt/agent-os/openclaw-workspace-templates/platformhelp "$release/context/openclaw-workspace-templates/platformhelp"
docker cp agent-os-backend-1:/opt/agent-os/knowledgebase/platform-help "$release/context/knowledgebase/platform-help"
previous_revision="$(docker inspect -f '{{index .Config.Labels "org.flolah.copilot.revision"}}' agent-os-frontend-1)"
frontend_source="$root/frontend"
if [[ -n "$previous_revision" && "$previous_revision" != '<no value>' ]]; then
  [[ "$previous_revision" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
  previous_context="$root/releases/copilot-$previous_revision/context"
  [[ -d "$previous_context/frontend" && -d "$previous_context/deploy" ]] || { echo 'Running release source missing; refusing stale-source rebuild'; exit 1; }
  frontend_source="$previous_context/frontend"
  cp -a "$previous_context/deploy" "$release/context/deploy"
fi
tar -C "$frontend_source" --exclude=node_modules --exclude=dist --exclude='.env*' -cf - . | tar -C "$release/context/frontend" -xf -
cd "$release/context"
git init -q
git apply --check --ignore-space-change "$COPILOT_PATCH"
git apply --ignore-space-change "$COPILOT_PATCH"
docker build -f deploy/docker/backend.copilot.Dockerfile --build-arg "BASE_IMAGE=agent-os-backend:copilot-rollback-$RELEASE_REVISION" --build-arg "RELEASE_REVISION=$RELEASE_REVISION" -t "agent-os-backend:copilot-$RELEASE_REVISION" .
docker build -f deploy/docker/frontend.copilot.Dockerfile --build-arg "BASE_IMAGE=agent-os-frontend:copilot-rollback-$RELEASE_REVISION" --build-arg "RELEASE_REVISION=$RELEASE_REVISION" -t "agent-os-frontend:copilot-$RELEASE_REVISION" .
for service in backend frontend; do
  [[ "$(docker inspect -f '{{.Image}}' "agent-os-$service-1")" == "${old[$service]}" ]] || { echo 'Concurrent deployment detected; no cutover'; exit 1; }
done
docker exec -e "COPILOT_BACKUP=/tmp/copilot-$RELEASE_REVISION.db" agent-os-backend-1 node --input-type=module -e 'import {getDb} from "./src/db/schema.js"; await getDb().backup(process.env.COPILOT_BACKUP);'
docker cp "agent-os-backend-1:/tmp/copilot-$RELEASE_REVISION.db" "$release/database-before.db"
chmod 600 "$release/database-before.db"
recreate() {
  local service="$1" image="$2" override="$release/$1.override.yml"
  printf 'services:\n  %s:\n    image: %s\n' "$service" "$image" > "$override"
  (cd "$root/deploy"; COMPOSE_FILE="${configs[$service]},$override" COMPOSE_PATH_SEPARATOR=, docker compose -p agent-os up -d --no-deps --no-build --force-recreate "$service")
}
rollback() {
  trap - ERR
  for service in backend frontend; do recreate "$service" "agent-os-$service:copilot-rollback-$RELEASE_REVISION" || true; done
  docker exec agent-os-nginx-1 nginx -s reload || true
  echo 'Captured API/UI images restored. Database and gateway were not rolled back.'
}
trap rollback ERR
for service in backend frontend; do recreate "$service" "agent-os-$service:copilot-$RELEASE_REVISION"; done
healthy=false
for attempt in $(seq 1 60); do
  if [[ "$(docker inspect -f '{{.State.Health.Status}}' agent-os-backend-1)" == healthy && "$(docker inspect -f '{{.State.Health.Status}}' agent-os-frontend-1)" == healthy ]]; then healthy=true; break; fi
  sleep 3
done
[[ "$healthy" == true ]]
docker exec agent-os-nginx-1 nginx -t
docker exec agent-os-nginx-1 nginx -s reload
[[ "$(docker inspect -f '{{.Id}} {{.State.StartedAt}}' agent-os-openclaw-1)" == "$gateway" ]]
trap - ERR
echo "COPILOT_DEPLOYED_HEALTHY $RELEASE_REVISION"
