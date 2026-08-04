#!/usr/bin/env bash
# Local Qwen embeddings for OpenSearch hybrid RAG (no OpenAI).
# Idempotent: writes OPENSEARCH_EMBEDDING_* to deploy/.env, builds/starts profile optional-embeddings.
#
# Usage:
#   bash deploy/scripts/ensure-embeddings-env.sh [/path/to/deploy/.env]
#   SKIP_EMBEDDINGS=1 bash deploy/scripts/ensure-embeddings-env.sh   # env keys only
#   EMBEDDINGS_BUILD=0 bash …                                        # up only (no build)
set -euo pipefail

ENV_FILE="${1:-}"
if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ensure-embeddings-env: missing $ENV_FILE (skip)" >&2
  exit 0
fi

DEPLOY_DIR="$(cd "$(dirname "$ENV_FILE")" && pwd)"
cd "$DEPLOY_DIR"

upsert() {
  local key="$1"
  local val="$2"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    return 0
  fi
  printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  echo "ensure-embeddings-env: added $key"
}

set_key() {
  local key="$1"
  local val="$2"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i.bak -E "s|^${key}=.*|${key}=${val}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
  echo "ensure-embeddings-env: set $key=$val"
}

if ! grep -q 'optional-embeddings\|Qwen.*Embedding' "$ENV_FILE" 2>/dev/null; then
  cat >> "$ENV_FILE" <<'EOF'

# ---- Local Qwen embeddings (Compose profile optional-embeddings) ----
# ensure-embeddings-env.sh starts qwen-embeddings; backend uses hybrid BM25+kNN.
# Model: Qwen/Qwen3-Embedding-0.6B (1024-d). Reindex after first enable or dim change.
# SKIP_EMBEDDINGS=1 to skip container start (BM25-only).
EOF
  echo "ensure-embeddings-env: added optional-embeddings comment block"
fi

upsert OPENSEARCH_EMBEDDING_BASE_URL 'http://embeddings:8080/v1'
upsert OPENSEARCH_EMBEDDING_MODEL 'Qwen/Qwen3-Embedding-0.6B'
upsert OPENSEARCH_EMBEDDING_DIMS 1024
upsert OPENSEARCH_EMBEDDING_API_KEY 'local'
upsert EMBEDDING_MODEL_ID 'Qwen/Qwen3-Embedding-0.6B'
upsert OPENSEARCH_EMBEDDINGS_ENABLED 1

cur_model="$(grep -E '^OPENSEARCH_EMBEDDING_MODEL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
cur_base="$(grep -E '^OPENSEARCH_EMBEDDING_BASE_URL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
cur_dims="$(grep -E '^OPENSEARCH_EMBEDDING_DIMS=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"

if [[ -z "$cur_base" || "$cur_base" == *openai.com* || "$cur_base" == *api.openai* ]]; then
  set_key OPENSEARCH_EMBEDDING_BASE_URL 'http://embeddings:8080/v1'
fi
if [[ -z "$cur_model" || "$cur_model" == text-embedding-3-small || "$cur_model" == text-embedding-3-large || "$cur_model" == text-embedding-ada-002 ]]; then
  set_key OPENSEARCH_EMBEDDING_MODEL 'Qwen/Qwen3-Embedding-0.6B'
  set_key OPENSEARCH_EMBEDDING_DIMS 1024
  set_key EMBEDDING_MODEL_ID 'Qwen/Qwen3-Embedding-0.6B'
fi
if [[ "$cur_dims" == "1536" ]]; then
  cur_model2="$(grep -E '^OPENSEARCH_EMBEDDING_MODEL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  if [[ "$cur_model2" == Qwen/* || "$cur_model2" == *Qwen* || "$cur_model2" == *qwen* ]]; then
    set_key OPENSEARCH_EMBEDDING_DIMS 1024
  fi
fi
if grep -qE '^OPENSEARCH_EMBEDDING_BASE_URL=http://embeddings:' "$ENV_FILE" 2>/dev/null; then
  set_key OPENSEARCH_EMBEDDINGS_ENABLED 1
fi

if [[ "${SKIP_EMBEDDINGS:-0}" == "1" ]]; then
  echo "ensure-embeddings-env: SKIP_EMBEDDINGS=1 — env only"
  exit 0
fi

echo "==> optional-embeddings: qwen embeddings"
COMPOSE=(docker compose --profile optional-embeddings)
if [[ "${EMBEDDINGS_BUILD:-1}" != "0" ]]; then
  "${COMPOSE[@]}" build embeddings || echo "WARN: embeddings build failed"
fi
"${COMPOSE[@]}" up -d embeddings || {
  echo "WARN: optional-embeddings up failed — RAG will use BM25 until fixed"
  exit 0
}

for i in 1 2 3 4 5 6 7 8 9 10; do
  if "${COMPOSE[@]}" exec -T embeddings curl -sf http://127.0.0.1:8080/health >/dev/null 2>&1; then
    echo "    embeddings healthy"
    break
  fi
  sleep 6
done
echo "ENSURE_EMBEDDINGS_DONE model=Qwen/Qwen3-Embedding-0.6B base=http://embeddings:8080/v1"
