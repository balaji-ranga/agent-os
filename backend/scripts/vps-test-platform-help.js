/**
 * VPS: ensure Platform Help tenant agents + sample chat (optional).
 * Usage: node scripts/vps-test-platform-help.js
 * SKIP_CHAT=1 to skip gateway chat.
 */
import { initDb, getDb } from '../src/db/schema.js';
import { seedPlatformHelpAgent } from './seed-platform-help-agent.js';
import { grantStandardAgents } from '../src/services/users.js';
import { ensureAllTenantOpenClawAgentsForAllCeos } from '../src/services/openclaw-tenant.js';
import { ensureCeoDefaultMasterDataForAllCeos, PLATFORM_HELP_TITLE_PREFIX } from '../src/services/ceo-default-master-data.js';
import { listDocuments, ragDocuments } from '../src/services/master-data.js';
import { createSession } from '../src/services/auth/session.js';
import { readFileSync, existsSync } from 'fs';

const skipChat = process.env.SKIP_CHAT === '1' || process.env.SKIP_CHAT === 'true';
const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');

initDb();
seedPlatformHelpAgent();
const db = getDb();

const ceos = db.prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1`).all();
for (const c of ceos) grantStandardAgents(c.id);
const md = ensureCeoDefaultMasterDataForAllCeos(
  ceos.map((c) => c.id),
  { refresh: false }
);
const ensured = ensureAllTenantOpenClawAgentsForAllCeos();
console.log('OK grants + master data', { ceos: ceos.length, ensured, md });

const ceo = db.prepare(`SELECT id, email FROM platform_users WHERE id = 'ceo-bala' OR role = 'ceo' LIMIT 1`).get();
const docs = listDocuments(ceo.id).filter((d) => String(d.title || '').startsWith(PLATFORM_HELP_TITLE_PREFIX));
console.log('OK help docs for', ceo.id, docs.length);
if (docs.length < 5) throw new Error('too few Platform Help docs');

const rag = await ragDocuments(ceo.id, {
  query: 'MCP register server workflow mcp_tool Brain',
  topK: 4,
  summarize: false,
});
if (!rag?.hit_count) throw new Error('RAG returned no hits');
console.log('OK RAG hits', rag.hit_count);

let ocPath = process.env.OPENCLAW_CONFIG_PATH || '/root/.openclaw/openclaw.json';
if (!existsSync(ocPath)) ocPath = `${process.env.HOME || '/root'}/.openclaw/openclaw.json`;
if (existsSync(ocPath)) {
  const config = JSON.parse(readFileSync(ocPath, 'utf8'));
  const ids = (config.agents?.list || []).map((a) => String(a.id || '').toLowerCase());
  const base = ids.includes('platformhelp');
  const tenants = ids.filter((id) => id.includes('--platformhelp'));
  console.log('OK openclaw platformhelp base=', base, 'tenant entries=', tenants.length);
  if (!base) throw new Error('platformhelp missing from openclaw.json agents.list');
}

if (skipChat) {
  console.log('VPS_PLATFORM_HELP_OK (skip chat)');
  process.exit(0);
}

const session = createSession(ceo.id);
console.log('Chatting as', ceo.id, '...');
const res = await fetch(`${BASE}/api/agents/platformhelp/chat`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    message:
      'In one short paragraph: where do I register an MCP server in Flowlah, and which workflow nodes use it? Use master_data_rag.',
  }),
  signal: AbortSignal.timeout(180000),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error('CHAT_FAIL', res.status, body);
  process.exit(1);
}
const reply = body.reply || body.message || body.content || body.text || JSON.stringify(body);
console.log('Reply:\n', String(reply).slice(0, 1200));
if (!/MCP|integrations\/mcp|mcp_tool|Brain|SSE/i.test(String(reply))) {
  console.warn('WARN: reply weak on MCP keywords');
} else {
  console.log('OK chat mentions MCP');
}
console.log('VPS_PLATFORM_HELP_OK');
