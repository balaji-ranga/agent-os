#!/usr/bin/env bash
# Ensure model-router defaults and a private LiteLLM gateway key without printing it.
set -euo pipefail

ENV_FILE="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env}"
[[ -f "$ENV_FILE" ]] || { echo "model router: env file not found: $ENV_FILE" >&2; exit 1; }

upsert_default() {
  local key="$1" value="$2"
  if ! grep -qE "^${key}=" "$ENV_FILE"; then
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

env_value() {
  grep -E "^${1}=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '\r' || true
}

set_value() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

if ! grep -qE '^LITELLM_MASTER_KEY=.+$' "$ENV_FILE"; then
  key="sk-flolah-$(openssl rand -hex 32)"
  if grep -qE '^LITELLM_MASTER_KEY=' "$ENV_FILE"; then
    sed -i "s|^LITELLM_MASTER_KEY=.*|LITELLM_MASTER_KEY=${key}|" "$ENV_FILE"
  else
    printf 'LITELLM_MASTER_KEY=%s\n' "$key" >> "$ENV_FILE"
  fi
  unset key
  echo "model router: generated private LiteLLM key"
fi

upsert_default MODEL_ROUTING_ENABLED 1
upsert_default LITELLM_BASE_URL http://litellm:4000/v1
upsert_default LITELLM_IMAGE docker.litellm.ai/berriai/litellm:main-latest
primary_model="$(env_value OPENAI_PRIMARY_MODEL)"
[[ -n "$primary_model" ]] || primary_model="$(env_value OPENAI_DEFAULT_MODEL)"
[[ -n "$primary_model" ]] || primary_model="gpt-4o-mini"
secondary_model="$(env_value OPENAI_SECONDARY_MODEL)"
[[ -n "$secondary_model" ]] || secondary_model="gpt-4o-mini"
ollama_model="$(env_value OLLAMA_MODEL)"
[[ -n "$ollama_model" ]] || ollama_model="llama3.2"
reasoning_model="$(env_value DEEPSEEK_FALLBACK_MODEL)"
[[ -n "$reasoning_model" ]] || reasoning_model="deepseek-r1:8b"
# The OpenAI adapter also supports DeepSeek's OpenAI-compatible API base.
set_value LITELLM_PRIMARY_MODEL_SPEC "openai/${primary_model#*/}"
set_value LITELLM_SECONDARY_MODEL_SPEC "openai/${secondary_model#*/}"
set_value LITELLM_OLLAMA_MODEL_SPEC "ollama_chat/${ollama_model#ollama/}"
set_value LITELLM_REASONING_MODEL_SPEC "ollama_chat/${reasoning_model#ollama/}"
unset primary_model secondary_model ollama_model reasoning_model
echo "model router: environment ready (secret not displayed)"
