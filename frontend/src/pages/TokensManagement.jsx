/**
 * Settings → Tokens management — issued external package tokens (masked) + revoke.
 * Lists workflow desktop + IBKR bridge + Browser session package tokens for the owner.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'workflow_desktop', label: 'Workflow desktop' },
  { id: 'ibkr_bridge', label: 'IBKR bridge' },
  { id: 'browser_session', label: 'Browser session package' },
];

function fmtWhen(v) {
  if (!v) return '—';
  const raw = String(v);
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString();
}

function statusClass(status) {
  if (status === 'active') return 'success-text';
  if (status === 'revoked') return 'this-week-muted';
  return 'error-text';
}

function kindLabel(row) {
  return row.kind_label || row.issuer_name || row.kind || '—';
}

export default function TokensManagement() {
  const [tokens, setTokens] = useState([]);
  const [counts, setCounts] = useState({});
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.externalTokensList();
      setTokens(res.tokens || []);
      setCounts(res.counts || {});
    } catch (e) {
      setError(e.message || 'Failed to load tokens');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    if (filter === 'all') return tokens;
    return tokens.filter((t) => t.kind === filter);
  }, [tokens, filter]);

  const revoke = async (row) => {
    if (!row?.can_revoke) return;
    const label = row.token_display || row.id;
    const msg =
      'Revoke ' +
      label +
      ' (' +
      kindLabel(row) +
      ')? Desktop and Browser Session tokens stop working on the next cloud call. For IBKR bridge, re-download a package and update the local .env after revoke.';
    if (!window.confirm(msg)) return;
    const key = row.kind + ':' + row.id;
    setBusyKey(key);
    setError(null);
    setMessage(null);
    try {
      await api.externalTokensRevoke(row.kind, row.id);
      setMessage('Token revoked.');
      await load();
    } catch (e) {
      setError(e.message || 'Revoke failed');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="nav-menus-page">
      <header className="this-week-header">
        <div>
          <h1>Tokens management</h1>
          <p className="this-week-sub">
            All external package tokens issued for your account: workflow desktop downloads, IBKR
            bridge zip, and Browser Session worker package. Full secrets are never shown — only
            prefixes. Named API vault keys: <Link to="/api-keys">API Keys</Link>.
          </p>
        </div>
        <div className="this-week-header-actions">
          <Link className="btn secondary" to="/connectors">
            Connectors
          </Link>
          <Link className="btn secondary" to="/settings/ip-whitelists">
            IP Whitelists
          </Link>
          <Link className="btn secondary" to="/api-keys">
            API Keys
          </Link>
        </div>
      </header>

      {loading && <p>Loading…</p>}
      {error && <p className="error-text">{error}</p>}
      {message && <p className="success-text">{message}</p>}

      {!loading && (
        <>
          <section className="this-week-card" style={{ marginBottom: '1rem' }}>
            <h3 className="this-week-card-title">By package type</h3>
            <p className="this-week-muted" style={{ marginTop: 0 }}>
              Counts include revoked tokens. New rows appear when you download a package (Connectors
              or Browser Session / Workflow Download for Windows). Older IBKR downloads from before
              inventory tracking are not backfilled.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {FILTERS.map((f) => {
                const n =
                  f.id === 'all'
                    ? tokens.length
                    : counts[f.id] != null
                      ? counts[f.id]
                      : tokens.filter((t) => t.kind === f.id).length;
                const active = filter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    className={active ? 'btn' : 'btn secondary'}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label} ({n})
                  </button>
                );
              })}
            </div>
          </section>

          <section className="this-week-card">
            <h3 className="this-week-card-title">Issued tokens</h3>
            {visible.length === 0 ? (
              <p className="this-week-muted" style={{ marginTop: 0 }}>
                {filter === 'ibkr_bridge' &&
                  'No IBKR bridge tokens recorded yet. Open Connectors → download Local IBKR bridge to mint one (it will appear here).'}
                {filter === 'browser_session' &&
                  'No Browser Session package tokens yet. Download the worker package from Connectors or Browser Session.'}
                {filter === 'workflow_desktop' &&
                  'No workflow desktop tokens yet. Publish a workflow and use Download for Windows.'}
                {filter === 'all' &&
                  'No external package tokens yet. Download a workflow package, Local IBKR bridge, or Browser Session worker from Workflows / Connectors / Browser Session.'}
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Token</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Issued package</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Type</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Issuer</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Last used</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Status</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => {
                      const key = row.kind + ':' + row.id;
                      return (
                        <tr key={key} style={{ borderTop: '1px solid var(--border, #333)' }}>
                          <td
                            style={{
                              padding: '0.5rem',
                              fontFamily: 'monospace',
                              fontSize: '0.85rem',
                            }}
                          >
                            {row.token_display}
                          </td>
                          <td style={{ padding: '0.5rem' }}>{row.package_name || '—'}</td>
                          <td style={{ padding: '0.5rem' }}>{kindLabel(row)}</td>
                          <td style={{ padding: '0.5rem' }}>{row.issuer_name || '—'}</td>
                          <td style={{ padding: '0.5rem' }}>{fmtWhen(row.last_used_at)}</td>
                          <td style={{ padding: '0.5rem' }} className={statusClass(row.status)}>
                            {row.status || '—'}
                          </td>
                          <td style={{ padding: '0.5rem' }}>
                            {row.can_revoke ? (
                              <button
                                type="button"
                                className="btn secondary"
                                disabled={busyKey === key}
                                onClick={() => revoke(row)}
                              >
                                {busyKey === key ? 'Revoking…' : 'Revoke'}
                              </button>
                            ) : (
                              <span className="this-week-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
