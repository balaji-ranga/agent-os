#!/usr/bin/env bash
# Ensure DeepSeek V3 is configured for local Ollama (no cloud API gateway).
# Writes DEEPSEEK_* to deploy/.env if missing and starts optional-ollama.
# Set PULL_DEEPSEEK=1 to also ollama pull (large download — used by smoke tests).
set -euo pipefail
ENV_FILE="${1:-/opt/agent-os/deploy/.env}"
ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
MODEL="${DEEPSEEK_MODEL:-deepseek-v3}"
PULL="${PULL_DEEPSEEK:-0}"

if [[ -f "$ENV_FILE" ]]; then
  if ! grep -qE '^DEEPSEEK_BASE_URL=' "$ENV_FILE" 2>/dev/null; then
    {
      echo ""
      echo "# DeepSeek V3 via local Ollama (no cloud API key) — $(date -Is)"
      echo "DEEPSEEK_BASE_URL=http://ollama:11434/v1"
      echo "DEEPSEEK_MODEL=${MODEL}"
    } >> "$ENV_FILE"
    echo "Added DEEPSEEK_* (Ollama) to $ENV_FILE"
  else
    if grep -qE '^DEEPSEEK_BASE_URL=.*deepseek:8080' "$ENV_FILE" 2>/dev/null; then
      sed -i 's|^DEEPSEEK_BASE_URL=.*|DEEPSEEK_BASE_URL=http://ollama:11434/v1|' "$ENV_FILE"
      echo "Migrated DEEPSEEK_BASE_URL → Ollama"
    fi
    if grep -qE '^DEEPSEEK_MODEL=deepseek-chat' "$ENV_FILE" 2>/dev/null; then
      sed -i 's|^DEEPSEEK_MODEL=deepseek-chat|DEEPSEEK_MODEL=deepseek-v3|' "$ENV_FILE"
      echo "Migrated DEEPSEEK_MODEL → deepseek-v3"
    fi
  fi
  if grep -qE '^DEEPSEEK_API_KEY=' "$ENV_FILE" 2>/dev/null; then
    sed -i 's|^DEEPSEEK_API_KEY=|# DEEPSEEK_API_KEY= (unused — Ollama local)|' "$ENV_FILE" || true
  fi
  if grep -qE '^DEEPSEEK_UPSTREAM_URL=' "$ENV_FILE" 2>/dev/null; then
    sed -i 's|^DEEPSEEK_UPSTREAM_URL=|# DEEPSEEK_UPSTREAM_URL= (removed cloud proxy)|' "$ENV_FILE" || true
  fi
fi

cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"

echo "==> Start optional-ollama"
docker compose --profile optional-ollama up -d ollama

echo "==> Wait for Ollama"
for i in $(seq 1 40); do
  if docker compose exec -T ollama ollama list >/dev/null 2>&1; then
    echo "    ollama ready"
    break
  fi
  sleep 2
done

MODEL_FROM_ENV=$(grep -E '^DEEPSEEK_MODEL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
MODEL="${MODEL_FROM_ENV:-$MODEL}"

# Full deepseek-v3 (671B) needs far more RAM than a typical VPS — auto-pick a runnable DeepSeek tag.
AVAIL_MB=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
if [[ "$MODEL" == "deepseek-v3" || "$MODEL" == "deepseek-v3:latest" ]]; then
  if [[ "$AVAIL_MB" -gt 0 && "$AVAIL_MB" -lt 65536 ]]; then
    FALLBACK="${DEEPSEEK_FALLBACK_MODEL:-deepseek-r1:8b}"
    echo "WARN: available RAM ~${AVAIL_MB}MiB — full deepseek-v3 needs a large host; using $FALLBACK"
    MODEL="$FALLBACK"
    if [[ -f "$ENV_FILE" ]]; then
      if grep -qE '^DEEPSEEK_MODEL=' "$ENV_FILE"; then
        sed -i "s|^DEEPSEEK_MODEL=.*|DEEPSEEK_MODEL=${MODEL}|" "$ENV_FILE"
      else
        echo "DEEPSEEK_MODEL=${MODEL}" >> "$ENV_FILE"
      fi
      if ! grep -qE '^# DEEPSEEK_NOTE=' "$ENV_FILE"; then
        echo "# DEEPSEEK_NOTE=full deepseek-v3 skipped on this host (set DEEPSEEK_MODEL=deepseek-v3 on a large GPU box)" >> "$ENV_FILE"
      fi
    fi
  fi
fi

if [[ "$PULL" == "1" || "$PULL" == "true" ]]; then
  echo "==> Ensure Ollama model: $MODEL"
  if docker compose exec -T ollama ollama list 2>/dev/null | grep -qE "^${MODEL%%:*}"; then
    echo "    model already present"
  else
    echo "    pulling $MODEL..."
    docker compose exec -T ollama ollama pull "$MODEL" || {
      echo "WARN: ollama pull $MODEL failed — check disk/RAM"
      exit 0
    }
  fi
else
  echo "    skip pull (set PULL_DEEPSEEK=1 to download $MODEL)"
fi

echo "ENSURE_DEEPSEEK_OLLAMA_DONE model=$MODEL"
