import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { formatChatTimestamp } from '../utils/formatDateTime.js';

export const GOAL_EVENT_LABELS = {
  goal_created: 'Goal created',
  plan_generated: 'Plan generated',
  step_started: 'Step started',
  step_completed: 'Step completed',
  tool_side_effect: 'Tool side effect',
  policy_decision: 'Policy decision',
  failure: 'Failure',
  re_plan: 'Re-plan',
  human_intervention: 'Human intervention',
  goal_completed: 'Goal completed',
  decision: 'Decision',
};

const SENSITIVE_KEY = /token|secret|password|authorization|api[_-]?key|cookie/i;

export function goalOriginLabel(goal) {
  if (!goal) return 'Ad-hoc';
  if (goal.scheduled_goal_id || goal.source === 'scheduled_goal') return 'Scheduled';
  if (goal.source === 'seeded_stress') return 'Example run';
  if (goal.source) return 'Ad-hoc';
  return 'Ad-hoc';
}

export function goalPlanTracePath(goalRunId) {
  const id = String(goalRunId || '').trim();
  return id ? `/goal-plans/${encodeURIComponent(id)}` : '/goal-plans';
}

function eventTone(type, payload) {
  const t = String(type || '');
  if (t === 'failure' || (t === 'policy_decision' && payload?.allow === false)) return 'danger';
  if (t === 're_plan' || t === 'human_intervention' || t === 'decision') return 'warn';
  if (t === 'goal_completed' || t === 'step_completed') return 'ok';
  return 'info';
}

