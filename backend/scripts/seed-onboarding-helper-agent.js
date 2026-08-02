/**
 * Seed Onboarding Helper agent (onboardinghelper) + tool grants + workspace templates.
 * Usage: node scripts/seed-onboarding-helper-agent.js
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
  process.env.OPENCLAW_WORKSPACE_ONBOARDINGHELP ||
  join(process.env.USERPROFILE || process.env.HOME || '', '.openclaw', 'workspace-onboardinghelper');

const TEMPLATES_DIR = join(__dirname, '..', '..', 'openclaw-workspace-templates', 'onboardinghelper');

const ONBOARDING_HELPER_TOOLS = [
  'master_data_rag',
  'learnings_summary',
  'notify_ceo',
  'onboarding_save_proposal',
  'onboarding_apply_proposal',
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

export function seedOnboardingHelperAgent() {
  ensureWorkspace();
  const coo = db.prepare('SELECT id FROM agents WHERE is_coo = 1 LIMIT 1').get();
  const parentId = coo?.id || 'balserve';
  const existing = db.prepare('SELECT id FROM agents WHERE id = ?').get('onboardinghelper');
  if (existing) {
    db.prepare(
      `UPDATE agents SET name = ?, role = ?, parent_id = ?, workspace_path = ?, openclaw_agent_id = ?, is_coo = 0, agent_type = 'standard', department = COALESCE(NULLIF(department, ''), ?) WHERE id = ?`
    ).run(
      'Onboarding Helper',
      'Strategic org onboarding coach',
      parentId,
      WORKSPACE_PATH,
      'onboardinghelper',
      'Executive',
      'onboardinghelper'
    );
  } else {
    db.prepare(
      `INSERT INTO agents (id, name, role, parent_id, workspace_path, openclaw_agent_id, is_coo, agent_type, department)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'standard', ?)`
    ).run(
      'onboardinghelper',
      'Onboarding Helper',
      'Strategic org onboarding coach',
      parentId,
      WORKSPACE_PATH,
      'onboardinghelper',
      'Executive'
    );
  }
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get('onboardinghelper');
  try {
    setAgentToolGrants(agent, ONBOARDING_HELPER_TOOLS);
  } catch (e) {
    console.warn('[seed-onboarding-helper] tool grants:', e.message);
  }
  return agent;
}

if (process.argv[1]?.includes('seed-onboarding-helper-agent')) {
  const agent = seedOnboardingHelperAgent();
  console.log('Seeded', agent.id, agent.name, '→', agent.workspace_path);
  const grants = db
    .prepare('SELECT tool_name FROM agent_tool_grants WHERE agent_id = ? ORDER BY tool_name')
    .all('onboardinghelper')
    .map((r) => r.tool_name);
  console.log('Grants:', grants.join(', ') || '(none)');
}
