import { getDb } from '../db/schema.js';

export const WORK_ASSIGNMENT_MODES = new Set(['equal_weight', 'prefer_agent', 'prefer_human', 'risk_to_human']);
export const ETA_HOUR_OPTIONS = [1, 2, 4, 8, 12, 24, 36, 48, 72, 168];

function eta(value, fallback) {
  const n = Number(value);
  return ETA_HOUR_OPTIONS.includes(n) ? n : fallback;
}

function ensure() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS work_assignment_policies (
    owner_user_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'prefer_agent',
    high_risk_to_human INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  const columns = new Set(getDb().prepare('PRAGMA table_info(work_assignment_policies)').all().map((row) => row.name));
  if (!columns.has('urgent_eta_hours')) getDb().exec(`ALTER TABLE work_assignment_policies ADD COLUMN urgent_eta_hours INTEGER NOT NULL DEFAULT 4`);
  if (!columns.has('standard_eta_hours')) getDb().exec(`ALTER TABLE work_assignment_policies ADD COLUMN standard_eta_hours INTEGER NOT NULL DEFAULT 8`);
  if (!columns.has('complex_eta_hours')) getDb().exec(`ALTER TABLE work_assignment_policies ADD COLUMN complex_eta_hours INTEGER NOT NULL DEFAULT 12`);
  if (!columns.has('sla_notify_in_app')) getDb().exec(`ALTER TABLE work_assignment_policies ADD COLUMN sla_notify_in_app INTEGER NOT NULL DEFAULT 1`);
  if (!columns.has('sla_notify_email')) getDb().exec(`ALTER TABLE work_assignment_policies ADD COLUMN sla_notify_email INTEGER NOT NULL DEFAULT 1`);
  if (!columns.has('sla_notify_whatsapp')) getDb().exec(`ALTER TABLE work_assignment_policies ADD COLUMN sla_notify_whatsapp INTEGER NOT NULL DEFAULT 1`);
  if (!columns.has('sla_include_status_checker')) getDb().exec(`ALTER TABLE work_assignment_policies ADD COLUMN sla_include_status_checker INTEGER NOT NULL DEFAULT 1`);
}

export function getWorkAssignmentPolicy(ownerUserId) {
  ensure();
  const row = getDb().prepare('SELECT * FROM work_assignment_policies WHERE owner_user_id=?').get(ownerUserId);
  return row ? {
    mode: row.mode,
    high_risk_to_human: !!row.high_risk_to_human,
    urgent_eta_hours: eta(row.urgent_eta_hours, 4),
    standard_eta_hours: eta(row.standard_eta_hours, 8),
    complex_eta_hours: eta(row.complex_eta_hours, 12),
    sla_notify_in_app: row.sla_notify_in_app !== 0,
    sla_notify_email: row.sla_notify_email !== 0,
    sla_notify_whatsapp: row.sla_notify_whatsapp !== 0,
    sla_include_status_checker: row.sla_include_status_checker !== 0,
    updated_at: row.updated_at,
  } : {
    mode: 'prefer_agent', high_risk_to_human: true,
    urgent_eta_hours: 4, standard_eta_hours: 8, complex_eta_hours: 12,
    sla_notify_in_app: true, sla_notify_email: true, sla_notify_whatsapp: true,
    sla_include_status_checker: true, updated_at: null,
  };
}

export function saveWorkAssignmentPolicy(ownerUserId, input = {}) {
  ensure();
  const current = getWorkAssignmentPolicy(ownerUserId);
  const mode = WORK_ASSIGNMENT_MODES.has(input.mode) ? input.mode : 'prefer_agent';
  getDb().prepare(`INSERT INTO work_assignment_policies
    (owner_user_id,mode,high_risk_to_human,urgent_eta_hours,standard_eta_hours,complex_eta_hours,
     sla_notify_in_app,sla_notify_email,sla_notify_whatsapp,sla_include_status_checker,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(owner_user_id) DO UPDATE SET
    mode=excluded.mode,high_risk_to_human=excluded.high_risk_to_human,
    urgent_eta_hours=excluded.urgent_eta_hours,standard_eta_hours=excluded.standard_eta_hours,
    complex_eta_hours=excluded.complex_eta_hours,
    sla_notify_in_app=excluded.sla_notify_in_app,sla_notify_email=excluded.sla_notify_email,
    sla_notify_whatsapp=excluded.sla_notify_whatsapp,
    sla_include_status_checker=excluded.sla_include_status_checker,updated_at=datetime('now')`
  ).run(ownerUserId, mode, input.high_risk_to_human === false ? 0 : 1,
    eta(input.urgent_eta_hours, 4), eta(input.standard_eta_hours, 8), eta(input.complex_eta_hours, 12),
    (input.sla_notify_in_app ?? current.sla_notify_in_app) === false ? 0 : 1,
    (input.sla_notify_email ?? current.sla_notify_email) === false ? 0 : 1,
    (input.sla_notify_whatsapp ?? current.sla_notify_whatsapp) === false ? 0 : 1,
    (input.sla_include_status_checker ?? current.sla_include_status_checker) === false ? 0 : 1);
  return getWorkAssignmentPolicy(ownerUserId);
}

export function resolvePolicyEtaHours(ownerUserId, value, context = '') {
  const explicit = Number(value);
  if (ETA_HOUR_OPTIONS.includes(explicit)) return explicit;
  const policy = getWorkAssignmentPolicy(ownerUserId);
  const text = String(context || '').toLowerCase();
  if (/critical|urgent|immediate|high[- ]risk|risk\s*[:=]\s*high|regulatory|legal|overdue|payment|finance/.test(text)) return policy.urgent_eta_hours;
  if (/complex|research|investigat|multi[- ]step|customer/.test(text)) return policy.complex_eta_hours;
  return policy.standard_eta_hours;
}

export function listHumanWorkCandidates(ownerUserId) {
  ensure();
  return getDb().prepare(`SELECT id,name,role_title,department,COALESCE(specialty,'') AS specialty,
      COALESCE(purpose,'') AS purpose FROM platform_users
    WHERE owner_user_id=? AND role='org_user' AND enabled=1 ORDER BY name`).all(ownerUserId);
}

/** Deterministic policy gate over planner-proposed overlap; intent classification supplies candidates. */
export function chooseOverlappingExecutor({ policy, risk = 'normal', agentCandidate = null, humanCandidate = null }) {
  if (!humanCandidate) return agentCandidate ? { kind: 'agent', candidate: agentCandidate } : null;
  if (!agentCandidate) return { kind: 'human', candidate: humanCandidate };
  if ((policy?.mode === 'risk_to_human' || policy?.high_risk_to_human) && risk === 'high') return { kind: 'human', candidate: humanCandidate };
  if (policy?.mode === 'prefer_human') return { kind: 'human', candidate: humanCandidate };
  if (policy?.mode === 'equal_weight') {
    const humanScore = Number(humanCandidate.match_score || 0);
    const agentScore = Number(agentCandidate.match_score || 0);
    return humanScore > agentScore ? { kind: 'human', candidate: humanCandidate } : { kind: 'agent', candidate: agentCandidate };
  }
  return { kind: 'agent', candidate: agentCandidate };
}
