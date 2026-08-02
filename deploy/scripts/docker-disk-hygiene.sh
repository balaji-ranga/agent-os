#!/usr/bin/env bash
# Reclaim Docker disk after Agent OS builds without touching app data or onboarded tools.
#
# Safe targets:
#   - BuildKit / containerd build cache (main disk growth from frequent compose build)
#   - Known leftover test containers (e.g. oc-fix-ep)
#   - Dangling (<none>) images
#
# Does NOT remove:
#   - Running compose services / volumes (DB, OpenClaw home, Ollama models, …)
#   - Admin-onboarded tool containers (label agent-os.managed=1 / docker_onboarded_tools)
#
# Usage:
#   bash deploy/scripts/docker-disk-hygiene.sh
#   DOCKER_BUILDER_PRUNE_UNTIL=72h bash deploy/scripts/docker-disk-hygiene.sh
#   DOCKER_BUILDER_PRUNE_ALL=1 bash deploy/scripts/docker-disk-hygiene.sh   # full cache wipe
#   SKIP_DOCKER_PRUNE=1 bash deploy/scripts/docker-disk-hygiene.sh          # leftovers only
#
# Env:
#   SKIP_DOCKER_PRUNE=1              Skip builder prune (still removes known leftovers)
#   DOCKER_BUILDER_PRUNE_ALL=1       prune -af with no age filter (slow next build)
#   DOCKER_BUILDER_PRUNE_UNTIL=72h   Keep recent cache; drop older (default for ongoing)
#   SKIP_DANGLING_IMAGE_PRUNE=1      Do not run docker image prune -f
set -euo pipefail

SKIP_DOCKER_PRUNE="${SKIP_DOCKER_PRUNE:-0}"
DOCKER_BUILDER_PRUNE_ALL="${DOCKER_BUILDER_PRUNE_ALL:-0}"
DOCKER_BUILDER_PRUNE_UNTIL="${DOCKER_BUILDER_PRUNE_UNTIL:-72h}"
SKIP_DANGLING_IMAGE_PRUNE="${SKIP_DANGLING_IMAGE_PRUNE:-0}"

echo "==> docker disk hygiene"

# Leftover one-off / rename conflicts (never part of the live stack)
for name in oc-fix-ep agent-os-deepseek-1; do
  if docker ps -aq --filter "name=^/${name}$" 2>/dev/null | grep -q . \
    || docker ps -aq --filter "name=${name}" --format '{{.Names}}' 2>/dev/null | grep -qx "$name"; then
    echo "    remove leftover container: $name"
    docker rm -f "$name" 2>/dev/null || true
  fi
done
# Orphaned name-prefixed backend containers (already handled in deploy; belt-and-suspenders)
for c in $(docker ps -aq --filter "name=oc-fix-ep" 2>/dev/null || true); do
  docker rm -f "$c" 2>/dev/null || true
done

if [[ "$SKIP_DOCKER_PRUNE" == "1" ]]; then
  echo "    SKIP_DOCKER_PRUNE=1 — skipping builder prune"
else
  before="$(df -B1 / 2>/dev/null | awk 'NR==2{print $4}' || echo 0)"
  if [[ "$DOCKER_BUILDER_PRUNE_ALL" == "1" ]]; then
    echo "    docker builder prune -af (full unused cache)"
    docker builder prune -af || echo "    WARN: builder prune failed"
  else
    echo "    docker builder prune -af --filter until=${DOCKER_BUILDER_PRUNE_UNTIL}"
    docker builder prune -af --filter "until=${DOCKER_BUILDER_PRUNE_UNTIL}" \
      || echo "    WARN: builder prune failed"
  fi
  after="$(df -B1 / 2>/dev/null | awk 'NR==2{print $4}' || echo 0)"
  if [[ "$before" =~ ^[0-9]+$ && "$after" =~ ^[0-9]+$ && "$after" -ge "$before" ]]; then
    freed_mb=$(( (after - before) / 1024 / 1024 ))
    echo "    disk free delta ~${freed_mb} MB"
  fi
fi

if [[ "$SKIP_DANGLING_IMAGE_PRUNE" != "1" ]]; then
  echo "    docker image prune -f (dangling <none> only)"
  docker image prune -f || echo "    WARN: image prune failed"
fi

echo "    docker system df (summary)"
docker system df 2>/dev/null || true
df -h / 2>/dev/null | awk 'NR==1 || NR==2'
echo "==> docker disk hygiene done"
