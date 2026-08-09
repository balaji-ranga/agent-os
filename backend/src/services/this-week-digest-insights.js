/**
 * Insights & recommendations for This Week Digest.
 * Separate assessment of CRM, goals, workflows, data growth, token utilization (past week).
 * Deterministic rules first; optional LLM can plug in later.
 */
import { getDb } from '../db/schema.js';
import { getBusinessProfile } from './company-business-profile.js';
import { getTwentyStatusForOwner } from './twenty-crm.js';
import { listScheduledGoals } from './scheduled-goals.js';

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * @param {string} ownerUserId
 * @param {{ weekStart: string, weekEnd: string, prevStart: string, prevEnd: string, facts: object }} ctx
 */
export async function buildThisWeekInsights(ownerUserId, ctx = {}) {
  const owner = String(ownerUserId || '').trim();
  const insights = [];
  const facts = ctx.facts || {};
  const weekStart = ctx.weekStart;
  const weekEnd = ctx.weekEnd;

  try {
    const hours = num(facts.time_saved_hours);
    if (hours > 0) {
      const months = (hours / (40 * 4.3)).toFixed(1);
      insights.push({
        id: 'time_saved',
        kind: 'success',
        icon: 'check',
        title: 'Time saved',
        body: `You're saving ~${hours.toLocaleString()} hours this week! That's like getting ${months} extra months of work done.`,
      });
    }
  } catch {
    /* ignore */
  }

  // Workflow failures in week
  try {
    const db = getDb();
    const failed = db
      .prepare(
        `SELECT d.name AS name, COUNT(*) AS c
         FROM agent_workflow_runs r
         LEFT JOIN agent_workflow_definitions d ON d.id = r.definition_id
         WHERE r.owner_user_id = ?
           AND lower(COALESCE(r.status,'')) IN ('failed','error')
           AND date(COALESCE(r.completed_at, r.updated_at, r.started_at), 'localtime') >= ?
           AND date(COALESCE(r.completed_at, r.updated_at, r.started_at), 'localtime') <= ?
         GROUP BY COALESCE(d.name, r.definition_id)
         ORDER BY c DESC
         LIMIT 3`
      )
      .all(owner, weekStart, weekEnd);
    for (const row of failed) {
      if (num(row.c) < 1) continue;
      insights.push({
        id: `wf_fail_${row.name || 'workflow'}`,
        kind: 'warning',
        icon: 'warning',
        title: 'Workflow attention',
        body: `${row.name || 'A workflow'} has ${row.c} failure${row.c === 1 ? '' : 's'} this week. Consider adding a retry step or reviewing the data source.`,
      });
      break;
    }
  } catch (e) {
    console.warn('[this-week-insights] workflows', e?.message || e);
  }

  // Token utilization vs last week
  try {
    const tokens = num(facts.tokens_week);
    const prevTokens = num(facts.tokens_prev_week);
    if (tokens > 0 && prevTokens > 0 && tokens > prevTokens * 1.35) {
      const pct = Math.round(((tokens - prevTokens) / prevTokens) * 100);
      insights.push({
        id: 'token_spike',
        kind: 'warning',
        icon: 'warning',
        title: 'Token utilization',
        body: `Token usage is up ~${pct}% vs last week (${tokens.toLocaleString()} tokens). Review Tools→Model mappings or Efficiency budgets if this continues.`,
      });
    } else if (tokens > 50_000) {
      insights.push({
        id: 'token_high',
        kind: 'suggestion',
        icon: 'bulb',
        title: 'Token utilization',
        body: `Heavy week: ${tokens.toLocaleString()} tokens. Check Efficiency View for which AI employees drive cost.`,
      });
    }
  } catch (e) {
    console.warn('[this-week-insights] tokens', e?.message || e);
  }

  // Scheduled goals
  try {
    const goals = listScheduledGoals(owner) || [];
    const active = goals.filter((g) => String(g.status || 'active').toLowerCase() === 'active');
    const paused = goals.filter((g) => String(g.status || '').toLowerCase() === 'paused').length;
    if (goals.length === 0) {
      insights.push({
        id: 'goals_none',
        kind: 'suggestion',
        icon: 'bulb',
        title: 'Goals',
        body: 'No scheduled goals yet. Set a weekly CEO prompt so your team runs without you retyping briefs.',
      });
    } else if (paused > 0) {
      insights.push({
        id: 'goals_paused',
        kind: 'suggestion',
        icon: 'bulb',
        title: 'Goals',
        body: `${paused} scheduled goal${paused === 1 ? ' is' : 's are'} paused. Resume or clean them under Scheduled goals.`,
      });
    } else if (active.length >= 1) {
      insights.push({
        id: 'goals_ok',
        kind: 'success',
        icon: 'check',
        title: 'Goals',
        body: `${active.length} scheduled goal${active.length === 1 ? '' : 's'} active — keep cadence aligned with this week's priorities.`,
      });
    }
  } catch (e) {
    console.warn('[this-week-insights] goals', e?.message || e);
  }

  // CRM
  try {
    const business = getBusinessProfile(owner);
    const twenty = getTwentyStatusForOwner(owner);
    if (!business?.crm_enabled) {
      insights.push({
        id: 'crm_off',
        kind: 'suggestion',
        icon: 'bulb',
        title: 'CRM',
        body: 'CRM is not enabled. Turn on Twenty under Profile → Business Core to track customers next to AI work.',
      });
    } else if (!(twenty?.bound || business?.twenty?.bound)) {
      insights.push({
        id: 'crm_pending',
        kind: 'warning',
        icon: 'warning',
        title: 'CRM',
        body: 'CRM is enabled but the workspace is not bound yet. Finish Twenty setup so customer data stays fully yours on Flolah.',
      });
    } else {
      insights.push({
        id: 'crm_ok',
        kind: 'growth',
        icon: 'growth',
        title: 'CRM',
        body: 'Customer CRM is online for your company. Review pipeline items this week after AI outreach or support tasks.',
      });
    }
  } catch (e) {
    console.warn('[this-week-insights] crm', e?.message || e);
  }

  // Knowledge / data growth
  try {
    const db = getDb();
    let weekDocs = 0;
    let prevDocs = 0;
    try {
      weekDocs =
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM master_data_documents
             WHERE owner_user_id = ?
               AND date(created_at, 'localtime') >= ? AND date(created_at, 'localtime') <= ?`
          )
          .get(owner, weekStart, weekEnd)?.n || 0;
      prevDocs =
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM master_data_documents
             WHERE owner_user_id = ?
               AND date(created_at, 'localtime') >= ? AND date(created_at, 'localtime') <= ?`
          )
          .get(owner, ctx.prevStart, ctx.prevEnd)?.n || 0;
    } catch {
      weekDocs = num(facts.knowledge_docs_week);
      prevDocs = num(facts.knowledge_docs_prev);
    }
    if (weekDocs > 0 && prevDocs > 0) {
      const pct = Math.round(((weekDocs - prevDocs) / Math.max(prevDocs, 1)) * 100);
      insights.push({
        id: 'knowledge_growth',
        kind: 'growth',
        icon: 'growth',
        title: 'Knowledge Base',
        body:
          pct >= 0
            ? `Knowledge is growing! ${pct}% more documents added this week vs last week.`
            : `Fewer knowledge adds this week (${weekDocs} vs ${prevDocs}). Keep feeding RAG so AI employees stay current.`,
      });
    } else if (weekDocs > 0) {
      insights.push({
        id: 'knowledge_new',
        kind: 'growth',
        icon: 'growth',
        title: 'Knowledge Base',
        body: `${weekDocs} knowledge document${weekDocs === 1 ? '' : 's'} added this week.`,
      });
    }
  } catch (e) {
    console.warn('[this-week-insights] knowledge', e?.message || e);
  }

  // Workflows changed this week
  try {
    const published = num(facts.workflows_published_week);
    if (published >= 1) {
      insights.push({
        id: 'wf_share',
        kind: 'suggestion',
        icon: 'bulb',
        title: 'Workflows',
        body: `${published} workflow${published === 1 ? '' : 's'} changed this week. Share winners across teams to increase impact.`,
      });
    }
  } catch {
    /* ignore */
  }

  // Cap & de-dupe
  const seen = new Set();
  const out = [];
  for (const ins of insights) {
    if (seen.has(ins.id)) continue;
    seen.add(ins.id);
    out.push(ins);
    if (out.length >= 6) break;
  }
  if (!out.length) {
    out.push({
      id: 'empty',
      kind: 'suggestion',
      icon: 'bulb',
      title: 'Getting started',
      body: 'Not enough activity yet. Hire AI employees, run a workflow or Kanban task, and check back for tailored recommendations.',
    });
  }
  console.info('[this-week-insights] owner=%s count=%s', owner, out.length);
  return out;
}
