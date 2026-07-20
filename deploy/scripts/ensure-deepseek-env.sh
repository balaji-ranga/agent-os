#!/usr/bin/env bash
# Ensure DEEPSEEK_* vars exist in deploy/.env (for optional-deepseek profile).
# Copies OPENAI_SECONDARY_* when secondary points at api.deepseek.com.
set -euo pipefail
ENV_FILE="${1:-/opt/agent-os/deploy/.env}"
[[ -f "$ENV_FILE" ]] || exit 0

if grep -qE '^DEEPSEEK_API_KEY=.+' "$ENV_FILE" 2>/dev/null; then
  echo "DEEPSEEK_API_KEY already set"
  exit 0
fi

SEC_BASE=$(grep -E '^OPENAI_SECONDARY_BASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
SEC_KEY=$(grep -E '^OPENAI_SECONDARY_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
SEC_MODEL=$(grep -E '^OPENAI_SECONDARY_MODEL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)

if [[ -n "$SEC_KEY" && "$SEC_BASE" == *deepseek.com* ]]; then
  {
    echo ""
    echo "# DeepSeek V3 (auto from OPENAI_SECONDARY_* — $(date -Is))"
    echo "DEEPSEEK_API_KEY=$SEC_KEY"
    echo "DEEPSEEK_BASE_URL=http://deepseek:8080/v1"
    echo "DEEPSEEK_MODEL=${SEC_MODEL:-deepseek-chat}"
  } >> "$ENV_FILE"
  echo "Added DEEPSEEK_* from OPENAI_SECONDARY (deepseek.com)"
  exit 0
fi

echo "WARN: DEEPSEEK_API_KEY not set — add to $ENV_FILE and re-run optional-deepseek profile"
exit 0
