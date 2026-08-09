/**
 * Operational Effectiveness Index (OEI) — owner-scoped, deterministic.
 * Rolling window: 14 days. Green >= 75, Amber 50-74, Red 0-49.
 * Equal-ish domain weights (mean of applicable domains). No LLM required.
 * Privacy: never returns vault secrets / BYOK keys.
 */
import { getDb } from '../db/schema.js';
import { listAgentsForUser, getUserById } from './users.js';
import { listScheduledGoals } from './scheduled-goals.js';
import { getBusinessProfile } from './company-business-profile.js';
import { getTwentyStatusForOwner } from './twenty-crm.js';
import { getConnectedConnectorApps } from './openconnector.js';
import { getCeoGuardrails, getActiveCeoGuardrailText } from './ceo-guardrails.js';
import { listAgentBudgets } from './agent-budgets.js';
import { getPlatformTimezone } from '../utils/format-datetime.js';

const WINDOW_DAYS = 14;
const BAND_GREEN = 75;
const BAND_AMBER = 50;

const CRM_NAME_RE =
  /hubspot|salesforce|pipedrive|zoho|twenty|dynamics|close\.io|copper|freshsales|monday|crm\b|customer\s*relationship/i;

function clamp(n, lo = 0, hi = 100) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function bandOf(score) {
  const s = clamp(score);
  if (s >= BAND_GREEN) return { band: 'green', label: 'Green' };
  if (s >= BAND_AMBER) return { band: 'amber', label: 'Amber' };
  return { band: 'red', label: 'Red' };
}

function windowStartIso(days = WINDOW_DAYS) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function dateOnlyDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * CRM is "connected" when platform Twenty is entitled+bound, OR an MCA/OpenConnector
 * CRM-class app is connected for this owner.
 */
export async function resolveCrmOperationalState(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  let business = null;
  let twenty = null;
  try {
    business = getBusinessProfile(owner);
  } catch (e) {
    console.warn('[oei] business profile', e?.message || e);
  }
  try {
    twenty = getTwentyStatusForOwner(owner);
  } catch (e) {
    console.warn('[oei] twenty status', e?.message || e);
  }

  const platformEnabled = !!(business?.crm_enabled || business?.platform_crm);
  const platformBound = !!(twenty?.bound || business?.twenty?.bound || twenty?.workspace_id);
  const platformLive = platformEnabled && platformBound;

  let connectorCrm = null;
  let connectorsSource = null;
  try {
    const { apps, source } = await getConnectedConnectorApps(owner);
    connectorsSource = source;
    const real = (apps || []).filter((a) => a && a.connected && source !== 'suggested');
    connectorCrm =
      real.find((a) => {
        const blob = `${a.id || ''} ${a.provider_name || ''} ${a.name || ''} ${a.app || ''}`;
        return CRM_NAME_RE.test(blob);
      }) || null;
  } catch (e) {
    console.warn('[oei] connectors', e?.message || e);
  }

  const connectorLive = !!connectorCrm;
  const connected = platformLive || connectorLive;

  return {
    connected,
    platform: {
      enabled: platformEnabled,
      bound: platformBound,
      live: platformLive,
      provider: business?.crm_provider || business?.crm || null,
    },
    mca_connector: connectorLive
      ? {
          id: connectorCrm.id || connectorCrm.provider_name || null,
          name: connectorCrm.name || connectorCrm.provider_name || connectorCrm.id || null,
          source: connectorsSource,
        }
      : null,
    connectors_source: connectorsSource,
  };
}

function domainResult({ id, name, score, weight, na = false, kpis = [], improve = [] }) {
  const s = na ? null : clamp(Math.round(score));
  const b = na ? { band: 'na', label: 'N/A' } : bandOf(s);
  return {
    id,
    name,
    score: s,
    weight,
    band: b.band,
    band_label: b.label,
    not_applicable: !!na,
    kpis,
    improve,
  };
}

