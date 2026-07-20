import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

function formatCompact(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

function formatDayLabel(iso) {
  if (!iso) return '';
  const parts = String(iso).slice(0, 10).split('-');
  if (parts.length !== 3) return String(iso).slice(5);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = Number(parts[2]);
  const month = months[Number(parts[1]) - 1] || parts[1];
  return `${day} ${month}`;
}

function buildEmptyTimeline(days) {
  const n = Number(days) === 30 ? 30 : Number(days) === 14 ? 14 : 7;
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    keys.push({
      date: `${yyyy}-${mm}-${dd}`,
      prompts: 0,
      agents_active: 0,
      tokens: 0,
      tool_calls: 0,
    });
  }
  return keys;
}

function InfoTip({ text }) {
  return (
    <span className="ai-snip-info" title={text} aria-label={text}>
      i
    </span>
  );
}

function TimelineChart({ timeline, metric }) {
  const rows = Array.isArray(timeline) && timeline.length ? timeline : buildEmptyTimeline(7);
  const width = 640;
  const height = 260;
  const padL = 40;
  const padR = 16;
  const padT = 16;
  const padB = 44;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const values = rows.map((d) => (metric === 'tokens' ? Number(d.tokens) || 0 : Number(d.prompts) || 0));
  const maxVal = Math.max(1, ...values);
  const yMax = Math.max(4, Math.ceil(maxVal / 4) * 4);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => Math.round(yMax * p));

  const points = rows.map((d, i) => {
    const n = rows.length || 1;
    const x = padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const v = metric === 'tokens' ? Number(d.tokens) || 0 : Number(d.prompts) || 0;
    const y = padT + plotH - (v / yMax) * plotH;
    return { x, y, v, date: d.date };
  });

  const path =
    points.length > 1
      ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
      : '';

  return (
    <div className="ai-snip-chart-wrap">
      <svg
        className="ai-snip-chart"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="260"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${metric} timeline`}
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
        {path ? (
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
        ) : null}
        {points.map((p) => (
          <g key={String(p.date)}>
            <line
              x1={p.x}
              y1={padT + plotH}
              x2={p.x}
              y2={padT + plotH + 5}
              stroke="var(--muted)"
              strokeWidth="1"
            />
            <circle cx={p.x} cy={p.y} r={p.v > 0 ? 3.5 : 2.25} fill="var(--accent)" />
            <text
              x={p.x}
              y={height - 14}
              textAnchor="middle"
              fill="var(--muted)"
              fontSize="11"
            >
              {formatDayLabel(p.date)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function AiSnipper() {
  const [days, setDays] = useState(14);
  const [chartMetric, setChartMetric] = useState('prompts');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .aiSnipperSummary(days)
      .then((res) => {
        if (cancelled) return;
        if (!res?.totals) {
          throw new Error('Usage summary returned no totals');
        }
        const timeline =
          Array.isArray(res?.timeline) && res.timeline.length
            ? res.timeline
            : buildEmptyTimeline(days);
        setData({ ...res, timeline });
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || 'Failed to load usage');
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const totals = data?.totals || { prompts: 0, agents: 0, agents_active: 0, tokens: 0, tool_calls: 0, agents_entitled: 0 };
  const timeline = data?.timeline?.length ? data.timeline : buildEmptyTimeline(days);
  const rangeLabel = useMemo(() => `Last ${days} days`, [days]);
  const hasActivity =
    (totals.prompts || 0) > 0 || (totals.tokens || 0) > 0 || (totals.tool_calls || 0) > 0;

  return (
    <div className="ai-snip-page">
      <header className="ai-snip-page-head">
        <div>
          <h1>AI Snipper</h1>
          <p className="ai-snip-sub">Usage across agent chats, workflow builder, and content tools.</p>
        </div>
      </header>

      {error && (
        <div className="ai-snip-error">
          {error}
          {/not found|404/i.test(error) ? ' — restart the backend to load /api/ai-snipper.' : ''}
        </div>
      )}
      {loading && !data && <div className="ai-snip-loading">Loading…</div>}

      <section className="ai-snip-card">
        <div className="ai-snip-card-head">
          <h2>Summary</h2>
          <select
            className="ai-snip-select"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Time range"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>

        {!loading && !error && data && !hasActivity && (
          <p className="ai-snip-note">
            No prompts, tokens, or tool calls in this window. Agents still shows your enabled agents.
            Try Last 30 days if activity is older.
          </p>
        )}

        <div className="ai-snip-metrics">
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">{formatCompact(totals.prompts)}</div>
            <div className="ai-snip-metric-label">
              Prompts <InfoTip text="User messages in agent chat and Workflow Builder chat" />
            </div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">{formatCompact(totals.agents)}</div>
            <div className="ai-snip-metric-label">
              Agents{' '}
              <InfoTip
                text={`${totals.agents_active ?? 0} active in this period (had chat). Total is enabled agents for your account.`}
              />
            </div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">{formatCompact(totals.tokens)}</div>
            <div className="ai-snip-metric-label">
              Total tokens <InfoTip text="Estimated from message length (~4 chars/token) until metering is stored" />
            </div>
          </div>
          <div className="ai-snip-metric">
            <div className="ai-snip-metric-value">{formatCompact(totals.tool_calls)}</div>
            <div className="ai-snip-metric-label">
              Tool calls <InfoTip text="Content tool invocations for this CEO" />
            </div>
          </div>
        </div>

        <button
          type="button"
          className="ai-snip-breakdown-toggle"
          onClick={() => setBreakdownOpen((o) => !o)}
          aria-expanded={breakdownOpen}
        >
          <span>Token and activity breakdown</span>
          <span className="ai-snip-chevron" aria-hidden>
            {breakdownOpen ? '▴' : '▾'}
          </span>
        </button>
        {breakdownOpen && (
          <div className="ai-snip-breakdown">
            <div>
              <strong>Prompts</strong>
              <span>{totals.prompts}</span>
            </div>
            <div>
              <strong>Agents (account)</strong>
              <span>{totals.agents}</span>
            </div>
            <div>
              <strong>Agents active in period</strong>
              <span>{totals.agents_active ?? 0}</span>
            </div>
            <div>
              <strong>Tokens (est.)</strong>
              <span>{Number(totals.tokens || 0).toLocaleString()}</span>
            </div>
            <div>
              <strong>Tool calls</strong>
              <span>{totals.tool_calls}</span>
            </div>
            {data?.tokens_estimated && (
              <p className="ai-snip-note">Token counts are estimated from stored message text.</p>
            )}
          </div>
        )}
      </section>

      <section className="ai-snip-card">
        <div className="ai-snip-card-head">
          <div className="ai-snip-pills" role="tablist" aria-label="Chart metric">
            <button
              type="button"
              role="tab"
              aria-selected={chartMetric === 'prompts'}
              className={`ai-snip-pill${chartMetric === 'prompts' ? ' active' : ''}`}
              onClick={() => setChartMetric('prompts')}
            >
              Prompt
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={chartMetric === 'tokens'}
              className={`ai-snip-pill${chartMetric === 'tokens' ? ' active' : ''}`}
              onClick={() => setChartMetric('tokens')}
            >
              Token
            </button>
          </div>
          <div className="ai-snip-range-static">{rangeLabel}</div>
        </div>
        <TimelineChart timeline={timeline} metric={chartMetric} />
      </section>
    </div>
  );
}
