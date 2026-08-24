import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { formatChatTimestamp } from '../utils/formatDateTime.js';
import GoalPlanPanel from '../components/GoalPlanPanel';
import { goalOriginLabel } from '../components/GoalPlanTelemetry';
import ExecutionHistory from '../components/ExecutionHistory.jsx';

function KpiIcon({ name }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (name === 'users') {
    return (
      <svg {...common}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }
  if (name === 'rocket') {
    return (
      <svg {...common}>
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-5c1.62-2.2 5-3 5-3" />
        <path d="M12 15v5s3.03-.55 5-2c2.2-1.62 3-5 3-5" />
      </svg>
    );
  }
  if (name === 'clock') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    );
  }
  if (name === 'dollar') {
    return (
      <svg {...common}>
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    );
  }
  return null;
}

function HighlightIcon({ name }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'user-plus':
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <line x1="19" y1="8" x2="19" y2="14" />
          <line x1="22" y1="11" x2="16" y2="11" />
        </svg>
      );
    case 'workflow':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
          <path d="M10 6.5h4M17.5 10v4M6.5 10v4" />
        </svg>
      );
    case 'plug':
      return (
        <svg {...common}>
          <path d="M12 22v-5" />
          <path d="M9 8V2" />
          <path d="M15 8V2" />
          <path d="M18 8v5a6 6 0 0 1-12 0V8z" />
        </svg>
      );
    case 'book':
      return (
        <svg {...common}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      );
    case 'uptime':
      return (
        <svg {...common}>
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...common}>
          <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
        </svg>
      );
  }
}

