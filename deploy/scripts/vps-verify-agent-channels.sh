#!/usr/bin/env bash
# Verify CEO agent channels (WhatsApp/Slack) are present in openclaw.json after deploy.
# Fails (exit 1) when DB has enabled/pairing channels but OpenClaw config is missing them.
#
# Usage:
#   bash /opt/agent-os/deploy/scripts/vps-verify-agent-channels.sh
set -euo pipefail

ROOT="${ROOT:-/opt/agent-os}"
cd "$ROOT/deploy" 2>/dev/null || cd "$ROOT"

echo "==> agent-channels sync + drift check"

if ! docker compose exec -T backend true >/dev/null 2>&1; then
  echo "ERROR: backend container not running"
  exit 1
fi

# Snapshot whether openclaw already has WhatsApp accounts (avoid needless restarts).
BEFORE_WA=$(
  docker compose exec -T openclaw node -e \
    'const c=require("/root/.openclaw/openclaw.json"); process.stdout.write(String(Object.keys((c.channels&&c.channels.whatsapp&&c.channels.whatsapp.accounts)||{}).length))' \
    2>/dev/null || echo 0
)

# Always re-merge from DB (source of truth) + refresh sidecar.
SYNC_OUT=$(
  docker compose exec -T -w /opt/agent-os/backend backend \
    node scripts/sync-agent-channels-to-openclaw.js 2>/tmp/agent-channels-sync.err || true
)
if ! echo "$SYNC_OUT" | grep -q '"ok": true'; then
  echo "ERROR: sync-agent-channels-to-openclaw.js failed"
  cat /tmp/agent-channels-sync.err 2>/dev/null || true
  echo "$SYNC_OUT"
  exit 1
fi
echo "    sync: $SYNC_OUT"

AFTER_WA=$(
  docker compose exec -T openclaw node -e \
    'const c=require("/root/.openclaw/openclaw.json"); process.stdout.write(String(Object.keys((c.channels&&c.channels.whatsapp&&c.channels.whatsapp.accounts)||{}).length))' \
    2>/dev/null || echo 0
)
# Restart only when sync repaired a missing account set (or bindings newly present).
if [[ "${BEFORE_WA:-0}" -eq 0 && "${AFTER_WA:-0}" -gt 0 ]]; then
  echo "    restarting openclaw so restored WhatsApp accounts bind (before=$BEFORE_WA after=$AFTER_WA)..."
  docker compose restart openclaw >/dev/null 2>&1 || true
  for _i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    st=$(docker compose ps --format '{{.Health}}' openclaw 2>/dev/null | head -1 || true)
    [[ "$st" == "healthy" ]] && break
    sleep 2
  done
fi

