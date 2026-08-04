import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { RequireAuth } from '../context/AuthContext';

function statusClass(status) {
  if (status === 'active') return 'sg-badge sg-badge-active';
  if (status === 'paused') return 'sg-badge sg-badge-paused';
  return 'sg-badge sg-badge-done';
}

function ScheduledGoalsPanel() {
  const [goals, setGoals] = useState([]);
  const [timezone, setTimezone] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);
  const [filter, setFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [agents, setAgents] = useState([]);
  const [form, setForm] = useState({
    title: '',
    prompt: '',
    agent_id: 'balserve',
    cadence: 'daily',
    time_local: '09:00',
    ends_at: '',
    weekday: 1,
  });

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .scheduledGoalsList()
      .then((data) => {
        setGoals(data.goals || []);
        setTimezone(data.server_timezone || '');
      })
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.agentsList().then((list) => setAgents(Array.isArray(list) ? list : list?.agents || [])).catch(() => {});
  }, []);

  const filtered = goals.filter((g) => (filter === 'all' ? true : g.status === filter));

  const runAction = async (id, fn, okMsg) => {
    setBusyId(id);
    setMessage(null);
    setError(null);
    try {
      await fn();
      setMessage(okMsg);
      load();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    setBusyId('create');
    setError(null);
    try {
      await api.scheduledGoalsCreate({
        title: form.title || undefined,
        prompt: form.prompt,
        agent_id: form.agent_id,
        cadence: form.cadence,
        time_local: form.time_local,
        weekday: form.cadence === 'weekly' ? Number(form.weekday) : undefined,
        ends_at: form.ends_at || 'perpetual',
      });
      setShowCreate(false);
      setForm({ title: '', prompt: '', agent_id: form.agent_id, cadence: 'daily', time_local: '09:00', ends_at: '', weekday: 1 });
      setMessage('Scheduled goal created — it will fire automatically while active.');
      load();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <header className="page-hero" style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0 }}>Scheduled goals</h1>
        <p style={{ margin: '0.4rem 0 0', color: 'var(--muted)', maxWidth: 640 }}>
          Recurring prompts your AI employees run on a schedule. Chat the COO to create one in plain language, or add
          one here. Pause or delete stops the schedule immediately and after restarts.
        </p>
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
        <button type="button" className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Cancel' : 'New scheduled goal'}
        </button>
        <Link to="/agents/balserve/chat" className="btn-secondary" style={{ textDecoration: 'none' }}>
          Ask COO
        </Link>
        <select value={filter} onChange={(ev) => setFilter(ev.target.value)} aria-label="Filter status">
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="completed">Ended</option>
        </select>
        {timezone && (
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Company timezone: {timezone}</span>
        )}
      </div>

      {showCreate && (
        <form
          onSubmit={create}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.65rem',
            marginBottom: '1.25rem',
            padding: '1rem',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--surface)',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Title (optional)</span>
            <input
              value={form.title}
              onChange={(ev) => setForm((f) => ({ ...f, title: ev.target.value }))}
              placeholder="Daily market insights"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Prompt (what to do each run)</span>
            <textarea
              required
              rows={4}
              value={form.prompt}
              onChange={(ev) => setForm((f) => ({ ...f, prompt: ev.target.value }))}
              placeholder="Generate a fresh daily market insights analysis and prepare blog, LinkedIn, and Facebook posts. Do not repeat prior angles."
            />
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Who runs it</span>
              <select value={form.agent_id} onChange={(ev) => setForm((f) => ({ ...f, agent_id: ev.target.value }))}>
                {agents.length === 0 && <option value="balserve">COO (BalServe)</option>}
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || a.id}
                    {a.is_coo ? ' (COO)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Cadence</span>
              <select value={form.cadence} onChange={(ev) => setForm((f) => ({ ...f, cadence: ev.target.value }))}>
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            {form.cadence === 'weekly' && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Weekday</span>
                <select
                  value={form.weekday}
                  onChange={(ev) => setForm((f) => ({ ...f, weekday: Number(ev.target.value) }))}
                >
                  <option value={0}>Sunday</option>
                  <option value={1}>Monday</option>
                  <option value={2}>Tuesday</option>
                  <option value={3}>Wednesday</option>
                  <option value={4}>Thursday</option>
                  <option value={5}>Friday</option>
                  <option value={6}>Saturday</option>
                </select>
              </label>
            )}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Time</span>
              <input
                type="time"
                required
                value={form.time_local}
                onChange={(ev) => setForm((f) => ({ ...f, time_local: ev.target.value }))}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Ends (optional)</span>
              <input
                type="date"
                value={form.ends_at}
                onChange={(ev) => setForm((f) => ({ ...f, ends_at: ev.target.value }))}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Empty = perpetual</span>
            </label>
          </div>
          <button type="submit" className="btn-primary" disabled={busyId === 'create' || !form.prompt.trim()}>
            {busyId === 'create' ? 'Saving…' : 'Save schedule'}
          </button>
        </form>
      )}

      {message && (
        <p style={{ color: 'var(--accent)', fontSize: '0.9rem' }} role="status">
          {message}
        </p>
      )}
      {error && (
        <p style={{ color: 'var(--danger, #c44)', fontSize: '0.9rem' }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>
          No scheduled goals yet. Chat the COO: “Every weekday at 9, prepare market insights for LinkedIn and blog,” or
          create one above.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '0.5rem' }}>Goal / prompt</th>
                <th style={{ padding: '0.5rem' }}>Agent</th>
                <th style={{ padding: '0.5rem' }}>Schedule</th>
                <th style={{ padding: '0.5rem' }}>Ends</th>
                <th style={{ padding: '0.5rem' }}>Status</th>
                <th style={{ padding: '0.5rem' }}>Last run</th>
                <th style={{ padding: '0.5rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr key={g.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.65rem 0.5rem', maxWidth: 280 }}>
                    <div style={{ fontWeight: 600 }}>{g.title}</div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>
                      {String(g.prompt || '').slice(0, 160)}
                      {String(g.prompt || '').length > 160 ? '…' : ''}
                    </div>
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <Link to={`/agents/${encodeURIComponent(g.agent_id)}/chat`}>{g.agent_name || g.agent_id}</Link>
                  </td>
                  <td style={{ padding: '0.5rem' }}>{g.schedule_label}</td>
                  <td style={{ padding: '0.5rem' }}>{g.ends_label || (g.is_perpetual ? 'Perpetual' : g.ends_at)}</td>
                  <td style={{ padding: '0.5rem' }}>
                    <span className={statusClass(g.status)}>{g.status}</span>
                  </td>
                  <td style={{ padding: '0.5rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
                    {g.last_run_status || '—'}
                    {g.run_count ? ` · ${g.run_count} run(s)` : ''}
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {g.status === 'active' ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={busyId === g.id}
                          onClick={() => runAction(g.id, () => api.scheduledGoalsPause(g.id), 'Paused (off after restart too).')}
                        >
                          Pause
                        </button>
                      ) : g.status === 'paused' ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={busyId === g.id}
                          onClick={() => runAction(g.id, () => api.scheduledGoalsResume(g.id), 'Resumed.')}
                        >
                          Resume
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={busyId === g.id}
                        onClick={() => runAction(g.id, () => api.scheduledGoalsRunNow(g.id), 'Run started — check agent chat.')}
                      >
                        Run now
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={busyId === g.id}
                        onClick={() => {
                          if (!window.confirm('Delete this schedule permanently?')) return;
                          runAction(g.id, () => api.scheduledGoalsDelete(g.id), 'Deleted.');
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        .sg-badge { font-size: 0.75rem; padding: 0.15rem 0.45rem; border-radius: 4px; text-transform: capitalize; }
        .sg-badge-active { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
        .sg-badge-paused { background: color-mix(in srgb, #c90 15%, transparent); color: #a60; }
        .sg-badge-done { background: color-mix(in srgb, var(--muted) 20%, transparent); color: var(--muted); }
        .page input, .page select, .page textarea {
          padding: 0.45rem 0.55rem; border-radius: 6px; border: 1px solid var(--border);
          background: var(--bg, var(--surface)); color: var(--text); font: inherit;
        }
      `}</style>
    </div>
  );
}

export default function ScheduledGoals() {
  return (
    <RequireAuth>
      <ScheduledGoalsPanel />
    </RequireAuth>
  );
}