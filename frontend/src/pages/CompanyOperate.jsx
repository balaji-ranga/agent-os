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
          <h2>Channels &amp; systems for Day 1</h2>
          <p style={{ opacity: 0.8 }}>
            Mark readiness honestly. Opening a page does not run a separate setup wizard for Kanban — that board is where agent-created tasks land.
            Social logins today go through <strong>Browser Session</strong> (not OpenConnector FB/LI packs yet).
            Use <strong>← Back to wizard</strong> on those pages to return here.
          </p>
          <h3>Systems</h3>
          {(model.systems_run || []).map((s) => (
            <div key={s.id} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ minWidth: 200 }}>{s.label}{s.required ? ' *' : ''}</span>
                <select
                  value={s.readiness || 'not_ready'}
                  disabled={busy}
                  onChange={(e) => setSysReady(s.id, e.target.value, 'systems_run')}
                  style={{ padding: 6, borderRadius: 6 }}
                >
                  {READY.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
                {s.path && (
                  <button type="button" style={btnSecondary({ padding: '0.35rem 0.7rem', fontSize: '0.85rem' })} disabled={busy} onClick={() => openRelated(s.path)}>
                    {systemLinkLabel(s)}
                  </button>
                )}
              </div>
              {systemHint(s) && (
                <div style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: 4, maxWidth: 640 }}>{systemHint(s)}</div>
              )}
            </div>
          ))}
          {(model.channels || []).length > 0 && (
            <>
              <h3>Channels</h3>
              {(model.channels || []).map((c) => (
                <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 200 }}>{c.label}</span>
                  <select
                    value={c.readiness || 'not_ready'}
                    disabled={busy}
                    onChange={(e) => setSysReady(c.id, e.target.value, 'channels')}
                    style={{ padding: 6, borderRadius: 6 }}
                  >
                    {READY.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    style={btnSecondary({ padding: '0.35rem 0.7rem', fontSize: '0.85rem' })}
                    disabled={busy}
                    onClick={() => openRelated(c.path || '/browser-session')}
                  >
                    Open Browser Session
                  </button>
                </div>
              ))}
            </>
          )}
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
                      digest: { ...(model.digest || {}), mode: digestMode, channel: 'in_app' },
                    },
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
          {day1?.what_runs?.length > 0 && (
            <>
              <h3>What can run</h3>
              <ul>
                {day1.what_runs.map((w) => (
                  <li key={w.loop}>{w.loop} ({w.cadence}){w.workflow ? ` · workflow ${w.workflow}` : ''}</li>
                ))}
              </ul>
            </>
          )}
          {day1?.needs_human?.length > 0 && (
            <>
              <h3>Still needs you</h3>
              <ul>
                {day1.needs_human.map((n) => (
                  <li key={n.label}>
                    {n.label}
                    {n.path ? <> — <Link to={n.path}>setup</Link></> : null}
                    {n.note ? <div style={{ fontSize: '0.85rem', opacity: 0.75 }}>{n.note}</div> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: '1rem' }}>
            <button type="button" style={btnPrimary()} onClick={() => navigate('/')}>Home</button>
            <Link to="/workflows" style={btnSecondary()}>Workflows</Link>
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
