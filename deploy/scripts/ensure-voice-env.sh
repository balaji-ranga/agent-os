#!/usr/bin/env bash
# Ensure free local STT/TTS (faster-whisper + Piper) for Agent Chat mic and speech_* workflow nodes.
# Idempotent: writes SPEECH_* to deploy/.env if missing, builds/starts optional-voice profile.
#
# Usage:
#   bash deploy/scripts/ensure-voice-env.sh [/path/to/deploy/.env]
#   SKIP_VOICE=1 bash deploy/scripts/ensure-voice-env.sh   # env keys only (no containers)
#   VOICE_BUILD=0 bash ...                                 # up only (skip piper image build)
#
# Called from up.sh and vps-deploy-latest.sh on every deploy.
set -euo pipefail

ENV_FILE="${1:-}"
if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
fi
ROOT="${AGENT_OS_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
SKIP_VOICE="${SKIP_VOICE:-0}"
VOICE_BUILD="${VOICE_BUILD:-1}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ensure-voice-env: missing $ENV_FILE (skip)" >&2
  exit 0
fi

upsert() {
  local key="$1"
  local val="$2"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    return 0
  fi
  printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  echo "ensure-voice-env: added $key"
}

# OpenAI-compatible STT base (backend appends /v1/audio/transcriptions when needed)
upsert SPEECH_STT_URL 'http://whisper:8000'
upsert SPEECH_TTS_URL 'http://piper:5500'
upsert WHISPER_MODEL 'Systran/faster-whisper-tiny.en'
upsert PIPER_VOICE 'en_US-lessac-medium'

if ! grep -q 'optional-voice' "$ENV_FILE" 2>/dev/null; then
  cat >> "$ENV_FILE" <<'EOF'

# ---- Free STT/TTS (Compose profile optional-voice) ----
# ensure-voice-env.sh keeps SPEECH_* and starts whisper + piper on deploy.
# SKIP_VOICE=1 to skip containers. Agent Chat mic + speech_stt/speech_tts nodes use these URLs.
# Docs: knowledgebase/platform-help/25-speech-and-published-scenes.md
EOF
  echo "ensure-voice-env: added optional-voice comment block"
fi

if [[ "$SKIP_VOICE" == "1" || "$SKIP_VOICE" == "true" ]]; then
  echo "ensure-voice-env: SKIP_VOICE=1 — env only"
  echo "ENSURE_VOICE_DONE skip_containers=1"
  exit 0
fi

cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml:docker-compose.vps-client-ip.yml:docker-compose.docker-tools.yml}"

echo "==> optional-voice: whisper + piper"
if [[ "$VOICE_BUILD" == "1" || "$VOICE_BUILD" == "true" ]]; then
  docker compose --profile optional-voice build piper || echo "WARN: piper build failed"
fi
docker compose --profile optional-voice up -d whisper piper || {
  echo "WARN: optional-voice up failed — speech APIs will 503 until fixed"
  echo "ENSURE_VOICE_DONE up=failed"
  exit 0
}

# Soft health probes (do not fail deploy)
for i in $(seq 1 20); do
  if docker compose --profile optional-voice exec -T piper curl -sf http://127.0.0.1:5500/health >/dev/null 2>&1; then
    echo "    piper healthy"
    break
  fi
  sleep 2
done

echo "ENSURE_VOICE_DONE stt=$(grep -E '^SPEECH_STT_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-) tts=$(grep -E '^SPEECH_TTS_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"