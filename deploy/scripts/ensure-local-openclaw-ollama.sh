#!/usr/bin/env bash
# Point Agent OS platform LLM + local OpenClaw gateway at self-hosted Ollama (no cloud, no Ollama Cloud).
#
# Intended model: Mistral Medium 3.5 (128B, ~80GB Q4). Hosts without ~80GB GPU/RAM
# auto-select the largest free local tag that fits. Never pulls *-cloud tags.
#
# Usage:
#   bash deploy/scripts/ensure-local-openclaw-ollama.sh [/path/to/deploy/.env]
#   APPLY_LOCAL_OLLAMA=1 bash ...     # persist PLATFORM_USE_LOCAL_OLLAMA=1 and rewrite primary
#   PLATFORM_USE_LOCAL_OLLAMA=1 ...   # keep/refresh local primary on later deploys
#   SKIP_OLLAMA_PULL=1                # start Ollama but do not download weights
#   OLLAMA_FORCE_MODEL=mistral-medium-3.5   # skip RAM/GPU auto-select (will OOM on small VPS)
#
# Called from vps-deploy-latest.sh / up.sh. No-op unless PLATFORM_USE_LOCAL_OLLAMA=1
# or APPLY_LOCAL_OLLAMA=1.
set -euo pipefail

ENV_FILE="${1:-}"
if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
fi
ROOT="${AGENT_OS_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
SKIP_PULL="${SKIP_OLLAMA_PULL:-0}"
APPLY="${APPLY_LOCAL_OLLAMA:-0}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ensure-local-openclaw-ollama: missing $ENV_FILE (skip)" >&2
  exit 0
fi

env_get() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^["'\'']//' -e 's/["'\'']$//' || true
}

set_key() {
  local key="$1"
  local val="$2"
  local escaped
  escaped=$(printf '%s' "$val" | sed -e 's/[|&]/\\&/g')
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

USE_LOCAL="$(env_get PLATFORM_USE_LOCAL_OLLAMA)"
if [[ "$APPLY" == "1" || "$APPLY" == "true" ]]; then
  USE_LOCAL=1
fi
if [[ "$USE_LOCAL" != "1" && "$USE_LOCAL" != "true" ]]; then
  echo "ensure-local-openclaw-ollama: skip (set PLATFORM_USE_LOCAL_OLLAMA=1 or APPLY_LOCAL_OLLAMA=1)"
  exit 0
fi

WANTED="${OLLAMA_WANTED_MODEL:-$(env_get OLLAMA_WANTED_MODEL)}"
WANTED="${WANTED:-mistral-medium-3.5}"
FORCE="${OLLAMA_FORCE_MODEL:-$(env_get OLLAMA_FORCE_MODEL)}"

total_ram_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
avail_mb=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
gpu_mb=0
if command -v nvidia-smi >/dev/null 2>&1; then
  gpu_mb=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | awk '{s+=$1} END {print int(s+0)}' || echo 0)
fi

pick_model() {
  if [[ -n "$FORCE" ]]; then
    echo "$FORCE"
    return
  fi
  # 128B dense Q4 ~80GB. Free local only — never Ollama Cloud tags.
  if [[ "$gpu_mb" -ge 78000 || "$total_ram_mb" -ge 96000 ]]; then
    echo "$WANTED"
    return
  fi
  if [[ "$gpu_mb" -ge 22000 || "$total_ram_mb" -ge 32000 ]]; then
    echo "gpt-oss:20b"
    return
  fi
  if [[ "$total_ram_mb" -ge 12000 ]]; then
    echo "deepseek-r1:8b"
    return
  fi
  echo "llama3.2"
}

MODEL="$(pick_model)"
if [[ "$MODEL" == *"-cloud"* || "$MODEL" == *":cloud"* ]]; then
  echo "ensure-local-openclaw-ollama: refusing Ollama Cloud tag '$MODEL'" >&2
  exit 1
fi

# OpenClaw COO bootstrap (SOUL/AGENTS + tool schemas) does not fit in 8k — that
# rejects even "hi" with "Context overflow: prompt too large for the model".
# 32k is the platform default; 128k thrashes small VPS RAM.
CTX=32768
TIMEOUT_MS=300000
if [[ "$MODEL" == "mistral-medium-3.5"* || "$MODEL" == *"128b"* ]]; then
  TIMEOUT_MS=600000
elif [[ "$MODEL" == "gpt-oss:20b"* ]]; then
  TIMEOUT_MS=420000
fi

echo "==> Local OpenClaw + platform LLM -> Ollama (free, no cloud)"
echo "    host RAM=${total_ram_mb}MiB available=${avail_mb}MiB GPU=${gpu_mb}MiB"
echo "    wanted=${WANTED} (128B) selected=${MODEL} ctx=${CTX}"

