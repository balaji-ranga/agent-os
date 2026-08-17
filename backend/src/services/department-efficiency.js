/**
 * Efficiency View → Department tab.
 *
 * Rolls up month-to-date token usage for every org member (internal + leaf) whose
 * `department` string matches a Master Data departments row, and compares that sum
 * to the department's planning `monthly_token_budget`.
 */
import { listDepartmentsForOwner } from './ceo-default-master-data.js';
import { listEfficiencyMembers } from './agent-efficiency.js';
import { getMonthlyTokensByMember, monthPeriod } from './token-usage.js';
import { getDb } from '../db/schema.js';
import { getKanbanScopeIds } from './kanban-user-scope.js';

const DEFAULT_WARN_PCT = 80;

function normalizeDept(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

/**
 * @param {string} ownerUserId
 * @returns {{ period: string, departments: Array<object> }}
 */
export function getDepartmentEfficiency(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) {
    const err = new Error('owner_user_id required');
    err.status = 400;
    throw err;
  }

  const period = monthPeriod();
  const depts = listDepartmentsForOwner(owner);
  const members = listEfficiencyMembers(owner);
  const tokensByMember = getMonthlyTokensByMember(owner, period);
  const people = getDb()
    .prepare(
      `SELECT id, name, department, enabled FROM platform_users
       WHERE owner_user_id = ? AND role = 'org_user'`
    )
    .all(owner);
  const kanbanIds = getKanbanScopeIds(owner);
  const kph = kanbanIds.length ? kanbanIds.map(() => '?').join(',') : '?';
  const kanbanParams = kanbanIds.length ? kanbanIds : ['__none__'];
  const taskRows = getDb()
    .prepare(
      `SELECT
         COALESCE(pu.department, a.department, '') AS department,
         k.status,
         k.due_date,
         k.assigned_user_id,
         k.assigned_agent_id
       FROM kanban_tasks k
       LEFT JOIN platform_users pu ON pu.id = k.assigned_user_id
       LEFT JOIN agents a ON a.id = k.assigned_agent_id
       WHERE k.owner_user_id IN (${kph})`
    )
    .all(...kanbanParams);

  /** @type {Map<string, object>} */
  const byNorm = new Map();
  for (const d of depts) {
    const key = normalizeDept(d.name);
    if (!key) continue;
    byNorm.set(key, {
      name: d.name,
      purpose: d.purpose || '',
      monthly_token_budget: d.monthly_token_budget,
      tokens_used: 0,
      token_calls: 0,
      members: [],
      people: [],
      tasks: { open: 0, awaiting_confirmation: 0, in_progress: 0, completed: 0, failed: 0, overdue: 0 },
    });
  }

  function ensureBucket(deptName) {
    const key = normalizeDept(deptName);
    if (!key) return null;
    let bucket = byNorm.get(key);
    if (!bucket) {
      bucket = {
        name: deptName,
        purpose: '',
        monthly_token_budget: null,
        tokens_used: 0,
        token_calls: 0,
        members: [],
        people: [],
        tasks: { open: 0, awaiting_confirmation: 0, in_progress: 0, completed: 0, failed: 0, overdue: 0 },
      };
      byNorm.set(key, bucket);
    }
    return bucket;
  }

  // Members whose department is not in master data still appear under that label.
  for (const m of members) {
    const deptName = String(m.department || '').trim();
    const bucket = ensureBucket(deptName);
    if (!bucket) continue;
    const usage = tokensByMember.get(m.member_key) || { total_tokens: 0, calls: 0 };
    const tokens = Number(usage.total_tokens) || 0;
    const calls = Number(usage.calls) || 0;
    bucket.tokens_used += tokens;
    bucket.token_calls += calls;
    bucket.members.push({
      member_key: m.member_key,
      name: m.name,
      kind: m.kind,
      tokens_used: tokens,
      token_calls: calls,
      budget_state: m.budget_state || 'ok',
      monthly_token_budget: m.monthly_token_budget ?? null,
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const p of people) {
    const deptName = String(p.department || '').trim();
    const bucket = ensureBucket(deptName);
    if (!bucket) continue;
    const personTasks = taskRows.filter((t) => t.assigned_user_id === p.id);
    const completed = personTasks.filter((t) => t.status === 'completed').length;
    const failed = personTasks.filter((t) => t.status === 'failed').length;
    const terminal = completed + failed;
    bucket.people.push({
      user_id: p.id,
      name: p.name,
      kind: 'person',
      enabled: !!p.enabled,
      tasks_open: personTasks.filter((t) => t.status === 'open').length,
      tasks_in_progress: personTasks.filter((t) => t.status === 'in_progress').length,
      tasks_awaiting: personTasks.filter((t) => t.status === 'awaiting_confirmation').length,
      tasks_completed: completed,
      tasks_failed: failed,
      completion_pct: terminal > 0 ? Math.round((completed / terminal) * 1000) / 10 : null,
    });
  }

  for (const t of taskRows) {
    const bucket = ensureBucket(t.department);
    if (!bucket) continue;
    if (bucket.tasks[t.status] != null) bucket.tasks[t.status] += 1;
    if (
      t.due_date &&
      String(t.due_date).slice(0, 10) < today &&
      !['completed', 'failed'].includes(t.status)
    ) {
      bucket.tasks.overdue += 1;
    }
  }

  const departments = [...byNorm.values()]
    .map((d) => {
      const budget = d.monthly_token_budget;
      const tokenPct =
        budget != null && budget > 0 ? Math.round((d.tokens_used / budget) * 1000) / 10 : null;
      let state = 'ok';
      if (tokenPct != null && tokenPct >= 100) state = 'blocked';
      else if (tokenPct != null && tokenPct >= DEFAULT_WARN_PCT) state = 'warn';
      d.members.sort((a, b) => (b.tokens_used || 0) - (a.tokens_used || 0) || a.name.localeCompare(b.name));
      d.people.sort((a, b) => a.name.localeCompare(b.name));
      const done = d.tasks.completed;
      const fail = d.tasks.failed;
      const assigned =
        (d.tasks.open || 0) +
        (d.tasks.awaiting_confirmation || 0) +
        (d.tasks.in_progress || 0) +
        done +
        fail;
      const terminal = done + fail;
      const completion_pct = terminal > 0 ? Math.round((done / terminal) * 1000) / 10 : null;
      return {
        ...d,
        tasks: { ...d.tasks, assigned, completion_pct },
        member_count: d.members.length,
        people_count: d.people.length,
        token_pct: tokenPct,
        state,
        completion_pct,
        fail_pct: terminal > 0 ? Math.round((fail / terminal) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const totals = {
    departments: departments.length,
    members: members.filter((m) => String(m.department || '').trim()).length,
    people: people.filter((p) => String(p.department || '').trim()).length,
    tokens_used: departments.reduce((s, d) => s + d.tokens_used, 0),
    monthly_token_budget: departments.reduce(
      (s, d) => s + (d.monthly_token_budget != null ? Number(d.monthly_token_budget) || 0 : 0),
      0
    ),
  };

  return { period, departments, totals };
}
