import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { formatLocalDateTime } from '../utils/formatDateTime.js';

function Payload({ label, raw }) {
  const [open, setOpen] = useState(false);
  if (!raw) return null;
  let text = raw;
  try {
    text = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    /* keep raw */
  }
  return (
    <div style={{ marginTop: 4 }}>
      <button
        type="button"
        className="mcp-pg-btn-ghost mcp-pg-btn-sm"
        onClick={() => setOpen((v) => !v)}
      >
        {label} {open ? '▼' : '▶'}
      </button>
      {open && (
        <pre
          style={{
            marginTop: 4,
            maxHeight: 180,
            overflow: 'auto',
            fontSize: '0.72rem',
            background: 'var(--bg, #f7f8f9)',
            padding: 8,
            borderRadius: 6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {text}
        </pre>
      )}
    </div>
  );
}

function outcomeClass(outcome) {
  if (outcome === 'success') return 'mcp-pg-status mcp-pg-status-healthy';
  if (outcome === 'denied') return 'mcp-pg-status';
  if (outcome === 'failed') return 'mcp-pg-status';
  return 'mcp-pg-status';
}

function outcomeStyle(outcome) {
  if (outcome === 'success') return {};
  if (outcome === 'denied') return { background: 'rgba(245, 158, 11, 0.15)', color: '#b45309' };
  if (outcome === 'failed') return { background: 'rgba(239, 68, 68, 0.12)', color: '#b91c1c' };
  return { background: 'rgba(100, 116, 139, 0.12)', color: '#475569' };
}

export default function AdminA2AInvocations() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [outcome, setOutcome] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [clientIp, setClientIp] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 40;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .adminA2AInvocations({
        outcome: outcome || undefined,
        endpoint: endpoint || undefined,
        source: source || undefined,
        q: q || undefined,
        client_ip: clientIp || undefined,
        limit,
        offset,
      })
      .then((r) => {
        setLogs(r.logs || []);
        setTotal(r.total || 0);
        setSummary(r.summary || {});
      })
      .catch((e) => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [outcome, endpoint, source, q, clientIp, offset]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mcp-pg">
      <header className="page-hero">
        <div className="page-hero-top">
          <div className="page-hero-titles">
            <p className="page-hero-kicker">Admin · Observability</p>
            <h1>A2A invocation logs</h1>
          </div>
          <button type="button" className="mcp-pg-btn-primary page-hero-action" onClick={load}>
            Refresh
          </button>
        </div>
        <p className="page-hero-sub">
          Platform-wide history of AgentExchange / A2A card fetches, OAuth token attempts, and
          invokes — including IP deny, OAuth failures, and other blocks that never start a workflow
          run.
        </p>
      </header>

      {error && <div className="mcp-pg-alert mcp-pg-alert-error">{error}</div>}

      <div className="mcp-pg-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <select value={outcome} onChange={(e) => { setOffset(0); setOutcome(e.target.value); }}>
          <option value="">All outcomes</option>
          <option value="success">success</option>
          <option value="denied">denied</option>
          <option value="failed">failed</option>
          <option value="error">error</option>
        </select>
        <select value={endpoint} onChange={(e) => { setOffset(0); setEndpoint(e.target.value); }}>
          <option value="">All endpoints</option>
          <option value="card">card</option>
          <option value="oauth_token">oauth_token</option>
          <option value="invoke">invoke</option>
        </select>
        <select value={source} onChange={(e) => { setOffset(0); setSource(e.target.value); }}>
          <option value="">All sources</option>
          <option value="public">public</option>
          <option value="agent_exchange_test">agent_exchange_test</option>
        </select>
        <input
          className="mcp-pg-search"
          placeholder="Client IP…"
          value={clientIp}
          onChange={(e) => setClientIp(e.target.value)}
          onBlur={() => setOffset(0)}
          style={{ maxWidth: 140 }}
        />
        <input
          className="mcp-pg-search"
          placeholder="Search agent / reason / skill…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setOffset(0);
              load();
            }
          }}
        />
      </div>

      <div className="mcp-pg-card-meta" style={{ marginBottom: '0.75rem', gap: '0.75rem' }}>
        <span>Total: {total}</span>
        {Object.entries(summary).map(([k, v]) => (
          <span key={k} className={outcomeClass(k)} style={outcomeStyle(k)}>
            {k}: {v}
          </span>
        ))}
      </div>

      {loading ? (
        <div className="mcp-pg-loading">
          <div className="mcp-pg-spinner" />
          <p>Loading invocation logs…</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: 8 }}>When</th>
                <th style={{ padding: 8 }}>Outcome</th>
                <th style={{ padding: 8 }}>Endpoint</th>
                <th style={{ padding: 8 }}>Agent</th>
                <th style={{ padding: 8 }}>Client IP</th>
                <th style={{ padding: 8 }}>Reason</th>
                <th style={{ padding: 8 }}>HTTP</th>
                <th style={{ padding: 8 }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => (
                <tr key={row.id} style={{ borderBottom: '1px solid var(--border)', verticalAlign: 'top' }}>
                  <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                    {formatLocalDateTime(row.created_at)}
                    <div style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>
                      {row.source}
                      {row.bypass_access ? ' · bypass' : ''}
                      {row.latency_ms != null ? ` · ${row.latency_ms}ms` : ''}
                    </div>
                  </td>
                  <td style={{ padding: 8 }}>
                    <span className={outcomeClass(row.outcome)} style={outcomeStyle(row.outcome)}>
                      {row.outcome}
                    </span>
                  </td>
                  <td style={{ padding: 8 }}>
                    <code>{row.endpoint}</code>
                    {row.rpc_method ? (
                      <div style={{ fontSize: '0.72rem' }}>
                        <code>{row.rpc_method}</code>
                      </div>
                    ) : null}
                    {row.skill_id ? (
                      <div style={{ fontSize: '0.72rem' }}>skill: {row.skill_id}</div>
                    ) : null}
                  </td>
                  <td style={{ padding: 8 }}>
                    <div>{row.agent_name || '—'}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--muted)', wordBreak: 'break-all' }}>
                      {row.publish_id}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                      {row.access_policy || '—'} · {row.auth_mode || '—'}
                    </div>
                  </td>
                  <td style={{ padding: 8 }}>
                    <code>{row.client_ip || '—'}</code>
                  </td>
                  <td style={{ padding: 8 }}>
                    <div>
                      <code>{row.reason_code || '—'}</code>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                      {row.reason_message || ''}
                    </div>
                    {(row.task_id || row.run_id) && (
                      <div style={{ fontSize: '0.72rem', marginTop: 4 }}>
                        {row.task_id ? (
                          <>
                            task: <code>{row.task_id}</code>{' '}
                          </>
                        ) : null}
                        {row.run_id != null ? <>run: {row.run_id}</> : null}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: 8 }}>{row.http_status ?? '—'}</td>
                  <td style={{ padding: 8, minWidth: 160 }}>
                    <Payload label="Request" raw={row.request_json} />
                    <Payload label="Response" raw={row.response_json} />
                  </td>
                </tr>
              ))}
              {!logs.length && (
                <tr>
                  <td colSpan={8} style={{ padding: 16, color: 'var(--muted)' }}>
                    No A2A invocation logs yet. Public card/token/invoke attempts and AgentExchange
                    Test agent calls are recorded here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mcp-pg-card-actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="mcp-pg-btn-ghost mcp-pg-btn-sm"
          disabled={offset <= 0}
          onClick={() => setOffset(Math.max(0, offset - limit))}
        >
          Previous
        </button>
        <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
          {offset + 1}–{Math.min(offset + limit, total)} of {total}
        </span>
        <button
          type="button"
          className="mcp-pg-btn-ghost mcp-pg-btn-sm"
          disabled={offset + limit >= total}
          onClick={() => setOffset(offset + limit)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