async function scoreVisionDomain(owner, facts) {
  const user = getUserById(owner) || {};
  let biz = null;
  try {
    biz = getBusinessProfile(owner);
  } catch {
    /* ignore */
  }
  let profileScore = 0;
  const kpis = [];
  const hasBizName = !!(user.business_name || biz?.business_name || biz?.company_name);
  const hasIndustry = !!(user.industry || biz?.industry);
  const hasMission = !!(
    biz?.mission ||
    biz?.vision ||
    biz?.purpose ||
    biz?.company_description ||
    biz?.scope
  );
  if (hasBizName) profileScore += 35;
  if (hasIndustry) profileScore += 25;
  if (hasMission) profileScore += 25;
  kpis.push({
    id: 'profile',
    label: 'Company profile fields',
    value: [hasBizName && 'name', hasIndustry && 'industry', hasMission && 'mission/vision']
      .filter(Boolean)
      .join(', ') || 'incomplete',
    ok: hasBizName && hasIndustry,
  });

  let guardText = '';
  try {
    guardText = String(getActiveCeoGuardrailText(owner) || '').trim();
  } catch {
    try {
      const g = getCeoGuardrails(owner);
      guardText = String(g?.text || g?.policy || '').trim();
    } catch {
      /* ignore */
    }
  }
  const policyOk = guardText.length >= 40;
  if (policyOk) profileScore += 15;
  else profileScore += Math.min(15, Math.round(guardText.length / 8));
  kpis.push({
    id: 'policy',
    label: 'CEO policies / guardrails',
    value: policyOk ? 'present' : guardText ? 'thin' : 'missing',
    ok: policyOk,
  });

  // Company operate / setup hints from profile flags if present
  let operateBonus = 0;
  if (biz?.operating_model || biz?.operate_model || biz?.day0_complete) operateBonus = 10;
  profileScore = clamp(profileScore + operateBonus);

  const improve = [];
  if (!hasBizName || !hasIndustry) {
    improve.push({
      action: 'Complete company name and industry on Profile / Company setup',
      href: '/company-setup',
    });
  }
  if (!hasMission) {
    improve.push({
      action: 'Capture company vision/scope so AI employees align to it',
      href: '/company-setup',
    });
  }
  if (!policyOk) {
    improve.push({ action: 'Add CEO Policies / guardrails for safer autonomous work', href: '/policies' });
  }
  facts.vision = { has_biz_name: hasBizName, has_industry: hasIndustry, has_mission: hasMission, policy_ok: policyOk };
  return domainResult({
    id: 'vision',
    name: 'Vision & operating model',
    score: profileScore,
    weight: 1,
    kpis,
    improve: improve.slice(0, 3),
  });
}