old_base="$(env_get OPENAI_BASE_URL)"
old_key="$(env_get OPENAI_API_KEY)"
old_primary_model="$(env_get OPENAI_PRIMARY_MODEL)"
if [[ "$old_base" == *"deepseek.com"* || "$old_base" == *"openai.com"* ]]; then
  if [[ -n "$old_key" && "$old_key" != "ollama-local" && "$old_key" != "ollama" ]]; then
    if [[ "$old_base" == *"deepseek.com"* ]]; then
      set_key DEEPSEEK_CLOUD_BASE_URL "$old_base"
      set_key DEEPSEEK_CLOUD_API_KEY "$old_key"
      set_key DEEPSEEK_CLOUD_MODEL "${old_primary_model:-deepseek-v4-flash}"
    fi
  fi
fi

set_key PLATFORM_USE_LOCAL_OLLAMA 1
set_key OLLAMA_WANTED_MODEL "$WANTED"
set_key OLLAMA_BASE_URL 'http://ollama:11434'
set_key OLLAMA_API_KEY 'ollama-local'
set_key OLLAMA_MODEL "$MODEL"
set_key OLLAMA_CONTEXT_WINDOW "$CTX"
set_key OPENCLAW_OLLAMA_CHAT_TIMEOUT_MS "$TIMEOUT_MS"
set_key OPENCLAW_OLLAMA_FALLBACK_MODEL "$MODEL"
set_key OPENCLAW_ENABLE_OLLAMA_FALLBACK 0
set_key OPENCLAW_MODEL_FALLBACKS ''
set_key OPENCLAW_MODEL_PRIMARY "ollama/${MODEL}"
set_key OPENAI_BASE_URL 'http://ollama:11434/v1'
set_key OPENAI_API_KEY 'ollama-local'
set_key OPENAI_PRIMARY_BASE_URL 'http://ollama:11434/v1'
set_key OPENAI_PRIMARY_API_KEY 'ollama-local'
set_key OPENAI_PRIMARY_MODEL "$MODEL"

cd "$ROOT/deploy"
if [[ -f "$ROOT/deploy/scripts/compose-file-defaults.sh" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/deploy/scripts/compose-file-defaults.sh"
  export_vps_compose_file "$ENV_FILE" 2>/dev/null || true
fi
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"

if [[ "$gpu_mb" -ge 1000 && -f "$ROOT/deploy/docker-compose.ollama-gpu.yml" ]]; then
  case ":${COMPOSE_FILE}:" in
    *:docker-compose.ollama-gpu.yml:*) ;;
    *)
      COMPOSE_FILE="${COMPOSE_FILE}:docker-compose.ollama-gpu.yml"
      echo "    enabling docker-compose.ollama-gpu.yml"
      ;;
  esac
  export COMPOSE_FILE
  if grep -qE '^COMPOSE_FILE=' "$ENV_FILE" 2>/dev/null; then
    set_key COMPOSE_FILE "$COMPOSE_FILE"
  fi
fi

echo "==> Start optional-ollama"
docker compose --profile optional-ollama up -d ollama

echo "==> Wait for Ollama"
ready=0
for i in $(seq 1 40); do
  if docker compose --profile optional-ollama exec -T ollama ollama list >/dev/null 2>&1; then
    ready=1
    echo "    ollama ready"
    break
  fi
  sleep 2
done
if [[ "$ready" != "1" ]]; then
  echo "WARN: ollama did not become ready" >&2
  echo "ENSURE_LOCAL_OPENCLAW_OLLAMA_DONE model=$MODEL ready=0"
  exit 0
fi

if [[ "$SKIP_PULL" == "1" || "$SKIP_PULL" == "true" ]]; then
  echo "    skip pull (SKIP_OLLAMA_PULL=1)"
else
  echo "==> Ensure local Ollama model: $MODEL"
  if docker compose --profile optional-ollama exec -T ollama ollama list 2>/dev/null | grep -qE "^${MODEL%%:*}"; then
    echo "    model already present"
  else
    echo "    pulling $MODEL (local weights only)..."
    docker compose --profile optional-ollama exec -T ollama ollama pull "$MODEL" || {
      echo "WARN: ollama pull $MODEL failed — check disk/RAM. Platform stays pointed at this tag." >&2
    }
  fi
fi

echo "ENSURE_LOCAL_OPENCLAW_OLLAMA_DONE model=$MODEL wanted=$WANTED gpu_mb=$gpu_mb ram_mb=$total_ram_mb"