function pickSafe(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (SENSITIVE_KEY.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export function summarizeGoalEvent(ev) {
  const p = pickSafe(ev?.payload || {});
  const type = String(ev?.event_type || '');
  const bits = [];
  if (type === 'goal_created') {
    if (p.kpi) bits.push(String(p.kpi));
    if (p.target != null) bits.push(`target ${p.target}`);
    if (p.budget_usd != null) bits.push(`cap $${p.budget_usd}`);
    if (Array.isArray(p.constraints) && p.constraints.length) {
      bits.push(`${p.constraints.length} constraint${p.constraints.length === 1 ? '' : 's'}`);
    }
  } else if (type === 'plan_generated') {
    if (p.plan_version != null) bits.push(`plan v${p.plan_version}`);
    const n = Array.isArray(p.steps) ? p.steps.length : null;
    if (n != null) bits.push(`${n} step${n === 1 ? '' : 's'}`);
  } else if (type === 'step_started' || type === 'step_completed') {
    if (p.label) bits.push(String(p.label));
    const obs = p.observation?.class || p.observation?.reason;
    if (obs) bits.push(String(obs));
    if (p.kpi && (p.kpi.current != null || p.kpi.target != null)) {
      bits.push(`KPI ${p.kpi.current ?? 0}${p.kpi.target != null ? ` / ${p.kpi.target}` : ''}`);
    }
  } else if (type === 'tool_side_effect') {
    if (p.tool) bits.push(String(p.tool));
    if (p.object_id) bits.push(`id ${String(p.object_id).slice(0, 24)}`);
    if (p.replay) bits.push('replay (no extra write)');
  } else if (type === 'policy_decision') {
    bits.push(p.allow === false ? 'blocked' : 'allowed');
    if (p.family || p.action_family) bits.push(String(p.family || p.action_family));
    if (p.tool) bits.push(String(p.tool));
    if (p.error) bits.push(String(p.error).slice(0, 120));
  } else if (type === 're_plan') {
    if (p.from != null || p.to != null) bits.push(`v${p.from ?? '?'} → v${p.to ?? '?'}`);
    if (p.rationale || p.reason) bits.push(String(p.rationale || p.reason).slice(0, 160));
  } else if (type === 'failure') {
    if (p.reason || p.message || p.error) bits.push(String(p.reason || p.message || p.error).slice(0, 160));
    if (p.fallback) bits.push('fallback');
  } else if (type === 'decision') {
    if (p.action) bits.push(String(p.action));
    if (p.reason) bits.push(String(p.reason).slice(0, 140));
  } else if (type === 'human_intervention') {
    if (p.kind || p.action) bits.push(String(p.kind || p.action));
    if (p.summary || p.reason) bits.push(String(p.summary || p.reason).slice(0, 160));
  } else if (type === 'goal_completed') {
    if (p.kpi) bits.push(String(p.kpi));
    if (p.current_value != null || p.target != null) {
      bits.push(`${p.current_value ?? 0}${p.target != null ? ` / ${p.target}` : ''}`);
    }
    const cost = p.retrospective?.cost_usd;
    if (cost != null) bits.push(`spend $${cost}`);
    if (p.retrospective?.kpi_achieved) bits.push('KPI met');
    else if (p.shortfall) bits.push('shortfall recorded');
  }
  return bits.filter(Boolean).join(' · ');
}

function toneColor(tone) {
  if (tone === 'ok') return 'var(--success, #16a34a)';
  if (tone === 'warn') return 'var(--warning, #d97706)';
  if (tone === 'danger') return 'var(--danger, #dc2626)';
  return 'var(--accent, #2563eb)';
}

/**
 * Owner-scoped execution telemetry + plan version history for a goal run.
 */
export default function GoalPlanTelemetry({
  goalRunId = null,
  goal = null,
  events: eventsProp = null,
  pollMs = 0,
  compact = false,
  defaultOpen = true,
}) {
  const [events, setEvents] = useState(Array.isArray(eventsProp) ? eventsProp : null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(defaultOpen);
  const [filter, setFilter] = useState('all');
  const id = goalRunId || goal?.id;

  useEffect(() => {
    if (Array.isArray(eventsProp)) setEvents(eventsProp);
  }, [eventsProp]);

  useEffect(() => {
    if (!id || Array.isArray(eventsProp)) return undefined;
    let cancelled = false;
    const load = () => {
      api
        .agentGoalRunsEvents(id)
        .then((data) => {
          if (!cancelled) {
            setEvents(data.events || []);
            setErr(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setErr(e.message || String(e));
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
  }, [id, eventsProp, pollMs]);

  const history = Array.isArray(goal?.plan_history) ? goal.plan_history : [];
  const list = Array.isArray(events) ? events : [];
  const types = useMemo(() => {
    const seen = new Set();
    for (const e of list) {
      if (e?.event_type) seen.add(e.event_type);
    }
    return [...seen];
  }, [list]);
  const shown = filter === 'all' ? list : list.filter((e) => e.event_type === filter);

  if (!id) return null;

  return (
    <div className="goal-tel">
      {!compact && history.length ? (
        <section className="goal-tel-section" aria-label="Plan versions">
          <h3 className="goal-tel-h">Plan versions</h3>
          <ol className="goal-tel-versions">
            {history.map((h, i) => (
              <li key={`${h.version || i}-${h.at || i}`}>
                <strong>v{h.version ?? i + 1}</strong>
                {h.at ? (
                  <>
                    {' · '}
                    <time dateTime={String(h.at)}>{formatChatTimestamp(h.at)}</time>
                  </>
                ) : null}
                {h.rationale ? <div className="goal-tel-muted">{String(h.rationale)}</div> : null}
                {Array.isArray(h.step_labels) && h.step_labels.length ? (
                  <div className="goal-tel-muted">{h.step_labels.join(' → ')}</div>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="goal-tel-section" aria-label="Execution telemetry">
        <button
          type="button"
          className="goal-tel-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          Execution telemetry
          <span className="goal-tel-muted">
            {list.length ? ` (${list.length})` : events == null && !err ? ' …' : ' (none yet)'}
          </span>
        </button>
        {open ? (
          <>
            {err ? (
              <p className="goal-tel-muted" style={{ color: 'var(--danger, #dc2626)' }} role="alert">
                {err}
              </p>
            ) : null}
            {types.length > 1 ? (
              <div className="goal-tel-filters">
                <button
                  type="button"
                  className={filter === 'all' ? 'goal-tel-chip on' : 'goal-tel-chip'}
                  onClick={() => setFilter('all')}
                >
                  All
                </button>
                {types.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={filter === t ? 'goal-tel-chip on' : 'goal-tel-chip'}
                    onClick={() => setFilter(t)}
                  >
                    {GOAL_EVENT_LABELS[t] || t}
                  </button>
                ))}
              </div>
            ) : null}
            {!list.length && !err ? (
              <p className="goal-tel-muted">
                Events appear as the COO and specialists execute this plan (created, plan, steps, policy,
                re-plan, completion).
              </p>
            ) : (
              <ol className="goal-tel-timeline">
                {shown.map((ev) => {
                  const tone = eventTone(ev.event_type, ev.payload);
                  const summary = summarizeGoalEvent(ev);
                  return (
                    <li key={ev.id || `${ev.event_type}-${ev.created_at}`}>
                      <span className="goal-tel-dot" style={{ background: toneColor(tone) }} aria-hidden />
                      <div>
                        <div className="goal-tel-row">
                          <strong>{GOAL_EVENT_LABELS[ev.event_type] || ev.event_type}</strong>
                          {ev.created_at ? (
                            <time dateTime={String(ev.created_at)} className="goal-tel-muted">
                              {formatChatTimestamp(ev.created_at)}
                            </time>
                          ) : null}
                        </div>
                        {summary ? <div className="goal-tel-summary">{summary}</div> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
