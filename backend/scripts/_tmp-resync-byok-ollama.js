#!/usr/bin/env node
/**
 * Re-sync all ollama_free / deepseek BYOK CEOs into OpenClaw (context caps + auth).
 */
import { initDb, getDb } from '../src/db/schema.js';
import { syncUserLlmToOpenClaw } from '../src/services/user-llm-settings.js';

initDb();
const rows = getDb()
  .prepare(
    `SELECT id, name, llm_provider FROM platform_users
     WHERE llm_provider IN ('ollama_free', 'deepseek', 'ollama')`
  )
  .all();
console.log('byok_ollama_ceos', rows.length);
for (const r of rows) {
  const out = syncUserLlmToOpenClaw(r.id);
  console.log(r.id, r.llm_provider, out?.ok, out?.model || out?.cleared || out?.reason);
}
console.log('BYOK_OLLAMA_RESYNC_DONE');
