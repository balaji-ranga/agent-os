import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'flolah-openclaw-cleanup-'));
process.env.AGENT_OS_DATA_DIR = join(root, 'data');
process.env.OPENCLAW_DIR = join(root, '.openclaw');

const { initDb, getDb } = await import('../src/db/schema.js');
const { runOpenClawSessionCleanup, setOpenClawSessionCleanupPolicy } = await import(
  '../src/services/openclaw-session-cleanup.js'
);
initDb();
const db = getDb();
const oldIso = '2026-07-01T00:00:00.000Z';
const nowMs = Date.parse('2026-08-25T00:00:00.000Z');

db.prepare(`INSERT INTO agent_goal_runs
  (id, owner_user_id, agent_id, title, prompt, source, status, created_at, updated_at, completed_at)
  VALUES (?, ?, ?, '', '', 'test', ?, ?, ?, ?)`)
  .run('agr-terminal', 'ceo-test', 'researcher', 'completed', oldIso, oldIso, oldIso);
db.prepare(`INSERT INTO agent_goal_steps
  (id, goal_run_id, step_index, step_type, label, spec_json, status, started_at, completed_at)
  VALUES (?, ?, 0, 'specialty_task', '', '{}', 'completed', ?, ?)`)
  .run('ags-step', 'agr-terminal', oldIso, oldIso);
db.prepare(`INSERT INTO agent_goal_runs
  (id, owner_user_id, agent_id, title, prompt, source, status, created_at, updated_at)
  VALUES (?, ?, ?, '', '', 'test', 'running', ?, ?)`)
  .run('agr-active', 'ceo-test', 'researcher', oldIso, oldIso);
db.prepare(`INSERT INTO agent_goal_steps
  (id, goal_run_id, step_index, step_type, label, spec_json, status, started_at)
  VALUES (?, ?, 0, 'specialty_task', '', '{}', 'running', ?)`)
  .run('ags-active', 'agr-active', oldIso);
for (const [goalId, ownerId, agentId, stepId] of [
  ['agr-wrong-owner', 'ceo-someone-else', 'researcher', 'ags-wrong-owner'],
  ['agr-wrong-agent', 'ceo-test', 'different-agent', 'ags-wrong-agent'],
]) {
  db.prepare(`INSERT INTO agent_goal_runs
    (id, owner_user_id, agent_id, title, prompt, source, status, created_at, updated_at, completed_at)
    VALUES (?, ?, ?, '', '', 'test', 'completed', ?, ?, ?)`)
    .run(goalId, ownerId, agentId, oldIso, oldIso, oldIso);
  db.prepare(`INSERT INTO agent_goal_steps
    (id, goal_run_id, step_index, step_type, label, spec_json, status, started_at, completed_at)
    VALUES (?, ?, 0, 'agent_continue', '', '{}', 'completed', ?, ?)`)
    .run(stepId, goalId, oldIso, oldIso);
}

const runtime = 't-ceo-test--researcher';
const sessionsDir = join(process.env.OPENCLAW_DIR, 'agents', runtime, 'sessions');
mkdirSync(sessionsDir, { recursive: true });
const oldDate = new Date(oldIso);
const makeFile = (name, text = '{}\n', date = oldDate) => {
  const path = join(sessionsDir, name);
  writeFileSync(path, text);
  utimesSync(path, date, date);
  return path;
};

makeFile('terminal.jsonl');
makeFile('active.jsonl');
makeFile('missing.jsonl');
makeFile('chat.jsonl');
makeFile('recent.jsonl', '{}\n', new Date(nowMs - 60_000));
makeFile('orphan.jsonl');
makeFile('wrong-owner.jsonl');
makeFile('wrong-agent.jsonl');

const prefix = `agent:${runtime}:`;
const sessions = {
  [`${prefix}goal-agr-terminal-ags-step`]: {
    sessionId: 'terminal', status: 'done', updatedAt: oldIso, sessionFile: 'terminal.jsonl',
  },
  [`${prefix}goal-agr-active-ags-active`]: {
    sessionId: 'active', status: 'done', updatedAt: oldIso, sessionFile: 'active.jsonl',
  },
  [`${prefix}delegation-999999`]: {
    sessionId: 'missing', status: 'failed', updatedAt: oldIso, sessionFile: 'missing.jsonl',
  },
  [`${prefix}ordinary-conversation`]: {
    sessionId: 'chat', status: 'done', updatedAt: oldIso, sessionFile: 'chat.jsonl',
  },
  [`${prefix}delegation-999998`]: {
    sessionId: 'recent', status: 'failed', updatedAt: nowMs - 60_000, sessionFile: 'recent.jsonl',
  },
  [`${prefix}goal-agr-wrong-owner-ags-wrong-owner`]: {
    sessionId: 'wrong-owner', status: 'done', updatedAt: oldIso, sessionFile: 'wrong-owner.jsonl',
  },
  [`${prefix}goal-agr-wrong-agent-ags-wrong-agent`]: {
    sessionId: 'wrong-agent', status: 'done', updatedAt: oldIso, sessionFile: 'wrong-agent.jsonl',
  },
};
const indexPath = join(sessionsDir, 'sessions.json');
writeFileSync(indexPath, JSON.stringify(sessions, null, 2));
utimesSync(indexPath, oldDate, oldDate);

const basePolicy = {
  terminal_retention_days: 7,
  missing_reference_grace_hours: 48,
  recent_activity_minutes: 15,
  batch_size: 500,
};
setOpenClawSessionCleanupPolicy({ ...basePolicy, dry_run: true });
const dry = await runOpenClawSessionCleanup({ nowMs });
assert.equal(dry.dry_run, true);
assert.equal(dry.candidate_sessions, 2, 'terminal and old missing-reference execution sessions qualify');
assert.equal(dry.unindexed_files_observed, 1, 'unindexed files are observed but never auto-selected');
assert.equal(dry.deleted_sessions, 0);
assert.equal(Object.keys(JSON.parse(readFileSync(indexPath, 'utf8'))).length, 7);

setOpenClawSessionCleanupPolicy({ ...basePolicy, dry_run: false });
const live = await runOpenClawSessionCleanup({ nowMs });
assert.equal(live.deleted_sessions, 2, 'only eligible indexed execution sessions removed');
assert.equal(live.deleted_files, 2, 'only the two proven indexed execution transcripts are removed');
const after = JSON.parse(readFileSync(indexPath, 'utf8'));
assert.equal(after[`${prefix}goal-agr-terminal-ags-step`], undefined);
assert.equal(after[`${prefix}delegation-999999`], undefined);
assert.ok(after[`${prefix}goal-agr-active-ags-active`], 'active database reference preserved');
assert.ok(after[`${prefix}ordinary-conversation`], 'unknown/conversational session preserved');
assert.ok(after[`${prefix}delegation-999998`], 'recent session preserved');
assert.ok(after[`${prefix}goal-agr-wrong-owner-ags-wrong-owner`], 'cross-owner session preserved');
assert.ok(after[`${prefix}goal-agr-wrong-agent-ags-wrong-agent`], 'mismatched-agent session preserved');
assert.equal(readFileSync(join(sessionsDir, 'orphan.jsonl'), 'utf8'), '{}\n', 'unindexed transcript preserved');
const audit = db.prepare('SELECT dry_run, deleted_sessions, deleted_files FROM openclaw_session_cleanup_runs ORDER BY id DESC LIMIT 1').get();
assert.deepEqual(audit, { dry_run: 0, deleted_sessions: 2, deleted_files: 2 });

console.log('PASS openclaw session cleanup: dry-run, terminal/missing rules, active/recent/chat/unindexed preservation, audit');