async function scoreOrgDomain(owner, facts) {
  const agents = listAgentsForUser(owner) || [];
  const specialists = agents.filter((a) => !a.is_coo && !/platform.?help|workflow.?builder/i.test(a.name || a.id || ''));
  const nonCore = agents.filter((a) => !a.is_coo);
  const kpis = [];
  let score = 0;

  const headcount = agents.length;
  // Core trio often = COO + WB + Help
  if (headcount >= 5) score += 40;
  else if (headcount >= 3) score += 28;
  else if (headcount >= 1) score += 15;
  kpis.push({ id: 'headcount', label: 'AI employees on team', value: headcount, ok: headcount >= 3 });

  if (specialists.length >= 2) score += 25;
  else if (specialists.length === 1) score += 12;
  kpis.push({
    id: 'specialists',
    label: 'Specialists beyond core',
    value: specialists.length,
    ok: specialists.length >= 1,
  });

  // Activity in window
  const since = windowStartIso();
  let activeAgents = 0;
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT DISTINCT agent_id AS id FROM agent_delegation_tasks
         WHERE created_at >= ? AND agent_id IS NOT NULL
         UNION
         SELECT DISTINCT assigned_agent_id AS id FROM kanban_tasks
         WHERE COALESCE(updated_at, created_at) >= ? AND assigned_agent_id IS NOT NULL`
      )
      .all(since, since);
    const ids = new Set((rows || []).map((r) => r.id).filter(Boolean));
    activeAgents = agents.filter((a) => ids.has(a.id)).length;
  } catch {
    activeAgents = 0;
  }
  if (activeAgents >= 2) score += 25;
  else if (activeAgents === 1) score += 12;
  kpis.push({
    id: 'active_14d',
    label: 'Agents with work in 14d',
    value: activeAgents,
    ok: activeAgents >= 1,
  });

  if (nonCore.length >= 1) score += 10;
  score = clamp(score);

  const improve = [];
  if (headcount < 3) {
    improve.push({ action: 'Hire AI employees for roles that match your company scope', href: '/workspace' });
  }
  if (specialists.length < 1) {
    improve.push({ action: 'Add specialist AI employees (not only COO)', href: '/org' });
  }
  if (activeAgents < 1) {
    improve.push({ action: 'Delegate or schedule work so specialists act in the next 14 days', href: '/kanban' });
  }
  facts.org = { headcount, specialists: specialists.length, active_14d: activeAgents };
  return domainResult({
    id: 'org',
    name: 'Org & AI workforce',
    score,
    weight: 1,
    kpis,
    improve: improve.slice(0, 3),
  });
}

async function scoreGoalsDomain(owner, facts) {
  let goals = [];
  try {
    goals = listScheduledGoals(owner) || [];
  } catch (e) {
    console.warn('[oei] goals list', e?.message || e);
  }
  const active = goals.filter((g) => String(g.status || '').toLowerCase() === 'active');
  const kpis = [];
  let score = 0;

  if (active.length >= 3) score += 40;
  else if (active.length === 2) score += 30;
  else if (active.length === 1) score += 20;
  kpis.push({ id: 'active_goals', label: 'Active scheduled goals', value: active.length, ok: active.length >= 1 });

  // Count actual firings from scheduled_goal_runs (not last_run_at — that is “latest only” per goal).
  const sinceIso = windowStartIso();
  let success = 0;
  let fail = 0;
  let fireCount = 0;
  let goalsThatRan = 0;
  try {
    const db = getDb();
    const agg = db
      .prepare(
        `SELECT
           COUNT(*) AS n,
           SUM(CASE WHEN lower(COALESCE(status,'')) IN ('ok','success','completed') THEN 1 ELSE 0 END) AS ok,
           SUM(CASE WHEN lower(COALESCE(status,'')) IN ('error','failed') THEN 1 ELSE 0 END) AS bad,
           COUNT(DISTINCT goal_id) AS goals_n
         FROM scheduled_goal_runs
         WHERE owner_user_id = ?
           AND datetime(created_at) >= datetime(?)`
      )
      .get(owner, sinceIso);
    fireCount = Number(agg?.n) || 0;
    success = Number(agg?.ok) || 0;
    fail = Number(agg?.bad) || 0;
    goalsThatRan = Number(agg?.goals_n) || 0;
  } catch (e) {
    console.warn('[oei] goal runs history', e?.message || e);
    // Fallback: last_run_at still only counts goals, not firings
    const sinceDay = dateOnlyDaysAgo(WINDOW_DAYS);
    for (const g of active) {
      if (g.last_run_at && String(g.last_run_at).slice(0, 10) >= sinceDay) {
        goalsThatRan += 1;
        fireCount += 1;
        const st = String(g.last_run_status || '').toLowerCase();
        if (st === 'ok' || st === 'success' || st === 'completed') success += 1;
        else if (st === 'error' || st === 'failed') fail += 1;
      }
    }
  }

  if (active.length === 0) {
    /* no health points */
  } else if (fireCount === 0) {
    score += 10; // goals exist but idle
  } else {
    const rate = success / Math.max(fireCount, 1);
    score += Math.round(rate * 40);
    // Cadence signal: daily goals should fire many times in 14d
    if (fireCount >= 7) score += 15;
    else if (fireCount >= 3) score += 10;
    else if (goalsThatRan >= 1) score += 5;
  }
  score = clamp(score);

  kpis.push({
    id: 'goal_fires_14d',
    label: 'Goal runs (14d)',
    value: fireCount,
    ok: fireCount >= 1,
  });
  kpis.push({
    id: 'goals_that_ran_14d',
    label: 'Distinct goals that ran (14d)',
    value: goalsThatRan,
    ok: goalsThatRan >= 1,
  });
  kpis.push({
    id: 'goal_success',
    label: 'Successful runs (14d)',
    value: `${success}${fail ? ` (${fail} failed)` : ''}`,
    ok: fail === 0 && success > 0,
  });

  const improve = [];
  if (active.length < 1) {
    improve.push({
      action: 'Create scheduled goals so AI employees work on a cadence',
      href: '/scheduled-goals',
    });
  } else if (fireCount < 1) {
    improve.push({
      action: 'Ensure goals are active and can fire (check time/timezone, Run now)',
      href: '/scheduled-goals',
    });
  } else if (fail > 0) {
    improve.push({ action: 'Fix failing scheduled goals (read last run error)', href: '/scheduled-goals' });
  } else if (active.some((g) => /daily|hour/i.test(String(g.cadence || ''))) && fireCount < 3) {
    improve.push({
      action: 'Daily/hourly goals have few stored runs — verify the scheduler is firing and not only emailing outside goals',
      href: '/scheduled-goals',
    });
  }
  facts.goals = {
    total: goals.length,
    active: active.length,
    fires_14d: fireCount,
    goals_that_ran_14d: goalsThatRan,
    success_14d: success,
    fail_14d: fail,
  };
  return domainResult({
    id: 'goals',
    name: 'Goals → execution',
    score,
    weight: 1,
    kpis,
    improve: improve.slice(0, 3),
  });
}

async function scoreWorkflowsDomain(owner, facts) {
  const db = getDb();
  const since = windowStartIso();
  let published = 0;
  let completed = 0;
  let failed = 0;
  try {
    published =
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_workflow_definitions
           WHERE owner_user_id = ? AND lower(COALESCE(status,'')) IN ('published','active')`
        )
        .get(owner)?.n || 0;
  } catch {
    try {
      published =
        db
          .prepare(`SELECT COUNT(*) AS n FROM agent_workflow_definitions WHERE owner_user_id = ?`)
          .get(owner)?.n || 0;
    } catch {
      published = 0;
    }
  }
  try {
    const row = db
      .prepare(
        `SELECT
           SUM(CASE WHEN lower(COALESCE(status,'')) IN ('completed','success','succeeded') THEN 1 ELSE 0 END) AS ok,
           SUM(CASE WHEN lower(COALESCE(status,'')) IN ('failed','error') THEN 1 ELSE 0 END) AS bad
         FROM agent_workflow_runs
         WHERE owner_user_id = ?
           AND COALESCE(completed_at, updated_at, started_at) >= ?`
      )
      .get(owner, since);
    completed = Number(row?.ok) || 0;
    failed = Number(row?.bad) || 0;
  } catch (e) {
    console.warn('[oei] workflow runs', e?.message || e);
  }

  let score = 0;
  if (published >= 3) score += 35;
  else if (published >= 1) score += 22;
  const total = completed + failed;
  if (total >= 5) score += 20;
  else if (total >= 1) score += 12;
  if (total > 0) {
    const rate = completed / total;
    score += Math.round(rate * 45);
  }
  score = clamp(score);

  const kpis = [
    { id: 'published', label: 'Published workflows', value: published, ok: published >= 1 },
    { id: 'runs_14d', label: 'Workflow runs (14d)', value: total, ok: total >= 1 },
    {
      id: 'success_rate',
      label: 'Run success rate (14d)',
      value: total ? `${Math.round((completed / total) * 100)}%` : 'n/a',
      ok: total > 0 && completed / total >= 0.85,
    },
  ];
  const improve = [];
  if (published < 1) {
    improve.push({ action: 'Publish at least one workflow that encodes a core company process', href: '/workflows' });
  }
  if (total < 1 && published >= 1) {
    improve.push({ action: 'Trigger workflows on a schedule or via COO so they run autonomously', href: '/workflows' });
  }
  if (failed > 0 && failed >= completed) {
    improve.push({ action: 'Review failed runs and add retries/guards (run audit)', href: '/workflows' });
  }
  facts.workflows = { published, completed_14d: completed, failed_14d: failed, runs_14d: total };
  return domainResult({
    id: 'workflows',
    name: 'Workflows (automation)',
    score,
    weight: 1,
    kpis,
    improve: improve.slice(0, 3),
  });
}

