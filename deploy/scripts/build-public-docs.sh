#!/usr/bin/env bash
# Build public Docusaurus sites:
#   user guide → deploy/static/flolah-home/docs/   (https://flolah.cloud/docs/)
#   blog+forum → deploy/static/flolah-home/blog/   (https://flolah.cloud/blog/)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCS_SRC="${ROOT}/docs-site"
OUT_DOCS="${ROOT}/deploy/static/flolah-home/docs"
OUT_BLOG="${ROOT}/deploy/static/flolah-home/blog"

if [[ ! -f "${DOCS_SRC}/package.json" ]]; then
  echo "ERROR: docs-site/package.json missing" >&2
  exit 1
fi

SCAN_PATHS=(
  "${DOCS_SRC}/docs"
  "${DOCS_SRC}/blog"
  "${DOCS_SRC}/blog-pages"
  "${DOCS_SRC}/docusaurus.config.js"
  "${DOCS_SRC}/docusaurus.blog.config.js"
  "${DOCS_SRC}/sidebars.js"
)
if grep -Rqi --include='*.md' --include='*.mdx' --include='*.js' 'openclaw' "${SCAN_PATHS[@]}"; then
  echo "ERROR: public docs/blog source still mentions OpenClaw" >&2
  grep -Rni --include='*.md' --include='*.mdx' --include='*.js' 'openclaw' "${SCAN_PATHS[@]}" || true
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node "${ROOT}/backend/scripts/scan-public-docs-sensitive.js"
elif command -v docker >/dev/null 2>&1; then
  docker run --rm -v "${ROOT}:/repo:ro" -w /repo node:22-bookworm-slim \
    node backend/scripts/scan-public-docs-sensitive.js
else
  echo "ERROR: need node or docker for the public-docs sensitive-content scan" >&2
  exit 1
fi

echo "==> Build public docs + blog (Docusaurus)"

build_with_npm() {
  (cd "${DOCS_SRC}" && CI=true npm ci && CI=true npm run build && CI=true npm run build:blog)
  rm -rf "${OUT_DOCS}" "${OUT_BLOG}"
  mkdir -p "${OUT_DOCS}" "${OUT_BLOG}"
  cp -a "${DOCS_SRC}/build/." "${OUT_DOCS}/"
  cp -a "${DOCS_SRC}/build-blog/." "${OUT_BLOG}/"
}

build_with_docker() {
  mkdir -p "${OUT_DOCS}" "${OUT_BLOG}"
  docker run --rm \
    -v "${DOCS_SRC}:/src:ro" \
    -v "${OUT_DOCS}:/out-docs" \
    -v "${OUT_BLOG}:/out-blog" \
    node:22-bookworm-slim \
    bash -c 'set -euo pipefail
      cp -a /src /tmp/docs
      cd /tmp/docs
      rm -rf node_modules build build-blog .docusaurus
      CI=true npm ci
      CI=true npm run build
      CI=true npm run build:blog
      find /out-docs -mindepth 1 -maxdepth 1 -exec rm -rf {} +
      find /out-blog -mindepth 1 -maxdepth 1 -exec rm -rf {} +
      cp -a /tmp/docs/build/. /out-docs/
      cp -a /tmp/docs/build-blog/. /out-blog/'
}

if command -v npm >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  build_with_npm
elif command -v docker >/dev/null 2>&1; then
  echo "    npm not on host — building with docker node:22-bookworm-slim"
  build_with_docker
else
  echo "ERROR: need npm or docker to build public docs/blog" >&2
  exit 1
fi

if [[ ! -f "${OUT_DOCS}/index.html" ]]; then
  echo "ERROR: docs build missing index.html at ${OUT_DOCS}" >&2
  exit 1
fi
if [[ ! -f "${OUT_BLOG}/index.html" ]]; then
  echo "ERROR: blog build missing index.html at ${OUT_BLOG}" >&2
  exit 1
fi
if grep -Rqi --include='*.html' --include='*.js' 'openclaw' "${OUT_DOCS}" "${OUT_BLOG}"; then
  echo "ERROR: public docs/blog output still mentions OpenClaw" >&2
  exit 1
fi
chmod -R a+rX "${OUT_DOCS}" "${OUT_BLOG}" 2>/dev/null || true
echo "    public docs built → ${OUT_DOCS}"
echo "    public blog built → ${OUT_BLOG}"
