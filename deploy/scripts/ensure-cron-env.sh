#!/usr/bin/env bash
# Ensure the scheduled-job (cron) reference block exists in an env file.
#
# All Agent OS crons have code defaults, so these keys are OPTIONAL — the block is written
# commented out purely as operator reference. Uncomment a line to override the default.
#
# Usage:
#   bash deploy/scripts/ensure-cron-env.sh /opt/agent-os/deploy/.env
#   bash deploy/scripts/ensure-cron-env.sh backend/.env
set -euo pipefail

ENV_FILE="${1:-/opt/agent-os/deploy/.env}"
MARKER="Scheduled jobs (crons) — platform-level timers"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ENSURE_CRON_ENV_SKIP missing=$ENV_FILE"
  exit 0
fi

if grep -qF "$MARKER" "$ENV_FILE"; then
  echo "ENSURE_CRON_ENV_OK already_present=$ENV_FILE"
  exit 0
fi

cat >> "$ENV_FILE" <<'EOF'

# ---- Scheduled jobs (crons) — platform-level timers, per-user effect ----
# Every value below has a built-in default; keys are OPTIONAL and shown commented for reference.
# One timer runs per backend process; each tick then loops over enabled CEOs / their own rows,
# so per-user settings (standup time, workflow schedule_cron, data_retention_days) still apply.
#
# STANDUP_SCHEDULE_CRON=* * * * *          # dispatcher: runs each user standup at its own scheduled_at
# STANDUP_CRON_SCHEDULE=                   # legacy auto-collect standup for every CEO (empty = disabled)
# DELEGATION_CRON_SCHEDULE=* * * * *       # process pending COO -> agent delegation tasks, per CEO
# AGENT_WORKFLOW_SCHEDULER_CRON=* * * * *  # master tick: runs user workflows whose schedule_cron is due
# JOB_PIPELINE_CRON_SCHEDULE=0 * * * *     # Job Applicant pipeline tick across active job profiles
# COO_STATUS_CHECKER_CRON=0 9 * * *        # daily CEO status report -> standup chat + HTML email
# DATA_RETENTION_CRON=15 3 * * *           # daily purge using each user's Profile data_retention_days
EOF

echo "ENSURE_CRON_ENV_ADDED file=$ENV_FILE"
