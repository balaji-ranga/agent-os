import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 1 month' },
  { value: '90', label: 'Last 3 months' },
  { value: 'all', label: 'All' },
];

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

export default function EfficiencyView() {
  const [range, setRange] = useState('14');
  const [chartTab, setChartTab] = useState('tasks');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
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
  }, [range]);

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

  return (
    <div className="ai-snip-page eff-page">
      <header className="ai-snip-page-head eff-page-head">
        <div>
          <h1>Efficiency View</h1>
          <p className="ai-snip-sub">
            Agents, automated tasks, feedback quality, and AI workflow run outcomes.
          </p>
        </div>
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
      </header>

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
    </div>
  );
}
