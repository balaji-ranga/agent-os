import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 1 month' },
  { value: '90', label: 'Last 3 months' },
  { value: 'all', label: 'All' },
];

function formatUsd(n) {
  const v = Number(n) || 0;
  if (v === 0) return '$0.00';
  if (Math.abs(v) < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function formatCompact(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

function formatDayLabel(iso, granularity = 'day') {
  if (!iso) return '';
  const parts = String(iso).slice(0, 10).split('-');
  if (parts.length !== 3) return String(iso).slice(5);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(parts[1]) - 1] || parts[1];
  if (granularity === 'month') return month;
  const day = Number(parts[2]);
  return `${day} ${month}`;
}

function rangeLabel(range) {
  const opt = RANGE_OPTIONS.find((o) => o.value === String(range));
  return opt?.label || 'Selected range';
}

function InfoTip({ text }) {
  return (
    <span className="ai-snip-info" title={text} aria-label={text}>
      i
    </span>
  );
}

function formatStorageBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Clickable "i" that loads GET /efficiency/storage and shows a breakdown modal.
 */
function StorageBreakdownInfo({ summaryBreakdown, totalMb }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [payload, setPayload] = useState(null);

  const openModal = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const res = await api.efficiencyStorage();
      setPayload(res);
    } catch (e) {
      // Fall back to breakdown folded into org summary if detail call fails
      if (summaryBreakdown?.components?.length) {
        setPayload({
          total_mb: totalMb,
          total_bytes: null,
          components: summaryBreakdown.components,
          notes: summaryBreakdown.notes || [],
          as_of: summaryBreakdown.as_of,
        });
        setError(null);
      } else {
        setError(e.message || String(e));
        setPayload(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const components = payload?.components || [];
  const notes = payload?.notes || [];
  const shownTotal =
    payload?.total_mb != null
      ? Number(payload.total_mb)
      : totalMb != null
        ? Number(totalMb)
        : null;

  return (
    <>
      <button
        type="button"
        className="ai-snip-info ai-snip-info-btn"
        title="Show storage breakdown"
        aria-label="Show storage breakdown"
        onClick={openModal}
      >
        i
      </button>
      {open ? (
        <div
          className="ai-snip-storage-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="ai-snip-storage-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-snip-storage-title"
          >
            <header className="ai-snip-storage-modal-head">
              <h2 id="ai-snip-storage-title">Storage breakdown</h2>
              <button
                type="button"
                className="ai-snip-storage-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <p className="ai-snip-storage-lead">
              Estimated footprint for your tenant only (not other CEOs). Includes Master Data
              source files and OpenSearch RAG indices when available.
            </p>
            {loading && <p className="ai-snip-note">Loading breakdown…</p>}
            {error && <p className="ai-snip-error">{error}</p>}
            {!loading && shownTotal != null && (
              <p className="ai-snip-storage-total">
                <strong>{shownTotal.toFixed(2)} MB</strong>
                {payload?.total_bytes != null ? (
                  <span className="ai-snip-storage-total-bytes">
                    {' '}
                    ({formatStorageBytes(payload.total_bytes)})
                  </span>
                ) : null}
              </p>
            )}
            {!loading && components.length > 0 && (
              <div className="ai-snip-storage-table-wrap">
                <table className="ai-snip-storage-table">
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th>Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {components.map((row) => (
                      <tr
                        key={row.key}
                        className={
                          Number(row.bytes) > 0 ? undefined : 'ai-snip-storage-row-empty'
                        }
                      >
                        <td>{row.label}</td>
                        <td>
                          {formatStorageBytes(row.bytes)}
                          {row.mb != null && Number(row.bytes) >= 1024 * 1024
                            ? ` (${Number(row.mb).toFixed(3)} MB)`
                            : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && notes.length > 0 && (
              <ul className="ai-snip-storage-notes">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            {payload?.as_of && (
              <p className="ai-snip-note">As of {payload.as_of}</p>
            )}
            <div className="ai-snip-storage-actions">
              <button type="button" className="btn secondary" onClick={openModal} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button type="button" className="btn secondary" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MultiSeriesChart({ timeline, series, granularity = 'day' }) {
  const rows = Array.isArray(timeline) && timeline.length ? timeline : [];
  const width = 720;
  const height = 260;
  const padL = 40;
  const padR = 16;
  const padT = 16;
  const padB = 44;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const allValues = series.flatMap((s) => rows.map((d) => Number(d[s.key]) || 0));
  const maxVal = Math.max(1, ...allValues, 0);
  const yMax = Math.max(4, Math.ceil(maxVal / 4) * 4);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => Math.round(yMax * p));

  const pointsFor = (key) =>
    rows.map((d, i) => {
      const n = rows.length || 1;
      const x = padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
      const v = Number(d[key]) || 0;
      const y = padT + plotH - (v / yMax) * plotH;
      return { x, y, v, date: d.date };
    });

  const pathFor = (pts) =>
    pts.length > 1
      ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
      : '';

  const labelStep = Math.max(1, Math.ceil(rows.length / 8));

  return (
    <div className="ai-snip-chart-wrap">
      <svg
        className="ai-snip-chart"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="260"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Efficiency timeline"
      >
        {ticks.map((t) => {
          const y = padT + plotH - (t / yMax) * plotH;
          return (
            <g key={`y-${t}`}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="var(--border)" strokeWidth="1" />
              <text x={padL - 8} y={y + 4} textAnchor="end" fill="var(--muted)" fontSize="11">
                {t}
              </text>
            </g>
          );
        })}
        <line
          x1={padL}
          y1={padT + plotH}
          x2={width - padR}
          y2={padT + plotH}
          stroke="var(--border)"
          strokeWidth="1.25"
        />
        {series.map((s) => {
          const pts = pointsFor(s.key);
          const path = pathFor(pts);
          return (
            <g key={s.key}>
              {path ? (
                <path
                  d={path}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
              {pts.map((p) => (
                <circle
                  key={`${s.key}-${p.date}`}
                  cx={p.x}
                  cy={p.y}
                  r={p.v > 0 ? 3.25 : 2}
                  fill={s.color}
                />
              ))}
            </g>
          );
        })}
        {rows.map((d, i) => {
          if (i % labelStep !== 0 && i !== rows.length - 1) return null;
          const n = rows.length || 1;
          const x = padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
          return (
            <g key={`x-${d.date}`}>
              <line
                x1={x}
                y1={padT + plotH}
                x2={x}
                y2={padT + plotH + 5}
                stroke="var(--muted)"
                strokeWidth="1"
              />
              <text x={x} y={height - 14} textAnchor="middle" fill="var(--muted)" fontSize="11">
                {formatDayLabel(d.date, granularity)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="eff-legend">
        {series.map((s) => (
          <span key={s.key} className="eff-legend-item">
            <span className="eff-legend-swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const CHART_TABS = [
  {
    id: 'tasks',
    label: 'Tasks',
    series: [
      { key: 'tasks_created', label: 'Automated', color: 'var(--accent)' },
      { key: 'tasks_completed', label: 'Successful', color: '#22c55e' },
      { key: 'tasks_failed', label: 'Failed', color: '#ef4444' },
    ],
  },
  {
    id: 'feedback',
    label: 'Feedback',
    series: [
      { key: 'feedback_score', label: 'Net score (↑−↓ cumulative)', color: 'var(--accent)' },
      { key: 'feedback_up', label: 'Thumbs up', color: '#22c55e' },
      { key: 'feedback_down', label: 'Thumbs down', color: '#ef4444' },
    ],
  },
  {
    id: 'workflows',
    label: 'Workflow runs',
    series: [
      { key: 'workflow_runs', label: 'Runs', color: 'var(--accent)' },
      { key: 'workflow_completed', label: 'Successful', color: '#22c55e' },
      { key: 'workflow_failed', label: 'Failed', color: '#ef4444' },
    ],
  },
];

const AGENT_CHART_TABS = [
  {
    id: 'activity',
    label: 'Activity',
    series: [
      { key: 'prompts', label: 'Prompts', color: 'var(--accent)' },
      { key: 'tool_calls', label: 'Tool calls', color: '#38bdf8' },
    ],
  },
  {
    id: 'outcomes',
    label: 'Outcomes',
    series: [
      { key: 'tasks_completed', label: 'Successful', color: '#22c55e' },
      { key: 'tasks_failed', label: 'Failed', color: '#ef4444' },
    ],
  },
  {
    id: 'budget',
    label: 'Token budget',
    series: [
      { key: 'tokens_cumulative', label: 'Tokens used (cumulative)', color: 'var(--accent)' },
      { key: 'budget_line', label: 'Monthly budget', color: '#f59e0b' },
    ],
  },
  {
    id: 'reliability',
    label: 'Reliability',
    series: [
      { key: 'failure_rate', label: 'Failure rate %', color: '#ef4444' },
      { key: 'error_budget_line', label: 'Error budget %', color: '#f59e0b' },
    ],
  },
];

const BUDGET_STATE_COLOR = { ok: '#22c55e', warn: '#f59e0b', blocked: '#ef4444' };

function BudgetGauge({ label, used, limit, unit = '', tip }) {
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null;
  const color = pct == null ? 'var(--muted)' : pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#22c55e';
  return (
    <div className="eff-gauge">
      <div className="eff-gauge-head">
        <span>
          {label} {tip ? <InfoTip text={tip} /> : null}
        </span>
        <span style={{ color }}>{pct == null ? 'No budget set' : `${pct}%`}</span>
      </div>
      <div className="eff-gauge-track">
        <div className="eff-gauge-fill" style={{ width: `${pct ?? 0}%`, background: color }} />
      </div>
      <div className="eff-gauge-foot">
        {formatCompact(used)}
        {unit} {limit ? `of ${formatCompact(limit)}${unit}` : '(unlimited)'}
      </div>
    </div>
  );
}

function AgentView({ range, rangeLabelText }) {
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState('');
  const [data, setData] = useState(null);
  const [chartTab, setChartTab] = useState('activity');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editBudget, setEditBudget] = useState(false);
  const [tokenBudget, setTokenBudget] = useState('');
  const [errorBudget, setErrorBudget] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .efficiencyAgents()
      .then((res) => {
        if (cancelled) return;
        const list = res?.members || [];
        setMembers(list);
        setSelected((cur) => cur || list[0]?.member_key || '');
      })
      .catch((e) => !cancelled && setError(e.message || 'Failed to load agents'));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .efficiencyAgent(selected, range)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setTokenBudget(
          res?.budget?.monthly_token_budget == null ? '' : String(res.budget.monthly_token_budget)
        );
        setErrorBudget(res?.budget?.error_budget_pct == null ? '' : String(res.budget.error_budget_pct));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || 'Failed to load agent metrics');
        setData(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selected, range]);

  const member = members.find((m) => m.member_key === selected) || null;
  const budget = data?.budget || null;
  const totals = data?.totals || {};
  // Leaf members (ext: / a2a:) have no chat session here, so prompts / tools / feedback are N/A.
  const isLeaf =
    data?.kind === 'leaf' ||
    member?.kind === 'external' ||
    member?.kind === 'a2a_publish';
  const leafNaTip =
    'n/a for external agents — prompts, tool calls, and feedback come from chat sessions, which external / A2A leaf members do not have. Use tasks, latency, and tokens instead.';

  const timeline = useMemo(() => {
    const rows = data?.timeline || [];
    const tokenLimit = budget?.monthly_token_budget || 0;
    const errLimit = budget?.error_budget_pct || 0;
    return rows.map((r) => ({ ...r, budget_line: tokenLimit, error_budget_line: errLimit }));
  }, [data?.timeline, budget?.monthly_token_budget, budget?.error_budget_pct]);

  const activeChart = AGENT_CHART_TABS.find((t) => t.id === chartTab) || AGENT_CHART_TABS[0];

  const saveBudget = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await api.efficiencyAgentBudgetSet(selected, {
        monthly_token_budget: tokenBudget || null,
        error_budget_pct: errorBudget || null,
      });
      const refreshed = await api.efficiencyAgent(selected, range);
      setData(refreshed);
      setEditBudget(false);
      const list = await api.efficiencyAgents();
      setMembers(list?.members || []);
    } catch (e) {
      setError(e.message || 'Failed to save budget');
    } finally {
      setSaving(false);
    }
  };

  const reloadAgent = async () => {
    if (!selected) return;
    const [refreshed, list] = await Promise.all([
      api.efficiencyAgent(selected, range),
      api.efficiencyAgents(),
    ]);
    setData(refreshed);
    setMembers(list?.members || []);
  };

  const resetSelectedUsage = async () => {
    if (!selected || !member) return;
    const ok = window.confirm(
      `Reset month-to-date token usage for ${member.name} to 0?\n\nConfigured budgets stay the same; only the used counter is cleared for ${budget?.period || 'this month'}.`
    );
    if (!ok) return;
    setResetting(true);
    setError(null);
    try {
      await api.efficiencyUsageReset(selected);
      await reloadAgent();
    } catch (e) {
      setError(e.message || 'Failed to reset usage');
    } finally {
      setResetting(false);
    }
  };

  const resetAllUsage = async () => {
    const ok = window.confirm(
      `Reset month-to-date token usage to 0 for ALL agents (and external / A2A leaf members)?\n\nConfigured budgets stay the same; only used counters for this month are cleared.`
    );
    if (!ok) return;
    setResetting(true);
    setError(null);
    try {
      await api.efficiencyUsageReset(null);
      await reloadAgent();
    } catch (e) {
      setError(e.message || 'Failed to reset all usage');
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <section className="ai-snip-card">
        <div className="ai-snip-card-head">
          <h2>Agent</h2>
          <div className="ai-snip-range-static">{rangeLabelText}</div>
        </div>
        <div className="eff-agent-controls">
          <select
            className="ai-snip-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            aria-label="Agent"
          >
            {!members.length && <option value="">No agents</option>}
            {members.map((m) => (
              <option key={m.member_key} value={m.member_key}>
                {m.name}
                {m.department ? ` · ${m.department}` : ''}
                {m.kind === 'external' || m.kind === 'a2a_publish' ? ' (external)' : ''}
              </option>
            ))}
          </select>
          {member && (
            <span
              className="eff-badge"
              style={{ borderColor: BUDGET_STATE_COLOR[member.budget_state] || 'var(--border)' }}
            >
              {member.budget_state === 'blocked'
                ? 'Blocked — over budget'
                : member.budget_state === 'warn'
                  ? 'Warning — near budget'
                  : 'Within budget'}
            </span>
          )}
          <button type="button" className="ai-snip-pill" onClick={() => setEditBudget((v) => !v)}>
            {editBudget ? 'Close budget' : 'Edit budget'}
          </button>
          <button
            type="button"
            className="ai-snip-pill"
            onClick={resetSelectedUsage}
            disabled={!selected || resetting}
            title="Clear this agent's month-to-date token usage (used → 0)"
          >
            {resetting ? 'Resetting…' : 'Reset usage'}
          </button>
          <button
            type="button"
            className="ai-snip-pill"
            onClick={resetAllUsage}
            disabled={resetting}
            title="Clear month-to-date token usage for every agent"
          >
            Reset all usage
          </button>
        </div>

        {budget?.reasons?.length ? (
          <p className="ai-snip-note" style={{ color: BUDGET_STATE_COLOR[budget.state] }}>
            {budget.reasons.join(' · ')}
          </p>
        ) : null}

        {editBudget && (
          <div className="eff-budget-form">
            <label>
              Monthly token budget
              <input
                type="number"
                min="0"
                value={tokenBudget}
                onChange={(e) => setTokenBudget(e.target.value)}
                placeholder="blank = unlimited"
              />
            </label>
            <label>
              Error budget (max failure %)
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={errorBudget}
                onChange={(e) => setErrorBudget(e.target.value)}
                placeholder="e.g. 5"
              />
            </label>
            <button type="button" onClick={saveBudget} disabled={saving} className="ai-snip-pill active">
              {saving ? 'Saving…' : 'Save budget'}
            </button>
            <span className="ai-snip-note">
              Applies to {budget?.period || 'this month'} and carries forward to later months.
            </span>
          </div>
        )}

        <div className="eff-metrics">
          <div className="ai-snip-metric">
            <div className={`ai-snip-metric-value${isLeaf ? ' eff-na' : ''}`}>
              {isLeaf ? 'n/a' : formatCompact(totals.prompts || 0)}
            </div>
            <div className="ai-snip-metric-label">
              Prompts{' '}
              <InfoTip
                text={
                  isLeaf
                    ? leafNaTip
                    : 'Messages sent to this agent in the selected range'
                }
              />
            </div>
          </div>
          <div className="ai-snip-metric">
            <div className={`ai-snip-metric-value${isLeaf ? ' eff-na' : ''}`}>
              {isLeaf ? 'n/a' : formatCompact(totals.tool_calls || 0)}
            </div>
            <div className="ai-snip-metric-label">
              Tool calls{' '}
              <InfoTip
                text={
                  isLeaf
                    ? leafNaTip
                    : `${totals.tool_errors || 0} failed tool calls in this range`
                }
              />
            </div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value eff-split">
              <span className="eff-ok">{formatCompact(totals.tasks_completed || 0)}</span>
              <span className="eff-sep">/</span>
              <span className="eff-bad">{formatCompact(totals.tasks_failed || 0)}</span>
            </div>
            <div className="ai-snip-metric-label">Tasks ok / failed</div>
          </div>
          <div className="ai-snip-metric">
            <div className={`ai-snip-metric-value${isLeaf ? ' eff-na' : ''}`}>
              {isLeaf
                ? 'n/a'
                : totals.feedback_positive_pct != null
                  ? `${totals.feedback_positive_pct}%`
                  : '—'}
            </div>
            <div className="ai-snip-metric-label">
              Feedback positive{' '}
              <InfoTip
                text={
                  isLeaf
                    ? leafNaTip
                    : `${totals.feedback_up || 0} up / ${totals.feedback_down || 0} down`
                }
              />
            </div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">
              {totals.avg_latency_ms == null ? '—' : `${Math.round(totals.avg_latency_ms / 1000)}s`}
            </div>
            <div className="ai-snip-metric-label">
              Avg delegation latency{' '}
              <InfoTip text={`${totals.latency_samples || 0} completed delegations sampled`} />
            </div>
          </div>
        </div>

        <div className="eff-gauges">
          <BudgetGauge
            label="Tokens this month"
            used={budget?.tokens_used || 0}
            limit={budget?.monthly_token_budget || 0}
            tip={`${budget?.token_calls || 0} metered calls in ${budget?.period || 'this month'}. Estimated tokens: ${formatCompact(budget?.tokens_estimated || 0)}.`}
          />
          <BudgetGauge
            label="Failure rate this month"
            used={budget?.failure_rate || 0}
            limit={budget?.error_budget_pct || 0}
            unit="%"
            tip={`${budget?.failed || 0} failed of ${budget?.terminal_calls || 0} terminal calls. Blocking only applies from ${budget?.min_terminal_calls_for_error_block || 10} calls.`}
          />
        </div>
      </section>

      {error && <div className="ai-snip-error">{error}</div>}
      {loading && !data && <div className="ai-snip-loading">Loading…</div>}

      <section className="ai-snip-card">
        <div className="ai-snip-card-head">
          <div className="ai-snip-pills" role="tablist" aria-label="Agent chart metric">
            {AGENT_CHART_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={chartTab === tab.id}
                className={`ai-snip-pill${chartTab === tab.id ? ' active' : ''}`}
                onClick={() => setChartTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="ai-snip-range-static">{rangeLabelText}</div>
        </div>
        {!loading && timeline.length === 0 ? (
          <p className="ai-snip-note">No activity for this agent in the selected range.</p>
        ) : (
          <MultiSeriesChart timeline={timeline} series={activeChart.series} />
        )}
      </section>

      {data?.tokens_by_source?.length ? (
        <section className="ai-snip-card">
          <div className="ai-snip-card-head">
            <h2>Tokens by source</h2>
          </div>
          <div className="eff-tool-list">
            {data.tokens_by_source.map((s) => (
              <div key={s.source} className="eff-tool-row">
                <span>{s.source}</span>
                <span>
                  {formatCompact(s.tokens)} tokens
                  <span className="ai-snip-note"> · {s.calls || 0} calls</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {data?.top_tools?.length ? (
        <section className="ai-snip-card">
          <div className="ai-snip-card-head">
            <h2>Top tools</h2>
          </div>
          <div className="eff-tool-list">
            {data.top_tools.map((t) => (
              <div key={t.tool_name} className="eff-tool-row">
                <span>{t.tool_name}</span>
                <span>
                  <span className="eff-ok">{t.ok} ok</span>
                  {t.error ? <span className="eff-bad"> · {t.error} error</span> : null}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function DepartmentView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .efficiencyDepartments()
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setSelected((cur) => {
          if (cur && (res?.departments || []).some((d) => d.name === cur)) return cur;
          return res?.departments?.[0]?.name || '';
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || 'Failed to load department metrics');
        setData(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const departments = data?.departments || [];
  const totals = data?.totals || {};
  const dept = departments.find((d) => d.name === selected) || null;

  return (
    <>
      <section className="ai-snip-card">
        <div className="ai-snip-card-head">
          <h2>Departments</h2>
          <div className="ai-snip-range-static">{data?.period || 'This month'}</div>
        </div>
        <p className="ai-snip-note">
          Month-to-date tokens used by AI employees, plus Kanban task performance for people in each department.
        </p>

        <div className="eff-metrics">
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">{formatCompact(totals.departments || 0)}</div>
            <div className="ai-snip-metric-label">Departments</div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">{formatCompact(totals.people || 0)}</div>
            <div className="ai-snip-metric-label">People</div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">{formatCompact(totals.tokens_used || 0)}</div>
            <div className="ai-snip-metric-label">Tokens used (all depts)</div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">
              {totals.monthly_token_budget ? formatCompact(totals.monthly_token_budget) : '—'}
            </div>
            <div className="ai-snip-metric-label">
              Budget sum{' '}
              <InfoTip text="Sum of department monthly_token_budget values that are set" />
            </div>
          </div>
        </div>
      </section>

      {error && <div className="ai-snip-error">{error}</div>}
      {loading && !data && <div className="ai-snip-loading">Loading…</div>}

      <section className="ai-snip-card">
        <div className="ai-snip-card-head">
          <h2>Department</h2>
        </div>
        <div className="eff-agent-controls">
          <select
            className="ai-snip-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            aria-label="Department"
          >
            {!departments.length && <option value="">No departments</option>}
            {departments.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
                {d.member_count ? ` · ${d.member_count} member${d.member_count === 1 ? '' : 's'}` : ''}
              </option>
            ))}
          </select>
          {dept && (
            <span
              className="eff-badge"
              style={{ borderColor: BUDGET_STATE_COLOR[dept.state] || 'var(--border)' }}
            >
              {dept.state === 'blocked'
                ? 'Over department budget'
                : dept.state === 'warn'
                  ? 'Near department budget'
                  : dept.monthly_token_budget
                    ? 'Within department budget'
                    : 'No department budget'}
            </span>
          )}
        </div>

        {dept?.purpose ? <p className="ai-snip-note">{dept.purpose}</p> : null}

        {dept && (
          <div className="eff-gauges">
            <BudgetGauge
              label="Department tokens this month"
              used={dept.tokens_used || 0}
              limit={dept.monthly_token_budget || 0}
              tip={`${dept.token_calls || 0} metered calls across ${dept.member_count || 0} AI employee(s) in ${data?.period || 'this month'}. Set the department budget in Master Data → departments or Org designer.`}
            />
          </div>
        )}

        {dept?.tasks ? (
          <div className="ai-snip-metrics" style={{ marginTop: '0.75rem' }}>
            <div className="ai-snip-metric">
              <div className="ai-snip-metric-value">{formatCompact(dept.tasks.assigned || 0)}</div>
              <div className="ai-snip-metric-label">Tasks assigned</div>
            </div>
            <div className="ai-snip-metric">
              <div className="ai-snip-metric-value">{formatCompact(dept.tasks.completed || 0)}</div>
              <div className="ai-snip-metric-label">Completed</div>
            </div>
            <div className="ai-snip-metric">
              <div className="ai-snip-metric-value">{formatCompact(dept.tasks.failed || 0)}</div>
              <div className="ai-snip-metric-label">Failed</div>
            </div>
            <div className="ai-snip-metric">
              <div className="ai-snip-metric-value">
                {dept.tasks.completion_pct != null ? `${dept.tasks.completion_pct}%` : '—'}
              </div>
              <div className="ai-snip-metric-label">Completion</div>
            </div>
          </div>
        ) : null}

        {dept?.members?.length ? (
          <div className="eff-tool-list" style={{ marginTop: '1rem' }}>
            <div className="ai-snip-note">AI employees</div>
            {dept.members.map((m) => (
              <div key={m.member_key} className="eff-tool-row">
                <span>
                  {m.name}
                  <span className="ai-snip-note" style={{ marginLeft: 8 }}>
                    {m.kind}
                  </span>
                </span>
                <span>
                  <span style={{ color: BUDGET_STATE_COLOR[m.budget_state] || 'inherit' }}>
                    {formatCompact(m.tokens_used || 0)}
                  </span>
                  {m.monthly_token_budget != null
                    ? ` / ${formatCompact(m.monthly_token_budget)}`
                    : ' (no agent budget)'}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {dept?.people?.length ? (
          <div className="eff-tool-list" style={{ marginTop: '1rem' }}>
            <div className="ai-snip-note">People</div>
            {dept.people.map((p) => (
              <div key={p.user_id} className="eff-tool-row">
                <span>{p.name}</span>
                <span>
                  {p.tasks_completed || 0} done / {p.tasks_failed || 0} failed
                  {p.completion_pct != null ? ` · ${p.completion_pct}%` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {dept && !dept.members?.length && !dept.people?.length ? (
          <p className="ai-snip-note">No AI employees or people in this department yet.</p>
        ) : null}
      </section>

      {!loading && departments.length > 0 && (
        <section className="ai-snip-card">
          <div className="ai-snip-card-head">
            <h2>All departments</h2>
          </div>
          <div className="eff-tool-list">
            {departments.map((d) => (
              <button
                key={d.name}
                type="button"
                className="eff-tool-row"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  cursor: 'pointer',
                  background: d.name === selected ? 'var(--surface-2, transparent)' : 'transparent',
                  border: 'none',
                  padding: '0.5rem 0',
                }}
                onClick={() => setSelected(d.name)}
              >
                <span>
                  {d.name}
                  <span className="ai-snip-note" style={{ marginLeft: 8 }}>
                    {d.member_count} AI · {d.people_count || 0} people
                  </span>
                </span>
                <span style={{ color: BUDGET_STATE_COLOR[d.state] || 'inherit' }}>
                  {formatCompact(d.tokens_used || 0)}
                  {d.monthly_token_budget != null
                    ? ` / ${formatCompact(d.monthly_token_budget)}`
                    : ' / —'}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function UserView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .efficiencyUsers()
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setSelected((cur) => {
          if (cur && (res?.users || []).some((u) => u.user_id === cur)) return cur;
          return res?.users?.[0]?.user_id || '';
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || 'Failed to load people metrics');
        setData(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    api
      .efficiencyUser(selected)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (loading) {
    return (
      <p className="ai-snip-note" style={{ padding: '1.5rem' }}>
        Loading people metrics…
      </p>
    );
  }
  if (error) {
    return (
      <p className="ai-snip-error" style={{ padding: '1.5rem' }}>
        {error}
      </p>
    );
  }

  const users = data?.users || [];
  const totals = data?.totals || {};
  const person = users.find((u) => u.user_id === selected) || null;

  return (
    <>
      <p className="ai-snip-note" style={{ marginBottom: '1rem' }}>
        Kanban task performance for people in your company (this month). AI employees stay on Agent View.
      </p>
      <div className="ai-snip-metrics">
        <div className="ai-snip-metric">
          <div className="ai-snip-metric-value">{formatCompact(totals.people || 0)}</div>
          <div className="ai-snip-metric-label">People</div>
        </div>
        <div className="ai-snip-metric">
          <div className="ai-snip-metric-value">{formatCompact(totals.assigned || 0)}</div>
          <div className="ai-snip-metric-label">Tasks assigned</div>
        </div>
        <div className="ai-snip-metric">
          <div className="ai-snip-metric-value">{formatCompact(totals.completed || 0)}</div>
          <div className="ai-snip-metric-label">Completed</div>
        </div>
        <div className="ai-snip-metric">
          <div className="ai-snip-metric-value">
            {totals.completion_pct != null ? `${totals.completion_pct}%` : '—'}
          </div>
          <div className="ai-snip-metric-label">Completion</div>
        </div>
      </div>
      <div className="eff-split">
        <section className="card">
          <h2 className="ai-snip-h2" style={{ marginTop: 0 }}>
            {person?.name || 'Person'}
          </h2>
          {person ? (
            <>
              <p className="ai-snip-note">
                {person.department || 'No department'}
                {person.role_title ? ` · ${person.role_title}` : ''}
              </p>
              <div className="ai-snip-metrics">
                <div className="ai-snip-metric">
                  <div className="ai-snip-metric-value">{formatCompact(person.assigned || 0)}</div>
                  <div className="ai-snip-metric-label">Assigned</div>
                </div>
                <div className="ai-snip-metric">
                  <div className="ai-snip-metric-value">{formatCompact(person.completed || 0)}</div>
                  <div className="ai-snip-metric-label">Done</div>
                </div>
                <div className="ai-snip-metric">
                  <div className="ai-snip-metric-value">{formatCompact(person.failed || 0)}</div>
                  <div className="ai-snip-metric-label">Failed</div>
                </div>
                <div className="ai-snip-metric">
                  <div className="ai-snip-metric-value">
                    {person.completion_pct != null ? `${person.completion_pct}%` : '—'}
                  </div>
                  <div className="ai-snip-metric-label">Rate</div>
                </div>
              </div>
              {detailLoading ? (
                <p className="ai-snip-note">Loading recent tasks…</p>
              ) : detail?.recent_tasks?.length ? (
                <div className="eff-tool-list" style={{ marginTop: '1rem' }}>
                  {detail.recent_tasks.map((t) => (
                    <div key={t.id} className="eff-tool-row">
                      <span>{t.title}</span>
                      <span className="ai-snip-note">{t.status}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ai-snip-note">No Kanban tasks assigned this month.</p>
              )}
            </>
          ) : (
            <p className="ai-snip-note">Invite people from My Org → People to see task performance here.</p>
          )}
        </section>
        <section className="card">
          <h2 className="ai-snip-h2" style={{ marginTop: 0 }}>
            All people
          </h2>
          {users.length ? (
            <div className="eff-tool-list">
              {users.map((u) => (
                <button
                  key={u.user_id}
                  type="button"
                  className="eff-tool-row"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    cursor: 'pointer',
                    background: u.user_id === selected ? 'var(--surface-2, transparent)' : 'transparent',
                    border: 'none',
                    padding: '0.5rem 0',
                  }}
                  onClick={() => setSelected(u.user_id)}
                >
                  <span>
                    {u.name}
                    <span className="ai-snip-note" style={{ marginLeft: 8 }}>
                      {u.department || '—'}
                    </span>
                  </span>
                  <span>
                    {u.completed || 0}/{u.assigned || 0}
                    {u.completion_pct != null ? ` · ${u.completion_pct}%` : ''}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="ai-snip-note">No people yet.</p>
          )}
        </section>
      </div>
    </>
  );
}

function LlmopsView({ range, rangeLabelText }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bookRows, setBookRows] = useState([]);
  const [savingBook, setSavingBook] = useState(false);
  const [manualAmount, setManualAmount] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [savingManual, setSavingManual] = useState(false);

  const reload = () =>
    api.efficiencyLlmops(range).then((res) => {
      setData(res);
      const ceoRows = (res?.price_book?.rows || []).filter((r) => r.scope === 'ceo');
      setBookRows(
        ceoRows.length
          ? ceoRows.map((r) => ({
              model_id: r.model_id,
              input_usd_per_1m: r.input_usd_per_1m,
              output_usd_per_1m: r.output_usd_per_1m,
            }))
          : [{ model_id: '*', input_usd_per_1m: 1, output_usd_per_1m: 3 }]
      );
      return res;
    });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    reload()
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || 'Failed to load LLMOps');
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const tokens = data?.tokens || {};
  const cost = data?.cost || {};
  const quality = data?.quality || {};
  const platformBook = (data?.price_book?.rows || []).filter((r) => r.scope === 'platform');

  const saveBook = async () => {
    setSavingBook(true);
    setError(null);
    try {
      await api.efficiencyPriceBookSave(bookRows.filter((r) => String(r.model_id || '').trim()));
      await reload();
    } catch (e) {
      setError(e.message || 'Failed to save price book');
    } finally {
      setSavingBook(false);
    }
  };

  const addManual = async () => {
    setSavingManual(true);
    setError(null);
    try {
      await api.efficiencyCostLineAdd({
        amount_usd: Number(manualAmount),
        note: manualNote,
      });
      setManualAmount('');
      setManualNote('');
      await reload();
    } catch (e) {
      setError(e.message || 'Failed to add cost line');
    } finally {
      setSavingManual(false);
    }
  };

  const removeManual = async (id) => {
    setError(null);
    try {
      await api.efficiencyCostLineDelete(id);
      await reload();
    } catch (e) {
      setError(e.message || 'Failed to delete cost line');
    }
  };

  return (
    <>
      {error && <div className="ai-snip-error">{error}</div>}
      {loading && !data && <div className="ai-snip-loading">Loading…</div>}

      <section className="ai-snip-card">
        <div className="ai-snip-card-head">
          <h2>Summary</h2>
          <div className="ai-snip-range-static">{rangeLabelText}</div>
        </div>
        <p className="ai-snip-note">
          {cost.disclaimer ||
            'Estimated LLM $ uses your price book. Not a provider invoice. Digest Est. Value and Home OEI are separate.'}
        </p>
        <div className="eff-metrics">
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">{formatCompact(tokens.total_tokens)}</div>
            <div className="ai-snip-metric-label">
              Tokens{' '}
              <InfoTip
                text={`${formatCompact(tokens.estimated_tokens)} estimated (chars/4 when the provider did not return usage). ${tokens.calls || 0} metered calls.`}
              />
            </div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">{formatUsd(cost.llm_estimated_usd)}</div>
            <div className="ai-snip-metric-label">
              Estimated LLM $ <InfoTip text={`Payer: ${cost.payer || 'unknown'} (BYOK vs platform).`} />
            </div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">{formatUsd(cost.manual_usd)}</div>
            <div className="ai-snip-metric-label">Outside costs (this month)</div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">
              {quality.feedback?.positive_pct != null ? `${quality.feedback.positive_pct}%` : '—'}
            </div>
            <div className="ai-snip-metric-label">
              Feedback positive{' '}
              <InfoTip
                text={`${quality.feedback?.up || 0} up / ${quality.feedback?.down || 0} down. Goals completed ${quality.goals?.completed || 0}, failed ${quality.goals?.failed || 0}. Policy decisions ${quality.policy_decisions || 0}.`}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="eff-llmops-grid">
        <section className="ai-snip-card">
          <div className="ai-snip-card-head">
            <h2>By source</h2>
          </div>
          {(data?.by_source || []).length ? (
            <div className="eff-tool-list">
              {data.by_source.map((s) => (
                <div key={s.source} className="eff-tool-row">
                  <span>{s.source}</span>
                  <span>
                    {formatCompact(s.tokens)}
                    <span className="ai-snip-note"> · {s.calls || 0}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="ai-snip-note">No metered LLM calls in this range yet.</p>
          )}
        </section>
        <section className="ai-snip-card">
          <div className="ai-snip-card-head">
            <h2>By model</h2>
          </div>
          {(data?.by_model || []).length ? (
            <div className="eff-tool-list">
              {data.by_model.map((s) => (
                <div key={s.model_id} className="eff-tool-row">
                  <span>{s.model_id}</span>
                  <span>
                    {formatCompact(s.tokens)}
                    <span className="ai-snip-note"> · {s.calls || 0}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="ai-snip-note">No model split yet.</p>
          )}
        </section>
      </div>

      <section className="ai-snip-card">
        <div className="ai-snip-card-head">
          <h2>Traces</h2>
        </div>
        <p className="ai-snip-note">
          Correlation ids across chat, tools, goal plans, and workflows. Open a goal or workflow run to see the
          execution audit.
        </p>
        {(data?.traces || []).length ? (
          <table className="eff-table">
            <thead>
              <tr>
                <th>Trace</th>
                <th>Last</th>
                <th>Tokens</th>
                <th>Sources</th>
              </tr>
            </thead>
            <tbody>
              {data.traces.map((t) => (
                <tr key={t.trace_id}>
                  <td>
                    {t.href ? (
                      <a href={t.href}>{t.trace_id}</a>
                    ) : (
                      <code>{t.trace_id}</code>
                    )}
                  </td>
                  <td>{String(t.last_at || '').replace('T', ' ').slice(0, 19)}</td>
                  <td>{formatCompact(t.tokens)}</td>
                  <td>{(t.sources || []).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="ai-snip-note">No traces in this range. Chat, tools, and goal plans write a trace id when they run.</p>
        )}
      </section>

      <section className="ai-snip-card">
        <div className="ai-snip-card-head">
          <h2>Price book (USD per 1M tokens)</h2>
          <button type="button" className="ai-snip-btn" onClick={saveBook} disabled={savingBook}>
            {savingBook ? 'Saving…' : 'Save my rates'}
          </button>
        </div>
        <p className="ai-snip-note">
          Your rows override the platform estimate catalog. Empty the table and save to use platform defaults only.
        </p>
        <table className="eff-table">
          <thead>
            <tr>
              <th>Model id</th>
              <th>Input / 1M</th>
              <th>Output / 1M</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bookRows.map((row, idx) => (
              <tr key={`${row.model_id}-${idx}`}>
                <td>
                  <input
                    className="ai-snip-input"
                    value={row.model_id}
                    onChange={(e) => {
                      const next = [...bookRows];
                      next[idx] = { ...next[idx], model_id: e.target.value };
                      setBookRows(next);
                    }}
                    aria-label="Model id"
                  />
                </td>
                <td>
                  <input
                    className="ai-snip-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.input_usd_per_1m}
                    onChange={(e) => {
                      const next = [...bookRows];
                      next[idx] = { ...next[idx], input_usd_per_1m: e.target.value };
                      setBookRows(next);
                    }}
                    aria-label="Input USD per 1M"
                  />
                </td>
                <td>
                  <input
                    className="ai-snip-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.output_usd_per_1m}
                    onChange={(e) => {
                      const next = [...bookRows];
                      next[idx] = { ...next[idx], output_usd_per_1m: e.target.value };
                      setBookRows(next);
                    }}
                    aria-label="Output USD per 1M"
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="ai-snip-btn-ghost"
                    onClick={() => setBookRows(bookRows.filter((_, i) => i !== idx))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className="ai-snip-btn-ghost"
          onClick={() =>
            setBookRows([...bookRows, { model_id: '', input_usd_per_1m: 1, output_usd_per_1m: 3 }])
          }
        >
          Add model rate
        </button>
        {platformBook.length ? (
          <p className="ai-snip-note" style={{ marginTop: '0.75rem' }}>
            Platform catalog (read-only):{' '}
            {platformBook
              .slice(0, 8)
              .map((r) => `${r.model_id} ${r.input_usd_per_1m}/${r.output_usd_per_1m}`)
              .join(' · ')}
          </p>
        ) : null}
      </section>

      <section className="ai-snip-card">
        <div className="ai-snip-card-head">
          <h2>Outside costs this month</h2>
        </div>
        <p className="ai-snip-note">
          Manual lines for ads, contractors, or other opex. Not posted to ERP automatically.
        </p>
        <div className="eff-manual-row">
          <input
            className="ai-snip-input"
            type="number"
            step="0.01"
            placeholder="Amount USD"
            value={manualAmount}
            onChange={(e) => setManualAmount(e.target.value)}
            aria-label="Manual amount USD"
          />
          <input
            className="ai-snip-input"
            placeholder="Note"
            value={manualNote}
            onChange={(e) => setManualNote(e.target.value)}
            aria-label="Manual cost note"
          />
          <button type="button" className="ai-snip-btn" onClick={addManual} disabled={savingManual}>
            {savingManual ? 'Adding…' : 'Add'}
          </button>
        </div>
        {(cost.manuals || []).length ? (
          <div className="eff-tool-list" style={{ marginTop: '0.75rem' }}>
            {cost.manuals.map((m) => (
              <div key={m.id} className="eff-tool-row">
                <span>
                  {formatUsd(m.amount_usd)}
                  {m.note ? <span className="ai-snip-note"> · {m.note}</span> : null}
                </span>
                <button type="button" className="ai-snip-btn-ghost" onClick={() => removeManual(m.id)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="ai-snip-note">No outside cost lines this month.</p>
        )}
      </section>

      <p className="ai-snip-note">
        Product monitoring is this tab, Agent View, Goal execution trace, and workflow run audit. Gateway recovery
        and cron pause live under <strong>Admin</strong> — they are not mixed into this CEO view.
      </p>
    </>
  );
}

export default function EfficiencyView() {
  const [view, setView] = useState(() => {
    if (typeof window === 'undefined') return 'org';
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'agent') return 'agent';
    if (tab === 'department' || tab === 'dept') return 'department';
    if (tab === 'user' || tab === 'people') return 'user';
    if (tab === 'llmops' || tab === 'monitoring') return 'llmops';
    return 'org';
  });
  const [range, setRange] = useState('14');
  const [chartTab, setChartTab] = useState('tasks');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (view !== 'org') return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .efficiencySummary(range)
      .then((res) => {
        if (cancelled) return;
        if (!res?.totals) {
          throw new Error('Efficiency summary returned no totals');
        }
        setData(res);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || 'Failed to load efficiency metrics');
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, view]);

  const totals = data?.totals || {
    agents: 0,
    tasks_automated: 0,
    tasks_completed: 0,
    tasks_failed: 0,
    feedback_up: 0,
    feedback_down: 0,
    feedback_total: 0,
    feedback_positive_pct: null,
    feedback_net: 0,
    workflows: 0,
    workflows_published: 0,
    workflow_runs: 0,
    workflow_runs_completed: 0,
    workflow_runs_failed: 0,
  };
  const timeline = data?.timeline || [];
  const granularity = data?.timeline_granularity || 'day';
  const activeChart = CHART_TABS.find((t) => t.id === chartTab) || CHART_TABS[0];
  const label = useMemo(() => rangeLabel(data?.range || range), [data?.range, range]);

  const taskSuccessRate =
    totals.tasks_completed + totals.tasks_failed > 0
      ? Math.round((totals.tasks_completed / (totals.tasks_completed + totals.tasks_failed)) * 100)
      : null;
  const runSuccessRate =
    totals.workflow_runs_completed + totals.workflow_runs_failed > 0
      ? Math.round(
          (totals.workflow_runs_completed /
            (totals.workflow_runs_completed + totals.workflow_runs_failed)) *
            100
        )
      : null;

  const subtitle =
    view === 'agent'
      ? 'Per-agent activity, outcomes, and monthly token / error budgets.'
      : view === 'department'
        ? 'Department monthly token budget vs tokens used by AI employees, plus people task performance.'
        : view === 'user'
          ? 'Kanban task performance for people in your company (this month).'
          : view === 'llmops'
            ? 'Token meters, estimated LLM cost, traces, and quality — not provider invoices.'
          : 'Agents, automated tasks, feedback quality, and AI workflow run outcomes.';

  return (
    <div className="ai-snip-page eff-page">
      <header className="ai-snip-page-head eff-page-head">
        <div>
          <h1>Efficiency View</h1>
          <p className="ai-snip-sub">{subtitle}</p>
          <div className="ai-snip-pills" role="tablist" aria-label="Efficiency view">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'org'}
              className={`ai-snip-pill${view === 'org' ? ' active' : ''}`}
              onClick={() => setView('org')}
            >
              Org
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'department'}
              className={`ai-snip-pill${view === 'department' ? ' active' : ''}`}
              onClick={() => setView('department')}
            >
              Department
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'agent'}
              className={`ai-snip-pill${view === 'agent' ? ' active' : ''}`}
              onClick={() => setView('agent')}
            >
              Agent View
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'user'}
              className={`ai-snip-pill${view === 'user' ? ' active' : ''}`}
              onClick={() => setView('user')}
            >
              User View
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'llmops'}
              className={`ai-snip-pill${view === 'llmops' ? ' active' : ''}`}
              onClick={() => setView('llmops')}
            >
              LLMOps
            </button>
          </div>
        </div>
        {view === 'org' || view === 'agent' || view === 'llmops' ? (
          <select
            className="ai-snip-select eff-range-select"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            aria-label="Time range"
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="ai-snip-range-static">This calendar month</div>
        )}
      </header>

      {view === 'agent' && <AgentView range={range} rangeLabelText={label} />}
      {view === 'department' && <DepartmentView />}
      {view === 'user' && <UserView />}
      {view === 'llmops' && <LlmopsView range={range} rangeLabelText={label} />}

      {view === 'org' && (
        <>
      {error && (
        <div className="ai-snip-error">
          {error}
          {/not found|404/i.test(error) ? ' — restart the backend to load /api/efficiency.' : ''}
        </div>
      )}
      {loading && !data && <div className="ai-snip-loading">Loading…</div>}

      <section className="ai-snip-card">
        <div className="ai-snip-card-head">
          <h2>Summary</h2>
          <div className="ai-snip-range-static">{label}</div>
        </div>

        <div className="eff-metrics">
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">{formatCompact(totals.agents)}</div>
            <div className="ai-snip-metric-label">
              Agents <InfoTip text="Enabled agents on your account" />
            </div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">{formatCompact(totals.tasks_automated)}</div>
            <div className="ai-snip-metric-label">
              Tasks automated{' '}
              <InfoTip text="Kanban tasks assigned to an agent in this period" />
            </div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value eff-split">
              <span className="eff-ok">{formatCompact(totals.tasks_completed)}</span>
              <span className="eff-sep">/</span>
              <span className="eff-bad">{formatCompact(totals.tasks_failed)}</span>
            </div>
            <div className="ai-snip-metric-label">
              Tasks ok / failed
              {taskSuccessRate != null ? ` (${taskSuccessRate}%)` : ''}
            </div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">
              {totals.feedback_positive_pct != null ? `${totals.feedback_positive_pct}%` : '—'}
            </div>
            <div className="ai-snip-metric-label">
              Feedback positive{' '}
              <InfoTip
                text={`${totals.feedback_up} up / ${totals.feedback_down} down (net ${totals.feedback_net >= 0 ? '+' : ''}${totals.feedback_net})`}
              />
            </div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">{formatCompact(totals.workflows)}</div>
            <div className="ai-snip-metric-label">
              AI workflows{' '}
              <InfoTip text={`${totals.workflows_published} published of ${totals.workflows} total`} />
            </div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">{formatCompact(totals.workflow_runs_completed)}</div>
            <div className="ai-snip-metric-label">Successful runs</div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">{formatCompact(totals.workflow_runs_failed)}</div>
            <div className="ai-snip-metric-label">
              Failed runs
              {runSuccessRate != null ? ` (${100 - runSuccessRate}% fail)` : ''}
            </div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">{formatCompact(totals.workflow_runs)}</div>
            <div className="ai-snip-metric-label">Total workflow runs</div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">
              {totals.storage_mb != null ? Number(totals.storage_mb).toFixed(1) : '—'}
            </div>
            <div className="ai-snip-metric-label">
              Storage (MB){' '}
              <StorageBreakdownInfo
                summaryBreakdown={totals.storage_breakdown}
                totalMb={totals.storage_mb}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="ai-snip-card">
        <div className="ai-snip-card-head">
          <div className="ai-snip-pills" role="tablist" aria-label="Chart metric">
            {CHART_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={chartTab === tab.id}
                className={`ai-snip-pill${chartTab === tab.id ? ' active' : ''}`}
                onClick={() => setChartTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="ai-snip-range-static">{label}</div>
        </div>
        {!loading && timeline.length === 0 ? (
          <p className="ai-snip-note">No timeline data for this range.</p>
        ) : (
          <MultiSeriesChart timeline={timeline} series={activeChart.series} granularity={granularity} />
        )}
      </section>
        </>
      )}
    </div>
  );
}
