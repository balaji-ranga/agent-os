import { getDb } from '../db/schema.js';

export const WORK_ASSIGNMENT_MODES = new Set(['equal_weight', 'prefer_agent', 'prefer_human', 'risk_to_human']);

function ensure() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS work_assignment_policies (
    owner_user_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'prefer_agent',
    high_risk_to_human INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
}

export function getWorkAssignmentPolicy(ownerUserId) {
  ensure();
  const row = getDb().prepare('SELECT * FROM work_assignment_policies WHERE owner_user_id=?').get(ownerUserId);
  return row ? { mode: row.mode, high_risk_to_human: !!row.high_risk_to_human, updated_at: row.updated_at } : { mode: 'prefer_agent', high_risk_to_human: true, updated_at: null };
}

export function saveWorkAssignmentPolicy(ownerUserId, input = {}) {
  ensure();
  const mode = WORK_ASSIGNMENT_MODES.has(input.mode) ? input.mode : 'prefer_agent';
  getDb().prepare(`INSERT INTO work_assignment_policies(owner_user_id,mode,high_risk_to_human,updated_at)
    VALUES(?,?,?,datetime('now')) ON CONFLICT(owner_user_id) DO UPDATE SET
    mode=excluded.mode,high_risk_to_human=excluded.high_risk_to_human,updated_at=datetime('now')`
  ).run(ownerUserId, mode, input.high_risk_to_human === false ? 0 : 1);
  return getWorkAssignmentPolicy(ownerUserId);
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
