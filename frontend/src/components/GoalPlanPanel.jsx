import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatChatTimestamp } from '../utils/formatDateTime.js';
import { goalOriginLabel, goalPlanTracePath } from './GoalPlanTelemetry';

function statusColor(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'var(--success, #16a34a)';
  if (s === 'partial_success') return 'var(--warning, #d97706)';
  if (s === 'awaiting_plan_review') return 'var(--warning, #d97706)';
  if (s === 'planning' || s === 'running' || s === 'in_progress') return 'var(--accent, #2563eb)';
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
  const [reviewGuidance, setReviewGuidance] = useState('');
  const [reviewBusy, setReviewBusy] = useState('');
  const [reviewMessage, setReviewMessage] = useState('');
  const [draftJson, setDraftJson] = useState('');

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
  const review = goal.plan_review || goal.context?.plan_review || null;

  async function planReview(action, extra = {}) {
    setReviewBusy(action);
    setReviewMessage('');
    try {
      const result = action === 'cancel'
        ? await api.agentGoalRunsCancel(goal.id, { reason: 'Cancelled during plan review' })
        : await api.agentGoalRunsPlanReview(goal.id, { action, ...extra });
      setGoal(result.goal || goal);
      setReviewMessage(action === 'cancel' ? 'Goal cancelled.' : action === 'approve' ? 'Plan approved; execution is starting.' : 'Guidance accepted; maker/checker replanning has started.');
    } catch (error) {
      setReviewMessage(error?.message || 'Could not update the plan review');
    } finally {
      setReviewBusy('');
    }
  }

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
            background: statusColor(goal.status === 'failed' ? 'failed' : goal.status === 'completed' ? 'completed' : goal.status === 'partial_success' ? 'partial_success' : 'running'),
          }}
        />
      </div>
      {goal.status === 'planning' ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginBottom: 8,
            padding: '0.5rem 0.6rem',
            borderRadius: 7,
            background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
            color: 'var(--muted)',
            fontSize: '0.76rem',
          }}
        >
          Maker/checker planning is in progress. Each round validates outcome coverage, dependencies, and executor fit before execution starts.
        </div>
      ) : null}
      {goal.status === 'awaiting_plan_review' && review ? (
        <section
          aria-label="Plan review required"
          style={{ marginBottom: 10, padding: '0.7rem', border: '1px solid color-mix(in srgb, var(--warning, #d97706) 55%, var(--border))', borderRadius: 8, background: 'color-mix(in srgb, var(--warning, #d97706) 8%, var(--surface))' }}
        >
          <strong style={{ display: 'block', marginBottom: 4 }}>Planning needs your guidance</strong>
          <p style={{ margin: '0 0 7px', fontSize: '0.76rem', color: 'var(--muted)' }}>
            No business step ran. Review the maker proposal and checker findings, then correct, approve, retry, or cancel this same goal.
          </p>
          {(review.validation_errors || []).length ? (
            <ul style={{ margin: '0 0 8px', paddingLeft: '1.1rem', fontSize: '0.76rem' }}>
              {review.validation_errors.slice(0, compact ? 4 : 10).map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}
            </ul>
          ) : null}
          {(review.candidate_steps || []).length ? (
            <details style={{ marginBottom: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.77rem', fontWeight: 650 }}>Maker proposal ({review.candidate_steps.length} steps)</summary>
              <ol style={{ margin: '6px 0 0', paddingLeft: '1.1rem', fontSize: '0.75rem' }}>
                {review.candidate_steps.map((step) => (
                  <li key={step.key}>{step.label || step.key} · {step.type} · {step.spec?.agent_id || step.spec?.workflow_id || step.spec?.tool_name || 'COO'}</li>
                ))}
              </ol>
            </details>
          ) : null}
          <textarea
            value={reviewGuidance}
            onChange={(event) => setReviewGuidance(event.target.value)}
            rows={compact ? 2 : 3}
            placeholder="Tell the planner what to correct…"
            style={{ width: '100%', resize: 'vertical', marginBottom: 7 }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn" disabled={!!reviewBusy} onClick={() => planReview('apply_checker')}>
              {reviewBusy === 'apply_checker' ? 'Applying…' : 'Apply checker recommendations'}
            </button>
            <button type="button" className="btn secondary" disabled={!!reviewBusy || !reviewGuidance.trim()} onClick={() => planReview('revise', { guidance: reviewGuidance.trim() })}>
              {reviewBusy === 'revise' ? 'Replanning…' : 'Correct with my guidance'}
            </button>
            {review.candidate_schema_valid ? (
              <button type="button" className="btn secondary" disabled={!!reviewBusy} onClick={() => planReview('approve')}>
                {reviewBusy === 'approve' ? 'Approving…' : 'Approve valid proposal'}
              </button>
            ) : null}
            <button type="button" className="btn danger" disabled={!!reviewBusy} onClick={() => planReview('cancel')}>Cancel goal</button>
            {compact ? <Link className="btn secondary" to={goalPlanTracePath(goal.id)}>Edit detailed plan</Link> : null}
          </div>
          {!compact ? (
            <details style={{ marginTop: 8 }} onToggle={(event) => {
              if (event.currentTarget.open && !draftJson) setDraftJson(JSON.stringify(review.candidate_steps || [], null, 2));
            }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.77rem', fontWeight: 650 }}>Advanced step editor</summary>
              <p style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Edit the typed proposal. Approval remains blocked until deterministic schema, dependency, catalog and safety validation passes.</p>
              <textarea value={draftJson} onChange={(event) => setDraftJson(event.target.value)} rows={14} spellCheck={false} style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.72rem' }} />
              <button type="button" className="btn secondary" disabled={!!reviewBusy || !draftJson.trim()} onClick={() => {
                try { planReview('approve', { steps: JSON.parse(draftJson) }); }
                catch { setReviewMessage('The edited plan must be valid JSON.'); }
              }}>Validate and approve edited plan</button>
            </details>
          ) : null}
          {reviewMessage ? <p role="status" style={{ margin: '7px 0 0', fontSize: '0.75rem' }}>{reviewMessage}</p> : null}
        </section>
      ) : null}
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
      {goal.final_outcome ? (
        <details
          open={!compact}
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: '1px solid var(--border)',
            fontSize: '0.8rem',
          }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
            {goal.status === 'failed' ? 'Final outcome and blocker' : 'Final outcome'}
          </summary>
          <div
            style={{
              marginTop: 8,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              color: 'var(--text)',
              lineHeight: 1.45,
            }}
          >
            {goal.final_outcome}
          </div>
        </details>
      ) : null}
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
