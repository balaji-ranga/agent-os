#!/bin/sh
set -eu
release=${1:?candidate release required}
case "$release" in *[!a-zA-Z0-9_-]*) exit 2;; esac
bundle=/opt/flolah-digital-adoption/releases/$release/platform
docker build --target frontend-build -f "$bundle/Dockerfile.frontend" -t "agent-os-frontend-builder:adoption-$release" "$bundle"
temporary=$(docker create "agent-os-frontend-builder:adoption-$release")
trap 'docker rm "$temporary" >/dev/null' EXIT
mkdir -p "$bundle/context/backend/src/generated"
docker cp "$temporary:/backend/src/generated/copilot-screen-inventory.json" "$bundle/context/backend/src/generated/copilot-screen-inventory.json"
docker build -f "$bundle/Dockerfile.frontend" -t "agent-os-frontend:adoption-$release" "$bundle"
docker build -f "$bundle/Dockerfile.backend" -t "agent-os-backend:adoption-$release" "$bundle"
echo 'Scoped platform images built with one shared generated screen inventory. No services changed.'
