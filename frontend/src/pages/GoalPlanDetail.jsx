import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import GoalPlanPanel from '../components/GoalPlanPanel';
import GoalPlanTelemetry, { goalOriginLabel } from '../components/GoalPlanTelemetry';
import { formatChatTimestamp } from '../utils/formatDateTime.js';

function statusColor(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'var(--success, #16a34a)';
  if (s === 'running' || s === 'in_progress' || s === 'pending') return 'var(--accent, #2563eb)';
  if (s === 'failed') return 'var(--danger, #dc2626)';
  return 'var(--muted)';
}

/**
 * Full execution view for one ad-hoc or scheduled goal run: outcome, steps, plan versions, telemetry.
 */
export default function GoalPlanDetail() {
  const { goalRunId } = useParams();
  const [goal, setGoal] = useState(null);
  const [events, setEvents] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  useEffect(() => {
    const id = String(goalRunId || '').trim();
    if (!id) {
      setLoading(false);
      setErr('Missing goal plan id');
      return undefined;
    }
    let cancelled = false;
    let timer = null;
    const load = () => {
      Promise.all([
        api.agentGoalRunsGet(id),
        api.agentGoalRunsEvents(id).catch(() => ({ events: [] })),
      ])
        .then(([gRes, eRes]) => {
          if (cancelled) return;
          const g = gRes.goal || gRes;
          setGoal(g);
          setEvents(eRes.events || []);
          setErr('');
          const st = String(g?.status || '').toLowerCase();
          const stillLive = ['planning', 'running', 'pending', 'in_progress', 'awaiting_approval'].includes(st);
          if (!stillLive && timer) {
            clearInterval(timer);
            timer = null;
          }
        })
        .catch((e) => {
          if (!cancelled) setErr(e?.message || 'Failed to load goal plan');
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    setLoading(true);
    load();
    timer = setInterval(load, 8000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [goalRunId]);

  const outcome = goal?.outcome || {};
  const retro = outcome.retrospective || goal?.retrospective || null;
  const status = String(goal?.status || '').toLowerCase();
  const canCancel = ['planning', 'pending', 'running', 'in_progress', 'awaiting_approval'].includes(status);
  const canRetry = !!goal && status !== 'completed';

  async function cancelRun() {
    if (!goal || !window.confirm('Cancel this goal execution? Pending work and its Live Operations activity will be closed.')) return;
    setActionBusy('cancel');
    setActionMessage('');
    try {
      const result = await api.agentGoalRunsCancel(goal.id, { reason: 'Cancelled by CEO from Goal plans' });
      setGoal(result.goal || goal);
      setActionMessage('Goal execution cancelled.');
    } catch (error) {
      setActionMessage(error?.message || 'Could not cancel goal execution');
    } finally {
      setActionBusy('');
    }
  }

  async function retryRun() {
    if (!goal) return;
    const active = ['planning', 'pending', 'running', 'in_progress', 'awaiting_approval'].includes(status);
    if (active && !window.confirm('Retry this active goal? Its current abandoned work will be superseded; completed predecessor outputs are retained.')) return;
    setActionBusy('retry');
    setActionMessage('');
    try {
      const result = await api.agentGoalRunsRetry(goal.id, { reason: 'Retried by CEO from Goal plans' });
      setGoal(result.goal || goal);
      setActionMessage('Retry queued. This page will update as planning or execution advances.');
    } catch (error) {
      setActionMessage(error?.message || 'Could not retry goal execution');
    } finally {
      setActionBusy('');
    }
  }

  return (
    <div className="digest-page">
      <header className="digest-header">
        <div>
          <h1 className="digest-title">Goal execution</h1>
          <p className="digest-sub">
            How this ad-hoc or scheduled goal ran: steps, plan version, and telemetry. Owner-scoped — another
            company cannot see this run.
          </p>
        </div>
        <div className="digest-header-tools">
          {canRetry ? (
            <button type="button" className="btn secondary" disabled={!!actionBusy} onClick={retryRun}>
              {actionBusy === 'retry' ? 'Retrying…' : 'Retry execution'}
            </button>
          ) : null}
          {canCancel ? (
            <button type="button" className="btn danger" disabled={!!actionBusy} onClick={cancelRun}>
              {actionBusy === 'cancel' ? 'Cancelling…' : 'Cancel execution'}
            </button>
          ) : null}
          <Link className="btn secondary" to="/goal-plans">
            ← All goal plans
          </Link>
          <Link className="btn secondary" to="/scheduled-goals">
            Scheduled goals
          </Link>
        </div>
      </header>

      {err ? (
        <p className="digest-muted" style={{ color: 'var(--danger, #c44)' }} role="alert">
          {err}
        </p>
      ) : null}
      {loading ? <p className="digest-muted">Loading…</p> : null}
      {actionMessage ? <p className="digest-muted" role="status">{actionMessage}</p> : null}
      {!loading && !err && !goal ? <p className="digest-muted">Goal plan not found.</p> : null}

      {goal ? (
        <div className="goal-exec">
          <div className="goal-exec-meta">
            <span className="goal-tel-chip on">{goalOriginLabel(goal)}</span>
            <span style={{ color: statusColor(goal.status), fontWeight: 600 }}>{goal.status}</span>
            {goal.agent_id ? <span className="goal-tel-muted">{goal.agent_id}</span> : null}
            {goal.created_at ? (
              <time dateTime={String(goal.created_at)} className="goal-tel-muted">
                started {formatChatTimestamp(goal.created_at)}
              </time>
            ) : null}
            {goal.completed_at ? (
              <time dateTime={String(goal.completed_at)} className="goal-tel-muted">
                done {formatChatTimestamp(goal.completed_at)}
              </time>
            ) : null}
          </div>

          <dl className="goal-exec-kpis">
            <div>
              <dt>KPI</dt>
              <dd>
                {outcome.kpi || '—'}
                {outcome.target != null
                  ? `: ${outcome.current_value ?? 0} / ${outcome.target}`
                  : outcome.current_value != null
                    ? `: ${outcome.current_value}`
                    : ''}
              </dd>
            </div>
            <div>
              <dt>Spend</dt>
              <dd>
                {outcome.spend_usd != null ? `$${outcome.spend_usd}` : '—'}
                {outcome.budget_usd != null ? ` / cap $${outcome.budget_usd}` : ''}
              </dd>
            </div>
            <div>
              <dt>Plan version</dt>
              <dd>v{outcome.plan_version || 1}</dd>
            </div>
            <div>
              <dt>Quality</dt>
              <dd>
                rejected {outcome.rejected_count ?? 0}
                {' · '}
                unknown {outcome.unknown_count ?? 0}
              </dd>
            </div>
          </dl>

          {Array.isArray(outcome.constraints) && outcome.constraints.length ? (
            <p className="goal-tel-muted" style={{ marginTop: 0 }}>
              Constraints: {outcome.constraints.join('; ')}
            </p>
          ) : null}

          {retro ? (
            <p className="digest-muted" style={{ marginTop: 0 }}>
              Retrospective:{' '}
              {retro.summary || (retro.kpi_achieved ? 'KPI met' : 'Shortfall recorded')}
              {retro.cost_usd != null ? ` · spend $${retro.cost_usd}` : ''}
              {retro.evidence_count != null ? ` · ${retro.evidence_count} evidence` : ''}
            </p>
          ) : null}

          {goal.scheduled_goal_id ? (
            <p className="digest-muted">
              From a <Link to="/scheduled-goals">scheduled goal</Link>
              {' · '}
              each fire is a new run (this id does not reuse yesterday’s plan).
            </p>
          ) : (
            <p className="digest-muted">Ad-hoc run (COO chat / tool), not a recurring schedule.</p>
          )}

          <GoalPlanPanel goal={goal} showTraceLink={false} />
          <GoalPlanTelemetry
            goalRunId={goal.id}
            goal={goal}
            events={events}
            defaultOpen
          />
        </div>
      ) : null}
    </div>
  );
}
