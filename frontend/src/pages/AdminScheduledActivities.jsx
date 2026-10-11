import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { formatLocalDateTime } from '../utils/formatDateTime.js';

const KIND_LABELS = {
  standup: 'Daily standup',
  scheduled_goal: 'Scheduled goal',
  workflow_schedule: 'Workflow schedule',
  event_listener: 'Event listener',
};

function badge(status) {
  const active = status === 'active';
  const paused = status === 'paused';
  return {
    label: status || 'unknown',
    color: active ? '#15803d' : paused ? '#b45309' : '#475569',
    background: active ? 'rgba(34,197,94,.13)' : paused ? 'rgba(245,158,11,.14)' : 'rgba(100,116,139,.12)',
  };
}

export default function AdminScheduledActivities() {
  const [data, setData] = useState({ items: [], summary: {} });
  const [filters, setFilters] = useState({ user_id: '', kind: '', status: '', q: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await api.adminScheduledActivities(filters)); }
    catch (e) { setError(e.message || 'Failed to load scheduled activities'); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { const timer = setTimeout(load, 180); return () => clearTimeout(timer); }, [load]);

  const users = useMemo(() => {
    const map = new Map();
    for (const item of data.items || []) map.set(item.user_id, { id: item.user_id, name: item.user_name, email: item.user_email });
    return [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [data.items]);

  const act = async (payload, label) => {
    setBusy(label); setError(''); setNotice('');
    try {
      const result = await api.adminScheduledActivitiesAction(payload);
      setNotice(`${label}: ${result.succeeded} succeeded${result.failed ? `, ${result.failed} failed` : ''}.`);
      await load();
    } catch (e) { setError(e.message || `${label} failed`); }
    finally { setBusy(''); }
  };

  const itemAction = (item, action) => {
    const label = `${action} ${KIND_LABELS[item.kind]} “${item.name}”`;
    if (action === 'remove' && !window.confirm(`Permanently remove ${KIND_LABELS[item.kind]} “${item.name}” for ${item.user_name}?`)) return;
    act({ action, kind: item.kind, user_id: item.user_id, job_id: item.job_id }, label);
  };

  const bulk = (scope, action) => {
    const userId = scope === 'user' ? filters.user_id : '';
    if (scope === 'user' && !userId) { setError('Select a CEO before using user-level bulk actions.'); return; }
    const target = scope === 'all' ? 'all users' : users.find((user) => user.id === userId)?.name || userId;
    const kindText = filters.kind ? KIND_LABELS[filters.kind] : 'all scheduled activity types';
    const payload = { action, kind: filters.kind || undefined, ...(scope === 'all' ? { all_users: true } : { user_id: userId }) };
    if (action === 'remove') {
      const promptText = scope === 'all' ? 'REMOVE ALL SCHEDULED ACTIVITIES' : userId;
      const entered = window.prompt(`This permanently removes ${kindText} for ${target}. Type ${promptText} to confirm.`);
      if (entered !== promptText) return;
      payload.confirm = entered;
    } else if (!window.confirm(`${action === 'pause' ? 'Pause' : 'Resume'} ${kindText} for ${target}?`)) return;
    act(payload, `${action} ${kindText} for ${target}`);
  };

  return (
    <div className="page" style={{ maxWidth: 1400, margin: '0 auto', padding: '1.25rem 1rem 3rem' }}>
      <header className="page-hero" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>User scheduled activities</h1>
        <p style={{ color: 'var(--muted)', maxWidth: 850 }}>
          Review and control recurring agent work across CEOs. Pause is reversible. Removing a workflow schedule keeps the workflow and makes it non-scheduled; removing a standup or goal also removes its associated execution history.
        </p>
      </header>

      {error && <div className="mcp-pg-banner mcp-pg-banner-err" style={{ marginBottom: 10 }}>{error}</div>}
      {notice && <div className="mcp-pg-banner mcp-pg-banner-ok" style={{ marginBottom: 10 }}>{notice}</div>}

      <section style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'var(--surface)', marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,2fr) repeat(3,minmax(150px,1fr))', gap: 10 }}>
          <input aria-label="Search scheduled activities" placeholder="Search CEO, email, name, or job ID" value={filters.q} onChange={(e) => setFilters((value) => ({ ...value, q: e.target.value }))} />
          <select aria-label="CEO filter" value={filters.user_id} onChange={(e) => setFilters((value) => ({ ...value, user_id: e.target.value }))}>
            <option value="">All CEOs</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}
          </select>
          <select aria-label="Activity type filter" value={filters.kind} onChange={(e) => setFilters((value) => ({ ...value, kind: e.target.value }))}>
            <option value="">All activity types</option>{Object.entries(KIND_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <select aria-label="Status filter" value={filters.status} onChange={(e) => setFilters((value) => ({ ...value, status: e.target.value }))}>
            <option value="">All statuses</option><option value="active">Active</option><option value="paused">Paused</option><option value="draft">Draft</option><option value="completed">Completed</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="mcp-pg-btn-ghost mcp-pg-btn-sm" disabled={!!busy || !filters.user_id} onClick={() => bulk('user', 'pause')}>Pause selected CEO</button>
          <button className="mcp-pg-btn-ghost mcp-pg-btn-sm" disabled={!!busy || !filters.user_id} onClick={() => bulk('user', 'resume')}>Resume selected CEO</button>
          <button className="mcp-pg-btn-ghost mcp-pg-btn-sm" disabled={!!busy || !filters.user_id} onClick={() => bulk('user', 'remove')}>Remove selected CEO setups</button>
          <span style={{ flex: 1 }} />
          <button className="mcp-pg-btn-ghost mcp-pg-btn-sm" disabled={!!busy} onClick={() => bulk('all', 'pause')}>Pause all users</button>
          <button className="mcp-pg-btn-ghost mcp-pg-btn-sm" disabled={!!busy} onClick={() => bulk('all', 'resume')}>Resume all users</button>
          <button className="mcp-pg-btn-ghost mcp-pg-btn-sm" disabled={!!busy} onClick={() => bulk('all', 'remove')}>Remove all setups</button>
        </div>
        <small style={{ display: 'block', color: 'var(--muted)', marginTop: 8 }}>The activity-type filter scopes bulk actions. Search and status filters only affect the displayed list.</small>
      </section>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12, color: 'var(--muted)' }}>
        <span><strong style={{ color: 'var(--text)' }}>{data.summary?.total || 0}</strong> setups</span>
        <span><strong style={{ color: 'var(--text)' }}>{data.summary?.active || 0}</strong> active</span>
        <span><strong style={{ color: 'var(--text)' }}>{data.summary?.paused || 0}</strong> paused</span>
        {busy && <span>Working: {busy}…</span>}
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
          <thead><tr>{['CEO', 'Type', 'Setup / Job ID', 'Schedule', 'Status', 'Agent', 'Updated', 'Actions'].map((label) => <th key={label} style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid var(--border)', fontSize: '.78rem' }}>{label}</th>)}</tr></thead>
          <tbody>
            {!loading && !(data.items || []).length && <tr><td colSpan="8" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>No scheduled activities match these filters.</td></tr>}
            {(data.items || []).map((item) => { const state = badge(item.status); return (
              <tr key={`${item.kind}:${item.user_id}:${item.job_id}`}>
                <td style={{ padding: 10, borderBottom: '1px solid var(--border)' }}><strong>{item.user_name}</strong><div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>{item.user_email}<br />{item.user_id}</div></td>
                <td style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>{KIND_LABELS[item.kind]}</td>
                <td style={{ padding: 10, borderBottom: '1px solid var(--border)' }}><strong>{item.name}</strong><div style={{ fontFamily: 'monospace', fontSize: '.73rem', color: 'var(--muted)', maxWidth: 260, overflowWrap: 'anywhere' }}>{item.job_id}</div></td>
                <td style={{ padding: 10, borderBottom: '1px solid var(--border)', fontSize: '.82rem' }}>{item.schedule || '—'}</td>
                <td style={{ padding: 10, borderBottom: '1px solid var(--border)' }}><span style={{ padding: '3px 7px', borderRadius: 999, color: state.color, background: state.background, fontSize: '.75rem', fontWeight: 700 }}>{state.label}</span></td>
                <td style={{ padding: 10, borderBottom: '1px solid var(--border)', fontSize: '.82rem' }}>{item.agent_name || '—'}</td>
                <td style={{ padding: 10, borderBottom: '1px solid var(--border)', fontSize: '.78rem', color: 'var(--muted)' }}>{item.updated_at ? formatLocalDateTime(item.updated_at) : '—'}</td>
                <td style={{ padding: 10, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                  {item.status === 'paused' ? <button className="mcp-pg-btn-ghost mcp-pg-btn-sm" disabled={!!busy} onClick={() => itemAction(item, 'resume')}>Resume</button> : <button className="mcp-pg-btn-ghost mcp-pg-btn-sm" disabled={!!busy || item.status === 'completed'} onClick={() => itemAction(item, 'pause')}>Pause</button>}
                  <button className="mcp-pg-btn-ghost mcp-pg-btn-sm" disabled={!!busy} onClick={() => itemAction(item, 'remove')} style={{ marginLeft: 6 }}>Remove</button>
                </td>
              </tr>
            ); })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
