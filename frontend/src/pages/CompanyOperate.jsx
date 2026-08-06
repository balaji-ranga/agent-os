import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';

const RESUME_KEY = 'company-operate-resume-step';

const LEVELS = [
  { id: 'auto', label: 'Auto' },
  { id: 'recommend', label: 'Recommend' },
  { id: 'require_ceo', label: 'CEO approval' },
];

const READY = [
  { id: 'not_ready', label: 'Not ready' },
  { id: 'setup_later', label: 'Setup later' },
  { id: 'ready', label: 'Ready (I set it up)' },
];

function btnPrimary(extra = {}) {
  return {
    padding: '0.55rem 1rem',
    background: 'var(--accent)',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    cursor: extra.cursor || 'pointer',
    font: 'inherit',
    fontSize: '0.95rem',
    opacity: extra.disabled ? 0.7 : 1,
    ...extra,
  };
}

function btnSecondary(extra = {}) {
  return {
    padding: '0.55rem 1rem',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text)',
    cursor: extra.cursor || 'pointer',
    font: 'inherit',
    fontSize: '0.95rem',
    opacity: extra.disabled ? 0.7 : 1,
    ...extra,
  };
}

function cardStyle(active) {
  return {
    padding: '1rem',
    borderRadius: 10,
    border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
    background: 'var(--surface)',
    cursor: 'pointer',
    textAlign: 'left',
  };
}

function Spinner({ label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} aria-live="polite">
      <span
        aria-hidden
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          border: '2px solid rgba(255,255,255,0.35)',
          borderTopColor: 'currentColor',
          animation: 'co-spin 0.7s linear infinite',
          display: 'inline-block',
        }}
      />
      {label}
    </span>
  );
}

function systemLinkLabel(s) {
  if (s?.id === 'kanban') return 'Open board';
  if (s?.id === 'browser_session') return 'Open Browser Session';
  if (s?.id === 'replicate') return 'Open API Keys';
  return 'Open page';
}

function systemHint(s) {
  if (s?.id === 'kanban') {
    return 'Not a separate pipeline wizard. Agents create tasks here dynamically (kanban_* tools). Used for approvals and handoffs.';
  }
  if (s?.id === 'browser_session') {
    return 'Login once to FB / IG / LI / blog CMS in Client Chrome so agents can run publish recipes. Preferred today for social.';
  }
  if (s?.id === 'replicate') {
    return 'Optional image generation BYOK — not required for Day 1.';
  }
  return null;
}

function fieldStyle() {
  return {
    width: '100%',
    font: 'inherit',
    padding: '0.45rem 0.55rem',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
  };
}


const PATH_PRESETS = [
  { path: '/browser-session', label: 'Browser Session' },
  { path: '/kanban', label: 'Kanban' },
  { path: '/api-keys', label: 'API Keys' },
  { path: '/connectors', label: 'Connectors' },
  { path: '/master-data', label: 'Master Data' },
  { path: '/scheduled-goals', label: 'Scheduled goals' },
  { path: '/policies', label: 'Policies' },
];

const SYSTEM_PRESETS = [
  { id: 'browser_session', label: 'Browser Session', path: '/browser-session', required: true },
  { id: 'kanban', label: 'Kanban', path: '/kanban', required: true },
  { id: 'master_data', label: 'Master Data', path: '/master-data', required: true },
  { id: 'replicate', label: 'Replicate BYOK', path: '/api-keys', required: false },
  { id: 'gmail', label: 'Gmail / Email', path: '/connectors', required: false },
  { id: 'slack', label: 'Slack', path: '/ai-employees', required: false },
  { id: 'notion', label: 'Notion', path: '/connectors', required: false },
  { id: 'github', label: 'GitHub', path: '/connectors', required: false },
];

const CHANNEL_PRESETS = [
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'blog', label: 'Blog CMS' },
  { id: 'twitter', label: 'X / Twitter' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'youtube', label: 'YouTube' },
];

function slugifyLocal(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || ('item_' + Date.now().toString(36));
}

