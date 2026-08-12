/**
 * Re-merge ESSENTIAL_OPENCLAW_RUNTIME_TOOLS into tenant OpenClaw allowlists
 * (fixes "No response from OpenClaw." when sessions_history/read were stripped).
 *
 * Usage:
 *   OWNER_USER_ID=ceo-bala node scripts/heal-openclaw-runtime-tools.mjs
 *   node scripts/heal-openclaw-runtime-tools.mjs   # all CEOs with user_agents
 */
import { existsSync, readFileSync } from 'fs';
import { initDb, getDb } from '../src/db/schema.js';
import { ensureTenantOpenClawAgent } from '../src/services/openclaw-tenant.js';
import { syncAllowlistsFile } from '../src/services/openclaw-agent-tools.js';
import { ESSENTIAL_OPENCLAW_RUNTIME_TOOLS } from '../src/services/openclaw-runtime-tools.js';
import { getOpenClawConfigPath } from '../src/config/openclaw-paths.js';

initDb();
const db = getDb();
const ownerFilter = String(process.env.OWNER_USER_ID || process.argv[2] || '').trim();

const rows = ownerFilter
  ? db
      .prepare(
        `SELECT ua.user_id, a.* FROM user_agents ua
         JOIN agents a ON a.id = ua.agent_id
         WHERE ua.user_id = ? AND COALESCE(ua.enabled,1)=1`
      )
      .all(ownerFilter)
  : db
      .prepare(
        `SELECT ua.user_id, a.* FROM user_agents ua
         JOIN agents a ON a.id = ua.agent_id
         WHERE COALESCE(ua.enabled,1)=1`
      )
      .all();

let ok = 0;
let fail = 0;
const samples = [];
for (const row of rows) {
  const { user_id: owner, ...agent } = row;
  try {
    const ensured = ensureTenantOpenClawAgent(agent, owner);
    ok += 1;
    if (String(agent.id).includes('balserve') || agent.is_coo) {
      samples.push({
        owner,
        agent: agent.id,
        runtime: ensured.openclawAgentId,
      });
    }
  } catch (e) {
    fail += 1;
    console.warn('[heal] failed', owner, agent.id, e?.message || e);
  }
}
syncAllowlistsFile();

let balserveCheck = null;
const cfgPath = getOpenClawConfigPath();
if (existsSync(cfgPath)) {
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const entry = (cfg.agents?.list || []).find(
    (a) => String(a.id || '').includes('ceo-bala') && String(a.id || '').includes('balserve')
  );
  if (entry) {
    const allow = entry.tools?.allow || [];
    balserveCheck = {
      id: entry.id,
      has_sessions_send: allow.includes('sessions_send'),
      has_sessions_history: allow.includes('sessions_history'),
      has_read: allow.includes('read'),
      missing: ESSENTIAL_OPENCLAW_RUNTIME_TOOLS.filter((t) => !allow.includes(t)),
    };
  }
}

console.log(
  JSON.stringify(
    {
      ok: fail === 0 && (!balserveCheck || balserveCheck.missing.length === 0),
      ensured: ok,
      failed: fail,
      owner_filter: ownerFilter || null,
      balserve_ceo_bala: balserveCheck,
      coo_samples: samples.slice(0, 5),
    },
    null,
    2
  )
);
if (fail || (balserveCheck && balserveCheck.missing.length)) process.exit(1);
