import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-execution-schema-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
try {
  const { initDb } = await import('../src/db/schema.js');
  const db = initDb();
  const browserColumns = new Set(db.prepare('PRAGMA table_info(browser_tasks)').all().map((c) => c.name));
  const kanbanColumns = new Set(db.prepare('PRAGMA table_info(kanban_tasks)').all().map((c) => c.name));
  for (const name of ['trace_id', 'parent_goal_run_id', 'parent_goal_step_id']) assert(browserColumns.has(name), `browser_tasks.${name}`);
  for (const name of ['trace_id', 'goal_run_id', 'goal_step_id']) assert(kanbanColumns.has(name), `kanban_tasks.${name}`);
  db.close();
  console.log('company execution schema tests passed');
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
