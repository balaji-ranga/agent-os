import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { RequireAuth } from '../context/AuthContext';

function statusClass(status) {
  if (status === 'active') return 'sg-badge sg-badge-active';
  if (status === 'paused') return 'sg-badge sg-badge-paused';
  return 'sg-badge sg-badge-done';
}

const EMPTY_FORM = {
  title: '',
  prompt: '',
  agent_id: 'balserve',
  cadence: 'daily',
  time_local: '09:00',
  ends_at: '',
  weekday: 1,
};

function endsToDateInput(endsAt) {
  if (!endsAt) return '';
  const s = String(endsAt);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  try {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch (_) {
    /* ignore */
  }
  return '';
}

function timeFieldLabel(cadence) {
  if (cadence === 'hourly') return 'Minute of each hour (use time; hour is ignored, :MM used)';
  return 'Time';
}

function ScheduledGoalsPanel() {
  const [goals, setGoals] = useState([]);
  const [timezone, setTimezone] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);
  const [filter, setFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [agents, setAgents] = useState([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });

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

  const resetForm = (keepAgentId) => {
    setForm({ ...EMPTY_FORM, agent_id: keepAgentId || form.agent_id || 'balserve' });
    setEditingId(null);
    setShowForm(false);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, agent_id: form.agent_id || 'balserve' });
    setShowForm(true);
    setMessage(null);
    setError(null);
  };

  const openEdit = (g) => {
    setEditingId(g.id);
    setForm({
      title: g.title || '',
      prompt: g.prompt || '',
      agent_id: g.agent_id || 'balserve',
      cadence: g.cadence || 'daily',
      time_local: g.time_local || (g.cadence === 'hourly' ? '00:00' : '09:00'),
      ends_at: endsToDateInput(g.ends_at),
      weekday: g.weekday != null ? Number(g.weekday) : 1,
    });
    setShowForm(true);
    setMessage(null);
    setError(null);
    // Ensure the edit form is visible (esp. on short viewports / long lists).
    requestAnimationFrame(() => {
      document.getElementById('sg-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const enrichPromptWithAi = async () => {
    if (!form.prompt.trim()) {
      setError('Enter a draft prompt before enriching with AI.');
      return;
    }
    setEnrichBusy(true);
    setError(null);
    setMessage(null);
    try {
      const out = await api.scheduledGoalsEnrich({ prompt: form.prompt, title: form.title || '' });
      if (out.prompt) {
        setForm((f) => ({ ...f, prompt: out.prompt }));
        setMessage(
          out.model
            ? `AI enriched the goal prompt (model: ${out.model}). Review before saving.`
            : 'AI enriched the goal prompt. Review before saving.'
        );
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setEnrichBusy(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setBusyId(editingId || 'create');
    setError(null);
    const body = {
      title: form.title || undefined,
      prompt: form.prompt,
      agent_id: form.agent_id,
      cadence: form.cadence,
      time_local: form.time_local,
      weekday: form.cadence === 'weekly' ? Number(form.weekday) : undefined,
      ends_at: form.ends_at || 'perpetual',
    };
    try {
      if (editingId) {
        await api.scheduledGoalsUpdate(editingId, body);
        setMessage('Scheduled goal updated.');
      } else {
        await api.scheduledGoalsCreate(body);
        setMessage('Scheduled goal created — it will fire automatically while active.');
      }
      resetForm(form.agent_id);
      load();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onCadenceChange = (cadence) => {
    setForm((f) => ({
      ...f,
      cadence,
      time_local:
        cadence === 'hourly'
          ? f.cadence === 'hourly'
            ? f.time_local
            : '00:00'
          : f.cadence === 'hourly'
            ? '09:00'
            : f.time_local,
    }));
  };

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <header className="page-hero" style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0 }}>Scheduled goals</h1>
        <p style={{ margin: '0.4rem 0 0', color: 'var(--muted)', maxWidth: 640 }}>
          Recurring prompts your AI employees run on a schedule (hourly, daily, weekdays, or weekly). Chat the COO in
          plain language, or create and <strong>edit</strong> schedules here. Pause or delete stops the clock immediately
          and after restarts.
        </p>
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            if (showForm && !editingId) resetForm();
            else openCreate();
          }}
        >
          {showForm && !editingId ? 'Cancel' : 'New scheduled goal'}
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

      {showForm && (
        <form
          id="sg-form"
          onSubmit={save}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.65rem',
            marginBottom: '1.25rem',
            padding: '1rem',
            border: editingId
              ? '2px solid color-mix(in srgb, var(--accent) 55%, var(--border))'
              : '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--surface)',
          }}
        >
          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
            {editingId ? 'Edit scheduled goal' : 'New scheduled goal'}
          </div>
          {editingId && (
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
              Change any field below and click <strong>Save changes</strong>. Cadence can be hourly, daily, weekdays,
              or weekly.
            </p>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Title (optional)</span>
            <input
              value={form.title}
              onChange={(ev) => setForm((f) => ({ ...f, title: ev.target.value }))}
              placeholder="Hourly MAGS dip check"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Prompt (what to do each run)</span>
            <textarea
              required
              rows={4}
              value={form.prompt}
              onChange={(ev) => setForm((f) => ({ ...f, prompt: ev.target.value }))}
              placeholder="Check MAGS vs previous close; if down ≥2%, notify me. Otherwise do not notify."
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
              <select value={form.cadence} onChange={(ev) => onCadenceChange(ev.target.value)}>
                <option value="hourly">Hourly</option>
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
              <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{timeFieldLabel(form.cadence)}</span>
              <input
                type="time"
                required
                value={form.time_local}
                onChange={(ev) => setForm((f) => ({ ...f, time_local: ev.target.value }))}
              />
              {form.cadence === 'hourly' && (
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                  Fires once every hour at that minute (e.g. 00:15 → every hour at :15)
                </span>
              )}
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
          <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
            <button
              type="submit"
              className="btn-primary"
              disabled={busyId === (editingId || 'create') || enrichBusy || !form.prompt.trim()}
            >
              {busyId === (editingId || 'create')
                ? 'Saving…'
                : editingId
                  ? 'Save changes'
                  : 'Save schedule'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busyId === (editingId || 'create') || enrichBusy || !form.prompt.trim()}
              onClick={enrichPromptWithAi}
              title="AI clarifies and structures your goal for the target AI employee"
            >
              {enrichBusy ? 'Enriching…' : 'Enrich with AI'}
            </button>
            {editingId && (
              <button type="button" className="btn-secondary" onClick={() => resetForm(form.agent_id)}>
                Cancel edit
              </button>
            )}
          </div>
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
          No scheduled goals yet. Chat the COO: “Every hour, check MAGS and notify me if down 2%,” or create one above.
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
                  <td style={{ padding: '0.65rem 0.5rem', maxWidth: 320 }}>
                    <button
                      type="button"
                      onClick={() => openEdit(g)}
                      title="Edit this goal"
                      style={{
                        fontWeight: 600,
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        margin: 0,
                        color: 'var(--text)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        font: 'inherit',
                        textDecoration: editingId === g.id ? 'underline' : 'none',
                      }}
                    >
                      {g.title || 'Untitled goal'}
                    </button>
                    <div
                      className="sg-prompt-preview"
                      title={String(g.prompt || '')}
                      style={{
                        color: 'var(--muted)',
                        fontSize: '0.8rem',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 300,
                        cursor: 'pointer',
                      }}
                      onClick={() => openEdit(g)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          openEdit(g);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {String(g.prompt || '')}
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
                  <td style={{ padding: '0.5rem', minWidth: 200 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={busyId === g.id}
                        onClick={() => openEdit(g)}
                        aria-label={`Edit scheduled goal ${g.title || g.id}`}
                      >
                        Edit
                      </button>
                      {g.status === 'active' ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={busyId === g.id}
                          onClick={() =>
                            runAction(g.id, () => api.scheduledGoalsPause(g.id), 'Paused (off after restart too).')
                          }
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
                        onClick={() =>
                          runAction(g.id, () => api.scheduledGoalsRunNow(g.id), 'Run started — check agent chat.')
                        }
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
