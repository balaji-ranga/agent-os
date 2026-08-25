import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { basename, join, resolve, sep } from 'path';
import { getDb } from '../db/schema.js';
import { getOpenClawDir } from '../config/openclaw-paths.js';
import { parseTenantOpenClawAgentId } from './openclaw-tenant.js';
import { getPlatformSetting, setPlatformSetting } from './platform-llm-settings.js';

export const OPENCLAW_SESSION_CLEANUP_CRON_ID = 'openclaw_session_cleanup';
const POLICY_KEY = 'openclaw_session_cleanup_policy';
const TERMINAL = {
  goal: new Set(['completed', 'failed', 'cancelled']),
  delegation: new Set(['completed', 'failed', 'cancelled']),
  kanban: new Set(['completed', 'failed', 'cancelled']),
  workflow: new Set(['completed', 'failed', 'cancelled']),
  scheduled: new Set(['ok', 'error', 'cancelled']),
};
const ACTIVE_SESSION = new Set(['active', 'running', 'processing', 'pending', 'queued']);

function boolEnv(name, fallback) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function intEnv(name, fallback, min, max) {
  const n = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function defaultOpenClawSessionCleanupPolicy() {
  return {
    dry_run: boolEnv('OPENCLAW_SESSION_CLEANUP_DRY_RUN', true),
    terminal_retention_days: intEnv('OPENCLAW_SESSION_CLEANUP_RETENTION_DAYS', 7, 1, 365),
    missing_reference_grace_hours: intEnv(
      'OPENCLAW_SESSION_CLEANUP_MISSING_GRACE_HOURS',
      48,
      24,
      720
    ),
    recent_activity_minutes: intEnv('OPENCLAW_SESSION_CLEANUP_RECENT_MINUTES', 15, 5, 1440),
    batch_size: intEnv('OPENCLAW_SESSION_CLEANUP_BATCH_SIZE', 500, 1, 5000),
  };
}

function normalizePolicy(input = {}, base = defaultOpenClawSessionCleanupPolicy()) {
  return {
    dry_run: input.dry_run == null ? !!base.dry_run : input.dry_run === true,
    terminal_retention_days: clampInt(input.terminal_retention_days, base.terminal_retention_days, 1, 365),
    missing_reference_grace_hours: clampInt(
      input.missing_reference_grace_hours,
      base.missing_reference_grace_hours,
      24,
      720
    ),
    recent_activity_minutes: clampInt(input.recent_activity_minutes, base.recent_activity_minutes, 5, 1440),
    batch_size: clampInt(input.batch_size, base.batch_size, 1, 5000),
  };
}

export function getOpenClawSessionCleanupPolicy() {
  const defaults = defaultOpenClawSessionCleanupPolicy();
  try {
    const stored = JSON.parse(getPlatformSetting(POLICY_KEY, '{}') || '{}');
    return normalizePolicy(stored, defaults);
  } catch (_) {
    return defaults;
  }
}

export function setOpenClawSessionCleanupPolicy(input) {
  const policy = normalizePolicy(input, getOpenClawSessionCleanupPolicy());
  setPlatformSetting(POLICY_KEY, JSON.stringify(policy));
  return policy;
}

function ensureAuditTable(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS openclaw_session_cleanup_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      dry_run INTEGER NOT NULL DEFAULT 1,
      policy_json TEXT NOT NULL DEFAULT '{}',
      scanned_sessions INTEGER NOT NULL DEFAULT 0,
      candidate_sessions INTEGER NOT NULL DEFAULT 0,
      deleted_sessions INTEGER NOT NULL DEFAULT 0,
      deleted_files INTEGER NOT NULL DEFAULT 0,
      reclaimed_bytes INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      result_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_openclaw_cleanup_runs_started
      ON openclaw_session_cleanup_runs(started_at DESC);
  `);
}

export function getOpenClawSessionCleanupLatestRun() {
  try {
    const db = getDb();
    ensureAuditTable(db);
    const row = db.prepare('SELECT * FROM openclaw_session_cleanup_runs ORDER BY id DESC LIMIT 1').get();
    if (!row) return null;
    let result = {};
    try { result = JSON.parse(row.result_json || '{}'); } catch (_) {}
    return { ...row, dry_run: !!row.dry_run, result };
  } catch (_) {
    return null;
  }
}

function toMs(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim() !== '') {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function entryActivityMs(entry, filePath) {
  let ms = Math.max(
    toMs(entry?.updatedAt),
    toMs(entry?.lastInteractionAt),
    toMs(entry?.lastActivityAt),
    toMs(entry?.endedAt),
    toMs(entry?.startedAt),
    toMs(entry?.sessionStartedAt)
  );
  try { if (filePath && existsSync(filePath)) ms = Math.max(ms, statSync(filePath).mtimeMs); } catch (_) {}
  return ms;
}

function sanitize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseExecutionSession(sessionUser) {
  const s = String(sessionUser || '').toLowerCase();
  let m = s.match(/(?:^|-)delegation-(\d+)$/);
  if (m) return { type: 'delegation', id: Number(m[1]) };
  m = s.match(/(?:^|-)kanban-(\d+)$/);
  if (m) return { type: 'kanban', id: Number(m[1]) };
  m = s.match(/(?:^|-)wf-wake-(\d+)$/);
  if (m) return { type: 'workflow', id: Number(m[1]) };
  m = s.match(/(?:^|-)goal-done-([a-z0-9]+)$/);
  if (m) return { type: 'goal_prefix', id: m[1] };
  const stepAt = s.lastIndexOf('-ags-');
  const goalAt = s.lastIndexOf('goal-agr-');
  if (goalAt >= 0 && stepAt > goalAt) {
    return {
      type: 'goal_step',
      goalId: s.slice(goalAt + 5, stepAt),
      stepId: s.slice(stepAt + 1),
    };
  }
  m = s.match(/(?:^|-)tgoalrun-([a-z0-9-]+?)(?:-tool-[a-z0-9_-]+)?$/);
  if (m) return { type: 'goal', id: m[1].startsWith('agr-') ? m[1] : `agr-${m[1]}` };
  m = s.match(/(?:^|-)tsched-([a-z0-9-]+)-([a-z0-9]{6,})$/);
  if (m) return { type: 'scheduled', goalId: m[1], runPrefix: m[2] };
  return null;
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function getReference(db, parsed) {
  try {
    const required = {
      goal: ['agent_goal_runs'],
      goal_prefix: ['agent_goal_runs'],
      goal_step: ['agent_goal_runs', 'agent_goal_steps', 'agent_delegation_tasks'],
      delegation: ['agent_delegation_tasks'],
      kanban: ['kanban_tasks'],
      workflow: ['agent_workflow_runs'],
      scheduled: ['scheduled_goal_runs'],
    }[parsed.type] || [];
    if (required.some((name) => !tableExists(db, name))) return { lookupUnavailable: true };
    if ((parsed.type === 'goal' || parsed.type === 'goal_prefix') && tableExists(db, 'agent_goal_runs')) {
      const row = parsed.type === 'goal'
        ? db.prepare('SELECT id, owner_user_id, agent_id, status, completed_at, updated_at FROM agent_goal_runs WHERE id=?').get(parsed.id)
        : db.prepare('SELECT id, owner_user_id, agent_id, status, completed_at, updated_at FROM agent_goal_runs WHERE replace(id, \'agr-\', \'\') LIKE ? ORDER BY updated_at DESC LIMIT 1').get(`${parsed.id}%`);
      return row ? { ...row, kind: 'goal', terminalAt: row.completed_at || row.updated_at } : null;
    }
    if (parsed.type === 'goal_step' && tableExists(db, 'agent_goal_runs')) {
      const row = db.prepare(`SELECT r.id, r.owner_user_id,
          COALESCE(d.to_agent_id, r.agent_id) AS agent_id, r.status, r.completed_at, r.updated_at,
          s.status AS step_status FROM agent_goal_runs r LEFT JOIN agent_goal_steps s ON s.id=? AND s.goal_run_id=r.id
          LEFT JOIN agent_delegation_tasks d ON d.id=s.child_delegation_task_id
          WHERE r.id=?`).get(parsed.stepId, parsed.goalId);
      return row ? { ...row, kind: 'goal', terminalAt: row.completed_at || row.updated_at } : null;
    }
    if (parsed.type === 'delegation' && tableExists(db, 'agent_delegation_tasks')) {
      const row = db.prepare('SELECT id, owner_user_id, to_agent_id AS agent_id, status, completed_at, created_at FROM agent_delegation_tasks WHERE id=?').get(parsed.id);
      return row ? { ...row, kind: 'delegation', terminalAt: row.completed_at || row.created_at } : null;
    }
    if (parsed.type === 'kanban' && tableExists(db, 'kanban_tasks')) {
      const row = db.prepare('SELECT id, owner_user_id, assigned_agent_id AS agent_id, status, updated_at, created_at FROM kanban_tasks WHERE id=?').get(parsed.id);
      return row ? { ...row, kind: 'kanban', terminalAt: row.updated_at || row.created_at } : null;
    }
    if (parsed.type === 'workflow' && tableExists(db, 'agent_workflow_runs')) {
      const row = db.prepare('SELECT id, owner_user_id, status, completed_at, updated_at, started_at FROM agent_workflow_runs WHERE id=?').get(parsed.id);
      return row ? { ...row, kind: 'workflow', terminalAt: row.completed_at || row.updated_at || row.started_at } : null;
    }
    if (parsed.type === 'scheduled' && tableExists(db, 'scheduled_goal_runs')) {
      const row = db.prepare('SELECT id, owner_user_id, agent_id, status, created_at FROM scheduled_goal_runs WHERE goal_id=? AND replace(id, \'-\', \'\') LIKE ? ORDER BY created_at DESC LIMIT 1').get(parsed.goalId, `%${parsed.runPrefix}%`);
      return row ? { ...row, kind: 'scheduled', terminalAt: row.created_at } : null;
    }
  } catch (_) {
    return { lookupUnavailable: true };
  }
  return null;
}

function sameAgent(db, referenceAgentId, runtimeBase) {
  if (!referenceAgentId) return true;
  const direct = sanitize(referenceAgentId);
  if (direct === sanitize(runtimeBase)) return true;
  try {
    if (!tableExists(db, 'agents')) return false;
    const row = db.prepare('SELECT id, openclaw_agent_id FROM agents WHERE id=?').get(referenceAgentId);
    return !!row && [row.id, row.openclaw_agent_id].some((v) => sanitize(v) === sanitize(runtimeBase));
  } catch (_) {
    return false;
  }
}

function safeSessionFile(sessionsDir, entry) {
  const raw = String(entry?.sessionFile || '').trim();
  if (!raw || !raw.toLowerCase().endsWith('.jsonl')) return null;
  const candidate = resolve(sessionsDir, basename(raw));
  const root = resolve(sessionsDir) + sep;
  if (!candidate.startsWith(root)) return null;
  try { if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) return null; } catch (_) { return null; }
  return candidate;
}

function summaryTemplate(policy, startedAt) {
  return {
    ok: true,
    dry_run: policy.dry_run,
    started_at: startedAt,
    finished_at: null,
    scanned_agents: 0,
    scanned_sessions: 0,
    recognized_sessions: 0,
    candidate_sessions: 0,
    deleted_sessions: 0,
    deleted_files: 0,
    reclaimed_bytes: 0,
    skipped_unknown: 0,
    skipped_active: 0,
    skipped_recent: 0,
    skipped_reference_active: 0,
    skipped_reference_unavailable: 0,
    skipped_owner_mismatch: 0,
    skipped_agent_mismatch: 0,
    skipped_busy_index: 0,
    skipped_unsafe_file: 0,
    skipped_unknown_age: 0,
    unindexed_files_observed: 0,
    errors: 0,
    samples: [],
  };
}

function recordAudit(summary, policy, error = null) {
  const db = getDb();
  ensureAuditTable(db);
  db.prepare(`INSERT INTO openclaw_session_cleanup_runs
    (started_at, finished_at, dry_run, policy_json, scanned_sessions, candidate_sessions,
     deleted_sessions, deleted_files, reclaimed_bytes, error, result_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      summary.started_at,
      summary.finished_at,
      policy.dry_run ? 1 : 0,
      JSON.stringify(policy),
      summary.scanned_sessions,
      summary.candidate_sessions,
      summary.deleted_sessions,
      summary.deleted_files,
      summary.reclaimed_bytes,
      error ? String(error).slice(0, 2000) : null,
      JSON.stringify(summary)
    );
  db.exec(`DELETE FROM openclaw_session_cleanup_runs WHERE id NOT IN
    (SELECT id FROM openclaw_session_cleanup_runs ORDER BY id DESC LIMIT 100)`);
}

export async function runOpenClawSessionCleanup(options = {}) {
  const policy = normalizePolicy(options.policy || getOpenClawSessionCleanupPolicy());
  const nowMs = Number(options.nowMs) || Date.now();
  const startedAt = new Date(nowMs).toISOString();
  const summary = summaryTemplate(policy, startedAt);
  const root = resolve(options.openClawDir || getOpenClawDir());
  const agentsRoot = join(root, 'agents');
  const recentCutoff = nowMs - policy.recent_activity_minutes * 60_000;
  const terminalCutoff = nowMs - policy.terminal_retention_days * 86_400_000;
  const missingCutoff = nowMs - policy.missing_reference_grace_hours * 3_600_000;
  let remaining = policy.batch_size;

  try {
    if (!existsSync(agentsRoot)) {
      summary.finished_at = new Date().toISOString();
      recordAudit(summary, policy);
      return summary;
    }
    const db = options.db || getDb();
    for (const runtimeId of readdirSync(agentsRoot)) {
      if (remaining <= 0) break;
      const tenant = parseTenantOpenClawAgentId(runtimeId);
      if (!tenant) continue;
      const runtimeDir = join(agentsRoot, runtimeId);
      try {
        const runtimeStat = lstatSync(runtimeDir);
        if (runtimeStat.isSymbolicLink() || !runtimeStat.isDirectory()) continue;
      } catch (_) { continue; }
      const sessionsDir = join(agentsRoot, runtimeId, 'sessions');
      const indexPath = join(sessionsDir, 'sessions.json');
      if (!existsSync(indexPath)) continue;
      try {
        const sessionsStat = lstatSync(sessionsDir);
        const indexStat = lstatSync(indexPath);
        if (sessionsStat.isSymbolicLink() || !sessionsStat.isDirectory() || indexStat.isSymbolicLink() || !indexStat.isFile()) {
          summary.skipped_unsafe_file += 1;
          continue;
        }
      } catch (_) { continue; }
      summary.scanned_agents += 1;
      try {
        if (statSync(indexPath).mtimeMs >= recentCutoff || readdirSync(sessionsDir).some((n) => n.endsWith('.lock'))) {
          summary.skipped_busy_index += 1;
          continue;
        }
        const beforeRaw = readFileSync(indexPath, 'utf8');
        const sessionMap = JSON.parse(beforeRaw || '{}');
        const removals = [];
        for (const [key, entry] of Object.entries(sessionMap)) {
          if (remaining <= 0) break;
          summary.scanned_sessions += 1;
          const prefix = `agent:${runtimeId}:`;
          if (!key.startsWith(prefix)) { summary.skipped_unknown += 1; continue; }
          const parsed = parseExecutionSession(key.slice(prefix.length));
          if (!parsed) { summary.skipped_unknown += 1; continue; }
          summary.recognized_sessions += 1;
          const filePath = safeSessionFile(sessionsDir, entry);
          if (entry?.sessionFile && !filePath) { summary.skipped_unsafe_file += 1; continue; }
          const activity = entryActivityMs(entry, filePath);
          if (ACTIVE_SESSION.has(String(entry?.status || '').toLowerCase())) { summary.skipped_active += 1; continue; }
          if (activity >= recentCutoff) { summary.skipped_recent += 1; continue; }
          const ref = getReference(db, parsed);
          if (ref?.lookupUnavailable) {
            summary.skipped_reference_unavailable += 1;
            continue;
          }
          if (ref) {
            if (sanitize(ref.owner_user_id) !== sanitize(tenant.ceoUserId)) { summary.skipped_owner_mismatch += 1; continue; }
            if (!sameAgent(db, ref.agent_id, tenant.baseOpenClawId)) { summary.skipped_agent_mismatch += 1; continue; }
            if (!TERMINAL[ref.kind]?.has(String(ref.status || '').toLowerCase())) { summary.skipped_reference_active += 1; continue; }
            if (Math.max(activity, toMs(ref.terminalAt)) > terminalCutoff) { summary.skipped_recent += 1; continue; }
          } else {
            if (!activity) { summary.skipped_unknown_age += 1; continue; }
            if (activity > missingCutoff) { summary.skipped_recent += 1; continue; }
          }
          summary.candidate_sessions += 1;
          remaining -= 1;
          if (summary.samples.length < 20) summary.samples.push({ runtime_id: runtimeId, type: parsed.type, reference_id: parsed.id || parsed.goalId || null });
          removals.push({ key, fingerprint: `${entry?.sessionId || ''}|${entry?.updatedAt || ''}`, filePath });
        }

        if (!policy.dry_run && removals.length) {
          const currentRaw = readFileSync(indexPath, 'utf8');
          const current = JSON.parse(currentRaw || '{}');
          const deletedFiles = [];
          for (const removal of removals) {
            const currentEntry = current[removal.key];
            const fingerprint = `${currentEntry?.sessionId || ''}|${currentEntry?.updatedAt || ''}`;
            if (!currentEntry || fingerprint !== removal.fingerprint) continue;
            delete current[removal.key];
            summary.deleted_sessions += 1;
            if (removal.filePath) deletedFiles.push(removal.filePath);
          }
          const tmp = `${indexPath}.cleanup-${process.pid}-${Date.now()}.tmp`;
          writeFileSync(tmp, JSON.stringify(current, null, 2) + '\n', { mode: 0o600 });
          renameSync(tmp, indexPath);
          for (const filePath of deletedFiles) {
            try {
              const size = existsSync(filePath) ? statSync(filePath).size : 0;
              if (existsSync(filePath)) unlinkSync(filePath);
              summary.deleted_files += 1;
              summary.reclaimed_bytes += size;
            } catch (_) { summary.errors += 1; }
          }
        }

        // Unindexed JSONL files cannot be proven to be machine execution transcripts rather
        // than conversations. Observe them for operators, but never auto-delete them.
        const currentMap = JSON.parse(readFileSync(indexPath, 'utf8') || '{}');
        const currentRefs = new Set(
          Object.values(currentMap)
            .map((e) => safeSessionFile(sessionsDir, e))
            .filter(Boolean)
            .map((p) => basename(p))
        );
        summary.unindexed_files_observed += readdirSync(sessionsDir).filter(
          (name) => name.endsWith('.jsonl') && !currentRefs.has(name)
        ).length;
      } catch (e) {
        summary.errors += 1;
        console.warn('[openclaw-session-cleanup] skipped runtime=%s error=%s', runtimeId, e?.message || e);
      }
    }
    summary.finished_at = new Date().toISOString();
    recordAudit(summary, policy);
    return summary;
  } catch (e) {
    summary.ok = false;
    summary.finished_at = new Date().toISOString();
    try { recordAudit(summary, policy, e); } catch (_) {}
    throw e;
  }
}

export function getOpenClawSessionCleanupAdminDetails() {
  return {
    cleanup_policy: getOpenClawSessionCleanupPolicy(),
    cleanup_last_run: getOpenClawSessionCleanupLatestRun(),
  };
}
