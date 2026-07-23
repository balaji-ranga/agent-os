#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml

docker compose exec -T backend node <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
import { createSession } from './src/services/auth/session.js';

initDb();
const db = getDb();
const owner = 'ceo-bala';
const coo = db.prepare(`SELECT id, name FROM agents WHERE is_coo = 1 LIMIT 1`).get();
if (!coo) throw new Error('no COO');
console.log('COO', coo);

const beforeSession = db
  .prepare(
    `SELECT id, status, started_at, title FROM chat_sessions
     WHERE agent_id = ? AND owner_user_id = ? AND status = 'active' LIMIT 1`
  )
  .get(coo.id, owner);
const turnBounds = db
  .prepare(
    `SELECT MIN(created_at) AS min_c, MAX(created_at) AS max_c, COUNT(*) AS n
     FROM chat_turns WHERE agent_id = ? AND owner_user_id = ?
       AND (session_id = ? OR (? IS NULL AND (session_id IS NULL OR session_id = '')))`
  )
  .get(coo.id, owner, beforeSession?.id || null, beforeSession?.id || null);
const allBounds = db
  .prepare(
    `SELECT MIN(created_at) AS min_c, MAX(created_at) AS max_c, COUNT(*) AS n
     FROM chat_turns WHERE agent_id = ? AND owner_user_id = ?`
  )
  .get(coo.id, owner);
console.log('BEFORE_ACTIVE', beforeSession);
console.log('ACTIVE_TURN_BOUNDS', turnBounds);
console.log('ALL_TURN_BOUNDS', allBounds);

const token = createSession(owner).token;
const res = await fetch(`http://127.0.0.1:3001/api/agents/${coo.id}/chat?tz=Asia/Singapore`, {
  headers: { Authorization: `Bearer ${token}` },
});
const json = await res.json();
if (!res.ok) throw new Error(`GET ${res.status} ${JSON.stringify(json)}`);
console.log('GET', {
  status: res.status,
  rolled_over: json.rolled_over,
  turnCount: (json.turns || []).length,
  sessionStarted: json.session?.started_at,
});

const hist = await fetch(`http://127.0.0.1:3001/api/agents/${coo.id}/chat/history`, {
  headers: { Authorization: `Bearer ${token}` },
});
const histJson = await hist.json();
console.log('HISTORY', {
  count: (histJson.sessions || []).length,
  latest: histJson.sessions?.[0]?.title,
  archived_at: histJson.sessions?.[0]?.archived_at,
});

if (allBounds?.min_c) {
  const minDay = String(allBounds.min_c).slice(0, 10);
  const todaySg = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const hadOldTurns = minDay < todaySg && (allBounds.n || 0) > 0;
  if (hadOldTurns && beforeSession && !json.rolled_over && (json.turns || []).length > 0) {
    // If active still has old turns after GET, fail
    const stillOld = (json.turns || []).some((t) => String(t.created_at || '').slice(0, 10) < todaySg);
    if (stillOld) throw new Error('COO_OLD_TURNS_STILL_IN_ACTIVE');
  }
  if (hadOldTurns && !json.rolled_over && (json.turns || []).length === 0 && (histJson.sessions || []).length === 0) {
    throw new Error('expected archive after rollover');
  }
}

if (json.rolled_over) {
  if ((json.turns || []).length !== 0) throw new Error('rollover should empty active');
  if (!(histJson.sessions || []).length) throw new Error('rollover should add history');
  console.log('COO_ROLLOVER_FIXED_OK');
} else {
  console.log('COO_NO_ROLLOVER_NEEDED_OR_ALREADY_FRESH', {
    turns: (json.turns || []).length,
    history: (histJson.sessions || []).length,
  });
}
NODE
