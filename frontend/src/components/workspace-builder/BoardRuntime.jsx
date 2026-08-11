/**
 * Shared runtime that paints a workspace board/component document.
 * Used by Workspace Builder preview and /work when a default is published.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatChatTimestamp } from '../../utils/formatDateTime.js';

function asArray(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.items)) return data.items;
  return [];
}

function MiniLine({ points = [] }) {
  const pts = points.length
    ? points
    : [20, 40, 30, 55, 48, 70, 62].map((v, i) => ({ x: i, y: v }));
  const max = Math.max(...pts.map((p) => p.y || p.value || 0), 1);
  const w = 220;
  const h = 90;
  const d = pts
    .map((p, i) => {
      const x = (i / Math.max(pts.length - 1, 1)) * (w - 8) + 4;
      const y = h - 8 - ((Number(p.y ?? p.value) || 0) / max) * (h - 16);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
  return (
    <svg className="ws-chart" viewBox={`0 0 ${w} ${h}`} width="100%" height="100">
      <path d={d} fill="none" stroke="var(--accent, #673de6)" strokeWidth="2.2" />
    </svg>
  );
}

function MiniBars({ items = [] }) {
  const rows = items.length
    ? items
    : [
        { label: 'A', value: 40 },
        { label: 'B', value: 70 },
        { label: 'C', value: 55 },
      ];
  const max = Math.max(...rows.map((r) => Number(r.value ?? r.count) || 0), 1);
  return (
    <div className="ws-bars">
      {rows.slice(0, 8).map((r, i) => (
        <div key={i} className="ws-bar-row">
          <span className="ws-bar-label">{r.label || r.name || r.key || `#${i + 1}`}</span>
          <div className="ws-bar-track">
            <div
              className="ws-bar-fill"
              style={{ width: `${Math.round(((Number(r.value ?? r.count) || 0) / max) * 100)}%` }}
            />
          </div>
          <span className="ws-bar-val">{r.value ?? r.count ?? r.success_rate ?? ''}</span>
        </div>
      ))}
    </div>
  );
}

function MiniDonut({ slices = [] }) {
  const data = slices.length
    ? slices
    : [
        { pct: 70, color: '#22c55e' },
        { pct: 20, color: '#3b82f6' },
        { pct: 10, color: '#f43f5e' },
      ];
  const size = 110;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const sum = data.reduce((a, s) => a + (Number(s.pct ?? s.count) || 0), 0) || 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      {data.map((s, i) => {
        const frac = (Number(s.pct ?? s.count) || 0) / sum;
        const len = frac * c;
        const el = (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={s.color || '#673de6'}
            strokeWidth={stroke}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
          />
        );
        offset += len;
        return el;
      })}
    </svg>
  );
}

function ComponentBody({ component, designMode, onCommand }) {
  const type = component.type;
  const data = component.data;
  const props = component.props || {};
  const err = component.data_error;

  if (err) {
    return <p className="ws-muted">Data: {err}</p>;
  }

  if (type === 'metrics_row' || type === 'metrics_header') {
    const m = data || {};
    const tiles = [
      { label: 'Open tasks', value: m.tasks_open ?? m.tasks_listed ?? '—' },
      { label: 'AI workers', value: m.agents_active ?? '—' },
      { label: 'CRM', value: m.crm_enabled ? 'On' : 'Off' },
      { label: 'ERP', value: m.erp_enabled ? 'On' : 'Off' },
    ];
    return (
      <div className="ws-metrics">
        {tiles.map((t) => (
          <div key={t.label} className="ws-metric">
            <div className="ws-metric-val">{t.value}</div>
            <div className="ws-metric-label">{t.label}</div>
          </div>
        ))}
      </div>
    );
  }

  if (type === 'kpi_card') {
    const value =
      typeof data === 'number' || typeof data === 'string'
        ? data
        : data?.value ?? data?.display ?? props.value ?? '—';
    const label = component.title || props.label || 'KPI';
    const delta = data?.delta_label || props.delta || '';
    return (
      <div className="ws-kpi">
        <div className="ws-kpi-val">{value}</div>
        <div className="ws-kpi-label">{label}</div>
        {delta ? <div className="ws-kpi-delta">{delta}</div> : null}
      </div>
    );
  }

  if (type === 'line_chart') {
    const series = asArray(data).map((r, i) => ({
      x: i,
      y: Number(r.y ?? r.value ?? r.revenue ?? r.count) || 0,
    }));
    return <MiniLine points={series} />;
  }

  if (type === 'bar_chart') {
    const items = asArray(data).map((r) => ({
      label: r.label || r.name || r.workflow || r.region,
      value: Number(r.value ?? r.runs ?? r.count ?? r.success_rate) || 0,
    }));
    return <MiniBars items={items} />;
  }

  if (type === 'donut_chart') {
    return <MiniDonut slices={asArray(data)} />;
  }

  if (type === 'task_list' || type === 'open_work') {
    const rows = asArray(data).slice(0, props.limit || 12);
    return (
      <ul className="ws-list">
        {rows.length === 0 && <li className="ws-muted">No open tasks</li>}
        {rows.map((t) => (
          <li key={t.id || t.title}>
            <span className="ws-status">{t.status}</span> {t.title || t.name}
          </li>
        ))}
      </ul>
    );
  }

  if (type === 'agent_list' || type === 'team_strip') {
    const rows = asArray(data);
    return (
      <div className="ws-agents">
        {rows.length === 0 && <p className="ws-muted">No AI workers yet</p>}
        {rows.map((a) => (
          <Link
            key={a.id}
            className="ws-agent-chip"
            to={designMode ? '#' : `/agents/${encodeURIComponent(a.id)}/chat`}
            onClick={designMode ? (e) => e.preventDefault() : undefined}
          >
            <strong>{a.name || a.id}</strong>
            <span>{a.is_coo ? 'COO' : a.role_title || a.role || 'AI worker'}</span>
          </Link>
        ))}
      </div>
    );
  }

  if (type === 'activity_feed' || type === 'activity') {
    const rows = asArray(data).slice(0, props.limit || 15);
    return (
      <ul className="ws-feed">
        {rows.length === 0 && <li className="ws-muted">No recent activity</li>}
        {rows.map((a) => {
          const line = a.text || a.snippet || '';
          const kind =
            a.kind === 'goal'
              ? 'Goal'
              : a.kind === 'workflow'
                ? 'Workflow'
                : a.kind === 'kanban'
                  ? 'Task'
                  : a.kind === 'feedback'
                    ? 'Feedback'
                    : null;
          const body = (
            <>
              <div className="ws-feed-time">
                {kind ? <span className="ws-feed-kind">{kind} · </span> : null}
                {formatChatTimestamp(a.created_at || a.at)}
              </div>
              <div>{line}</div>
            </>
          );
          return (
            <li key={a.id || line}>
              {a.href && !designMode ? (
                <Link to={a.href} style={{ textDecoration: 'none', color: 'inherit' }}>
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  if (type === 'data_table' || type === 'data_grid') {
    const rows = asArray(data);
    const cols =
      props.columns ||
      (rows[0] && typeof rows[0] === 'object'
        ? Object.keys(rows[0]).filter((k) => !k.startsWith('_')).slice(0, 5)
        : []);
    if (!rows.length) return <p className="ws-muted">No rows</p>;
    return (
      <div className="ws-table-wrap">
        <table className="ws-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, props.limit || 12).map((r, i) => (
              <tr key={r.id || i}>
                {cols.map((c) => (
                  <td key={c}>{String(r[c] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (type === 'text_block' || type === 'notes_card') {
    return <p className="ws-text">{props.text || data?.text || component.title || ''}</p>;
  }

  if (type === 'quick_links') {
    const links = data && typeof data === 'object' ? data : props.links || {};
    return (
      <div className="ws-links">
        {Object.entries(links).map(([k, href]) => (
          <Link key={k} to={designMode ? '#' : String(href)}>
            {k.replace(/_/g, ' ')}
          </Link>
        ))}
      </div>
    );
  }

  if (type === 'chat_panel') {
    return (
      <CommandBar
        placeholder={props.placeholder}
        agents={asArray(data) /* rare */}
        designMode={designMode}
        onCommand={onCommand}
      />
    );
  }

  if (type === 'filter_bar') {
    return (
      <div className="ws-filter">
        <input disabled={designMode} placeholder={props.placeholder || 'Filter…'} />
      </div>
    );
  }

  if (type === 'tabs') {
    const tabs = props.tabs || ['Overview', 'Detail'];
    return (
      <div className="ws-tabs">
        {tabs.map((t, i) => (
          <span key={t} className={i === 0 ? 'active' : ''}>
            {t}
          </span>
        ))}
      </div>
    );
  }

  if (type === 'spend_pulse') {
    return (
      <div className="ws-kpi">
        <div className="ws-kpi-val">{data?.total_tokens != null ? Number(data.total_tokens).toLocaleString() : '—'}</div>
        <div className="ws-kpi-label">Tokens (7d)</div>
      </div>
    );
  }

  if (type === 'customers_pulse') {
    return (
      <div>
        <p>{data?.message || 'CRM status'}</p>
        {!designMode && data?.href ? <Link to={data.href}>Open</Link> : null}
      </div>
    );
  }

  return <p className="ws-muted">Unknown component: {type}</p>;
}