async function scoreAutonomyDomain(owner, facts) {
  const db = getDb();
  const since = windowStartIso();
  let standups = 0;
  let delegations = 0;
  let notify = 0;
  try {
    standups =
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM standups
           WHERE owner_user_id = ? AND COALESCE(created_at, started_at) >= ?`
        )
        .get(owner, since)?.n || 0;
  } catch {
    standups = 0;
  }
  try {
    delegations =
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_delegation_tasks
           WHERE created_at >= ?`
        )
        .get(since)?.n || 0;
    // Prefer owner-scoped if column exists
    try {
      delegations =
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM agent_delegation_tasks d
             INNER JOIN standups s ON s.id = d.standup_id
             WHERE s.owner_user_id = ? AND d.created_at >= ?`
          )
          .get(owner, since)?.n || 0;
    } catch {
      /* keep prior */
    }
  } catch {
    delegations = 0;
  }
  try {
    notify =
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM content_tool_logs
           WHERE tool_name = 'notify_ceo'
             AND status = 'ok'
             AND created_at >= ?
             AND (request_payload LIKE ? OR response_payload LIKE ?)`
        )
        .get(since, `%${owner}%`, `%${owner}%`)?.n || 0;
  } catch {
    notify = 0;
  }

  // Scheduled goal activity also signals autonomy — count firings, not distinct goals only
  let goalFires = 0;
  try {
    const db = getDb();
    const since = windowStartIso();
    goalFires =
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM scheduled_goal_runs
           WHERE owner_user_id = ? AND datetime(created_at) >= datetime(?)`
        )
        .get(owner, since)?.n || 0;
  } catch {
    try {
      const goals = listScheduledGoals(owner) || [];
      const day = dateOnlyDaysAgo(WINDOW_DAYS);
      goalFires = goals.filter((g) => g.last_run_at && String(g.last_run_at).slice(0, 10) >= day).length;
    } catch {
      goalFires = 0;
    }
  }

  let score = 0;
  if (standups >= 3) score += 30;
  else if (standups >= 1) score += 18;
  if (delegations >= 3) score += 30;
  else if (delegations >= 1) score += 18;
  if (goalFires >= 7) score += 25;
  else if (goalFires >= 3) score += 18;
  else if (goalFires >= 1) score += 12;
  if (notify >= 1) score += 15;
  score = clamp(score);

  const kpis = [
    { id: 'standups', label: 'Standups (14d)', value: standups, ok: standups >= 1 },
    { id: 'delegations', label: 'Delegations (14d)', value: delegations, ok: delegations >= 1 },
    { id: 'scheduled_fires', label: 'Scheduled goal runs (14d)', value: goalFires, ok: goalFires >= 1 },
    { id: 'ceo_notify', label: 'CEO notifies (14d)', value: notify, ok: true },
  ];
  const improve = [];
  if (standups < 1) {
    improve.push({ action: 'Run standups or daily status so COO aggregation has input', href: '/standups' });
  }
  if (delegations < 1) {
    improve.push({ action: 'Let COO delegate work to specialists (Kanban cards)', href: '/' });
  }
  if (goalFires < 1) {
    improve.push({ action: 'Turn on scheduled goals for hands-off cadence', href: '/scheduled-goals' });
  }
  facts.autonomy = {
    standups_14d: standups,
    delegations_14d: delegations,
    goal_fires_14d: goalFires,
    notify_14d: notify,
  };
  return domainResult({
    id: 'autonomy',
    name: 'Autonomous operating loop',
    score,
    weight: 1,
    kpis,
    improve: improve.slice(0, 3),
  });
}

async function scoreCrmDomain(owner, facts) {
  const crm = await resolveCrmOperationalState(owner);
  let score = 0;
  const kpis = [];
  if (crm.connected) {
    score += 70;
    if (crm.platform.live) score += 15;
    if (crm.mca_connector) score += 15;
  } else if (crm.platform.enabled && !crm.platform.bound) {
    score = 35;
  } else {
    score = 10;
  }
  score = clamp(score);
  kpis.push({
    id: 'crm_connected',
    label: 'CRM connected (platform or MCA)',
    value: crm.connected
      ? crm.platform.live
        ? 'Platform CRM'
        : `MCA: ${crm.mca_connector?.name || 'connector'}`
      : crm.platform.enabled
        ? 'Enabled but not bound'
        : 'Not connected',
    ok: crm.connected,
  });
  if (crm.mca_connector) {
    kpis.push({
      id: 'mca',
      label: 'MCA CRM connector',
      value: crm.mca_connector.name || crm.mca_connector.id,
      ok: true,
    });
  }

  const improve = [];
  if (!crm.connected) {
    improve.push({
      action: 'Connect platform CRM (Business Core / Twenty) or an MCA CRM connector',
      href: '/connectors',
    });
    if (crm.platform.enabled && !crm.platform.bound) {
      improve.push({ action: 'Finish binding the Twenty CRM workspace for your company', href: '/crm' });
    }
  } else {
    improve.push({
      action: 'Use CRM in ops (pipeline after outreach) so customer data stays current',
      href: '/crm',
    });
  }
  facts.crm = crm;
  return domainResult({
    id: 'crm',
    name: 'CRM & systems of record',
    score,
    weight: 1,
    kpis,
    improve: improve.slice(0, 3),
  });
}

async function scoreGovernanceDomain(owner, facts) {
  let score = 0;
  const kpis = [];
  let policyOk = false;
  try {
    const text = String(getActiveCeoGuardrailText(owner) || '').trim();
    policyOk = text.length >= 40;
    if (policyOk) score += 40;
    else if (text.length > 0) score += 20;
  } catch {
    /* ignore */
  }
  kpis.push({ id: 'policies', label: 'Policies / guardrails', value: policyOk ? 'on' : 'weak/missing', ok: policyOk });

  let budgetsSet = 0;
  let agentsN = 0;
  try {
    const agents = listAgentsForUser(owner) || [];
    agentsN = agents.length;
    const budgets = listAgentBudgets(owner) || [];
    budgetsSet = (budgets || []).filter(
      (b) => Number(b.monthly_token_budget) > 0 || Number(b.monthly_error_budget) > 0
    ).length;
  } catch {
    /* ignore */
  }
  if (budgetsSet >= 2 || (agentsN > 0 && budgetsSet >= 1)) score += 30;
  else if (budgetsSet === 1) score += 15;
  kpis.push({
    id: 'budgets',
    label: 'AI employees with budgets',
    value: budgetsSet,
    ok: budgetsSet >= 1,
  });

  // Approvals path: pending/completed approval states exist over window
  let approvalPath = 0;
  try {
    const db = getDb();
    const since = windowStartIso();
    approvalPath =
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM kanban_tasks
           WHERE owner_user_id = ?
             AND lower(COALESCE(status,'')) LIKE '%approv%'
             AND COALESCE(updated_at, created_at) >= ?`
        )
        .get(owner, since)?.n || 0;
  } catch {
    try {
      // owner_user_id may not filter - use any recent approval statuses as weak signal
      approvalPath = 0;
    } catch {
      approvalPath = 0;
    }
  }
  if (approvalPath >= 1) score += 20;
  else score += 10; // not all companies need approvals weekly
  kpis.push({
    id: 'approvals',
    label: 'Approval-path activity (14d)',
    value: approvalPath,
    ok: true,
  });

  // Retention configured
  try {
    const user = getUserById(owner);
    if (Number(user?.data_retention_days) > 0) score += 10;
  } catch {
    /* ignore */
  }

  score = clamp(score);
  const improve = [];
  if (!policyOk) {
    improve.push({ action: 'Enable CEO Policies so AI work has human gates written down', href: '/policies' });
  }
  if (budgetsSet < 1) {
    improve.push({ action: 'Set monthly token/error budgets on AI employees', href: '/efficiency' });
  }
  if (approvalPath < 1) {
    improve.push({
      action: 'Route sensitive actions through Kanban approval states when publishing externally',
      href: '/kanban',
    });
  }
  facts.governance = { policy_ok: policyOk, budgets_set: budgetsSet, approval_path_14d: approvalPath };
  return domainResult({
    id: 'governance',
    name: 'Governance & human gates',
    score,
    weight: 1,
    kpis,
    improve: improve.slice(0, 3),
  });
}

