#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-gateway}"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
AGENT_OS_ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
OC_DIR="${OPENCLAW_DIR:-/root/.openclaw}"

mkdir -p "${OC_DIR}"

# Refresh volume-mounted extensions from the image on every start so rebuilds
# are repeatable without re-running the full init profile.
sync_extensions_from_image() {
  local sync_js="${AGENT_OS_ROOT}/scripts/sync-openclaw-extensions.js"
  if [[ ! -f "${sync_js}" ]]; then
    echo "[openclaw] WARN: ${sync_js} missing — skipping extension sync"
    return 0
  fi
  echo "[openclaw] Syncing Agent OS extensions into ${OC_DIR}/extensions ..."
  node "${sync_js}" || {
    echo "[openclaw] WARN: extension sync failed (gateway will still start)" >&2
    return 0
  }
  # Official WhatsApp plugin (ClawHub) for QR pairing in Agent OS channel wizard.
  local ensure_channels="${AGENT_OS_ROOT}/deploy/scripts/ensure-openclaw-channel-plugins.sh"
  if [[ -f "${ensure_channels}" ]]; then
    bash "${ensure_channels}" || echo "[openclaw] WARN: channel plugin ensure failed" >&2
  fi
  # Keep plugin baseUrl / apiKey / gateway token / tools.allow aligned with container env
  # when config exists (incl. learnings_summary on global + COO allow — volume-safe).
  local configure_js="${AGENT_OS_ROOT}/deploy/scripts/configure-openclaw-docker.js"
  local restore_channels_js="${AGENT_OS_ROOT}/deploy/scripts/restore-openclaw-channel-routing.js"
  local config_path="${OPENCLAW_CONFIG_PATH:-${OC_DIR}/openclaw.json}"
  if [[ -f "${configure_js}" && -f "${config_path}" ]]; then
    echo "[openclaw] Applying container OpenClaw config from env..."
    node "${configure_js}" || echo "[openclaw] WARN: configure-openclaw-docker.js failed" >&2
  fi
  # configure/apply can drop channels.whatsapp; restore from sidecar written by Agent OS backend.
  if [[ -f "${restore_channels_js}" && -f "${config_path}" ]]; then
    node "${restore_channels_js}" || echo "[openclaw] WARN: channel routing restore failed" >&2
  fi
}

