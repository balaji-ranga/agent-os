import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const TYPE_LABELS = {
  content_tool: 'Platform tool',
  mcp_tool: 'MCP tool',
  connector_action: 'Connector action',
};

const TIER_COLORS = {
  R0: '#22c55e',
  R1: '#38bdf8',
  R2: '#f59e0b',
  R3: '#ef4444',
  R4: '#a855f7',
};

const TIER_ORDER = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 };

function RiskBadge({ tier }) {
  const color = TIER_COLORS[tier] || '#94a3b8';
  return (
    <span style={{ color, border: `1px solid ${color}`, background: `color-mix(in srgb, ${color} 10%, transparent)`, borderRadius: 999, padding: '0.15rem 0.52rem', fontWeight: 800, fontSize: '0.75rem' }}>
      {tier}
    </span>
  );
}

export default function ToolRiskMappings() {
  const [data, setData] = useState({ tiers: [], mappings: [], counts: {} });
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.toolRiskMappingsList());
    } catch (e) {
      setError(e.message || 'Failed to load risk classifications');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data.mappings || []).filter((row) => {
      if (type && row.capability_type !== type) return false;
      if (!q) return true;
      return `${row.capability_id} ${row.display_name} ${row.description} ${row.source_id}`.toLowerCase().includes(q);
    });
  }, [data.mappings, query, type]);

  const replaceMapping = (mapping) => {
    setData((current) => {
      const mappings = current.mappings.map((row) => (
        row.capability_type === mapping.capability_type && row.capability_key === mapping.capability_key
          ? mapping
          : row
      ));
      const counts = Object.fromEntries((current.tiers || []).map((tier) => [tier.id, 0]));
      mappings.forEach((row) => { counts[row.risk_tier] = Number(counts[row.risk_tier] || 0) + 1; });
      return { ...current, mappings, counts };
    });
  };

  const changeTier = async (row, nextTier) => {
    if (nextTier === row.risk_tier) return;
    const lowersGuardrail = (TIER_ORDER[nextTier] ?? 0) < (TIER_ORDER[row.risk_tier] ?? 0);
    if (lowersGuardrail && !window.confirm(`Lower ${row.capability_id} from ${row.risk_tier} to ${nextTier}? This changes Action Control classification for your company.`)) return;
    const key = `${row.capability_type}:${row.capability_key}`;
    setBusyKey(key);
    setError(null);
    setMessage(null);
    try {
      const response = await api.toolRiskMappingSave({
        capability_type: row.capability_type,
        capability_key: row.capability_key,
        risk_tier: nextTier,
      });
      replaceMapping(response.mapping);
      setMessage(`${row.capability_id} now uses ${nextTier}. Agent Tool Access and Action Control use this mapping immediately.`);
    } catch (e) {
      setError(e.message || 'Failed to save classification');
    } finally {
      setBusyKey('');
    }
  };

  const reset = async (row) => {
    const key = `${row.capability_type}:${row.capability_key}`;
    setBusyKey(key);
    setError(null);
    setMessage(null);
    try {
      const response = await api.toolRiskMappingReset({ capability_type: row.capability_type, capability_key: row.capability_key });
      replaceMapping(response.mapping);
      setMessage(`${row.capability_id} returned to its interpreted default.`);
    } catch (e) {
      setError(e.message || 'Failed to reset classification');
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div className="nav-menus-page">
      <header className="this-week-header">
        <div>
          <h1>Risk classifications</h1>
          <p className="this-week-sub" style={{ maxWidth: 840 }}>
            One company mapping for platform tools, MCP tools, and connector actions. Flolah interprets a safe default,
            while your override becomes the value shown in Agent Tool Access and enforced by Action Control.
          </p>
        </div>
        <div className="this-week-header-actions">
          <Link className="btn secondary" to="/policies">Action Control</Link>
          <Link className="btn secondary" to="/workspace">AI Employees</Link>
        </div>
      </header>

      <section className="this-week-card" style={{ marginBottom: '1rem', background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, var(--surface)), var(--surface))' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '0.65rem' }}>
          {(data.tiers || []).map((tier) => (
            <div key={tier.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '0.8rem', background: 'color-mix(in srgb, var(--surface) 92%, transparent)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <RiskBadge tier={tier.id} />
                <strong style={{ fontSize: '1.15rem' }}>{data.counts?.[tier.id] || 0}</strong>
              </div>
              <strong style={{ display: 'block', marginTop: 8 }}>{tier.label}</strong>
              <small style={{ color: 'var(--muted)', lineHeight: 1.35 }}>{tier.effect}</small>
            </div>
          ))}
        </div>
        <p style={{ margin: '0.85rem 0 0', color: 'var(--muted)', fontSize: '0.84rem' }}>
          R4 is fail-closed: a critical privileged action is prohibited even when its broader Action Control family is autonomous.
          To permit it, first remap the exact capability to the appropriate lower tier; that change is owner-specific and persisted in its saved mapping.
        </p>
      </section>

      <section className="this-week-card">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(170px, 260px) auto', gap: '0.65rem', alignItems: 'center' }}>
          <input aria-label="Search risk mappings" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tool, action, server, or description…" style={{ width: '100%', padding: '0.68rem 0.78rem', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)', color: 'var(--text)' }} />
          <select aria-label="Capability type" value={type} onChange={(e) => setType(e.target.value)} style={{ width: '100%', padding: '0.68rem', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)', color: 'var(--text)' }}>
            <option value="">All capability types</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button className="btn secondary" type="button" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh catalogue'}</button>
        </div>

        {error && <p className="error-text" role="alert">{error}</p>}
        {message && <p className="success-text" role="status">{message}</p>}

        {!loading && (
          <div style={{ marginTop: '1rem', overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead style={{ background: 'color-mix(in srgb, var(--surface) 82%, var(--accent) 5%)' }}>
                <tr>
                  {['Capability', 'Type / source', 'Interpreted', 'Effective mapping', 'Stored as', ''].map((heading) => (
                    <th key={heading} style={{ textAlign: 'left', padding: '0.72rem', fontSize: '0.77rem', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const rowKey = `${row.capability_type}:${row.capability_key}`;
                  const saving = busyKey === rowKey;
                  return (
                    <tr key={rowKey} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.72rem', maxWidth: 360 }}>
                        <strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{row.display_name || row.capability_id}</strong>
                        <code style={{ fontSize: '0.75rem', color: 'var(--muted)', overflowWrap: 'anywhere' }}>{row.capability_id}</code>
                        {row.description && <small style={{ display: 'block', color: 'var(--muted)', marginTop: 4, lineHeight: 1.35 }}>{row.description}</small>}
                      </td>
                      <td style={{ padding: '0.72rem' }}>
                        <span style={{ display: 'block' }}>{TYPE_LABELS[row.capability_type] || row.capability_type}</span>
                        {row.source_id && <small style={{ color: 'var(--muted)' }}>{row.source_id}</small>}
                      </td>
                      <td style={{ padding: '0.72rem' }}><RiskBadge tier={row.inferred_risk_tier} /></td>
                      <td style={{ padding: '0.72rem' }}>
                        <select aria-label={`Risk tier for ${row.capability_id}`} value={row.risk_tier} disabled={saving} onChange={(e) => changeTier(row, e.target.value)} style={{ minWidth: 190, padding: '0.52rem', border: `1px solid ${TIER_COLORS[row.risk_tier] || 'var(--border)'}`, borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', fontWeight: 700 }}>
                          {(data.tiers || []).map((tier) => <option key={tier.id} value={tier.id}>{tier.id} · {tier.label}</option>)}
                        </select>
                        <small style={{ display: 'block', color: 'var(--muted)', marginTop: 4 }}>{row.action_family}</small>
                      </td>
                      <td style={{ padding: '0.72rem' }}>
                        <span style={{ fontSize: '0.75rem', borderRadius: 999, padding: '0.2rem 0.5rem', border: '1px solid var(--border)', color: row.mapping_source === 'user_override' ? 'var(--accent)' : 'var(--muted)' }}>
                          {row.mapping_source === 'user_override' ? 'User override' : 'Interpreted default'}
                        </span>
                      </td>
                      <td style={{ padding: '0.72rem' }}>
                        {row.override_risk_tier && <button className="btn secondary" type="button" disabled={saving} onClick={() => reset(row)}>Reset</button>}
                      </td>
                    </tr>
                  );
                })}
                {!filtered.length && <tr><td colSpan="6" style={{ padding: '1.2rem', color: 'var(--muted)', textAlign: 'center' }}>No capabilities match this filter.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
