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

TZ_MARKER="Display timezone for user-facing dates"

# Timezone reference block is tracked separately so existing installs still get it.
ensure_timezone_block() {
  if grep -qF "$TZ_MARKER" "$ENV_FILE"; then
    echo "ENSURE_TZ_ENV_OK already_present=$ENV_FILE"
    return
  fi
  cat >> "$ENV_FILE" <<'TZEOF'

# ---- Display timezone for user-facing dates ----
# TZ drives cron expressions and the container clock. PLATFORM_TIMEZONE (optional) drives dates
# rendered for users — Kanban cards and task chat, status reports. Falls back to TZ when unset.
# PLATFORM_TIMEZONE=Asia/Singapore
TZEOF
  echo "ENSURE_TZ_ENV_ADDED file=$ENV_FILE"
}

# Patch older .env files that already have the cron marker but lack newer keys.
ensure_missing_cron_keys() {
  local added=0
  if ! grep -qF 'KANBAN_ORPHAN_WATCHER_CRON' "$ENV_FILE"; then
    cat >> "$ENV_FILE" <<'EOF'
# KANBAN_ORPHAN_WATCHER_CRON=*/5 * * * *   # re-pend stuck processing + reinitiate orphan specialty Kanban
EOF
    added=1
  fi
  if ! grep -qF 'OPENCLAW_SESSION_CLEANUP_CRON' "$ENV_FILE"; then
    cat >> "$ENV_FILE" <<'EOF'
# OPENCLAW_SESSION_CLEANUP_CRON=30 2 * * * # execution-session audit/cleanup (Admin → Crons; dry-run default)
# OPENCLAW_SESSION_CLEANUP_DRY_RUN=1
# OPENCLAW_SESSION_CLEANUP_RETENTION_DAYS=7
# OPENCLAW_SESSION_CLEANUP_MISSING_GRACE_HOURS=48
# OPENCLAW_SESSION_CLEANUP_RECENT_MINUTES=15
# OPENCLAW_SESSION_CLEANUP_BATCH_SIZE=500
EOF
    added=1
  fi
  if ! grep -qF 'SCHEDULED_GOALS_CRON' "$ENV_FILE"; then
    cat >> "$ENV_FILE" <<'EOF'
# SCHEDULED_GOALS_CRON=* * * * *          # CEO scheduled goals: hourly|daily|weekdays|weekly; pause/delete off schedule
EOF
    added=1
  fi
  if ! grep -qF 'GOAL_RUN_RECOVERY_CRON' "$ENV_FILE"; then
    cat >> "$ENV_FILE" <<'EOF'
# GOAL_RUN_RECOVERY_CRON=*/15 * * * *      # wake stuck goals only when no active agent/workflow/human/approval blocks
# GOAL_RUN_WAKE_STALE_MS=120000
# GOAL_PLANNING_STALE_MS=900000
# GOAL_EXECUTION_STALE_MS=600000
# GOAL_RUN_RECOVERY_MAX_RETRIES=1
EOF
    added=1
  fi
  
  if ! grep -qF 'WORKFLOW_TERMINAL_WATCH_CRON' "$ENV_FILE"; then
    cat >> "$ENV_FILE" <<'EOF'
# WORKFLOW_TERMINAL_WATCH_CRON=*/5 * * * *  # Admin: WF terminal watch safety sweep + pause kill-switch
# GOAL_PLAN_COMPLETION_NUDGE_CRON=*/10 * * * * # Admin: goal plan completion nudge safety sweep
# WORKFLOW_TIMEOUT_WATCHDOG_CRON=*/1 * * * * # Admin: workflow step timeout reaper
# WORKFLOW_COO_WAKE_ON_TERMINAL=1
# GOAL_PLAN_COO_COMPLETION_NUDGE=1
EOF
    added=1
  fi

  if ! grep -qF 'GOAL_PLAN_FAILURE_KANBAN' "$ENV_FILE"; then
    cat >> "$ENV_FILE" <<'EOF'
# GOAL_PLAN_FAILURE_KANBAN=1              # 0 disables recovery Kanban+delegation when a goal plan fails (Admin → AgentSystem recovery can override)
# GOAL_PLAN_MAX_SPECIALTY=8              # Max specialty_task intents per durable goal plan
EOF
    added=1
  fi
  if ! grep -qF 'GOAL_PLAN_MAX_INTENTS' "$ENV_FILE"; then
    cat >> "$ENV_FILE" <<'EOF'
# GOAL_PLAN_MAX_INTENTS=12               # Max hybrid intents classified per plan (4–20)
# SCHEDULED_GOAL_CHAT_TIMEOUT_MS=240000  # Chat-mode scheduled goal AgentSystem timeout
# SCHEDULED_GOAL_STUCK_MINUTES=30        # Reconcile last_status=running with no plan after this many minutes
# GOAL_AGENT_CONTINUE_TIMEOUT_MS=240000  # AgentSystem agent_continue timeout for goal-plan interpretation steps
# GOAL_PLAN_COO_NUDGE_TIMEOUT_MS=45000   # Max wait for optional COO LLM wording before deterministic ladder fallback
EOF
    added=1
  fi
  if ! grep -qF 'CRM_TLS_WORKSPACE_CERT_CRON' "$ENV_FILE"; then
    cat >> "$ENV_FILE" <<'EOF'
# CRM_TLS_WORKSPACE_CERT_CRON=40 * * * *   # expand LE SANs when new Twenty {sub}.crm.* host missing from cert (Admin → Crons)
# CRM_TLS_WORKSPACE_CERT_AUTO=1            # 0 = no auto expand after workspace create (cron still may run)
EOF
    added=1
  fi
  if ! grep -qF 'TOOL_API_RATE_LIMIT_RESET_CRON' "$ENV_FILE"; then
    cat >> "$ENV_FILE" <<'EOF'
# TOOL_API_RATE_LIMIT_RESET_CRON=5 0 * * * # audit+zero per-user tool API call actuals at day/month roll (Tools → Rate limits)
EOF
    added=1
  fi
  if [[ "$added" -eq 1 ]]; then
    echo "ENSURE_CRON_ENV_KEYS_ADDED file=$ENV_FILE"
  fi
}

