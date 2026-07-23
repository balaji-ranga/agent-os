#!/usr/bin/env bash
# Ensure Workflow Certify env knobs exist in deploy/.env (default: LLM Checker OFF).
# Idempotent — appends a commented block once if no WORKFLOW_CERTIFY_* lines exist.
# Usage: bash deploy/scripts/ensure-workflow-certify-env.sh [/path/to/deploy/.env]
set -euo pipefail
ENV_FILE="${1:-/opt/agent-os/deploy/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "WARN: $ENV_FILE not found — skip workflow certify env ensure"
  exit 0
fi

if grep -qE '^[[:space:]]*#?[[:space:]]*WORKFLOW_CERTIFY_' "$ENV_FILE" 2>/dev/null; then
  # If USE_LLM_CHECKER is completely missing, append the explicit default OFF line
  if ! grep -qE '^[[:space:]]*#?[[:space:]]*WORKFLOW_CERTIFY_USE_LLM_CHECKER=' "$ENV_FILE" 2>/dev/null; then
    {
      echo ""
      echo "# LLM Checker soft grading (0/unset=OFF recommended) — $(date -Is)"
      echo "WORKFLOW_CERTIFY_USE_LLM_CHECKER=0"
    } >> "$ENV_FILE"
    echo "Added WORKFLOW_CERTIFY_USE_LLM_CHECKER=0 to $ENV_FILE"
  else
    echo "WORKFLOW_CERTIFY_* already present in $ENV_FILE"
  fi
  exit 0
fi

{
  echo ""
  echo "# ---- Workflow autonomous certify (Maker / Checker) — $(date -Is) ----"
  echo "# Deterministic Checker always runs. LLM Checker optional (default OFF)."
  echo "# Set WORKFLOW_CERTIFY_USE_LLM_CHECKER=1 to enable soft LLM grading (secondary model)."
  echo "WORKFLOW_CERTIFY_USE_LLM_CHECKER=0"
  echo "# WORKFLOW_CERTIFY_MAX_ATTEMPTS=5"
  echo "# WORKFLOW_CERTIFY_MAX_WALL_MS=300000"
  echo "# WORKFLOW_CERTIFY_TEST_TIMEOUT_MS=45000"
  echo "# WORKFLOW_CERTIFY_MAKER_MODEL="
  echo "# WORKFLOW_CERTIFY_CHECKER_MODEL="
} >> "$ENV_FILE"

echo "Added WORKFLOW_CERTIFY_* block (LLM Checker OFF) to $ENV_FILE"
