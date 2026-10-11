#!/usr/bin/env bash
# Scoped release against captured deployed code; never replace unrelated VPS edits.
set -euo pipefail
: "${KNOWLEDGE_PATCH:?Reviewed patch required}"
: "${RELEASE_REVISION:?Release identifier required}"
[[ "$RELEASE_REVISION" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
root=/opt/agent-os
release="$root/releases/knowledge-$RELEASE_REVISION"
[[ ! -e "$release" ]] || { echo 'Release directory already exists'; exit 1; }
mkdir -p "$release/context/backend" "$release/context/frontend" "$release/context/deploy/docker"
chmod 700 "$release"
declare -A old tags
for service in backend frontend knowledge-worker; do
  name="agent-os-$service-1"
  old[$service]="$(docker inspect -f '{{.Image}}' "$name")"
  tags[$service]="$(docker inspect -f '{{.Config.Image}}' "$name")"
  docker tag "${old[$service]}" "agent-os-$service:rollback-$RELEASE_REVISION"
done
for item in src scripts package.json package-lock.json; do
  docker cp "agent-os-backend-1:/opt/agent-os/backend/$item" "$release/context/backend/$item"
done
tar -C "$root/frontend" --exclude=node_modules --exclude=dist --exclude='.env*' -cf - . | tar -C "$release/context/frontend" -xf -
cp "$root/deploy/docker/"{backend.knowledge,frontend.knowledge,knowledge-worker}.Dockerfile "$release/context/deploy/docker/"
cd "$release/context"
git init -q
git apply --check --ignore-space-change "$KNOWLEDGE_PATCH"
git apply --ignore-space-change "$KNOWLEDGE_PATCH"
test -f backend/src/services/knowledge-processing-state.js
grep -q test-knowledge-processing-state backend/package.json
docker build -f deploy/docker/backend.knowledge.Dockerfile --build-arg "BASE_IMAGE=agent-os-backend:rollback-$RELEASE_REVISION" --build-arg "RELEASE_REVISION=$RELEASE_REVISION" -t "agent-os-backend:knowledge-$RELEASE_REVISION" .
docker build -f deploy/docker/frontend.knowledge.Dockerfile --build-arg "BASE_IMAGE=agent-os-frontend:rollback-$RELEASE_REVISION" --build-arg "RELEASE_REVISION=$RELEASE_REVISION" -t "agent-os-frontend:knowledge-$RELEASE_REVISION" .
docker build -f deploy/docker/knowledge-worker.Dockerfile --build-arg "BACKEND_IMAGE=agent-os-backend:knowledge-$RELEASE_REVISION" -t "flolah-knowledge-worker:knowledge-$RELEASE_REVISION" .
docker run --rm --network none --entrypoint node "agent-os-backend:knowledge-$RELEASE_REVISION" scripts/test-knowledge-incremental.mjs
# Keep runtime credentials on the server, never print them. The candidate has
# no production data mounts; the live search test uses a random disposable index.
(umask 077; docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' agent-os-backend-1 > "$release/runtime.env")
docker run --rm --network container:agent-os-backend-1 --env-file "$release/runtime.env" --entrypoint node "agent-os-backend:knowledge-$RELEASE_REVISION" scripts/test-knowledge-opensearch.mjs
rm -- "$release/runtime.env"
for service in backend frontend knowledge-worker; do
  [[ "$(docker inspect -f '{{.Image}}' "agent-os-$service-1")" == "${old[$service]}" ]] || { echo 'Concurrent release detected; no cutover'; exit 1; }
done
docker exec -e KNOWLEDGE_BACKUP_FILE="/tmp/knowledge-$RELEASE_REVISION.db" agent-os-backend-1 node --input-type=module -e 'import {getDb} from "./src/db/schema.js"; await getDb().backup(process.env.KNOWLEDGE_BACKUP_FILE);'
docker cp "agent-os-backend-1:/tmp/knowledge-$RELEASE_REVISION.db" "$release/database-before.db"
chmod 600 "$release/database-before.db"
compose_service() {
  local service="$1" files
  files="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "agent-os-$service-1")"
  if [[ "$service" == backend && "$files" != *docker-compose.knowledge-api.yml* ]]; then
    test -f "$root/deploy/docker-compose.knowledge-api.yml"
    files="$files,$root/deploy/docker-compose.knowledge-api.yml"
  fi
  (cd "$root/deploy"; COMPOSE_FILE="$files" COMPOSE_PATH_SEPARATOR=, docker compose -p agent-os up -d --no-deps --no-build --force-recreate "$service")
}
rollback() {
  trap - ERR
  for service in backend frontend knowledge-worker; do docker tag "${old[$service]}" "${tags[$service]}"; compose_service "$service" || true; done
  docker exec agent-os-nginx-1 nginx -s reload || true
  echo 'Captured images restored; database was not rolled back.'
}
trap rollback ERR
docker tag "agent-os-backend:knowledge-$RELEASE_REVISION" "${tags[backend]}"
docker tag "agent-os-frontend:knowledge-$RELEASE_REVISION" "${tags[frontend]}"
docker tag "flolah-knowledge-worker:knowledge-$RELEASE_REVISION" "${tags[knowledge-worker]}"
for service in backend frontend knowledge-worker; do compose_service "$service"; done
healthy=false
for attempt in $(seq 1 60); do
  if [[ "$(docker inspect -f '{{.State.Health.Status}}' agent-os-backend-1)" == healthy && "$(docker inspect -f '{{.State.Health.Status}}' agent-os-frontend-1)" == healthy ]]; then healthy=true; break; fi
  sleep 3
done
[[ "$healthy" == true ]]
docker exec agent-os-nginx-1 nginx -t
docker exec agent-os-nginx-1 nginx -s reload
trap - ERR
echo "KNOWLEDGE_DEPLOYED_HEALTHY $RELEASE_REVISION"