if grep -qF "$MARKER" "$ENV_FILE"; then
  echo "ENSURE_CRON_ENV_OK already_present=$ENV_FILE"
  ensure_missing_cron_keys
  ensure_timezone_block
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
# TOOL_API_RATE_LIMIT_RESET_CRON=5 0 * * * # audit+zero per-user tool API call actuals at day/month roll (Tools → Rate limits)
# DATA_RETENTION_CRON=15 3 * * *           # daily purge: chats/standup msgs/workflow runs + aged Content Explorer media (hard delete)
# OPENCLAW_SESSION_CLEANUP_CRON=30 2 * * * # execution-session audit/cleanup (Admin → Crons; dry-run default)
# OPENCLAW_SESSION_CLEANUP_DRY_RUN=1
# OPENCLAW_SESSION_CLEANUP_RETENTION_DAYS=7
# OPENCLAW_SESSION_CLEANUP_MISSING_GRACE_HOURS=48
# OPENCLAW_SESSION_CLEANUP_RECENT_MINUTES=15
# OPENCLAW_SESSION_CLEANUP_BATCH_SIZE=500
# KANBAN_ORPHAN_WATCHER_CRON=*/5 * * * *   # re-pend stuck processing + reinitiate orphan specialty Kanban
# SCHEDULED_GOALS_CRON=* * * * *          # CEO scheduled goals: hourly|daily|weekdays|weekly prompts → agent (pause/delete off schedule)
# GOAL_PLAN_MAX_SPECIALTY=8              # Max specialty_task intents per durable goal plan
# GOAL_PLAN_MAX_INTENTS=12               # Max hybrid intents classified per plan (4–20)
# SCHEDULED_GOAL_CHAT_TIMEOUT_MS=240000  # Chat-mode scheduled goal AgentSystem timeout
# SCHEDULED_GOAL_STUCK_MINUTES=30        # Reconcile last_status=running with no plan after this many minutes
# GOAL_AGENT_CONTINUE_TIMEOUT_MS=240000  # AgentSystem agent_continue timeout for goal-plan interpretation
# WORKFLOW_TERMINAL_WATCH_CRON=*/5 * * * * # Admin event: WF terminal notify/wake + goal advance (pause kill-switch)
# GOAL_PLAN_COMPLETION_NUDGE_CRON=*/10 * * * * # Admin event: goal plan complete → COO chat nudge once
# WORKFLOW_TIMEOUT_WATCHDOG_CRON=*/1 * * * * # Admin: reap timed-out workflow node steps
# WORKFLOW_COO_WAKE_ON_TERMINAL=1          # 0 disables COO re-invoke on async WF terminal
# GOAL_PLAN_COO_COMPLETION_NUDGE=1         # 0 hard-disables goal completion chat nudge
# GOAL_PLAN_FAILURE_KANBAN=1              # 0 disables recovery Kanban when a plan fails (Admin recovery UI can override)
# CRM_TLS_WORKSPACE_CERT_CRON=40 * * * *   # LE SAN expand for new Twenty workspace hosts (Admin → Crons: crm_tls_workspace_certs)
# CRM_TLS_WORKSPACE_CERT_AUTO=1            # 0 disables post-provision debounce only; set CRON=off to disable schedule
EOF

echo "ENSURE_CRON_ENV_ADDED file=$ENV_FILE"
ensure_timezone_block
