#!/usr/bin/env bash
# Sync OpenClaw Browser Relay chrome-extension into deploy/assets (folder + zip).
# Usage (repo root or VPS /opt/agent-os):
#   bash deploy/scripts/sync-openclaw-chrome-extension.sh
#   OPENCLAW_CONTAINER=agent-os-openclaw-1 bash deploy/scripts/sync-openclaw-chrome-extension.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ASSETS="${ROOT}/deploy/assets"
OUT_DIR="${ASSETS}/openclaw-chrome-extension"
OUT_ZIP="${ASSETS}/openclaw-chrome-extension.zip"
CONTAINER="${OPENCLAW_CONTAINER:-agent-os-openclaw-1}"
SRC_IN_IMAGE="/usr/local/lib/node_modules/openclaw/dist/extensions/browser/chrome-extension"

mkdir -p "${ASSETS}"

copy_from_container() {
  if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
    return 1
  fi
  if ! docker exec "${CONTAINER}" test -f "${SRC_IN_IMAGE}/manifest.json"; then
    echo "[sync-chrome-ext] WARN: ${SRC_IN_IMAGE} missing in ${CONTAINER}"
    return 1
  fi
  echo "[sync-chrome-ext] copying from ${CONTAINER}:${SRC_IN_IMAGE}"
  rm -rf "${OUT_DIR}"
  mkdir -p "${OUT_DIR}"
  docker exec "${CONTAINER}" tar -C "$(dirname "${SRC_IN_IMAGE}")" -cf - "$(basename "${SRC_IN_IMAGE}")" \
    | tar -C "${ASSETS}" -xf -
  # tar extracts as chrome-extension/
  if [[ -d "${ASSETS}/chrome-extension" ]]; then
    rm -rf "${OUT_DIR}"
    mv "${ASSETS}/chrome-extension" "${OUT_DIR}"
  fi
  return 0
}

copy_from_host_npm() {
  local host_src
  host_src="$(npm root -g 2>/dev/null)/openclaw/dist/extensions/browser/chrome-extension"
  if [[ ! -f "${host_src}/manifest.json" ]]; then
    return 1
  fi
  echo "[sync-chrome-ext] copying from host npm ${host_src}"
  rm -rf "${OUT_DIR}"
  mkdir -p "${OUT_DIR}"
  cp -a "${host_src}/." "${OUT_DIR}/"
  return 0
}

if [[ -f "${OUT_DIR}/manifest.json" ]] && [[ "${FORCE_SYNC:-0}" != "1" ]]; then
  echo "[sync-chrome-ext] vendored pack already present (set FORCE_SYNC=1 to refresh)"
else
  if ! copy_from_container && ! copy_from_host_npm; then
    if [[ -f "${OUT_DIR}/manifest.json" ]]; then
      echo "[sync-chrome-ext] keep existing vendored pack"
    else
      echo "[sync-chrome-ext] ERROR: no chrome-extension source (container or npm)" >&2
      exit 1
    fi
  fi
fi

# Build zip with top-level chrome-extension/ for Load unpacked
STAGING="$(mktemp -d)"
trap 'rm -rf "${STAGING}"' EXIT
mkdir -p "${STAGING}/chrome-extension"
cp -a "${OUT_DIR}/." "${STAGING}/chrome-extension/"
rm -f "${OUT_ZIP}"
(
  cd "${STAGING}"
  if command -v zip >/dev/null 2>&1; then
    zip -r -q "${OUT_ZIP}" chrome-extension
  else
    python3 - <<'PY' "${OUT_ZIP}" "${STAGING}/chrome-extension"
import sys, zipfile, os
out, src = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(src):
        for f in files:
            p = os.path.join(root, f)
            z.write(p, os.path.join("chrome-extension", os.path.relpath(p, src)))
print("zipped", out)
PY
  fi
)
echo "[sync-chrome-ext] OK dir=${OUT_DIR} zip=${OUT_ZIP} bytes=$(wc -c < "${OUT_ZIP}")"