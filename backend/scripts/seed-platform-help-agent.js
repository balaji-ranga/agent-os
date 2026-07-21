/**
 * Seed Platform Help agent (platformhelp) + tool grants + workspace templates.
 * Usage: node scripts/seed-platform-help-agent.js
 */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { initDb, getDb } from '../src/db/schema.js';
import { setAgentToolGrants } from '../src/services/openclaw-agent-tools.js';

initDb();
const db = getDb();

const WORKSPACE_PATH =
  process.env.OPENCLAW_WORKSPACE_PLATFORMHELP ||
  join(process.env.USERPROFILE || process.env.HOME || '', '.openclaw', 'workspace-platformhelp');

const TEMPLATES_DIR = join(__dirname, '..', '..', 'openclaw-workspace-templates', 'platformhelp');

const PLATFORM_HELP_TOOLS = [
  'learnings_summary',
  'content_tools_enquire',
  'master_data_list_tables',
  'master_data_list_rows',
  'master_data_list_documents',
  'master_data_rag',
  'notify_ceo',
];

function ensureWorkspace() {
  if (!existsSync(WORKSPACE_PATH)) mkdirSync(WORKSPACE_PATH, { recursive: true });
  for (const name of ['SOUL.md', 'AGENTS.md', 'TOOLS.md', 'MEMORY.md']) {
    const tpl = join(TEMPLATES_DIR, name);
    const dest = join(WORKSPACE_PATH, name);
    if (!existsSync(tpl)) continue;
    if (!existsSync(dest)) copyFileSync(tpl, dest);
    else writeFileSync(dest, readFileSync(tpl, 'utf8'), 'utf8');
  }
}

export function seedPlatformHelpAgent() {
  ensureWorkspace();
  const coo = db.prepare('SELECT id FROM agents WHERE is_coo = 1 LIMIT 1').get();
  const parentId = coo?.id || 'balserve';
  const existing = db.prepare('SELECT id FROM agents WHERE id = ?').get('platformhelp');
  if (existing) {
    db.prepare(
      `UPDATE agents SET name = ?, role = ?, parent_id = ?, workspace_path = ?, openclaw_agent_id = ?, is_coo = 0, agent_type = 'standard', department = COALESCE(NULLIF(department, ''), ?) WHERE id = ?`
    ).run(
      'Platform Help',
      'Flowlah product help & troubleshooting',
      parentId,
      WORKSPACE_PATH,
      'platformhelp',
      'Operations',
      'platformhelp'
    );
  } else {
    db.prepare(
      `INSERT INTO agents (id, name, role, parent_id, workspace_path, openclaw_agent_id, is_coo, agent_type, department)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'standard', ?)`
    ).run(
      'platformhelp',
      'Platform Help',
      'Flowlah product help & troubleshooting',
      parentId,
      WORKSPACE_PATH,
      'platformhelp',
      'Operations'
    );
  }
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get('platformhelp');
  try {
    setAgentToolGrants(agent, PLATFORM_HELP_TOOLS);
  } catch (e) {
    console.warn('[seed-platform-help] tool grants:', e.message);
  }
  return agent;
}

if (process.argv[1]?.includes('seed-platform-help-agent')) {
  const agent = seedPlatformHelpAgent();
  console.log('Seeded', agent.id, agent.name, '→', agent.workspace_path);
  const grants = db
    .prepare('SELECT tool_name FROM agent_tool_grants WHERE agent_id = ? ORDER BY tool_name')
    .all('platformhelp')
    .map((r) => r.tool_name);
  console.log('Grants:', grants.join(', ') || '(none)');
}
