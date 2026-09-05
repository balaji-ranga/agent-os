/** Owner-scoped read model across Flolah execution runtimes. */
import { getDb } from '../db/schema.js';
import { valueTokenUsage } from './llmops-cost.js';

function parseJson(raw, fallback = null) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) ?? fallback; } catch { return fallback; }
}

export function normalizeExecutionStatus(status) {
  const s = String(status || '').toLowerCase();
  if (['completed', 'complete', 'done', 'closed', 'success', 'succeeded'].includes(s)) return 'completed';
  if (['partial_success', 'partial', 'completed_with_gaps'].includes(s)) return 'partial_success';
  if (['failed', 'error', 'cancelled', 'canceled'].includes(s)) return 'failed';
  if (['blocked', 'blocked_on_input', 'waiting', 'awaiting_approval', 'awaiting_plan_review', 'paused'].includes(s)) return 'blocked';
  if (['running', 'in_progress', 'active', 'recording', 'processing'].includes(s)) return 'running';
  return 'pending';
}

export function verificationFromResult(status, result, error = null) {
  const normalized = normalizeExecutionStatus(status);
  if (normalized === 'failed') return { state: 'failed', evidence: [], error: error || result?.error || null };
  if (normalized === 'partial_success') return { state: 'unverified', evidence: [], error: error || result?.error || 'Some expected outcomes remain incomplete.' };
  if (normalized !== 'completed') return { state: 'not_due', evidence: [], error: null };
  const r = result && typeof result === 'object' ? result : {};
  const evidence = collectTypedEvidence(r);
  const explicit = String(r.verification_status || r.acceptance || '').toLowerCase();
  const verified = ['verified', 'accepted', 'qualified'].includes(explicit) || r.verified === true ||
    r.verification?.satisfied === true || r.verification?.verified === true;
  return { state: verified || evidence.length ? 'verified' : 'unverified', evidence, error: null };
}

export function collectTypedEvidence(value, { maxDepth = 4 } = {}) {
  const evidence = [];
  const seen = new Set();
  const add = (type, raw, path) => {
    const value = raw && typeof raw === 'object' ? raw.id || raw.artifact_id || raw.url || null : raw;
    if (value == null || value === '') return;
    const key = `${type}:${String(value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    evidence.push({ type, value, path });
  };
  const visit = (node, depth, path) => {
    if (depth > maxDepth || node == null) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < Math.min(node.length, 20); i += 1) visit(node[i], depth + 1, `${path}[${i}]`);
      return;
    }
    if (typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (/^(artifact_id|media_artifact_id)$/i.test(key)) add('artifact', child, nextPath);
      else if (/^(public_url|post_url|artifact_url)$/i.test(key)) add('url', child, nextPath);
      else if (/^(message_id|post_id|receipt_id|docname|record_id|task_id)$/i.test(key)) add('provider_receipt', child, nextPath);
      else if (/^artifacts$/i.test(key) && Array.isArray(child)) {
        for (const item of child.slice(0, 20)) add('artifact', item, nextPath);
      }
      visit(child, depth + 1, nextPath);
    }
  };
  visit(value, 0, '');
  return evidence.slice(0, 30);
}

function safeRows(sql, args = []) {
  try { return getDb().prepare(sql).all(...args); } catch { return []; }
}

function goalExecutions(owner, limit) {
  return safeRows(
    `SELECT id, agent_id, title, prompt, status, outcome_json, error_message, created_at, updated_at, completed_at
     FROM agent_goal_runs WHERE owner_user_id = ? ORDER BY datetime(created_at) DESC LIMIT ?`, [owner, limit]
  ).map((r) => {
    const outcome = parseJson(r.outcome_json, {});
    const accepted = outcome?.last_observation?.class === 'accepted';
    const targetMet = Number(outcome?.target || 0) > 0 && Number(outcome?.current_value || 0) >= Number(outcome.target);
    return {
      id: `goal:${r.id}`, source_type: 'goal_plan', source_id: r.id, title: r.title || r.prompt || 'Goal plan',
      owner_agent_id: r.agent_id || null, status: normalizeExecutionStatus(r.status), raw_status: r.status,
      verification: verificationFromResult(r.status, { verified: accepted || targetMet }, r.error_message),
      progress: { current: outcome?.current_value ?? null, target: outcome?.target ?? null }, error: r.error_message || null,
      created_at: r.created_at, updated_at: r.updated_at, completed_at: r.completed_at,
      detail_path: `/goal-plans/${encodeURIComponent(r.id)}`,
    };
  });
}

function workflowExecutions(owner, limit) {
  return safeRows(
    `SELECT r.id, r.definition_id, r.status, r.progress_pct, r.context_json, r.error_message,
            r.started_at, r.updated_at, r.completed_at, d.name AS definition_name
     FROM agent_workflow_runs r LEFT JOIN agent_workflow_definitions d ON d.id = r.definition_id
     WHERE r.owner_user_id = ? ORDER BY datetime(r.started_at) DESC LIMIT ?`, [owner, limit]
  ).map((r) => {
    const context = parseJson(r.context_json, {});
    return {
      id: `workflow:${r.id}`, source_type: 'workflow', source_id: String(r.id),
      title: r.definition_name || r.definition_id || `Workflow #${r.id}`, owner_agent_id: null,
      status: normalizeExecutionStatus(r.status), raw_status: r.status,
      verification: verificationFromResult(r.status, context, r.error_message),
      parent_goal_run_id: context.goal_run_id || null, parent_goal_step_id: context.goal_step_id || null,
      progress: { percent: Number(r.progress_pct || 0) }, error: r.error_message || null,
      created_at: r.started_at, updated_at: r.updated_at, completed_at: r.completed_at,
      detail_path: '/workflows',
    };
  });
}

