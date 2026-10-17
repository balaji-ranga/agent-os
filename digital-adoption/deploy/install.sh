#!/bin/sh
set -eu
ADOPTION_ROOT=/opt/flolah-digital-adoption
ADOPTION_RELEASE=${1:?unique release required}
case "$ADOPTION_RELEASE" in *[!a-zA-Z0-9_-]*) exit 2;; esac
export ADOPTION_ROOT ADOPTION_RELEASE
release="$ADOPTION_ROOT/releases/$ADOPTION_RELEASE"
test -f "$release/package.json"
mkdir -p "$ADOPTION_ROOT/config" "$ADOPTION_ROOT/data"
chmod 700 "$ADOPTION_ROOT/config"
base_image=$(docker inspect --format '{{.Config.Image}}' agent-os-backend-1)
if docker inspect flolah-adoption-adoption-1 >/dev/null 2>&1; then
  current_image=$(docker inspect --format '{{.Config.Image}}' flolah-adoption-adoption-1)
  docker run --rm --network none --user 1000:1000 --entrypoint node -v "$ADOPTION_ROOT/data:/data" -v "$release:/release:ro" "$current_image" /release/deploy/checkpoint.mjs "$ADOPTION_RELEASE"
  mkdir -p "$ADOPTION_ROOT/backups"
  chmod 700 "$ADOPTION_ROOT/backups"
  if test ! -f "$ADOPTION_ROOT/backups/config-before-$ADOPTION_RELEASE.tgz"; then
    tar -czf "$ADOPTION_ROOT/backups/config-before-$ADOPTION_RELEASE.tgz" -C "$ADOPTION_ROOT" config
    chmod 600 "$ADOPTION_ROOT/backups/config-before-$ADOPTION_RELEASE.tgz"
  fi
fi
docker inspect agent-os-backend-1 | docker run --rm -i --network none --user 0:0 --entrypoint node -v "$ADOPTION_ROOT/config:/config" -v "$release:/release:ro" "$base_image" /release/deploy/prepare-config.mjs
chown -R 1000:1000 "$ADOPTION_ROOT/config" "$ADOPTION_ROOT/data"
docker build -f "$release/deploy/Dockerfile" -t "flolah-digital-adoption:$ADOPTION_RELEASE" "$release"
# The coordinator limits active leases independently of the number of replicas.
# Use matching persistent service.json ingestion.maxWorkers when raising this.
docker compose -p flolah-adoption -f "$release/deploy/compose.yml" up -d --scale adoption-worker="${ADOPTION_WORKERS:-2}"

# Change only the known public registration link; preserve unrelated page updates.
docker run --rm --network none --user 0:0 --entrypoint node -v /opt/agent-os/deploy/static/flolah-home:/static -v "$release:/release:ro" "$base_image" /release/deploy/update-owner-entrypoint.mjs
docker run --rm --network none --user 0:0 --entrypoint node -v /opt/agent-os/deploy/nginx:/nginx -v "$release:/release:ro" "$base_image" /release/deploy/update-nginx.mjs
if docker exec agent-os-nginx-1 nginx -t; then
  docker exec agent-os-nginx-1 nginx -s reload
else
  echo 'Nginx validation failed; prior running configuration remains active. Review retained backup.' >&2
  exit 1
fi
echo 'Independent service deployed; certification still requires acceptance evidence.'