function CommandBar({ placeholder, designMode, onCommand }) {
  const [cmd, setCmd] = useState('');
  const navigate = useNavigate();
  function submit(e) {
    e.preventDefault();
    if (designMode) return;
    if (onCommand) return onCommand(cmd);
    const text = cmd.trim();
    if (!text) return navigate('/');
    if (text.startsWith('@')) {
      navigate(`/?message=${encodeURIComponent(text)}&autosend=1`);
    } else {
      navigate(`/?message=${encodeURIComponent(text)}&autosend=1`);
    }
  }
  return (
    <form className="ws-command" onSubmit={submit}>
      <input
        value={cmd}
        onChange={(e) => setCmd(e.target.value)}
        placeholder={placeholder || 'Ask Flolah AI…'}
        disabled={designMode}
      />
      <button type="submit" className="btn primary" disabled={designMode}>
        Go
      </button>
    </form>
  );
}

export default function BoardRuntime({
  board,
  components: componentsProp,
  designMode = false,
  selectedId = null,
  onSelect,
  onMove,
}) {
  const components = useMemo(
    () => componentsProp || board?.components || board?.widgets || [],
    [componentsProp, board]
  );
  const layout = board?.layout || { columns: 12, row_height: 48, gap: 12 };
  const cols = Number(layout.columns) || 12;
  const rowH = Number(layout.row_height) || 48;
  const gap = Number(layout.gap) || 12;

  const maxY = components.reduce((m, c) => Math.max(m, (Number(c.y) || 0) + (Number(c.h) || 2)), 8);

  return (
    <div
      className={`ws-canvas${designMode ? ' design' : ''}`}
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridAutoRows: `${rowH}px`,
        gap: `${gap}px`,
        minHeight: maxY * rowH,
      }}
    >
      {components.map((c) => {
        const style = {
          gridColumn: `${(Number(c.x) || 0) + 1} / span ${Number(c.w) || 4}`,
          gridRow: `${(Number(c.y) || 0) + 1} / span ${Number(c.h) || 2}`,
        };
        const selected = selectedId === c.id;
        return (
          <article
            key={c.id}
            className={`ws-comp${selected ? ' selected' : ''}`}
            style={style}
            onClick={designMode ? () => onSelect?.(c.id) : undefined}
          >
            {designMode ? (
              <header className="ws-comp-chrome">
                <span>{c.type}</span>
                <span className="ws-comp-tools">
                  <button type="button" title="Up" onClick={(e) => { e.stopPropagation(); onMove?.(c.id, 0, -1); }}>↑</button>
                  <button type="button" title="Down" onClick={(e) => { e.stopPropagation(); onMove?.(c.id, 0, 1); }}>↓</button>
                  <button type="button" title="Left" onClick={(e) => { e.stopPropagation(); onMove?.(c.id, -1, 0); }}>←</button>
                  <button type="button" title="Right" onClick={(e) => { e.stopPropagation(); onMove?.(c.id, 1, 0); }}>→</button>
                </span>
              </header>
            ) : null}
            {c.title && c.type !== 'kpi_card' && c.type !== 'chat_panel' ? (
              <h3 className="ws-comp-title">{c.title}</h3>
            ) : null}
            <div className="ws-comp-body">
              <ComponentBody component={c} designMode={designMode} />
            </div>
          </article>
        );
      })}
      {components.length === 0 ? (
        <div className="ws-empty">Drag components from the palette onto the canvas.</div>
      ) : null}
    </div>
  );
}
