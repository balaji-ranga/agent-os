/**
 * Seed default agents (BalServe, TechResearcher) if the agents table is empty.
 * Called automatically on backend startup.
 */
import { join } from 'path';
import { getDb } from './schema.js';

const homedir = process.env.USERPROFILE || process.env.HOME || '';

function defaultWorkspace(envKey, subdir) {
  const raw = process.env[envKey];
  if (raw) return String(raw).trim().replace(/^~([/\\]|$)/, (_, sep) => homedir + (sep || ''));
  return join(homedir, '.openclaw', subdir);
}

/** Known department labels for standard agents. */
export const DEFAULT_AGENT_DEPARTMENTS = Object.freeze({
  balserve: 'Executive',
  techresearcher: 'Research',
  expensemanager: 'Finance',
  socialasstant: 'Social',
  jobdiscovery: 'Job Pipeline',
  fitscorer: 'Job Pipeline',
  resumetailor: 'Job Pipeline',
  applicationagent: 'Job Pipeline',
  workflowbuilder: 'Engineering',
});

/** Backfill department for known agents when empty (safe on every startup). */
export function seedAgentDepartmentsIfMissing() {
  const db = getDb();
  const upd = db.prepare(
    `UPDATE agents SET department = ? WHERE id = ? AND (department IS NULL OR department = '')`
  );
  let n = 0;
  for (const [id, dept] of Object.entries(DEFAULT_AGENT_DEPARTMENTS)) {
    const r = upd.run(dept, id);
    if (r.changes) n += 1;
  }
  return n;
}

export function seedDefaultAgentsIfEmpty() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as n FROM agents').get();
  if (count.n > 0) return false;

  const balservePath = defaultWorkspace('OPENCLAW_WORKSPACE_BALSERVE', 'workspace-balserve');
  const techPath = defaultWorkspace('OPENCLAW_WORKSPACE_TECHRESEARCHER', 'workspace-techresearcher');

  db.prepare(
    `INSERT INTO agents (id, name, role, workspace_path, openclaw_agent_id, is_coo, agent_type, department) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('balserve', 'BalServe', 'COO', balservePath, 'balserve', 1, 'standard', 'Executive');

  db.prepare(
    `INSERT INTO agents (id, name, role, parent_id, workspace_path, openclaw_agent_id, is_coo, agent_type, department) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'techresearcher',
    'TechResearcher',
    'Research (AI & Tech)',
    'balserve',
    techPath,
    'techresearcher',
    0,
    'standard',
    'Research'
  );

  console.log('Agent OS: seeded default agents (BalServe, TechResearcher).');
  return true;
}
