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
    });
  }

  // Members whose department is not in master data still appear under that label.
  for (const m of members) {
    const deptName = String(m.department || '').trim();
    const key = normalizeDept(deptName);
    if (!key) continue;
    let bucket = byNorm.get(key);
    if (!bucket) {
      bucket = {
        name: deptName,
        purpose: '',
        monthly_token_budget: null,
        tokens_used: 0,
        token_calls: 0,
        members: [],
      };
      byNorm.set(key, bucket);
    }
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

  const departments = [...byNorm.values()]
    .map((d) => {
      const budget = d.monthly_token_budget;
      const tokenPct =
        budget != null && budget > 0 ? Math.round((d.tokens_used / budget) * 1000) / 10 : null;
      let state = 'ok';
      if (tokenPct != null && tokenPct >= 100) state = 'blocked';
      else if (tokenPct != null && tokenPct >= DEFAULT_WARN_PCT) state = 'warn';
      d.members.sort((a, b) => (b.tokens_used || 0) - (a.tokens_used || 0) || a.name.localeCompare(b.name));
      return {
        ...d,
        member_count: d.members.length,
        token_pct: tokenPct,
        state,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const totals = {
    departments: departments.length,
    members: members.filter((m) => String(m.department || '').trim()).length,
    tokens_used: departments.reduce((s, d) => s + d.tokens_used, 0),
    monthly_token_budget: departments.reduce(
      (s, d) => s + (d.monthly_token_budget != null ? Number(d.monthly_token_budget) || 0 : 0),
      0
    ),
  };

  return { period, departments, totals };
}
