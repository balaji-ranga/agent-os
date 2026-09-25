#!/usr/bin/env bash
set -euo pipefail

# Generate the featured Northstar live-UI video without rebuilding or restarting services.
# Run on the VPS after the source tree has been updated:
#   cd /opt/agent-os && bash deploy/scripts/vps-generate-northstar-demo.sh

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
COMPOSE_DIR="${ROOT}/deploy"
SCRIPT="${ROOT}/backend/scripts/northstar-demo-video.mjs"
VOICE="${ROOT}/knowledgebase/video-tours/scripts/13-northstar-ai-native-company.md"
ASSET_DIR="${ROOT}/knowledgebase/video-tours/assets"
TEMP_DIR="$(mktemp -d /tmp/northstar-demo.XXXXXX)"
SESSION_ISSUED=0

cleanup() {
  set +e
  if [[ "${SESSION_ISSUED}" == "1" ]]; then
    (cd "${COMPOSE_DIR}" && docker compose exec -T backend node scripts/northstar-demo-video.mjs revoke-session >/dev/null)
  fi
  if [[ -n "${OPENCLAW_ID:-}" ]]; then
    docker exec "${OPENCLAW_ID}" rm -rf /tmp/northstar-demo-video.mjs /tmp/northstar-capture-session /tmp/northstar-capture >/dev/null 2>&1
  fi
  rm -rf -- "${TEMP_DIR}"
}
trap cleanup EXIT

[[ -f "${SCRIPT}" ]] || { echo "Missing ${SCRIPT}" >&2; exit 1; }
[[ -f "${VOICE}" ]] || { echo "Missing ${VOICE}" >&2; exit 1; }
mkdir -p "${ASSET_DIR}"

cd "${COMPOSE_DIR}"
BACKEND_ID="$(docker compose ps -q backend)"
OPENCLAW_ID="$(docker compose ps -q openclaw)"
[[ -n "${BACKEND_ID}" && -n "${OPENCLAW_ID}" ]] || { echo 'backend/openclaw must be running' >&2; exit 1; }

# Refuse to record from a build that fails the pack lifecycle or ERPNext tenant/session gates.
# Both tests use isolated temporary state and do not mutate the live seed installation.
docker compose exec -T backend node scripts/test-northstar-okr-demo-seed.mjs
docker compose exec -T backend node scripts/test-erpnext-company-session-isolation.mjs

# Focused copies only: no image rebuild and no .env access or mutation.
docker compose cp "${SCRIPT}" backend:/opt/agent-os/backend/scripts/northstar-demo-video.mjs >/dev/null
docker compose cp "${VOICE}" backend:/opt/agent-os/knowledgebase/video-tours/scripts/13-northstar-ai-native-company.md >/dev/null
docker compose cp "${SCRIPT}" openclaw:/tmp/northstar-demo-video.mjs >/dev/null

docker compose exec -T backend node scripts/northstar-demo-video.mjs issue-session
SESSION_ISSUED=1

docker cp "${BACKEND_ID}:/data/agent-os/video-tours/northstar-featured/.capture-session" "${TEMP_DIR}/capture-session"
chmod 600 "${TEMP_DIR}/capture-session"
docker cp "${TEMP_DIR}/capture-session" "${OPENCLAW_ID}:/tmp/northstar-capture-session"

docker compose exec -T \
  -e NORTHSTAR_CAPTURE_TOKEN_FILE=/tmp/northstar-capture-session \
  -e AGENT_OS_DATA_DIR=/tmp/northstar-capture \
  openclaw node /tmp/northstar-demo-video.mjs capture

docker cp "${OPENCLAW_ID}:/tmp/northstar-capture/video-tours/northstar-featured/northstar-live-ui.webm" "${TEMP_DIR}/northstar-live-ui.webm"
docker cp "${OPENCLAW_ID}:/tmp/northstar-capture/video-tours/northstar-featured/13-northstar-ai-native-company-final-frame.png" "${TEMP_DIR}/final-frame.png"
docker cp "${TEMP_DIR}/northstar-live-ui.webm" "${BACKEND_ID}:/data/agent-os/video-tours/northstar-featured/northstar-live-ui.webm"

docker compose exec -T -e SPEECH_TTS_URL=http://piper:5500 backend node scripts/northstar-demo-video.mjs render

docker cp "${BACKEND_ID}:/data/agent-os/video-tours/northstar-featured/13-northstar-ai-native-company.mp4" "${ASSET_DIR}/13-northstar-ai-native-company.mp4"
docker cp "${BACKEND_ID}:/opt/agent-os/knowledgebase/video-tours/scripts/13-northstar-ai-native-company.vtt" "${ROOT}/knowledgebase/video-tours/scripts/13-northstar-ai-native-company.vtt"
cp "${ROOT}/knowledgebase/video-tours/scripts/13-northstar-ai-native-company.vtt" "${ASSET_DIR}/13-northstar-ai-native-company.vtt"
cp "${TEMP_DIR}/final-frame.png" "${ASSET_DIR}/13-northstar-ai-native-company-poster.png"

docker compose exec -T backend node scripts/northstar-demo-video.mjs revoke-session
SESSION_ISSUED=0

docker compose exec -T backend node -e \
  "const fs=require('fs');const p='/data/agent-os/video-tours/northstar-featured/13-northstar-ai-native-company.mp4';const s=fs.statSync(p);if(s.size<1024*1024)throw new Error('rendered video is unexpectedly small');console.log('VIDEO_BYTES',s.size)"

echo "Northstar demo ready: ${ASSET_DIR}/13-northstar-ai-native-company.mp4"
echo "Captions: ${ASSET_DIR}/13-northstar-ai-native-company.vtt"
echo "Poster / QA frame: ${ASSET_DIR}/13-northstar-ai-native-company-poster.png"
