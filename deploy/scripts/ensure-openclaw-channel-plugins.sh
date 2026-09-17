#!/usr/bin/env bash
# Install official OpenClaw channel plugins needed for Agent OS channel wizard (WhatsApp QR).
# The WhatsApp runtime is coupled to OpenClaw's channel lifecycle API, so merely finding a
# persisted extension directory is not sufficient: deploys must keep its version aligned with
# the installed OpenClaw core.
set -euo pipefail

OC_DIR="${OPENCLAW_DIR:-${HOME:-/root}/.openclaw}"
WA_DIR="${OC_DIR}/extensions/whatsapp"
WA_PACKAGE="${WA_DIR}/package.json"

if ! command -v openclaw >/dev/null 2>&1; then
  echo "[openclaw-channels] WARN: openclaw CLI missing — skip WhatsApp plugin install" >&2
  exit 0
fi

CORE_VERSION="$(openclaw --version 2>/dev/null | sed -nE 's/^OpenClaw[[:space:]]+([^[:space:]]+).*/\1/p' | head -n 1)"
PLUGIN_VERSION=""
if [[ ! -f "${WA_PACKAGE}" ]]; then
  for candidate in "${OC_DIR}"/npm/projects/openclaw-whatsapp-*/node_modules/@openclaw/whatsapp/package.json; do
    if [[ -f "${candidate}" ]]; then
      WA_PACKAGE="${candidate}"
      break
    fi
  done
fi
if [[ -f "${WA_PACKAGE}" ]] && command -v node >/dev/null 2>&1; then
  PLUGIN_VERSION="$(node -e 'try { process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version || "")); } catch {}' "${WA_PACKAGE}")"
fi

if [[ -n "${CORE_VERSION}" && "${PLUGIN_VERSION}" == "${CORE_VERSION}" ]]; then
  echo "[openclaw-channels] WhatsApp plugin ${PLUGIN_VERSION} matches OpenClaw ${CORE_VERSION}"
  exit 0
fi

if [[ -z "${CORE_VERSION}" ]]; then
  echo "[openclaw-channels] WARN: could not determine OpenClaw version — skip WhatsApp plugin install" >&2
  exit 0
fi

PLUGIN_SPEC="@openclaw/whatsapp@${CORE_VERSION}"
echo "[openclaw-channels] Installing ${PLUGIN_SPEC} (was ${PLUGIN_VERSION:-missing}) ..."
if openclaw plugins install "${PLUGIN_SPEC}" --force --pin --accept-capabilities; then
  echo "[openclaw-channels] WhatsApp plugin aligned with OpenClaw ${CORE_VERSION}"
else
  echo "[openclaw-channels] WARN: WhatsApp plugin install/upgrade failed (QR/inbound replies may be unavailable)" >&2
  exit 0
fi