function InsightIcon({ kind }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (kind === 'success') {
    return (
      <svg {...common}>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    );
  }
  if (kind === 'warning') {
    return (
      <svg {...common}>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  if (kind === 'growth') {
    return (
      <svg {...common}>
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
    </svg>
  );
}

function ActivityIcon({ icon }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (icon === 'warning') {
    return (
      <svg {...common}>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      </svg>
    );
  }
  if (icon === 'book') {
    return (
      <svg {...common}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    );
  }
  if (icon === 'workflow') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <path d="M10 6.5h4M17.5 10v4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function Donut({ slices, total }) {
  const size = 150;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = (slices || []).filter((s) => s.count > 0);
  if (!arcs.length) {
    return (
      <div className="digest-donut">
        <svg width={size} height={size} viewBox={'0 0 ' + size + ' ' + size}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        </svg>
        <div className="digest-donut-center">
          <div className="digest-donut-total">0</div>
          <div className="digest-donut-label">tasks</div>
        </div>
      </div>
    );
  }
  const sum = arcs.reduce((a, s) => a + s.count, 0) || 1;
  return (
    <div className="digest-donut">
      <svg width={size} height={size} viewBox={'0 0 ' + size + ' ' + size} style={{ transform: 'rotate(-90deg)' }}>
        {arcs.map((s) => {
          const len = (s.count / sum) * c;
          const el = (
            <circle
              key={s.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={len + ' ' + (c - len)}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="digest-donut-center">
        <div className="digest-donut-total">{total ?? sum}</div>
        <div className="digest-donut-label">tasks</div>
      </div>
    </div>
  );
}

function formatDelta(label) {
  if (!label || label === '-') return label || '-';
  const s = String(label);
  if (s.startsWith('up ')) return '↑ ' + s.slice(3);
  if (s.startsWith('down ')) return '↓ ' + s.slice(5);
  return s;
}

function deltaPositive(label) {
  const s = String(label || '');
  return s.startsWith('up') || s.startsWith('↑');
}

function DigestKpiExplain({ explain }) {
  const [open, setOpen] = useState(false);
  if (!explain || (!explain.title && !explain.bullets?.length && !explain.formula)) return null;
  return (
    <>
      <button
        type="button"
        className="digest-kpi-info"
        title={explain.title || 'How this is calculated'}
        aria-label={explain.title || 'How this is calculated'}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        i
      </button>
      {open ? (
        <div
          className="digest-explain-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="digest-explain-modal" role="dialog" aria-modal="true" aria-labelledby="digest-explain-title">
            <header className="digest-explain-head">
              <h2 id="digest-explain-title">{explain.title || 'How this is calculated'}</h2>
              <button type="button" className="digest-explain-close" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </header>
            {explain.summary ? <p className="digest-explain-summary">{explain.summary}</p> : null}
            {explain.formula ? (
              <p className="digest-explain-formula">
                <code>{explain.formula}</code>
              </p>
            ) : null}
            {(explain.bullets || []).length > 0 ? (
              <ul className="digest-explain-bullets">
                {explain.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function ThisWeek() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const offset = Number(searchParams.get('offset') || 0) || 0;
  const setOffset = (next) => {
    const n = typeof next === 'function' ? next(offset) : next;
    const o = Number(n) || 0;
    const sp = new URLSearchParams(searchParams);
    if (o) sp.set('offset', String(o));
    else sp.delete('offset');
    setSearchParams(sp, { replace: true });
  };
  const [ask, setAsk] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    api
      .thisWeekDigest({ offset })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setErr(e?.message || 'Failed to load digest');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [offset]);

  const kpis = useMemo(() => {
    const k = data?.kpis || {};
    return [
      { key: 'ai', ...k.ai_workers, color: 'purple' },
      { key: 'tasks', ...k.tasks_completed, color: 'green' },
      { key: 'time', ...k.time_saved, color: 'blue' },
      { key: 'value', ...k.value_delivered, color: 'amber' },
    ];
  }, [data]);

  const wh = data?.ai_worker_highlights || {};

  function onAsk(e) {
    e.preventDefault();
    const q = ask.trim();
    if (!q) {
      window.location.href = '/';
      return;
    }
    const msg =
      'About this week digest: ' +
      q +
      ' [Use tool this_week_digest with offset_weeks=' +
      offset +
      ' and explain Time Saved / Est. Value Delivered from methodology. Do not invent formulas or redirect to Platform Help.]';
    window.location.href = '/?q=' + encodeURIComponent(msg);
  }

  return (
    <div className="digest-page">
      <header className="digest-header">
        <div>
          <h1 className="digest-title">
            <span className="digest-spark" aria-hidden>
              ✦
            </span>{' '}
            This Week Digest
          </h1>
          <p className="digest-sub">
            Here&apos;s what happened in {data?.company_name || 'your company'} this week.
          </p>
        </div>
        <div className="digest-header-tools">
          <div className="digest-range" title="Week window">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <button type="button" className="digest-range-btn" onClick={() => setOffset((o) => o - 1)} aria-label="Previous week">
              ‹
            </button>
            <span>{data?.week?.label || '—'}</span>
            <button
              type="button"
              className="digest-range-btn"
              onClick={() => setOffset((o) => Math.min(0, o + 1))}
              disabled={offset >= 0}
              aria-label="Next week"
            >
              ›
            </button>
          </div>
        </div>
      </header>

      {err ? <p className="error-text">{err}</p> : null}
      {loading && !data ? <p className="digest-muted">Loading digest…</p> : null}

      {data ? (
        <>
          <section className="digest-kpis">
            {kpis.map((k) => (
              <article key={k.key} className={'digest-kpi color-' + (k.color || 'purple')}>
                <div className="digest-kpi-icon">
                  <KpiIcon name={k.icon} />
                </div>
                <div className="digest-kpi-body">
                  <div className="digest-kpi-value-row">
                    <div className="digest-kpi-value">{k.display ?? k.value ?? '—'}</div>
                    {k.explain ? <DigestKpiExplain explain={k.explain} /> : null}
                  </div>
                  <div className="digest-kpi-label">{k.label}</div>
                  <div className={'digest-kpi-delta' + (deltaPositive(k.delta_label) ? ' up' : '')}>{formatDelta(k.delta_label)}</div>
                </div>
              </article>
            ))}
          </section>

          <section className="digest-row">
            <article className="digest-card">
              <h2 className="digest-card-title">Organization Highlights</h2>
              <ul className="digest-highlights">
                {(data.organization_highlights || []).map((h, i) => (
                  <li key={i}>
                    <span className="digest-hl-icon">
                      <HighlightIcon name={h.icon} />
                    </span>
                    <span>{h.text}</span>
                  </li>
                ))}
              </ul>
              <Link className="digest-more" to={data.links?.activity || '/work'}>
                View all activity →
              </Link>
            </article>
            <article className="digest-card">
              <h2 className="digest-card-title">AI Workers Highlights</h2>
              {wh.empty_reason ? (
                <p className="digest-muted" style={{ fontSize: '0.8rem', marginBottom: '0.65rem' }}>
                  {wh.empty_reason}
                </p>
              ) : null}
              <dl className="digest-worker-hl">
                <div>
                  <dt>Top Performer</dt>
                  <dd>
                    {wh.top_performer ? (
                      <>
                        {wh.top_performer.name} <span className="digest-muted">({wh.top_performer.tasks} done)</span>
                      </>
                    ) : (
                      <span className="digest-muted">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Most Active</dt>
                  <dd>
                    {wh.most_active ? (
                      <>
                        {wh.most_active.name} <span className="digest-muted">({wh.most_active.tasks} events)</span>
                      </>
                    ) : (
                      <span className="digest-muted">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Most Time Saved</dt>
                  <dd>
                    {wh.most_time_saved ? (
                      <>
                        {wh.most_time_saved.name}{' '}
                        <span className="digest-muted">({wh.most_time_saved.hours} hrs)</span>
                      </>
                    ) : (
                      <span className="digest-muted">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>New This Week</dt>
                  <dd>
                    {wh.new_this_week ? (
                      <>
                        {wh.new_this_week.name} <span className="digest-badge">NEW</span>
                      </>
                    ) : (
                      <span className="digest-muted">—</span>
                    )}
                  </dd>
                </div>
              </dl>
              <Link className="digest-more" to={data.links?.agents || '/workspace'}>
                View all AI Workers →
              </Link>
            </article>
          </section>

          <section className="digest-row">
            <article className="digest-card" style={{ gridColumn: '1 / -1' }}>
              <h2 className="digest-card-title">Goal plans (plan vs progress)</h2>
              {!(data.goal_plans || []).length ? (
                <p className="digest-muted">
                  No durable multi-intent goal plans this week. Ad-hoc COO chat and scheduled multi-phase goals create
                  them. Open a plan’s <strong>Execution trace</strong> for telemetry and plan version.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {/* Backend already limits to 2 most recent for the selected week */}
                  {(data.goal_plans || []).slice(0, 2).map((g) => (
                    <div key={g.id}>
                      <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 4 }}>
                        {goalOriginLabel(g)} · {g.status}
                        {g.scheduled_goal_id ? (
                          <>
                            {' · '}
                            <Link to="/scheduled-goals">scheduled goal</Link>
                          </>
                        ) : null}
                        {g.created_at ? (
                          <>
                            {' · '}
                            <time dateTime={String(g.created_at)} title="Goal run started">
                              {formatChatTimestamp(g.created_at)}
                            </time>
                          </>
                        ) : null}
                        {g.completed_at ? (
                          <>
                            {' · done '}
                            <time dateTime={String(g.completed_at)} title="Goal run completed">
                              {formatChatTimestamp(g.completed_at)}
                            </time>
                          </>
                        ) : null}
                        {' · '}
                        {g.progress?.progress_pct ?? 0}%
                      </div>
                      <GoalPlanPanel goal={g} compact />
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem 1.25rem', marginTop: '0.65rem' }}>
                {(Number(data.goal_plans_total) || (data.goal_plans || []).length) > 2 ||
                (data.goal_plans || []).length > 0 ? (
                  <Link
                    className="digest-more"
                    to={
                      data.links?.goal_plans ||
                      `/goal-plans?offset=${offset}${
                        data?.week?.start_date && data?.week?.end_date
                          ? `&start=${encodeURIComponent(data.week.start_date)}&end=${encodeURIComponent(data.week.end_date)}`
                          : ''
                      }`
                    }
                  >
                    View all plans
                    {(Number(data.goal_plans_total) || 0) > 0
                      ? ` (${data.goal_plans_total} this week)`
                      : ''}{' '}
                    →
                  </Link>
                ) : null}
                <Link className="digest-more" to={data.links?.scheduled_goals || '/scheduled-goals'}>
                  Scheduled goals →
                </Link>
              </div>
            </article>
          </section>

          <section className="digest-row">
            <article className="digest-card">
              <h2 className="digest-card-title">Top Workflows</h2>
              {(data.top_workflows || []).length === 0 ? (
                <p className="digest-muted">No workflow runs this week.</p>
              ) : (
                <table className="digest-table">
                  <thead>
                    <tr>
                      <th>Workflow</th>
                      <th>Runs</th>
                      <th>Success Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_workflows.map((w) => (
                      <tr key={w.id || w.name}>
                        <td>{w.name}</td>
                        <td>{w.runs}</td>
                        <td>
                          <div className="digest-bar-wrap">
                            <div className="digest-bar" style={{ width: Math.min(100, w.success_rate || 0) + '%' }} />
                            <span>{w.success_rate}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <Link className="digest-more" to={data.links?.workflows || '/agent-workflows'}>
                View workflows →
              </Link>
            </article>
            <article className="digest-card">
              <h2 className="digest-card-title">AI Worker Performance</h2>
              <div className="digest-perf">
                <Donut slices={data.performance?.slices} total={data.performance?.total} />
                <ul className="digest-legend">
                  {(data.performance?.slices || []).map((s) => (
                    <li key={s.key}>
                      <span className="digest-swatch" style={{ background: s.color }} />
                      {s.label} <strong>{s.pct}%</strong>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="digest-success-line">
                Success rate this week: <strong>{data.performance?.success_rate ?? 0}%</strong>{' '}
                <span className={'digest-kpi-delta' + (deltaPositive(data.performance?.success_delta_label) ? ' up' : '')}>
                  {formatDelta(data.performance?.success_delta_label)}
                </span>
              </p>
            </article>
          </section>

          <section className="digest-row">
            <article className="digest-card">
              <h2 className="digest-card-title">Activity Timeline</h2>
              {(data.activity || []).length === 0 ? (
                <p className="digest-muted">No notable events this week yet.</p>
              ) : (
                <ul className="digest-timeline">
                  {data.activity.map((a) => (
                    <li key={a.id}>
                      <span className="digest-tl-icon">
                        <ActivityIcon icon={a.icon} />
                      </span>
                      <div>
                        <div className="digest-tl-time">{formatChatTimestamp(a.at)}</div>
                        <div className="digest-tl-text">{a.text}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </article>
            <article className="digest-card">
              <h2 className="digest-card-title">Insights &amp; Recommendations</h2>
              <div className="digest-insights">
                {(data.insights || []).map((ins) => (
                  <div key={ins.id} className={'digest-insight kind-' + (ins.kind || 'suggestion')}>
                    <span className="digest-insight-icon">
                      <InsightIcon kind={ins.kind} />
                    </span>
                    <div>
                      <div className="digest-insight-title">{ins.title}</div>
                      <p>{ins.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <ExecutionHistory from={data?.week?.start_date} to={data?.week?.end_date} />

          <form className="digest-ask" onSubmit={onAsk}>
            <div className="digest-ask-label">
              Questions about your digest? <strong>Ask Flolah AI</strong>
            </div>
            <div className="digest-ask-row">
              <input
                type="text"
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                placeholder="Ask a question"
                aria-label="Ask about this week digest"
              />
              <button type="submit" className="btn primary digest-ask-btn">
                Ask a question
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </form>
          {data.estimates ? (
            <p className="digest-footnote">
              Time saved uses {data.estimates.minutes_per_task} min/task. Est. value multiplies each completed task by
              that AI employee hourly rate (hire default 10 USD/hr). Unassigned tasks and workflow runs use the platform
              fallback of {data.estimates.usd_per_hour} USD/hr
              {data.estimates.weighted_avg_usd_per_hour != null
                ? ' (effective average this week: ' + data.estimates.weighted_avg_usd_per_hour + ' USD/hr)'
                : ''}
              . Insights assess CRM, goals, workflows, knowledge, and token use.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