function SystemsChannelsEditor({ model, busy, onChange, agentNames = [], onOpenPath }) {
  const systems = model?.systems_run || [];
  const channels = model?.channels || [];
  const goals = model?.goals || [];

  const setSystems = (next) => onChange({ ...model, systems_run: next });
  const setChannels = (next) => onChange({ ...model, channels: next });
  const setGoals = (next) => onChange({ ...model, goals: next });

  const updateSys = (id, patch) =>
    setSystems(systems.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeSys = (id) => setSystems(systems.filter((s) => s.id !== id));
  const addSys = (preset) => {
    if (systems.length >= 20) return;
    const base = preset
      ? { ...preset }
      : {
          id: 'sys_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
          label: 'Custom system',
          path: '/connectors',
          required: false,
        };
    if (!base.id) base.id = 'sys_' + Date.now().toString(36);
    if (systems.some((s) => s.id === base.id)) {
      base.id = base.id + '_' + Date.now().toString(36).slice(-4);
    }
    setSystems([
      ...systems,
      { ...base, readiness: base.readiness || 'not_ready' },
    ]);
  };

  const updateCh = (id, patch) =>
    setChannels(channels.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const removeCh = (id) => setChannels(channels.filter((c) => c.id !== id));
  const addCh = (preset) => {
    if (channels.length >= 16) return;
    const base = preset
      ? { ...preset }
      : {
          id: 'ch_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
          label: 'Custom channel',
          owner_role: agentNames[0] || 'COO',
          path: '/browser-session',
          system_id: 'browser_session',
        };
    if (!base.id) base.id = 'ch_' + Date.now().toString(36);
    if (channels.some((c) => c.id === base.id)) {
      base.id = base.id + '_' + Date.now().toString(36).slice(-4);
    }
    setChannels([
      ...channels,
      {
        ...base,
        path: base.path || '/browser-session',
        system_id: base.system_id || 'browser_session',
        owner_role: base.owner_role || agentNames[0] || 'COO',
        readiness: base.readiness || 'not_ready',
      },
    ]);
  };

  const updateGoal = (id, patch) =>
    setGoals(goals.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const removeGoal = (id) => setGoals(goals.filter((g) => g.id !== id));
  const addGoal = () => {
    if (goals.length >= 16) return;
    setGoals([
      ...goals,
      {
        id: 'goal_' + Date.now().toString(36),
        label: 'Custom company goal',
        path: '/scheduled-goals',
        owner_role: 'CEO',
        cadence: 'weekly',
        required: true,
        readiness: 'not_ready',
        note: '',
      },
    ]);
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h3 style={{ margin: '0 0 0.35rem' }}>Systems</h3>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', opacity: 0.78, maxWidth: 640 }}>
          Seeded from template or AI design (+ Company Setup choices). Add/remove rows manually — readiness is honesty for Day 1 install, not live OAuth.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          {systems.map((s, sIdx) => (
            <div
              key={(s.id || 'sys') + '-' + sIdx}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '0.75rem',
                background: 'var(--surface)',
                display: 'grid',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  disabled={busy}
                  value={s.label || ''}
                  onChange={(e) => updateSys(s.id, { label: e.target.value })}
                  placeholder="Label"
                  style={{ ...fieldStyle(), flex: '1 1 12rem' }}
                />
                <select
                  value={s.readiness || 'not_ready'}
                  disabled={busy}
                  onChange={(e) => updateSys(s.id, { readiness: e.target.value })}
                  style={{ padding: 6, borderRadius: 6, font: 'inherit' }}
                >
                  {READY.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
                <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={!!s.required}
                    onChange={(e) => updateSys(s.id, { required: e.target.checked })}
                  />
                  Required
                </label>
                <button type="button" style={btnSecondary({ padding: '0.3rem 0.6rem', fontSize: '0.8rem' })} disabled={busy} onClick={() => removeSys(s.id)}>
                  Remove
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  disabled={busy}
                  value={s.id || ''}
                  onChange={(e) => {
                    const nextId = slugifyLocal(e.target.value) || s.id;
                    if (!nextId || nextId === s.id) return;
                    updateSys(s.id, { id: nextId });
                  }}
                  placeholder="id"
                  style={{ ...fieldStyle(), flex: '0 1 10rem' }}
                  title="Stable id"
                />
                <select
                  disabled={busy}
                  value={PATH_PRESETS.some((p) => p.path === s.path) ? s.path : (s.path || '/connectors')}
                  onChange={(e) => updateSys(s.id, { path: e.target.value })}
                  style={{ ...fieldStyle(), flex: '1 1 10rem' }}
                >
                  {PATH_PRESETS.map((p) => (
                    <option key={p.path} value={p.path}>{p.label} ({p.path})</option>
                  ))}
                  {s.path && !PATH_PRESETS.some((p) => p.path === s.path) ? (
                    <option value={s.path}>{s.path}</option>
                  ) : null}
                </select>
                {s.path ? (
                  <button type="button" style={btnSecondary({ padding: '0.35rem 0.7rem', fontSize: '0.85rem' })} disabled={busy} onClick={() => onOpenPath?.(s.path)}>
                    Open
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, padding: '0.65rem', borderRadius: 8, border: '1px dashed var(--border)', background: 'var(--bg)' }}>
          <button type="button" style={btnPrimary({ disabled: busy || systems.length >= 20 })} disabled={busy || systems.length >= 20} onClick={() => addSys()}>
            + Add system
          </button>
          {SYSTEM_PRESETS.filter((pr) => !systems.some((s) => s.id === pr.id)).map((pr) => (
            <button key={pr.id} type="button" style={btnSecondary({ padding: '0.35rem 0.65rem', fontSize: '0.85rem' })} disabled={busy} onClick={() => addSys(pr)}>
              + {pr.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 style={{ margin: '0 0 0.35rem' }}>Channels</h3>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', opacity: 0.78, maxWidth: 640 }}>
          Public surfaces your company publishes or monitors. Social usually routes through Browser Session.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          {channels.map((c, cIdx) => (
            <div
              key={(c.id || 'ch') + '-' + cIdx}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '0.75rem',
                background: 'var(--surface)',
                display: 'grid',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  disabled={busy}
                  value={c.label || ''}
                  onChange={(e) => updateCh(c.id, { label: e.target.value })}
                  placeholder="Channel name"
                  style={{ ...fieldStyle(), flex: '1 1 12rem' }}
                />
                <select
                  value={c.readiness || 'not_ready'}
                  disabled={busy}
                  onChange={(e) => updateCh(c.id, { readiness: e.target.value })}
                  style={{ padding: 6, borderRadius: 6, font: 'inherit' }}
                >
                  {READY.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
                <button type="button" style={btnSecondary({ padding: '0.3rem 0.6rem', fontSize: '0.8rem' })} disabled={busy} onClick={() => removeCh(c.id)}>
                  Remove
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))', gap: 8 }}>
                <input
                  disabled={busy}
                  list="operate-loop-agent-names"
                  value={c.owner_role || ''}
                  onChange={(e) => updateCh(c.id, { owner_role: e.target.value })}
                  placeholder="Owner role"
                  style={fieldStyle()}
                />
                <select
                  disabled={busy}
                  value={c.path || '/browser-session'}
                  onChange={(e) => updateCh(c.id, { path: e.target.value })}
                  style={fieldStyle()}
                >
                  {PATH_PRESETS.map((pr) => (
                    <option key={pr.path} value={pr.path}>{pr.label}</option>
                  ))}
                </select>
                {c.path ? (
                  <button type="button" style={btnSecondary({ padding: '0.35rem 0.7rem', fontSize: '0.85rem' })} disabled={busy} onClick={() => onOpenPath?.(c.path || '/browser-session')}>
                    Open
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, padding: '0.65rem', borderRadius: 8, border: '1px dashed var(--border)', background: 'var(--bg)' }}>
          <button type="button" style={btnPrimary({ disabled: busy || channels.length >= 16 })} disabled={busy || channels.length >= 16} onClick={() => addCh()}>
            + Add channel
          </button>
          {CHANNEL_PRESETS.filter((pr) => !channels.some((c) => c.id === pr.id)).map((pr) => (
            <button key={pr.id} type="button" style={btnSecondary({ padding: '0.35rem 0.65rem', fontSize: '0.85rem' })} disabled={busy} onClick={() => addCh(pr)}>
              + {pr.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 style={{ margin: '0 0 0.35rem' }}>Goals</h3>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', opacity: 0.78, maxWidth: 640 }}>
          Tracked like systems and channels. Content topics come from CEO goals (e.g. weekly content goal to COO).
          Mark ready only after the goal exists under Scheduled goals or an explicit CEO brief.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          {goals.map((g, gIdx) => (
            <div
              key={(g.id || 'goal') + '-' + gIdx}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '0.75rem',
                background: 'var(--surface)',
                display: 'grid',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  disabled={busy}
                  value={g.label || ''}
                  onChange={(e) => updateGoal(g.id, { label: e.target.value })}
                  placeholder="Goal label"
                  style={{ ...fieldStyle(), flex: '1 1 12rem' }}
                />
                <select
                  value={g.readiness || 'not_ready'}
                  disabled={busy}
                  onChange={(e) => updateGoal(g.id, { readiness: e.target.value })}
                  style={{ padding: 6, borderRadius: 6, font: 'inherit' }}
                >
                  {READY.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
                <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={g.required !== false}
                    onChange={(e) => updateGoal(g.id, { required: e.target.checked })}
                  />
                  Required
                </label>
                <button type="button" style={btnSecondary({ padding: '0.3rem 0.6rem', fontSize: '0.8rem' })} disabled={busy} onClick={() => removeGoal(g.id)}>
                  Remove
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))', gap: 8 }}>
                <input
                  disabled={busy}
                  value={g.owner_role || ''}
                  onChange={(e) => updateGoal(g.id, { owner_role: e.target.value })}
                  placeholder="Owner (CEO / COO)"
                  style={fieldStyle()}
                />
                <select
                  disabled={busy}
                  value={g.cadence || 'weekly'}
                  onChange={(e) => updateGoal(g.id, { cadence: e.target.value })}
                  style={fieldStyle()}
                >
                  <option value="weekly">Weekly</option>
                  <option value="daily">Daily</option>
                  <option value="event">Event</option>
                  <option value="once">Once</option>
                </select>
                <select
                  disabled={busy}
                  value={g.path || '/scheduled-goals'}
                  onChange={(e) => updateGoal(g.id, { path: e.target.value })}
                  style={fieldStyle()}
                >
                  {PATH_PRESETS.map((pr) => (
                    <option key={pr.path} value={pr.path}>{pr.label}</option>
                  ))}
                </select>
              </div>
              <input
                disabled={busy}
                value={g.note || ''}
                onChange={(e) => updateGoal(g.id, { note: e.target.value })}
                placeholder="Note / how this goal is set"
                style={fieldStyle()}
              />
            </div>
          ))}
          {!goals.length ? (
            <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.7 }}>
              No goals in this model yet — industry template adds them on Day 1 for content companies.
            </p>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, padding: '0.65rem', borderRadius: 8, border: '1px dashed var(--border)', background: 'var(--bg)' }}>
          <button type="button" style={btnPrimary({ disabled: busy || goals.length >= 16 })} disabled={busy || goals.length >= 16} onClick={addGoal}>
            + Add goal
          </button>
          <button
            type="button"
            style={btnSecondary({ padding: '0.35rem 0.65rem', fontSize: '0.85rem' })}
            disabled={busy}
            onClick={() => onOpenPath?.('/scheduled-goals')}
          >
            Open Scheduled goals
          </button>
        </div>
      </div>
    </div>
  );
}


function LoopEditor({ loops = [], busy, onChange, agentNames = [] }) {
  const updateLoop = (id, patch) => {
    onChange((loops || []).map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };
  const removeLoop = (id) => {
    if ((loops || []).length <= 1) return;
    onChange((loops || []).filter((l) => l.id !== id));
  };
  const addLoop = () => {
    const n = (loops || []).length + 1;
    onChange([
      ...(loops || []),
      {
        id: `loop_${Date.now().toString(36)}`,
        name: `Custom loop ${n}`,
        description: '',
        cadence: 'daily',
        critical_day1: false,
        primary_agent_role: agentNames[0] || 'COO',
        owner_roles: agentNames.slice(0, 1),
        steps: [],
      },
    ]);
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.78, maxWidth: 640 }}>
        Loops are installed on Day 1 as agent runbooks and draft workflows. Mark Day-1 critical for loops that must run immediately.
        Cadence: daily / weekly / event (as needed).
      </p>
      {(loops || []).map((l, idx) => (
        <div
          key={l.id || idx}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '0.85rem',
            background: 'var(--surface)',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong style={{ flex: '1 1 120px' }}>Loop {idx + 1}</strong>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                disabled={busy}
                checked={!!l.critical_day1}
                onChange={(e) => updateLoop(l.id, { critical_day1: e.target.checked })}
              />
              Day-1 critical
            </label>
            <button
              type="button"
              style={btnSecondary({ padding: '0.3rem 0.6rem', fontSize: '0.8rem' })}
              disabled={busy || (loops || []).length <= 1}
              onClick={() => removeLoop(l.id)}
            >
              Remove
            </button>
          </div>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.85rem' }}>
            Name
            <input
              disabled={busy}
              value={l.name || ''}
              onChange={(e) => updateLoop(l.id, { name: e.target.value })}
              style={fieldStyle()}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.85rem' }}>
            Description
            <textarea
              disabled={busy}
              rows={2}
              value={l.description || ''}
              onChange={(e) => updateLoop(l.id, { description: e.target.value })}
              style={fieldStyle()}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: '0.85rem' }}>
              Cadence
              <select
                disabled={busy}
                value={l.cadence || 'daily'}
                onChange={(e) => updateLoop(l.id, { cadence: e.target.value })}
                style={fieldStyle()}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="event">Event-driven</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: '0.85rem' }}>
              Primary AI employee
              <input
                disabled={busy}
                list="operate-loop-agent-names"
                value={l.primary_agent_role || ''}
                onChange={(e) => updateLoop(l.id, { primary_agent_role: e.target.value })}
                placeholder="e.g. Content Strategist"
                style={fieldStyle()}
              />
            </label>
          </div>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.85rem' }}>
            Owner roles (comma-separated)
            <input
              disabled={busy}
              value={(l.owner_roles || []).join(', ')}
              onChange={(e) =>
                updateLoop(l.id, {
                  owner_roles: e.target.value
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              }
              style={fieldStyle()}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.85rem' }}>
            Steps (one per line)
            <textarea
              disabled={busy}
              rows={3}
              value={(l.steps || []).join('\n')}
              onChange={(e) =>
                updateLoop(l.id, {
                  steps: e.target.value
                    .split('\n')
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              }
              placeholder={'research\ndraft\nreview\npublish_checklist\nlog'}
              style={fieldStyle()}
            />
          </label>
        </div>
      ))}
      <datalist id="operate-loop-agent-names">
        {agentNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <button type="button" style={btnSecondary()} disabled={busy || (loops || []).length >= 12} onClick={addLoop}>
        + Add loop
      </button>
    </div>
  );
}

export default function CompanyOperate() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const busyRef = useRef(false);
  const [step, setStep] = useState('welcome');
  const [source, setSource] = useState('auto');
  const [model, setModel] = useState(null);
  const [digestMode, setDigestMode] = useState('daily');
  const [day1, setDay1] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);

  const rememberStep = (s) => {
    try {
      sessionStorage.setItem(RESUME_KEY, s);
    } catch {
      /* private mode */
    }
  };

  // Intentionally allow step changes while busyRef is set — begin/design/etc. call
  // goStep inside withBusy. User clicks are already gated via disabled buttons + withBusy.
  const goStep = (s) => {
    setStep(s);
    rememberStep(s);
  };

  const withBusy = async (label, fn) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setBusyLabel(label || 'Working…');
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e?.message || 'Something went wrong');
    } finally {
      busyRef.current = false;
      setBusy(false);
      setBusyLabel('');
    }
  };

  const openRelated = (path) => {
    if (!path) return;
    rememberStep(step);
    const sep = path.includes('?') ? '&' : '?';
    navigate(`${path}${sep}from=company-operate`);
  };

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await api.companyOperateState();
      setState(data);
      if (data.operating_model) setModel(data.operating_model);
      if (data.digest?.mode) setDigestMode(data.digest.mode);
      if (data.day1_result) setDay1(data.day1_result);

      const gate = data.operate_gate;
      const os = data.operate_step;
      let next = 'welcome';
      if (gate === 'day1_applied') {
        next = 'done';
        setDay1(data.day1_result || null);
      } else if (gate === 'day0_confirmed') {
        next = os === 'done' ? 'day1' : os === 'day0_done' ? 'day0_done' : 'day0_done';
      } else if (gate === 'in_progress' && os && os !== 'welcome') {
        next = os;
      } else if (!data.company_formed) {
        next = 'blocked';
      } else {
        next = 'welcome';
      }

      // Resume mid-wizard after visiting Kanban / Browser Session / etc.
      try {
        const resumeFlag = new URLSearchParams(window.location.search).get('resume') === '1';
        if (resumeFlag) {
          const stored = sessionStorage.getItem(RESUME_KEY);
          if (stored && gate !== 'day1_applied' && next !== 'blocked') {
            next = stored;
          }
        }
      } catch {
        /* ignore */
      }

      setStep(next);
      rememberStep(next);
    } catch (e) {
      setError(e?.message || 'Failed to load operate setup');
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get('resume') === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('resume');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  async function begin() {
    await withBusy('Starting…', async () => {
      const data = await api.companyOperateBegin();
      setState(data);
      // setStep here too (not only goStep) so UI advances even if sessionStorage fails
      setStep('context');
      rememberStep('context');
      await api.companyOperateSaveDraft({ operate_step: 'context' });
    });
  }

  async function skip() {
    await withBusy('Skipping…', async () => {
      await api.companyOperateSkip();
      navigate('/');
    });
  }

  async function runDesign(src) {
    await withBusy('Designing operating model…', async () => {
      const preferred = src || source;
      const data = await api.companyOperateDesign(preferred === 'auto' ? {} : { source: preferred });
      setState(data);
      setModel(data.operating_model);
      setSource(data.design_source === 'llm' ? 'llm' : 'template');
      goStep('propose');
      await api.companyOperateSaveDraft({ operate_step: 'propose' });
    });
  }

  async function saveModelPatch(patch, nextStep) {
    await withBusy(nextStep ? 'Saving…' : 'Saving…', async () => {
      const body = { ...patch };
      if (nextStep) body.operate_step = nextStep;
      const data = await api.companyOperateSaveDraft(body);
      setState(data);
      if (data.operating_model) setModel(data.operating_model);
      if (nextStep) goStep(nextStep);
    });
  }

  async function confirmDay0() {
    await withBusy('Confirming Day 0…', async () => {
      const data = await api.companyOperateConfirm({ operating_model: model });
      setState(data);
      setModel(data.operating_model);
      goStep('day0_done');
    });
  }

  async function applyDay1() {
    await withBusy('Installing Day 1…', async () => {
      const data = await api.companyOperateApplyDay1();
      setState(data);
      setDay1(data.day1 || data.day1_result);
      goStep('done');
    });
  }

  function setMatrixLevel(action, level) {
    if (!model || busy) return;
    const autonomy_matrix = (model.autonomy_matrix || []).map((row) =>
      row.action === action ? { ...row, level } : row
    );
    setModel({ ...model, autonomy_matrix });
  }

  function setSysReady(id, readiness, kind = 'systems_run') {
    if (!model || busy) return;
    const list = (model[kind] || []).map((row) => (row.id === id ? { ...row, readiness } : row));
    setModel({ ...model, [kind]: list });
  }

  function setTaskLine(agentName, text) {
    if (!model || busy) return;
    const daily_tasks = (model.daily_tasks || []).map((d) =>
      d.agent_name === agentName ? { ...d, tasks: text.split('\n').map((t) => t.trim()).filter(Boolean) } : d
    );
    setModel({ ...model, daily_tasks });
  }

  function setLoops(nextLoops) {
    if (!model || busy) return;
    setModel({ ...model, loops: Array.isArray(nextLoops) ? nextLoops : [] });
  }

  const agentNameOptions = [
    ...new Set([
      ...(state?.agents || []).map((a) => a.name).filter(Boolean),
      ...(model?.daily_tasks || []).map((d) => d.agent_name).filter(Boolean),
      ...(model?.loops || []).flatMap((l) => [l.primary_agent_role, ...(l.owner_roles || [])]).filter(Boolean),
    ]),
  ];

  if (initialLoading && !state && !error) {
    return (
      <div style={{ padding: '2rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          aria-hidden
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: '2px solid var(--border)',
            borderTopColor: 'var(--accent)',
            animation: 'co-spin 0.7s linear infinite',
            display: 'inline-block',
          }}
        />
        Loading operate setup…
        <style>{`@keyframes co-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div className="company-operate" style={{ maxWidth: 960, margin: '0 auto', padding: '1.5rem 1.25rem 3rem', position: 'relative' }}>
      <style>{`@keyframes co-spin { to { transform: rotate(360deg); } }`}</style>

      {busy && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 20,
            marginBottom: '1rem',
            padding: '0.65rem 1rem',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              border: '2px solid var(--border)',
              borderTopColor: 'var(--accent)',
              animation: 'co-spin 0.7s linear infinite',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: '0.95rem' }}>{busyLabel || 'Working…'}</span>
          <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Please wait — controls are paused</span>
        </div>
      )}

      <header style={{ marginBottom: '1.25rem' }}>
        <p style={{ margin: 0, opacity: 0.7, fontSize: '0.85rem' }}>Flolah · How the company runs</p>
        <h1 style={{ margin: '0.35rem 0 0', fontSize: '1.55rem' }}>Company Operate</h1>
        <p style={{ margin: '0.4rem 0 0', opacity: 0.8, maxWidth: 640 }}>
          Day 0: agree the operating model. Day 1: install MD, workflows, and honest systems readiness so the company can run under your gates.
        </p>
      </header>

      {error && (
        <div role="alert" style={{ padding: '0.75rem 1rem', background: 'rgba(220,80,80,0.12)', borderRadius: 8, marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {step === 'blocked' && (
        <section>
          <h2>Form your company first</h2>
          <p>Phase C (Company setup) creates people and mission. Then return here to design how you run.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link to="/company-setup" style={btnPrimary()}>Company setup</Link>
            <button type="button" style={btnSecondary()} disabled={busy} onClick={() => navigate('/')}>Home</button>
          </div>
        </section>
      )}

      {step === 'welcome' && (
        <section style={{ display: 'grid', gap: 12 }}>
          <div style={cardStyle(false)}>
            <h2 style={{ marginTop: 0 }}>Form is done. How will {state?.company_name || 'the company'} operate?</h2>
            <p style={{ opacity: 0.85 }}>
              Define cadence, autonomy, channels, and systems. Then Day 1 installs runbooks and workflows.
            </p>
            <p style={{ fontSize: '0.9rem', opacity: 0.75 }}>
              Status: <strong>{state?.operate_gate || 'pending'}</strong>
              {state?.operating_model_version ? ` · model v${state.operating_model_version}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={btnPrimary({ disabled: busy })} disabled={busy} onClick={begin}>
              {busy ? <Spinner label={busyLabel || 'Starting…'} /> : 'Design operating model'}
            </button>
            <button type="button" style={btnSecondary({ disabled: busy })} disabled={busy} onClick={() => navigate('/')}>
              Open Home
            </button>
            <button type="button" style={btnSecondary({ disabled: busy })} disabled={busy} onClick={skip}>
              {busy ? <Spinner label="Skipping…" /> : 'Skip for later'}
            </button>
          </div>
        </section>
      )}

      {step === 'context' && (
        <section>
          <h2>Context from company setup</h2>
          <div style={{ display: 'grid', gap: 8, marginBottom: '1rem' }}>
            <div><strong>Company:</strong> {state?.company_name || '—'}</div>
            <div><strong>Type:</strong> {state?.company_type_label || state?.company_type || '—'}</div>
            <div><strong>Mission:</strong> {state?.mission || '—'}</div>
            <div><strong>DNA:</strong> {state?.org_dna || '—'} {state?.org_dna_notes ? `· ${state.org_dna_notes}` : ''}</div>
            <div><strong>Style:</strong> {state?.management_style || '—'}</div>
            <div>
              <strong>Team ({(state?.agents || []).length}):</strong>{' '}
              {(state?.agents || []).slice(0, 12).map((a) => a.name).join(', ') || '—'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              style={btnPrimary({ disabled: busy })}
              disabled={busy}
              onClick={() => saveModelPatch({ operate_step: 'source' }, 'source')}
            >
              {busy ? <Spinner label="Saving…" /> : 'Continue'}
            </button>
            <button type="button" style={btnSecondary({ disabled: busy })} disabled={busy} onClick={() => goStep('welcome')}>
              Back
            </button>
          </div>
        </section>
      )}

      {step === 'source' && (
        <section>
          <h2>Source for the operating model</h2>
          <p style={{ opacity: 0.8 }}>Template is preferred for industry packs (e.g. Content Creator). AI designs when you want a custom ops model.</p>
          <div style={{ display: 'grid', gap: 10, maxWidth: 520, marginBottom: '1rem' }}>
            {[
              { id: 'template', title: 'Industry template', desc: state?.template_hint === 'template_preferred' ? 'Recommended for your company type' : 'Use pack skeleton' },
              { id: 'llm', title: 'Design with AI', desc: 'LLM proposes cadence, RACI, autonomy from your context' },
              { id: 'auto', title: 'Best default', desc: 'Template when pack exists, otherwise AI' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={busy}
                style={cardStyle(source === opt.id)}
                onClick={() => setSource(opt.id)}
              >
                <strong>{opt.title}</strong>
                <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" style={btnPrimary({ disabled: busy })} disabled={busy} onClick={() => runDesign(source)}>
              {busy ? <Spinner label={busyLabel || 'Designing…'} /> : 'Generate model'}
            </button>
            <button type="button" style={btnSecondary({ disabled: busy })} disabled={busy} onClick={() => goStep('context')}>
              Back
            </button>
          </div>
        </section>
      )}

      {step === 'propose' && model && (
        <section>
          <h2>Proposed operating model</h2>
          <p style={{ fontSize: '0.9rem', opacity: 0.75 }}>
            Source: {state?.design_source || '—'}
            {state?.design_error ? ` · ${state.design_error}` : ''}
          </p>
          <h3>Loops</h3>
          <LoopEditor loops={model.loops || []} busy={busy} onChange={setLoops} agentNames={agentNameOptions} />
          <h3 style={{ marginTop: '1.25rem' }}>Autonomy (summary)</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <tbody>
              {(model.autonomy_matrix || []).map((a) => (
                <tr key={a.action} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.4rem' }}>{a.label || a.action}</td>
                  <td style={{ padding: '0.4rem' }}><code>{a.level}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 10, marginTop: '1rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              style={btnPrimary({ disabled: busy })}
              disabled={busy}
              onClick={() =>
                saveModelPatch(
                  { operating_model: model, loops: model.loops, operate_step: 'cadence' },
                  'cadence'
                )
              }
            >
              {busy ? <Spinner label="Saving…" /> : 'Save loops · edit tasks & autonomy'}
            </button>
            <button type="button" style={btnSecondary({ disabled: busy })} disabled={busy} onClick={() => runDesign(source)}>
              {busy ? <Spinner label="Regenerating…" /> : 'Regenerate'}
            </button>
            <button type="button" style={btnSecondary({ disabled: busy })} disabled={busy} onClick={() => goStep('source')}>
              Back
            </button>
          </div>
        </section>
      )}

      {step === 'cadence' && model && (
        <section>
          <h2>Loops, daily tasks &amp; autonomy</h2>
          <h3 style={{ marginTop: 0 }}>Loops</h3>
          <LoopEditor loops={model.loops || []} busy={busy} onChange={setLoops} agentNames={agentNameOptions} />
          <h3 style={{ marginTop: '1.25rem' }}>Daily tasks (per AI employee)</h3>
          <div style={{ display: 'grid', gap: 12 }}>
            {(model.daily_tasks || []).map((d) => (
              <label key={d.agent_name} style={{ display: 'grid', gap: 4 }}>
                <strong>{d.agent_name}</strong>
                <textarea
                  rows={4}
                  disabled={busy}
                  value={(d.tasks || []).join('\n')}
                  onChange={(e) => setTaskLine(d.agent_name, e.target.value)}
                  style={fieldStyle()}
                />
              </label>
            ))}
          </div>
          <h3 style={{ marginTop: '1.25rem' }}>Autonomy gates</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {(model.autonomy_matrix || []).map((a) => (
              <div key={a.action} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ minWidth: 160 }}>{a.label || a.action}</span>
                <select
                  value={a.level}
                  disabled={busy}
                  onChange={(e) => setMatrixLevel(a.action, e.target.value)}
                  style={{ padding: 6, borderRadius: 6, font: 'inherit' }}
                >
                  {LEVELS.map((lv) => (
                    <option key={lv.id} value={lv.id}>{lv.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: '1rem' }}>
            <button
              type="button"
              style={btnPrimary({ disabled: busy })}
              disabled={busy}
              onClick={() =>
                saveModelPatch(
                  {
                    operating_model: model,
                    loops: model.loops,
                    daily_tasks: model.daily_tasks,
                    autonomy_matrix: model.autonomy_matrix,
                    operate_step: 'systems',
                  },
                  'systems'
                )
              }
            >
              {busy ? <Spinner label="Saving…" /> : 'Continue to systems'}
            </button>
            <button type="button" style={btnSecondary({ disabled: busy })} disabled={busy} onClick={() => goStep('propose')}>
              Back
            </button>
          </div>
        </section>
      )}

      {step === 'systems' && model && (
        <section>
          <h2>Channels, systems &amp; goals for Day 1</h2>
          <p style={{ opacity: 0.8 }}>
            Lists come from the industry template or AI design, then Company Setup picks.
            Edit freely. Mark readiness honestly. Social logins go through <strong>Browser Session</strong>.
            Goals (e.g. weekly content topic) use the same readiness honesty — content topics come from CEO goals, not agent invention.
            Use <strong>← Back to wizard</strong> after opening a related page.
          </p>
          <SystemsChannelsEditor
            model={model}
            busy={busy}
            agentNames={agentNameOptions}
            onOpenPath={openRelated}
            onChange={(next) => setModel(next)}
          />
          <p style={{ fontSize: '0.85rem', opacity: 0.75, marginTop: 8 }}>
            Scroll to use <strong>+ Add system / channel / goal</strong> and Remove.
            Click <strong>Review</strong> to save your edited lists.
          </p>
          <h3 style={{ marginTop: '1rem' }}>CEO digest</h3>
          <select value={digestMode} disabled={busy} onChange={(e) => setDigestMode(e.target.value)} style={{ padding: 6, borderRadius: 6 }}>
            <option value="daily">Daily in-app digest</option>
            <option value="weekly">Weekly rollup</option>
            <option value="off">Off for now</option>
          </select>
          <div style={{ display: 'flex', gap: 10, marginTop: '1rem' }}>
            <button
              type="button"
              style={btnPrimary({ disabled: busy })}
              disabled={busy}
              onClick={() =>
                saveModelPatch(
                  {
                    operating_model: {
                      ...model,
                      systems_run: model.systems_run,
                      channels: model.channels,
                      goals: model.goals,
                      digest: { ...(model.digest || {}), mode: digestMode, channel: 'in_app' },
                    },
                    systems_run: model.systems_run,
                    channels: model.channels,
                    goals: model.goals,
                    operate_step: 'review',
                  },
                  'review'
                )
              }
            >
              {busy ? <Spinner label="Saving…" /> : 'Review'}
            </button>
            <button type="button" style={btnSecondary({ disabled: busy })} disabled={busy} onClick={() => goStep('cadence')}>
              Back
            </button>
          </div>
        </section>
      )}

      {step === 'review' && model && (
        <section>
          <h2>Confirm operating model</h2>
          <p>I approve this operating model for {state?.company_name || 'my company'}.</p>
          <ul>
            <li>{(model.loops || []).length} loops ({(model.loops || []).filter((l) => l.critical_day1).length} Day-1 critical)</li>
            <li>{(model.daily_tasks || []).length} employee daily-task sets</li>
            <li>Publish gate: <code>{(model.autonomy_matrix || []).find((a) => a.action === 'publish')?.level || 'require_ceo'}</code></li>
          </ul>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={btnPrimary({ disabled: busy })} disabled={busy} onClick={confirmDay0}>
              {busy ? <Spinner label="Confirming…" /> : 'Confirm Day 0 model'}
            </button>
            <button type="button" style={btnSecondary({ disabled: busy })} disabled={busy} onClick={() => goStep('systems')}>
              Back
            </button>
          </div>
        </section>
      )}

      {step === 'day0_done' && (
        <section>
          <h2>Day 0 complete</h2>
          <p>
            Operating model <strong>v{state?.operating_model_version || 1}</strong> is confirmed.
            Continue to Day 1 to install runbooks and workflows.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={btnPrimary({ disabled: busy })} disabled={busy} onClick={() => goStep('day1')}>
              Continue to Day 1
            </button>
            <button type="button" style={btnSecondary({ disabled: busy })} disabled={busy} onClick={() => navigate('/')}>
              Home for now
            </button>
          </div>
        </section>
      )}

      {step === 'day1' && (
        <section>
          <h2>Day 1 — Make the company run</h2>
          <p>
            This will materialize AGENTS.md daily tasks, create draft operate workflows (with CEO gates for publish),
            seed ops knowledge tables, and report honest systems readiness. No silent social &quot;connected&quot; status.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={btnPrimary({ disabled: busy })} disabled={busy} onClick={applyDay1}>
              {busy ? <Spinner label="Installing…" /> : 'Install Day 1 autonomy'}
            </button>
            <button type="button" style={btnSecondary({ disabled: busy })} disabled={busy} onClick={() => goStep('day0_done')}>
              Back
            </button>
          </div>
        </section>
      )}

      {step === 'done' && (
        <section>
          <h2>Operate install complete</h2>
          <p>{day1?.message || state?.day1_result?.message || 'Day 1 applied.'}</p>
          {(day1?.configured_workflows || day1?.what_runs)?.length > 0 && (
            <>
              <h3>Workflows configured</h3>
              <ul>
                {(day1.configured_workflows || []).map((w) => (
                  <li key={w.id || w.name}>
                    {w.name} — {w.published ? 'published' : 'draft'}
                    {w.schedule_cron ? ` · schedule ${w.schedule_cron}` : w.cadence ? ` · ${w.cadence}` : ''}
                    {w.note ? ` · ${w.note}` : ''}
                  </li>
                ))}
                {!(day1.configured_workflows || []).length && (day1.what_runs || []).map((w) => (
                  <li key={w.loop}>{w.loop} ({w.cadence}){w.workflow ? ` · workflow ${w.workflow}` : ''}</li>
                ))}
              </ul>
              <p style={{ fontSize: '0.85rem', opacity: 0.8 }}>
                Content company loops are <strong>manual / event</strong> (COO or CEO triggers after a goal is set). Daily/weekly cadence only schedules when the loop says so. Goals readiness is tracked with systems and channels.
              </p>
            </>
          )}
          {((day1?.goals || [])).length > 0 && (
            <>
              <h3>Goals tracked</h3>
              <ul>
                {day1.goals.map((g) => (
                  <li key={g.id || g.label}>
                    {g.label}
                    {g.readiness ? ` · ${g.readiness}` : ''}
                    {g.path ? <> — <Link to={g.path}>{g.path}</Link></> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
          {((day1?.open_for_ceo || day1?.needs_human) || []).length > 0 && (
            <>
              <h3>Still needs you (logins / connections / goals)</h3>
              <ul>
                {(day1.open_for_ceo && day1.open_for_ceo.length ? day1.open_for_ceo : day1.needs_human || []).map((n) => (
                  <li key={n.label}>
                    {n.label}
                    {n.status ? ` · ${n.status}` : ''}
                    {n.path ? <> — <Link to={n.path}>open</Link></> : null}
                    {n.note ? <div style={{ fontSize: '0.85rem', opacity: 0.75 }}>{n.note}</div> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: '1rem' }}>
            <button type="button" style={btnPrimary()} onClick={() => navigate('/')}>Home</button>
            <Link to="/workflows" style={btnSecondary()}>Workflows</Link>
            <Link to="/scheduled-goals" style={btnSecondary()}>Scheduled goals</Link>
            <Link to="/browser-session" style={btnSecondary()}>Browser Session</Link>
            <button
              type="button"
              style={btnSecondary()}
              onClick={() => {
                goStep('welcome');
              }}
            >
              Review again
            </button>
          </div>
        </section>
      )}

      <footer style={{ marginTop: '2rem', fontSize: '0.85rem', opacity: 0.65 }}>
        <Link to="/company-setup">Company setup</Link>
        {' · '}
        <Link to="/">Home</Link>
        {' · '}
        <span>Step: {step}</span>
      </footer>
    </div>
  );
}
