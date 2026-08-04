#!/usr/bin/env bash
# Ensure OpenSearch-related env keys exist in deploy/.env (idempotent).
# Does not overwrite existing values (except ensure-embeddings-env migrates OpenAI defaults).
# Safe to run from up.sh / vps-deploy-latest.sh on any fresh host.
set -euo pipefail
ENV_FILE="${1:-}"
if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ensure-opensearch-env: missing $ENV_FILE" >&2
  exit 0
fi

upsert() {
  local key="$1"
  local val="$2"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    return 0
  fi
  printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  echo "ensure-opensearch-env: added $key"
}

# Document RAG (OpenSearch) — internal Docker DNS only; never publish 9200/5601.
# Security plugin is disabled in compose; isolation = Docker network + admin BFF for Dashboards.
upsert OPENSEARCH_ENABLED 1
upsert OPENSEARCH_URL 'http://opensearch:9200'
upsert OPENSEARCH_DASHBOARDS_URL 'http://opensearch-dashboards:5601'
upsert OPENSEARCH_USERNAME admin
upsert OPENSEARCH_PASSWORD ''
upsert OPENSEARCH_ADMIN_PASSWORD ''
# Local Qwen embeddings (see ensure-embeddings-env.sh) — not OpenAI cloud
upsert OPENSEARCH_EMBEDDING_BASE_URL 'http://embeddings:8080/v1'
upsert OPENSEARCH_EMBEDDING_MODEL 'Qwen/Qwen3-Embedding-0.6B'
upsert OPENSEARCH_EMBEDDING_DIMS 1024
upsert OPENSEARCH_EMBEDDING_API_KEY 'local'
upsert OPENSEARCH_EMBEDDINGS_ENABLED 1
upsert OPENSEARCH_JAVA_OPTS '-Xms512m -Xmx512m'

# Kernel hint (logged only; up.sh / vps-deploy-latest.sh applies sysctl when possible)
if ! grep -q 'OpenSearch document RAG' "$ENV_FILE" 2>/dev/null; then
  cat >> "$ENV_FILE" <<'EOF'

# ---- OpenSearch document RAG (internal only; no host ports) ----
# Indices: aos-docs-meta-{fp} / aos-docs-search-{fp} per CEO; aos-docs-*-platform for help.
# Admin UI: /admin/documents-rag ; Dashboards BFF: /opensearch/ (admin session cookie).
# Never publish :9200 or :5601. Host requires: sysctl -w vm.max_map_count=262144
# Persist: echo 'vm.max_map_count=262144' >> /etc/sysctl.conf && sysctl -p
# Embeddings: local Qwen via compose profile optional-embeddings (ensure-embeddings-env.sh).
# OPENSEARCH_EMBEDDING_BASE_URL=http://embeddings:8080/v1 model Qwen/Qwen3-Embedding-0.6B (1024-d).
# After first enable or dim change: Reindex all (Master Data / Admin Documents RAG).
EOF
fi