# Compare DB enabled/pairing counts vs openclaw.json accounts.
CHECK=$(docker compose exec -T -w /opt/agent-os/backend backend node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
import { readFileSync, existsSync } from 'fs';
import { getOpenClawConfigPath, getOpenClawDir } from './src/config/openclaw-paths.js';
import { join } from 'path';

initDb();
const db = getDb();
const rows = db
  .prepare(
    `SELECT channel, status, agent_id FROM ceo_agent_channels
     WHERE LOWER(status) IN ('enabled','pairing')`
  )
  .all();
const byChannel = {};
for (const r of rows) {
  const ch = String(r.channel || '').toLowerCase();
  byChannel[ch] = (byChannel[ch] || 0) + 1;
}

const cfgPath = getOpenClawConfigPath();
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
const waAccounts = Object.keys(cfg.channels?.whatsapp?.accounts || {});
const slackAccounts = Object.keys(cfg.channels?.slack?.accounts || {});
const bindings = Array.isArray(cfg.bindings) ? cfg.bindings.length : 0;
const sidecarPath = join(getOpenClawDir(), 'agent-os-channel-routing.json');
const sidecarOk = existsSync(sidecarPath);

// WhatsApp groupPolicy must default to disabled (DM allowFrom does not cover @g.us).
const waGroupPolicy = [];
const waMissingFromPrefix = [];
const waAccountsObj = cfg.channels?.whatsapp?.accounts || {};
for (const id of Object.keys(waAccountsObj)) {
  const gp = String(waAccountsObj[id]?.groupPolicy || cfg.channels?.whatsapp?.groupPolicy || '').toLowerCase();
  if (gp !== 'disabled' && gp !== 'allowlist' && gp !== 'open') {
    waGroupPolicy.push(`${id}:missing`);
  }
  const prefix = String(
    waAccountsObj[id]?.responsePrefix || cfg.channels?.whatsapp?.responsePrefix || ''
  );
  if (!/From:\s*\{identityName\}|From:/i.test(prefix)) {
    waMissingFromPrefix.push(id);
  }
}
const channelWaGroupPolicy = String(cfg.channels?.whatsapp?.groupPolicy || '').toLowerCase();

const expectWa = byChannel.whatsapp || 0;
const expectSlack = byChannel.slack || 0;
const drift = [];
if (expectWa > 0 && waAccounts.length < expectWa) {
  drift.push(`whatsapp db=${expectWa} openclaw_accounts=${waAccounts.length}`);
}
if (expectSlack > 0 && slackAccounts.length < expectSlack) {
  drift.push(`slack db=${expectSlack} openclaw_accounts=${slackAccounts.length}`);
}
if ((expectWa > 0 || expectSlack > 0) && bindings < 1) {
  drift.push(`bindings=${bindings} (expected >=1)`);
}
if ((expectWa > 0 || expectSlack > 0) && !sidecarOk) {
  drift.push('sidecar agent-os-channel-routing.json missing');
}
if (expectWa > 0 && waGroupPolicy.length) {
  drift.push(`whatsapp groupPolicy unset (${waGroupPolicy.join(',')}) — re-sync agent channels`);
}
if (expectWa > 0 && !['disabled', 'allowlist', 'open'].includes(channelWaGroupPolicy)) {
  drift.push('channels.whatsapp.groupPolicy missing (expect disabled by default)');
}
if (expectWa > 0 && waMissingFromPrefix.length) {
  drift.push(`whatsapp responsePrefix missing From: (${waMissingFromPrefix.join(',')})`);
}

const out = {
  ok: drift.length === 0,
  db: byChannel,
  openclaw: {
    whatsapp: waAccounts,
    slack: slackAccounts,
    bindings,
    sidecarOk,
    whatsapp_groupPolicy: channelWaGroupPolicy || null,
  },
  drift,
};
process.stdout.write(JSON.stringify(out));
process.exit(drift.length ? 2 : 0);
NODE
) || true

echo "    check: $CHECK"
if echo "$CHECK" | grep -q '"ok":false\|"ok": false'; then
  echo "ERROR: agent channel configuration drift detected"
  echo "    Re-enable from My Org → Agent channels, or re-run:"
  echo "    docker compose exec -T -w /opt/agent-os/backend backend node scripts/sync-agent-channels-to-openclaw.js"
  echo "    docker compose restart openclaw"
  exit 1
fi

if echo "$CHECK" | grep -q '"whatsapp_groupPolicy":"disabled"'; then
  echo "    WhatsApp groupPolicy=disabled OK (groups blocked before media download)"
elif echo "$CHECK" | grep -q '"whatsapp":\[' && ! echo "$CHECK" | grep -q '"whatsapp":\[\]'; then
  echo "    WARN: WhatsApp present but groupPolicy not reported as disabled — verify allowlist/open is intentional"
fi

if echo "$CHECK" | grep -q '"whatsapp":\[' && ! echo "$CHECK" | grep -q '"whatsapp":\[\]'; then
  if docker compose logs openclaw 2>/dev/null | tail -n 400 | grep -qiE 'Listening for WhatsApp inbound|starting provider'; then
    echo "    openclaw WhatsApp provider log: OK"
  else
    echo "    WARN: WhatsApp accounts present but no recent Listening log — check docker compose logs openclaw"
  fi
fi

echo "    agent-channels verify OK"
exit 0
