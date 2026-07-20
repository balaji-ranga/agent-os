#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-gateway}"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
AGENT_OS_ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"

mkdir -p "${OPENCLAW_DIR:-/root/.openclaw}"

# Refresh volume-mounted extensions from the image on every start so rebuilds
# are repeatable without re-running the full init profile.
sync_extensions_from_image() {
  local sync_js="${AGENT_OS_ROOT}/scripts/sync-openclaw-extensions.js"
  if [[ ! -f "${sync_js}" ]]; then
    echo "[openclaw] WARN: ${sync_js} missing — skipping extension sync"
    return 0
  fi
  echo "[openclaw] Syncing Agent OS extensions into ${OPENCLAW_DIR:-/root/.openclaw}/extensions ..."
  node "${sync_js}" || {
    echo "[openclaw] WARN: extension sync failed (gateway will still start)" >&2
    return 0
  }
  # Keep plugin baseUrl / apiKey / gateway token / tools.allow aligned with container env
  # when config exists (incl. learnings_summary on global + COO allow — volume-safe).
  local configure_js="${AGENT_OS_ROOT}/deploy/scripts/configure-openclaw-docker.js"
  local config_path="${OPENCLAW_CONFIG_PATH:-${OPENCLAW_DIR:-/root/.openclaw}/openclaw.json}"
  if [[ -f "${configure_js}" && -f "${config_path}" ]]; then
    echo "[openclaw] Applying container OpenClaw config from env..."
    node "${configure_js}" || echo "[openclaw] WARN: configure-openclaw-docker.js failed" >&2
  fi
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

case "${MODE}" in
  gateway)
    sync_extensions_from_image
    start_vnc_if_enabled
    echo "[openclaw] Starting gateway on port ${GATEWAY_PORT}..."
    exec openclaw gateway --port "${GATEWAY_PORT}"
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
