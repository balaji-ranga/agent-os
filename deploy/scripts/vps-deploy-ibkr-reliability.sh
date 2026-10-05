#!/usr/bin/env bash
# Build an immutable git-archive release while preserving a dirty canonical
# checkout, production Compose configuration, volumes, secrets and OpenClaw.
set -euo pipefail
release="${1:?absolute release directory required}"
revision="${2:?40-character source commit required}"
[[ "$release" == /opt/agent-os-releases/ibkr-* && "$revision" =~ ^[a-f0-9]{40}$ ]] || exit 2
[[ -f "$release/backend/ibkrnew-event-bridge/test/delivery.test.js" ]] || exit 2
cd /opt/agent-os/deploy
sha256sum --status -c /opt/agent-os-checkpoints/ibkr-reliability-20261005/deploy-env.sha256
docker build --label "org.opencontainers.image.revision=$revision" -t "agent-os-backend:ibkr-$revision" -f "$release/deploy/docker/backend.Dockerfile" "$release"
docker build --label "org.opencontainers.image.revision=$revision" -t "agent-os-frontend:ibkr-$revision" -f "$release/deploy/docker/frontend.Dockerfile" "$release"
docker run --rm --network none --entrypoint node "agent-os-backend:ibkr-$revision" scripts/test-ibkrnew-event-trader.mjs
docker run --rm --network none --entrypoint node "agent-os-backend:ibkr-$revision" scripts/test-ibkrnew-delivery-integration.mjs
docker run --rm --network none --entrypoint node "agent-os-backend:ibkr-$revision" scripts/test-ibkrnew-readiness.mjs
docker run --rm --network none --workdir /opt/agent-os/backend/ibkrnew-event-bridge --entrypoint npm "agent-os-backend:ibkr-$revision" test
# Capture the actual currently deployed images, not an obsolete earlier fix.
docker image tag agent-os-backend:latest "agent-os-backend:rollback-ibkr-$revision"
docker image tag agent-os-frontend:latest "agent-os-frontend:rollback-ibkr-$revision"
docker image tag "agent-os-backend:ibkr-$revision" agent-os-backend:latest
docker image tag "agent-os-frontend:ibkr-$revision" agent-os-frontend:latest
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml:docker-compose.vps-client-ip.yml:docker-compose.docker-tools.yml
docker compose up -d --no-deps backend frontend
for attempt in $(seq 1 60); do
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' agent-os-backend-1)" == healthy && "$(docker inspect --format '{{.State.Health.Status}}' agent-os-frontend-1)" == healthy ]]; then
    docker compose exec -T nginx nginx -t
    docker compose exec -T nginx nginx -s reload
    sha256sum --status -c /opt/agent-os-checkpoints/ibkr-reliability-20261005/deploy-env.sha256
    echo "DEPLOYED_HEALTHY $revision"
    exit 0
  fi
  sleep 3
done
docker image tag "agent-os-backend:rollback-ibkr-$revision" agent-os-backend:latest
docker image tag "agent-os-frontend:rollback-ibkr-$revision" agent-os-frontend:latest
docker compose up -d --no-deps backend frontend
docker compose exec -T nginx nginx -s reload || true
echo 'Health deadline exceeded; rollback images restored.' >&2
exit 1
