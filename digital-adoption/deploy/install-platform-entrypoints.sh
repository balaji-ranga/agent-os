#!/bin/sh
# Build only the additive Admin link against the running frontend's exact source.
set -eu
release=${1:?release required}
case "$release" in *[!a-zA-Z0-9_-]*) exit 2;; esac
base=/opt/agent-os
bundle=/opt/flolah-digital-adoption/releases/$release
context=$bundle/platform-context
test ! -e "$context"
previous=$(docker inspect -f '{{index .Config.Labels "org.flolah.copilot.revision"}}' agent-os-frontend-1)
case "$previous" in ''|*[!a-zA-Z0-9_-]*) echo 'Cannot identify running frontend source'; exit 1;; esac
source=$base/releases/copilot-$previous/context
test -d "$source/frontend"
old=$(docker inspect -f '{{.Image}}' agent-os-frontend-1)
configs=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' agent-os-frontend-1)
mkdir -p "$context/frontend" "$context/deploy/docker"
tar -C "$source/frontend" --exclude=node_modules --exclude=dist --exclude='.env*' -cf - . | tar -C "$context/frontend" -xf -
cp "$bundle/deploy/frontend-entrypoint.Dockerfile" "$context/deploy/docker/frontend.copilot.Dockerfile"
cd "$context"
git apply --check --ignore-space-change "$bundle/admin-entry.patch"
git apply --ignore-space-change "$bundle/admin-entry.patch"
docker tag "$old" "agent-os-frontend:adoption-rollback-$release"
docker build -f deploy/docker/frontend.copilot.Dockerfile --build-arg "BASE_IMAGE=agent-os-frontend:adoption-rollback-$release" --build-arg "RELEASE_REVISION=adoption-$release" -t "agent-os-frontend:adoption-$release" .
test "$(docker inspect -f '{{.Image}}' agent-os-frontend-1)" = "$old"
# Preserve compatibility with the platform release-source lookup.
mkdir -p "$base/releases/copilot-adoption-$release"
cp -a "$context" "$base/releases/copilot-adoption-$release/context"
printf 'services:\n  frontend:\n    image: agent-os-frontend:adoption-%s\n' "$release" > "$bundle/frontend.override.yml"
cd "$base/deploy"
COMPOSE_FILE="$configs,$bundle/frontend.override.yml" COMPOSE_PATH_SEPARATOR=, docker compose -p agent-os up -d --no-deps --no-build frontend
docker exec agent-os-nginx-1 nginx -t
docker exec agent-os-nginx-1 nginx -s reload
echo 'Frontend Admin entry deployed; API and OpenClaw were not restarted.'