function browserExecutions(owner, limit) {
  return safeRows(
    `SELECT id, agent_id, goal_text, status, result_json, error, selected_driver_mode,
            parent_goal_run_id, parent_goal_step_id, created_at, updated_at
     FROM browser_tasks WHERE ceo_user_id = ? ORDER BY datetime(created_at) DESC LIMIT ?`, [owner, limit]
  ).map((r) => ({
    id: `browser:${r.id}`, source_type: 'browser', source_id: r.id, title: r.goal_text || 'Browser task',
    owner_agent_id: r.agent_id || null, status: normalizeExecutionStatus(r.status), raw_status: r.status,
    verification: verificationFromResult(r.status, parseJson(r.result_json, {}), r.error),
    parent_goal_run_id: r.parent_goal_run_id || null, parent_goal_step_id: r.parent_goal_step_id || null,
    executor: r.selected_driver_mode || null, progress: null, error: r.error || null,
    created_at: r.created_at, updated_at: r.updated_at,
    completed_at: ['completed', 'failed'].includes(r.status) ? r.updated_at : null, detail_path: '/browser-session',
  }));
}

function kanbanExecutions(owner, limit) {
  return safeRows(
    `SELECT id, title, status, assigned_agent_id, goal_run_id, goal_step_id, trace_id, created_at, updated_at
     FROM kanban_tasks WHERE owner_user_id = ? ORDER BY datetime(created_at) DESC LIMIT ?`, [owner, limit]
  ).map((r) => ({
    id: `kanban:${r.id}`, source_type: 'kanban', source_id: String(r.id), title: r.title || `Task #${r.id}`,
    owner_agent_id: r.assigned_agent_id || null, status: normalizeExecutionStatus(r.status), raw_status: r.status,
    verification: verificationFromResult(r.status, {}, null), progress: null, error: null,
    parent_goal_run_id: r.goal_run_id || null, parent_goal_step_id: r.goal_step_id || null,
    created_at: r.created_at, updated_at: r.updated_at,
    completed_at: normalizeExecutionStatus(r.status) === 'completed' ? r.updated_at : null, detail_path: '/kanban',
  }));
}

export function correlateCompanyExecutions(executions) {
  const list = Array.isArray(executions) ? executions : [];
  const goals = new Map();
  for (const item of list) {
    if (item.source_type === 'goal_plan') {
      item.children = [];
      goals.set(String(item.source_id), item);
    }
  }
  for (const item of list) {
    const parentId = String(item.parent_goal_run_id || '').trim();
    if (!parentId) continue;
    item.parent_execution_id = `goal:${parentId}`;
    const parent = goals.get(parentId);
    if (parent) parent.children.push({
      id: item.id,
      source_type: item.source_type,
      source_id: item.source_id,
      title: item.title,
      status: item.status,
      verification: item.verification,
      executor: item.executor || null,
      updated_at: item.updated_at,
      detail_path: item.detail_path,
    });
  }
  return list;
}

function validDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function filterCompanyExecutions(executions, from, to) {
  const startDate = validDate(from);
  const endDate = validDate(to);
  let all = Array.isArray(executions) ? executions : [];
  if (startDate || endDate) {
    all = all.filter((item) => {
      const date = String(item.updated_at || item.created_at || '').slice(0, 10);
      return (!startDate || date >= startDate) && (!endDate || date <= endDate);
    });
  }
  return { executions: all, filters: { from: startDate, to: endDate } };
}

export function pageCompanyExecutions(executions, { page = 1, pageSize = 10, from = null, to = null } = {}) {
  const filtered = filterCompanyExecutions(executions, from, to);
  const all = filtered.executions;
  const size = Math.min(25, Math.max(1, Number(pageSize) || 10));
  const pageCount = Math.max(1, Math.ceil(all.length / size));
  const selectedPage = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const offset = (selectedPage - 1) * size;
  return {
    executions: all.slice(offset, offset + size),
    pagination: { page: selectedPage, page_size: size, total: all.length, page_count: pageCount, has_previous: selectedPage > 1, has_next: selectedPage < pageCount },
    filters: filtered.filters,
  };
}

export function buildCompanyPulse(executions, counts, cost = {}) {
  const list = Array.isArray(executions) ? executions : [];
  const artifacts = list.reduce((sum, item) => sum + (item.verification?.evidence?.length || 0), 0);
  const urgent = list.find((item) => item.status === 'failed') ||
    list.find((item) => item.status === 'blocked') ||
    list.find((item) => item.verification?.state === 'unverified') ||
    list.find((item) => item.status === 'running');
  let nextAction = { kind: 'clear', label: 'No intervention needed', detail_path: null, execution_id: null };
  if (urgent?.status === 'failed') nextAction = { kind: 'failed', label: `Review failed: ${urgent.title}`, detail_path: urgent.detail_path, execution_id: urgent.id };
  else if (urgent?.status === 'blocked') nextAction = { kind: 'blocked', label: `Unblock: ${urgent.title}`, detail_path: urgent.detail_path, execution_id: urgent.id };
  else if (urgent?.verification?.state === 'unverified') nextAction = { kind: 'unverified', label: `Verify outcome: ${urgent.title}`, detail_path: urgent.detail_path, execution_id: urgent.id };
  else if (urgent?.status === 'running') nextAction = { kind: 'running', label: `Monitor: ${urgent.title}`, detail_path: urgent.detail_path, execution_id: urgent.id };
  return {
    active: Number(counts?.running || 0), blocked: Number(counts?.blocked || 0),
    failed: Number(counts?.failed || 0), unverified: Number(counts?.unverified || 0),
    completed: Number(counts?.completed || 0), artifacts,
    estimated_llm_cost_usd: Number(cost?.amount_usd || 0), cost_payer: cost?.payer || 'unknown',
    next_action: nextAction,
  };
}

export function listCompanyExecutions(ownerUserId, { limit = 30, page = null, pageSize = null, from = null, to = null } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) { const error = new Error('CEO context required'); error.status = 403; throw error; }
  const paged = page != null || pageSize != null || from != null || to != null;
  const size = Math.min(25, Math.max(1, Number(pageSize) || Number(limit) || 10));
  const lim = Math.min(100, Math.max(1, Number(limit) || 30));
  const scan = paged ? 2000 : Math.max(lim, 20);
  let all = correlateCompanyExecutions([...goalExecutions(owner, scan), ...workflowExecutions(owner, scan),
    ...browserExecutions(owner, scan), ...kanbanExecutions(owner, scan)])
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
  const filtered = filterCompanyExecutions(all, from, to);
  all = filtered.executions;
  const counts = { total: all.length, pending: 0, running: 0, blocked: 0, failed: 0, completed: 0, unverified: 0 };
  for (const item of all) {
    counts[item.status] += 1;
    if (item.verification?.state === 'unverified') counts.unverified += 1;
  }
  let cost = { amount_usd: 0, payer: 'unknown' };
  try { cost = valueTokenUsage(owner, { since: validDate(from), until: validDate(to) }); } catch (_) {}
  const pulse = buildCompanyPulse(all, counts, cost);
  if (!paged) return { executions: all.slice(0, lim), counts, pulse, generated_at: new Date().toISOString() };
  const selected = pageCompanyExecutions(all, { page, pageSize: size });
  return {
    executions: selected.executions,
    counts,
    pulse,
    pagination: selected.pagination,
    filters: filtered.filters,
    generated_at: new Date().toISOString(),
  };
}
