#!/usr/bin/env bash
# Install official OpenClaw channel plugins needed for Agent OS channel wizard (WhatsApp QR).
# Idempotent: skips when extensions/whatsapp already exists.
set -euo pipefail

OC_DIR="${OPENCLAW_DIR:-${HOME:-/root}/.openclaw}"
WA_DIR="${OC_DIR}/extensions/whatsapp"

if [[ -d "${WA_DIR}" ]]; then
  echo "[openclaw-channels] WhatsApp plugin already present at ${WA_DIR}"
  exit 0
fi

if ! command -v openclaw >/dev/null 2>&1; then
  echo "[openclaw-channels] WARN: openclaw CLI missing — skip WhatsApp plugin install" >&2
  exit 0
fi

echo "[openclaw-channels] Installing clawhub:@openclaw/whatsapp ..."
if openclaw plugins install clawhub:@openclaw/whatsapp --acknowledge-clawhub-risk --force; then
  echo "[openclaw-channels] WhatsApp plugin installed"
else
  echo "[openclaw-channels] WARN: WhatsApp plugin install failed (QR pairing will be unavailable)" >&2
  exit 0
fi
