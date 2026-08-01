#!/usr/bin/env bash
# Verify WhatsApp MEDIA: dual-write + auth-only media + audio MIME for webchat players.
# Public signed URLs are OFF by default (MEDIA_PUBLIC_SIGNED=1 to opt in).
set -euo pipefail
cd "${AGENT_OS_ROOT:-/opt/agent-os}/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"

echo "==> media-url unit checks"
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-media-url.js

echo "==> persist wav + unauth 401 + auth Content-Type + OpenClaw volume"
OUT=$(docker compose exec -T -w /opt/agent-os/backend backend node --input-type=module <<'NODE'
import { existsSync } from 'fs';
import { persistGeneratedOpenClawMedia, isMediaPublicSignedEnabled } from './src/services/media-url.js';
import { initDb, getDb } from './src/db/schema.js';
import { createSession } from './src/services/auth/session.js';

const origInfo = console.info;
console.info = () => {};

const buf = Buffer.alloc(44 + 8);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + 8, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(8000, 24);
buf.writeUInt32LE(16000, 28);
buf.writeUInt16LE(2, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(8, 40);

initDb();
const ceo =
  getDb().prepare("SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1 ORDER BY created_at LIMIT 1").get() ||
  getDb().prepare("SELECT id FROM platform_users WHERE id = 'ceo-bala'").get();
if (!ceo?.id) throw new Error('no ceo for auth media smoke');

const media = persistGeneratedOpenClawMedia(buf, 'verify-tts.wav', 'generated', ceo.id);
console.info = origInfo;
if (!media.local_path || !existsSync(media.local_path)) throw new Error('local_path missing');
if (!String(media.paste_exactly || '').startsWith('MEDIA:')) throw new Error('paste_exactly must be MEDIA:');
if (media.public_url && !isMediaPublicSignedEnabled()) {
  throw new Error('public_url must be null when MEDIA_PUBLIC_SIGNED is off');
}

const rel = String(media.relative_url || '');
const unauth = await fetch('http://127.0.0.1:3001' + rel);
if (unauth.status !== 401) {
  throw new Error('expected unauth media HTTP 401, got ' + unauth.status);
}

const { token } = createSession(ceo.id, { userAgent: 'media-delivery-verify' });
const auth = await fetch('http://127.0.0.1:3001' + rel, {
  headers: { Authorization: 'Bearer ' + token },
});
const ct = String(auth.headers.get('content-type') || '').toLowerCase();
if (!auth.ok) throw new Error('auth media fetch HTTP ' + auth.status);
if (!ct.includes('audio/wav') && !ct.includes('audio/x-wav') && !ct.includes('audio/wave')) {
  throw new Error('expected audio/wav Content-Type, got ' + ct);
}

// Legacy ?sig= must not open anonymously when signed mode is off
const fakeSig = await fetch('http://127.0.0.1:3001' + rel + '?exp=9999999999&sig=notavalidsig');
if (fakeSig.status !== 401) {
  throw new Error('expected fake signed URL to require auth (401), got ' + fakeSig.status);
}

process.stdout.write(
  JSON.stringify({
    ok: true,
    relative_url: media.relative_url,
    paste_exactly: media.paste_exactly,
    local_path: media.local_path,
    public_url: media.public_url,
    content_type: ct,
    unauth_status: unauth.status,
  })
);
NODE
)
echo "$OUT"
LOCAL=$(printf '%s\n' "$OUT" | sed -n 's/.*"local_path":"\([^"]*\)".*/\1/p' | head -1)
echo "shared_local=$LOCAL"
[[ -n "$LOCAL" ]] || { echo "ERROR: could not parse local_path"; exit 1; }
OC_OK=$(docker compose exec -T openclaw sh -c "test -f '$LOCAL' && echo yes || echo no" || echo no)
echo "openclaw_sees_file=$OC_OK"
[[ "$OC_OK" == "yes" ]] || { echo "ERROR: OpenClaw container cannot see MEDIA local_path (volume drift)"; exit 1; }
echo "MEDIA_DELIVERY_VERIFY_OK"
