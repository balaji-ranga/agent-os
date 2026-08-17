#!/usr/bin/env bash
# Build the public Docusaurus user guide into deploy/static/flolah-home/docs/
# so nginx can serve https://flolah.cloud/docs/ (and /docs/ on the login host).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCS_SRC="${ROOT}/docs-site"
OUT="${ROOT}/deploy/static/flolah-home/docs"

if [[ ! -f "${DOCS_SRC}/package.json" ]]; then
  echo "ERROR: docs-site/package.json missing" >&2
  exit 1
fi

if grep -Rqi --include='*.md' --include='*.js' 'openclaw' "${DOCS_SRC}/docs" "${DOCS_SRC}/docusaurus.config.js" "${DOCS_SRC}/sidebars.js"; then
  echo "ERROR: public docs source still mentions OpenClaw" >&2
  grep -Rni --include='*.md' --include='*.js' 'openclaw' "${DOCS_SRC}/docs" "${DOCS_SRC}/docusaurus.config.js" "${DOCS_SRC}/sidebars.js" || true
  exit 1
fi

echo "==> Build public docs (Docusaurus → ${OUT})"

build_with_npm() {
  (cd "${DOCS_SRC}" && CI=true npm ci && CI=true npm run build)
  rm -rf "${OUT}"
  mkdir -p "${OUT}"
  cp -a "${DOCS_SRC}/build/." "${OUT}/"
}

build_with_docker() {
  mkdir -p "${OUT}"
  docker run --rm \
    -v "${DOCS_SRC}:/src:ro" \
    -v "${OUT}:/out" \
    node:22-bookworm-slim \
    bash -c 'set -euo pipefail
      cp -a /src /tmp/docs
      cd /tmp/docs
      rm -rf node_modules build .docusaurus
      CI=true npm ci
      CI=true npm run build
      find /out -mindepth 1 -maxdepth 1 -exec rm -rf {} +
      cp -a /tmp/docs/build/. /out/'
}

if command -v npm >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  build_with_npm
elif command -v docker >/dev/null 2>&1; then
  echo "    npm not on host — building with docker node:22-bookworm-slim"
  build_with_docker
else
  echo "ERROR: need npm or docker to build public docs" >&2
  exit 1
fi

if [[ ! -f "${OUT}/index.html" ]]; then
  echo "ERROR: docs build missing index.html at ${OUT}" >&2
  exit 1
fi
if grep -Rqi --include='*.html' --include='*.js' 'openclaw' "${OUT}"; then
  echo "ERROR: public docs output still mentions OpenClaw" >&2
  exit 1
fi
chmod -R a+rX "${OUT}" 2>/dev/null || true
echo "    public docs built"