/**
 * @param {string} ownerUserId CEO owner id from authenticated context only
 * @param {{ days?: number }} [opts]
 */
export async function buildOperationalEffectiveness(ownerUserId, opts = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) {
    const err = new Error('owner_user_id required');
    err.status = 400;
    throw err;
  }
  const days = Math.min(60, Math.max(7, Number(opts.days) || WINDOW_DAYS));
  const facts = { window_days: days, timezone: getPlatformTimezone() };
  const domains = [];

  domains.push(await scoreVisionDomain(owner, facts));
  domains.push(await scoreOrgDomain(owner, facts));
  domains.push(await scoreGoalsDomain(owner, facts));
  domains.push(await scoreWorkflowsDomain(owner, facts));
  domains.push(await scoreAutonomyDomain(owner, facts));
  domains.push(await scoreCrmDomain(owner, facts));
  domains.push(await scoreGovernanceDomain(owner, facts));

  const applicable = domains.filter((d) => !d.not_applicable && d.score != null);
  const overall =
    applicable.length > 0
      ? Math.round(applicable.reduce((s, d) => s + d.score, 0) / applicable.length)
      : 0;
  const band = bandOf(overall);

  // Top improve steps from lowest domains
  const sorted = [...applicable].sort((a, b) => a.score - b.score);
  const actions = [];
  const seen = new Set();
  for (const d of sorted) {
    for (const step of d.improve || []) {
      const key = step.href + step.action;
      if (seen.has(key)) continue;
      seen.add(key);
      actions.push({ domain: d.id, domain_name: d.name, ...step });
      if (actions.length >= 5) break;
    }
    if (actions.length >= 5) break;
  }

  const verdict =
    band.band === 'green'
      ? 'Your AI company setup and operations look effective for the last 14 days.'
      : band.band === 'amber'
        ? 'Core ops exist, but gaps in automation, CRM use, or governance limit effectiveness.'
        : 'Operational effectiveness is low — strengthen vision fit, autonomous goals/workflows, and CRM connection.';

  console.info(
    '[oei] owner=%s score=%s band=%s domains=%s',
    owner,
    overall,
    band.band,
    domains.map((d) => `${d.id}:${d.score}`).join(',')
  );

  return {
    ok: true,
    version: '2026-08-09',
    owner_user_id: owner,
    window_days: days,
    score: overall,
    band: band.band,
    band_label: band.label,
    bands: { green_min: BAND_GREEN, amber_min: BAND_AMBER, red_max: BAND_AMBER - 1 },
    verdict,
    domains,
    top_actions: actions,
    facts,
    methodology: {
      summary:
        'Operational Effectiveness Index (OEI) averages equal-weight domain scores over a 14-day window. Green ≥ 75, Amber 50–74, Red 0–49.',
      scoring:
        'Each domain scores 0–100 from setup + runtime signals (no BYOK keys, no cross-tenant data). Overall score is the average of domain scores.',
      crm_rule:
        'CRM domain credits platform CRM (e.g. Twenty bound for this CEO) or an MCA/OpenConnector CRM-class app connected for this owner.',
      domains: domains.map((d) => ({ id: d.id, name: d.name })),
      not_included: [
        'Not CRM revenue as value delivered',
        'Not LLM “IQ” of models',
        'Not global platform uptime',
      ],
    },
    generated_at: new Date().toISOString(),
  };
}

/** Compact payload for Home KPI chip */
export function summarizeOeiForHome(full) {
  if (!full) return null;
  return {
    score: full.score,
    band: full.band,
    band_label: full.band_label,
    verdict: full.verdict,
    top_actions: (full.top_actions || []).slice(0, 3),
    domains: (full.domains || []).map((d) => ({
      id: d.id,
      name: d.name,
      score: d.score,
      band: d.band,
    })),
  };
}