# OpenClaw gateway prefers process env OPENAI_API_KEY over models.providers.openai.apiKey.
# Admin primary/secondary switch writes platform-llm-runtime.env with the *effective* key+baseUrl.
# Always prefer that file when present so DeepSeek ↔ OpenAI flips stick after restart.
apply_platform_llm_runtime_env() {
  local marker="${OC_DIR}/platform-llm-active.json"
  local runtime_env="${OC_DIR}/platform-llm-runtime.env"

  if [[ -f "${runtime_env}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${runtime_env}"
    set +a
    echo "[openclaw] Sourced ${runtime_env} (OPENAI_API_KEY prefix ${OPENAI_API_KEY:0:10}... BASE=${OPENAI_BASE_URL:-})"
    return 0
  fi

  # Fallback if runtime.env not yet written: honor marker + SECONDARY_* for secondary only
  if [[ -f "${marker}" ]] && grep -Eq '"active"[[:space:]]*:[[:space:]]*"secondary"' "${marker}" 2>/dev/null; then
    if [[ -n "${OPENAI_SECONDARY_API_KEY:-}" ]]; then
      export OPENAI_API_KEY="${OPENAI_SECONDARY_API_KEY}"
      export OPENAI_BASE_URL="${OPENAI_SECONDARY_BASE_URL:-https://api.openai.com/v1}"
      echo "[openclaw] Honoring platform-llm-active secondary → OPENAI_API_KEY from OPENAI_SECONDARY_API_KEY (prefix ${OPENAI_API_KEY:0:10}...)"
    fi
  fi
}

marker_mtime() {
  local marker="${OC_DIR}/platform-llm-active.json"
  if [[ -f "${marker}" ]]; then
    stat -c %Y "${marker}" 2>/dev/null || stat -f %m "${marker}" 2>/dev/null || echo 0
  else
    echo 0
  fi
}

# openclaw gateway often re-execs / spawns openclaw-gateway with a different PID than $!.
# Kill the recorded child and any leftover gateway processes so env reload actually sticks.
kill_openclaw_gateway() {
  local gpid="${1:-}"
  if [[ -n "${gpid}" ]]; then
    kill "${gpid}" 2>/dev/null || true
    wait "${gpid}" 2>/dev/null || true
  fi
  local p cmd pid
  for p in /proc/[0-9]*; do
    pid="${p#/proc/}"
    [[ "${pid}" == "1" || "${pid}" == "$$" ]] && continue
    cmd="$(tr '\0' ' ' < "${p}/cmdline" 2>/dev/null || true)"
    if [[ "${cmd}" == *openclaw-gateway* || "${cmd}" == *"openclaw gateway"* ]]; then
      echo "[openclaw] Stopping leftover gateway pid=${pid}"
      kill "${pid}" 2>/dev/null || true
    fi
  done
  # Brief wait for port release
  sleep 1
  for p in /proc/[0-9]*; do
    pid="${p#/proc/}"
    cmd="$(tr '\0' ' ' < "${p}/cmdline" 2>/dev/null || true)"
    if [[ "${cmd}" == *openclaw-gateway* || "${cmd}" == *"openclaw gateway"* ]]; then
      echo "[openclaw] Force-killing gateway pid=${pid}"
      kill -9 "${pid}" 2>/dev/null || true
    fi
  done
  sleep 1
}

start_vnc_if_enabled() {
  if [[ "${ENABLE_VNC:-0}" != "1" ]]; then
    return 0
  fi
  export DISPLAY="${DISPLAY:-:99}"
  if ! pgrep -x Xvfb >/dev/null 2>&1; then
    echo "[openclaw] Starting Xvfb on ${DISPLAY}..."
    Xvfb "${DISPLAY}" -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
    sleep 2
  fi
  if ! pgrep -x x11vnc >/dev/null 2>&1; then
    echo "[openclaw] Starting x11vnc on :5900..."
    x11vnc -display "${DISPLAY}" -forever -shared -rfbport 5900 -nopw -bg
  fi
}

# Bridge 0.0.0.0:18792 → loopback extension relay :18799 so host-network nginx can reach it.
# OpenClaw binds the relay on 127.0.0.1 only (and rejects non-loopback Host), so Docker
# port-publish alone is not enough without this forwarder.
start_extension_relay_bridge() {
  local bridge_port="${OPENCLAW_EXTENSION_BRIDGE_PORT:-18792}"
  local relay_port="${OPENCLAW_EXTENSION_RELAY_PORT:-18799}"
  if ! command -v socat >/dev/null 2>&1; then
    echo "[openclaw] WARN: socat missing — Chrome extension WSS bridge on :${bridge_port} unavailable"
    return 0
  fi
  for _cmd in /proc/[0-9]*/cmdline; do
    # Avoid grep|pipefail: non-match must not abort under set -euo pipefail
    _line=$(tr '\0' ' ' < "$_cmd" 2>/dev/null || true)
    if [[ "$_line" == *"TCP-LISTEN:${bridge_port}"* ]]; then
      return 0
    fi
  done
  echo "[openclaw] Starting extension relay bridge 0.0.0.0:${bridge_port} → 127.0.0.1:${relay_port}"
  socat "TCP-LISTEN:${bridge_port},bind=0.0.0.0,fork,reuseaddr" "TCP:127.0.0.1:${relay_port}" &
}

# Run gateway as a child and re-exec env+process when Admin flips platform-llm-active.json.
# Without this, sync updates files but live OPENAI_API_KEY stays sticky → 401 → ollama dumps.
run_gateway_with_platform_llm_watch() {
  apply_platform_llm_runtime_env
  start_vnc_if_enabled
  start_extension_relay_bridge
  local last_mtime
  last_mtime="$(marker_mtime)"
  while true; do
    echo "[openclaw] Starting gateway on port ${GATEWAY_PORT}..."
    openclaw gateway --port "${GATEWAY_PORT}" &
    local gpid=$!
    # Resolve re-exec'd openclaw-gateway PID if $! was only a short-lived wrapper
    sleep 1
    local real_pid=""
    local p cmd pid
    for p in /proc/[0-9]*; do
      pid="${p#/proc/}"
      cmd="$(tr '\0' ' ' < "${p}/cmdline" 2>/dev/null || true)"
      if [[ "${cmd}" == *openclaw-gateway* ]]; then
        real_pid="${pid}"
      fi
    done
    if [[ -n "${real_pid}" ]]; then
      gpid="${real_pid}"
      echo "[openclaw] Gateway pid=${gpid}"
    fi
    # Warm chrome extension relay (binds 127.0.0.1:18799) so nginx→:18792 works immediately.
    (
      sleep 3
      openclaw browser status --browser-profile chrome >/dev/null 2>&1 || true
    ) &
    local reloading=0
    while kill -0 "${gpid}" 2>/dev/null; do
      sleep 2
      # Keep socat bridge alive across gateway restarts
      start_extension_relay_bridge
      local now
      now="$(marker_mtime)"
      if [[ "${now}" != "0" && "${now}" != "${last_mtime}" ]]; then
        echo "[openclaw] platform-llm-active.json changed (${last_mtime} → ${now}) — reloading env + restarting gateway"
        last_mtime="${now}"
        reloading=1
        # Source runtime.env *before* configure so OPENAI_API_KEY matches Admin switch
        apply_platform_llm_runtime_env
        local configure_js="${AGENT_OS_ROOT}/deploy/scripts/configure-openclaw-docker.js"
        local restore_channels_js="${AGENT_OS_ROOT}/deploy/scripts/restore-openclaw-channel-routing.js"
        local config_path="${OPENCLAW_CONFIG_PATH:-${OC_DIR}/openclaw.json}"
        if [[ -f "${configure_js}" && -f "${config_path}" ]]; then
          node "${configure_js}" || echo "[openclaw] WARN: configure-openclaw-docker.js failed on reload" >&2
        fi
        if [[ -f "${restore_channels_js}" && -f "${config_path}" ]]; then
          node "${restore_channels_js}" || echo "[openclaw] WARN: channel routing restore failed on reload" >&2
        fi
        # Re-source — configure may rewrite platform-llm-runtime.env
        apply_platform_llm_runtime_env
        kill_openclaw_gateway "${gpid}"
        break
      fi
    done
    # Intentional Admin-switch reload — start a fresh gateway with new env
    if [[ "${reloading}" == "1" ]]; then
      echo "[openclaw] Reload complete — restarting gateway with updated OPENAI_* env"
      continue
    fi
    # Gateway exited on its own (crash) — propagate so Docker restart policy can recover
    wait "${gpid}" 2>/dev/null || true
    local code=$?
    echo "[openclaw] Gateway exited with code ${code}"
    exit "${code}"
  done
}

case "${MODE}" in
  gateway)
    sync_extensions_from_image
    run_gateway_with_platform_llm_watch
    ;;
  bootstrap)
    echo "[openclaw] Running bootstrap..."
    exec /opt/agent-os/scripts/setup-openclaw-from-scratch.sh --docker --install-browser
    ;;
  *)
    echo "Unknown mode: ${MODE} (use gateway|bootstrap)" >&2
    exit 1
    ;;
esac
