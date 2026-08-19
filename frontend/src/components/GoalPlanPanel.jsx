import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatChatTimestamp } from '../utils/formatDateTime.js';
import { goalOriginLabel, goalPlanTracePath } from './GoalPlanTelemetry';

function statusColor(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'var(--success, #16a34a)';
  if (s === 'running' || s === 'in_progress') return 'var(--accent, #2563eb)';
  if (s === 'failed') return 'var(--danger, #dc2626)';
  return 'var(--muted)';
}

/** Compact goal plan ladder for chat + scheduled goals. */
export default function GoalPlanPanel({
  goalRunId = null,
  goal: goalProp = null,
  compact = false,
  pollMs = 0,
  showTraceLink = true,
}) {
  const [goal, setGoal] = useState(goalProp);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(!goalProp && !!goalRunId);

  useEffect(() => {
    if (goalProp) {
      setGoal(goalProp);
      setLoading(false);
    }
  }, [goalProp]);

  useEffect(() => {
    if (!goalRunId || goalProp) return undefined;
    let cancelled = false;
    const load = () => {
      api
        .agentGoalRunsGet(goalRunId)
        .then((data) => {
          if (!cancelled) {
            setGoal(data.goal || data);
            setErr(null);
            setLoading(false);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setErr(e.message || String(e));
            setLoading(false);
          }
        });
    };
    load();
    if (!pollMs) return () => {
      cancelled = true;
    };
    const t = setInterval(load, pollMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [goalRunId, goalProp, pollMs]);

  if (loading) {
    return <p className="digest-muted" style={{ fontSize: '0.8rem' }}>Loading goal plan…</p>;
  }
  if (err) {
    return <p className="digest-muted" style={{ fontSize: '0.8rem', color: 'var(--danger, #dc2626)' }}>{err}</p>;
  }
  if (!goal) return null;

  const progress = goal.progress || {};
  const steps = goal.steps || [];
  const pct = progress.progress_pct != null ? progress.progress_pct : 0;
  const title = goal.title || String(goal.prompt || '').slice(0, 72) || goal.id;

  return (
    <div
      className="goal-plan-panel"
      style={{
        marginTop: compact ? '0.35rem' : '0.55rem',
        padding: '0.65rem 0.75rem',
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--surface, rgba(0,0,0,0.03))',
        maxWidth: compact ? '100%' : 'min(560px, 96vw)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.02em' }}>
            GOAL PLAN
          </div>
          <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>{title}</div>
          {goal.outcome ? (
            <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: 2 }}>
              {goal.outcome.kpi || 'outcome'}
              {goal.outcome.target != null
                ? `: ${goal.outcome.current_value ?? 0} / ${goal.outcome.target}`
                : ''}
              {goal.outcome.spend_usd != null ? ` · spend $${goal.outcome.spend_usd}` : ''}
              {goal.outcome.budget_usd != null ? ` · cap $${goal.outcome.budget_usd}` : ''}
              {goal.outcome.plan_version ? ` · plan v${goal.outcome.plan_version}` : ''}
              {goal.outcome.retrospective
                ? ` · ${goal.outcome.retrospective.kpi_achieved ? 'KPI met' : 'shortfall recorded'}`
                : ''}
            </div>
          ) : null}
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
            <code style={{ fontSize: '0.7rem' }}>{goal.id}</code>
            {' · '}
            {goalOriginLabel(goal)}
            {' · '}
            <span style={{ color: statusColor(goal.status) }}>{goal.status}</span>
            {` · ${pct}%`}
            {goal.created_at ? (
              <>
                {' · '}
                <time dateTime={String(goal.created_at)} title="Goal run started">
                  {formatChatTimestamp(goal.created_at)}
                </time>
              </>
            ) : null}
            {goal.completed_at ? (
              <>
                {' · done '}
                <time dateTime={String(goal.completed_at)} title="Goal run completed">
                  {formatChatTimestamp(goal.completed_at)}
                </time>
              </>
            ) : null}
            {showTraceLink && goal.id ? (
              <>
                {' · '}
                <Link to={goalPlanTracePath(goal.id)} title="Steps, plan versions, and telemetry">
                  Execution trace
                </Link>
              </>
            ) : null}
          </div>
        </div>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 999,
          background: 'var(--border)',
          overflow: 'hidden',
          marginBottom: 8,
        }}
        aria-hidden
      >
        <div
          style={{
            width: `${Math.min(100, Math.max(0, pct))}%`,
            height: '100%',
            background: statusColor(goal.status === 'failed' ? 'failed' : goal.status === 'completed' ? 'completed' : 'running'),
          }}
        />
      </div>
      <ol style={{ margin: 0, paddingLeft: '1.15rem', fontSize: '0.8rem' }}>
        {steps.map((s) => (
          <li key={s.id || s.step_index} style={{ marginBottom: 4 }}>
            <span style={{ color: statusColor(s.status), fontWeight: 600 }}>{s.status || 'pending'}</span>
            {' · '}
            <span>{s.label || s.step_type}</span>
            {s.child_workflow_run_id ? (
              <>
                {' · '}
                <Link to={`/workflows/runs/${s.child_workflow_run_id}`}>WF #{s.child_workflow_run_id}</Link>
              </>
            ) : null}
            {s.step_type === 'specialty_task' || s.child_delegation_task_id ? (
              <span style={{ color: 'var(--muted)' }}>
                {' · '}
                specialty
                {s.child_delegation_task_id ? ` · task #${s.child_delegation_task_id}` : ''}
                {s.spec?.agent_id ? ` → ${s.spec.agent_id}` : ''}
              </span>
            ) : null}
            {s.step_type === 'agent_tool' || s.step_type === 'notify_ceo' ? (
              <span style={{ color: 'var(--muted)' }}>
                {' · '}
                {s.step_type === 'notify_ceo' ? 'notify' : 'tool'}
                {s.spec?.tool_name ? ` · ${s.spec.tool_name}` : ''}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Extract agr-* ids from free text and tool payloads. */
export function collectGoalRunIds({ text = '', toolCalls = [] } = {}) {
  const found = new Set();
  const re = /\bagr-[a-f0-9]{8,}\b/gi;
  const scan = (v) => {
    if (v == null) return;
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    let m;
    while ((m = re.exec(s))) found.add(m[0]);
  };
  scan(text);
  for (const tc of toolCalls || []) {
    const name = String(tc.tool_name || '');
    if (!name.startsWith('agent_goal_')) continue;
    scan(tc.request);
    scan(tc.response);
  }
  // Prefer full create response id first via parse of agent_goal_create response
  return [...found];
}