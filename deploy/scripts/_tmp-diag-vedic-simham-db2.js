#!/usr/bin/env node
const Module = require('module');
const orig = Module._nodeModulePaths;
Module._nodeModulePaths = function (from) {
  return [
    '/opt/agent-os/backend/node_modules',
    '/app/node_modules',
    ...orig.call(this, from),
  ];
};
const Database = require('better-sqlite3');
const db = new Database('/data/agent-os/agent-os.db', { readonly: true });

console.log('=== content_tool_logs last 40 ceo-bala or key tools ===');
const rows = db
  .prepare(
    `SELECT id, tool_name, source, status, created_at, owner_user_id,
            substr(coalesce(request_payload,''),1,400) as req,
            substr(coalesce(response_payload,''),1,200) as resp
     FROM content_tool_logs
     WHERE owner_user_id = 'ceo-bala'
        OR tool_name IN ('master_data_rag','notify_ceo','vedic_compute_chart','generate_chart')
     ORDER BY id DESC LIMIT 40`
  )
  .all();
console.log(JSON.stringify(rows, null, 2));

console.log('=== content_tool_logs window 01:40-02:00 ===');
const w = db
  .prepare(
    `SELECT id, tool_name, source, status, created_at, owner_user_id,
            substr(coalesce(request_payload,''),1,500) as req
     FROM content_tool_logs
     WHERE created_at >= '2026-07-23 01:40:00' AND created_at <= '2026-07-23 02:00:00'
     ORDER BY id`
  )
  .all();
console.log(JSON.stringify(w, null, 2));

console.log('=== chat_turns vedic ceo-bala today ===');
const turns = db
  .prepare(
    `SELECT id, role, created_at, substr(content,1,120) as preview
     FROM chat_turns
     WHERE agent_id = 'vedic-astrology' AND owner_user_id = 'ceo-bala'
       AND created_at >= '2026-07-23'
     ORDER BY id`
  )
  .all();
console.log(JSON.stringify(turns, null, 2));

console.log('=== any teamwork in ceo-bala chat_turns (all agents) ===');
const tw = db
  .prepare(
    `SELECT id, agent_id, role, created_at, substr(content,1,160) as preview
     FROM chat_turns
     WHERE owner_user_id = 'ceo-bala'
       AND lower(content) LIKE '%teamwork%'
     ORDER BY id DESC LIMIT 20`
  )
  .all();
console.log(JSON.stringify(tw, null, 2));

console.log('=== chat_session_meta for vedic/bala ===');
try {
  const meta = db
    .prepare(
      `SELECT * FROM chat_session_meta
       WHERE lower(coalesce(agent_id,'')) LIKE '%vedic%'
          OR lower(coalesce(owner_user_id,'')) LIKE '%bala%'
       ORDER BY rowid DESC LIMIT 20`
    )
    .all();
  console.log(JSON.stringify(meta, null, 2));
} catch (e) {
  console.log('meta err', e.message);
  console.log(JSON.stringify(db.prepare('PRAGMA table_info(chat_session_meta)').all(), null, 2));
}
