import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { RequireAuth } from '../context/AuthContext';
import GoalPlanPanel from '../components/GoalPlanPanel';
import GoalPlanManualEditor from '../components/GoalPlanManualEditor';
import { Fragment } from 'react';

function statusClass(status) {
  if (status === 'active') return 'sg-badge sg-badge-active';
  if (status === 'paused' || status === 'draft') return 'sg-badge sg-badge-paused';
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
  deliver_whatsapp: false,
};

const COO_PLAN_TIP =
  'Execution plans apply only to the COO. Other AI employees run the scheduled prompt directly.';

function agentIsCoo(agents, agentId) {
  const hit = (agents || []).find((a) => a.id === agentId);
  return !!hit?.is_coo;
}

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
  const [planOpenId, setPlanOpenId] = useState(null);
  const [planCache, setPlanCache] = useState({});
  const [planBusy, setPlanBusy] = useState(null);
  const [draftPlan, setDraftPlan] = useState(null);
  const [planFeedback, setPlanFeedback] = useState('');
  const [planBusyLocal, setPlanBusyLocal] = useState(false);
  const [amendPlanOpen, setAmendPlanOpen] = useState(false);

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

  const loadLastPlan = async (goalId) => {
    if (planOpenId === goalId) {
      setPlanOpenId(null);
      return;
    }
    setPlanOpenId(goalId);
    if (planCache[goalId]) return;
    setPlanBusy(goalId);
    try {
      const data = await api.agentGoalRunsList({ scheduled_goal_id: goalId, limit: 3 });
      setPlanCache((prev) => ({ ...prev, [goalId]: data.goals || [] }));
    } catch (e) {
      setPlanCache((prev) => ({
        ...prev,
        [goalId]: { error: e.message || String(e) },
      }));
    } finally {
      setPlanBusy(null);
    }
  };

  const resetForm = (keepAgentId) => {
    setForm({ ...EMPTY_FORM, agent_id: keepAgentId || form.agent_id || 'balserve' });
    setEditingId(null);
    setShowForm(false);
    setDraftPlan(null);
    setPlanFeedback('');
    setAmendPlanOpen(false);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, agent_id: form.agent_id || 'balserve' });
    setDraftPlan(null);
    setPlanFeedback('');
    setAmendPlanOpen(false);
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
      deliver_whatsapp: Array.isArray(g.deliver_to) && g.deliver_to.includes('whatsapp'),
    });
    setDraftPlan(g.is_coo && g.plan ? g.plan : null);
    setPlanFeedback('');
    setAmendPlanOpen(!!(g.is_coo && g.plan && Array.isArray(g.plan.steps) && g.plan.steps.length));
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

  const generateDraftPlan = async () => {
    if (!agentIsCoo(agents, form.agent_id)) {
      setError(COO_PLAN_TIP);
      return;
    }
    if (!form.prompt.trim()) {
      setError('Enter a prompt before generating the execution plan.');
      return;
    }
    setPlanBusyLocal(true);
    setError(null);
    setMessage(null);
    try {
      const out = await api.scheduledGoalsPlanPreview({
        prompt: form.prompt,
        agent_id: form.agent_id,
        feedback: planFeedback || undefined,
        previous_plan: draftPlan || undefined,
      });
      setDraftPlan(out.plan || null);
      setAmendPlanOpen(true);
      setMessage('Draft plan ready. Amend steps if the intent mapping is wrong, then save draft or approve.');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setPlanBusyLocal(false);
    }
  };

  const save = async (e, opts = {}) => {
    if (e && e.preventDefault) e.preventDefault();
    const planForCoo = agentIsCoo(agents, form.agent_id);
    const approvePlan = !!opts.approvePlan;
    if (planForCoo && approvePlan && !(draftPlan?.steps?.length)) {
      setError('Approve needs at least one plan step. Generate a draft or amend the plan, then try again.');
      return;
    }
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
      deliver_to: form.deliver_whatsapp ? ['web', 'whatsapp'] : ['web'],
      plan: planForCoo ? draftPlan || undefined : undefined,
      plan_feedback: planForCoo ? planFeedback || undefined : undefined,
      approve_plan: approvePlan,
    };
    try {
      if (editingId) {
        await api.scheduledGoalsUpdate(editingId, {
          title: body.title,
          prompt: body.prompt,
          agent_id: body.agent_id,
          cadence: body.cadence,
          time_local: body.time_local,
          weekday: body.weekday,
          ends_at: body.ends_at,
          deliver_to: body.deliver_to,
        });
        if (planForCoo && (draftPlan || planFeedback || approvePlan)) {
          await api.scheduledGoalsSetPlan(editingId, {
            plan: draftPlan,
            feedback: planFeedback || undefined,
            approve: approvePlan,
            prompt: form.prompt,
          });
        } else if (!planForCoo && approvePlan) {
          await api.scheduledGoalsResume(editingId);
        }
        setMessage(
          planForCoo
            ? approvePlan
              ? 'Plan approved — schedule is active.'
              : 'Scheduled goal updated.'
            : approvePlan
              ? 'Scheduled — this employee runs the prompt directly (no COO execution plan).'
              : 'Scheduled goal updated.'
        );
      } else {
        await api.scheduledGoalsCreate(body);
        setMessage(
          planForCoo
            ? approvePlan
              ? 'Scheduled goal created and active.'
              : 'Draft goal saved with plan — approve to activate the schedule.'
            : approvePlan
              ? 'Scheduled — this employee runs the prompt directly (no COO execution plan).'
              : 'Saved paused — use Save & schedule or Resume to activate.'
        );
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

  const planForCoo = agentIsCoo(agents, form.agent_id);

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <header className="page-hero" style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0 }}>Scheduled goals</h1>
        <p style={{ margin: '0.4rem 0 0', color: 'var(--muted)', maxWidth: 640 }}>
          Recurring prompts your AI employees run on a schedule (hourly, daily, weekdays, or weekly). Chat the COO in
          plain language, or create and <strong>edit</strong> schedules here. Pause or delete stops the clock immediately
          and after restarts. Optional <strong>WhatsApp</strong> copies the <em>final outcome</em> to that employee’s
          bound channel (chat schedules: the reply; plan schedules: completed/failed nudge) — not each workflow terminal.
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
          <option value="draft">Draft plan</option>
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
              {planForCoo ? (
                <>
                  Review the execution plan, give feedback if needed, then <strong>Save draft</strong> or{' '}
                  <strong>Approve plan &amp; schedule</strong>.
                </>
              ) : (
                <>
                  This employee runs the prompt directly. Execution plans are COO-only.{' '}
                  <strong>Save &amp; schedule</strong> to activate.
                </>
              )}
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
              <select
                value={form.agent_id}
                onChange={(ev) => {
                  const agent_id = ev.target.value;
                  setForm((f) => ({ ...f, agent_id }));
                  if (!agentIsCoo(agents, agent_id)) {
                    setDraftPlan(null);
                    setAmendPlanOpen(false);
                    setPlanFeedback('');
                  }
                }}
              >
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
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                minWidth: 240,
                marginTop: 18,
                fontSize: '0.85rem',
              }}
            >
              <input
                type="checkbox"
                checked={!!form.deliver_whatsapp}
                onChange={(ev) => setForm((f) => ({ ...f, deliver_whatsapp: ev.target.checked }))}
                style={{ marginTop: 3 }}
              />
              <span>
                Also send the <strong>final outcome</strong> on this employee’s WhatsApp
                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)' }}>
                  Needs Channels → WhatsApp enabled and a DM (allow-from or Profile mobile). Unpaired skips WhatsApp; web still works.
                </span>
              </span>
            </label>
          </div>
          <div className="sg-plan-panel">
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 6 }}>Execution plan</div>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
              {planForCoo
                ? 'Think of this as a small dynamic workflow: each intent becomes a step (CRM/ERP workflows, specialty AI, notify). Generate a draft, amend if it does not match what you meant, then save or approve.'
                : COO_PLAN_TIP}
            </p>
            <div className="sg-plan-actions">
              <span
                className="sg-plan-tip-wrap"
                title={!planForCoo ? COO_PLAN_TIP : undefined}
              >
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!planForCoo || planBusyLocal || !form.prompt.trim()}
                  onClick={generateDraftPlan}
                >
                  {planBusyLocal ? 'Planning…' : draftPlan ? 'Regenerate plan' : 'Generate draft plan'}
                </button>
              </span>
              {planForCoo && draftPlan && (
                <button
                  type="button"
                  className={'btn-secondary' + (amendPlanOpen ? ' is-active-toggle' : '')}
                  disabled={planBusyLocal}
                  onClick={() => setAmendPlanOpen((v) => !v)}
                  aria-pressed={amendPlanOpen}
                >
                  {amendPlanOpen ? 'Hide manual editor' : 'Amend plan manually'}
                </button>
              )}
              {planForCoo && !draftPlan && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={planBusyLocal || !form.prompt.trim()}
                  onClick={() => {
                    setDraftPlan({
                      version: 1,
                      prompt: form.prompt,
                      steps: [],
                      uses_goal_run_mode: false,
                      generated_at: new Date().toISOString(),
                      amended_manually: true,
                    });
                    setAmendPlanOpen(true);
                    setMessage('Empty plan — add intents with Amend plan (CRM maker-checker, specialty, notify, …).');
                  }}
                >
                  Build plan manually
                </button>
              )}
            </div>
            {planForCoo && draftPlan?.steps?.length > 0 && !amendPlanOpen && (
              <ol className="sg-plan-summary">
                {draftPlan.steps.map((s, i) => (
                  <li key={i}>
                    <strong>{s.type}</strong>
                    {s.spec?.parallel_group != null ? ' (parallel)' : ''}: {s.label}
                    {s.spec?.agent_id ? ' → ' + s.spec.agent_id : ''}
                    {s.spec?.phrase ? ' [' + s.spec.phrase + ']' : ''}
                  </li>
                ))}
              </ol>
            )}
            {planForCoo && draftPlan && amendPlanOpen && (
              <GoalPlanManualEditor
                plan={draftPlan}
                prompt={form.prompt}
                agents={agents}
                disabled={planBusyLocal || busyId === (editingId || 'create')}
                onChange={(next) => setDraftPlan(next)}
              />
            )}
            {planForCoo && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Regenerate with feedback (optional)</span>
              <textarea
                rows={2}
                value={planFeedback}
                onChange={(ev) => setPlanFeedback(ev.target.value)}
                placeholder="e.g. also add social research; run Platform Help in parallel"
              />
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                Feedback re-runs the planner and can replace manual edits. Prefer Amend for precise step changes.
              </span>
            </label>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={busyId === (editingId || 'create') || enrichBusy || !form.prompt.trim()}
              onClick={() => save(null, { approvePlan: false })}
            >
              Save draft
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={
                busyId === (editingId || 'create') ||
                enrichBusy ||
                !form.prompt.trim() ||
                (planForCoo && !draftPlan)
              }
              onClick={() => save(null, { approvePlan: true })}
              title={!planForCoo ? COO_PLAN_TIP : undefined}
            >
              {busyId === (editingId || 'create')
                ? 'Saving...'
                : planForCoo
                  ? 'Approve plan & schedule'
                  : 'Save & schedule'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busyId === (editingId || 'create') || enrichBusy || !form.prompt.trim()}
              onClick={enrichPromptWithAi}
              title="AI clarifies and structures your goal for the target AI employee"
            >
              {enrichBusy ? 'Enriching...' : 'Enrich with AI'}
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
        <p style={{ color: 'var(--muted)' }}>Loading...</p>
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
                <Fragment key={g.id}>
                <tr style={{ borderBottom: planOpenId === g.id ? 'none' : '1px solid var(--border)' }}>
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
                    <span className={statusClass(g.status)}>{g.status}{g.plan_status && g.plan_status !== 'none' ? ` · plan ${g.plan_status}` : ''}</span>
                    {Array.isArray(g.deliver_to) && g.deliver_to.includes('whatsapp') ? (
                      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: 4 }}>Web + WhatsApp</div>
                    ) : null}
                  </td>
                  <td style={{ padding: '0.5rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
                    <div>{g.last_run_status || '—'}
                    {g.run_count ? ` · ${g.run_count} run(s)` : ''}</div>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ marginTop: 4, fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                      disabled={planBusy === g.id}
                      onClick={() => loadLastPlan(g.id)}
                    >
                      {planOpenId === g.id ? 'Hide plan' : 'Last plan'}
                    </button>
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
                      {(g.status === 'draft' || g.plan_status === 'draft') && g.is_coo && (
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={busyId === g.id}
                          onClick={() =>
                            runAction(g.id, () => api.scheduledGoalsApprovePlan(g.id), 'Plan approved — schedule active.')
                          }
                        >
                          Approve plan
                        </button>
                      )}
                      {(g.status === 'draft' || g.plan_status === 'draft') && !g.is_coo && (
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={busyId === g.id}
                          title={COO_PLAN_TIP}
                          onClick={() =>
                            runAction(
                              g.id,
                              () => api.scheduledGoalsResume(g.id),
                              'Activated — this employee runs the prompt directly (no COO execution plan).'
                            )
                          }
                        >
                          Activate
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={busyId === g.id || g.status === 'draft' || g.plan_status === 'draft'}
                        onClick={() =>
                          runAction(g.id, () => api.scheduledGoalsRunNow(g.id), 'Run started — check agent chat.')
                        }
                        title={g.status === 'draft' || g.plan_status === 'draft' ? 'Approve the plan first' : 'Fire now'}
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
                {planOpenId === g.id ? (
                  <tr key={`${g.id}-plan`} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td colSpan={7} style={{ padding: '0.35rem 0.75rem 0.85rem' }}>
                      {planBusy === g.id ? (
                        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Loading plan...</p>
                      ) : planCache[g.id]?.error ? (
                        <p style={{ color: 'var(--danger, #c44)', fontSize: '0.85rem' }}>{planCache[g.id].error}</p>
                      ) : !(planCache[g.id] || []).length ? (
                        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                          No fire-time goal plan yet. Multi-intent or multi-workflow prompts create a durable plan on fire after the schedule plan is approved; specialty steps show as specialty_task.
                        </p>
                      ) : (
                        (planCache[g.id] || []).map((plan) => (
                          <GoalPlanPanel key={plan.id} goal={plan} compact />
                        ))
                      )}
                    </td>
                  </tr>
                ) : null}
                </Fragment>
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
        .sg-plan-panel {
          margin-top: 0.35rem; padding: 0.75rem; border: 1px solid var(--border);
          border-radius: 8px; background: var(--bg, var(--surface));
        }
        .sg-plan-actions { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-bottom: 0.55rem; align-items: center; }
        .sg-plan-tip-wrap { display: inline-block; }
        .sg-plan-tip-wrap .btn-secondary:disabled { pointer-events: none; }
        .btn-secondary.is-active-toggle {
          outline: 1px solid var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent);
        }
        .sg-plan-summary { margin: 0.35rem 0 0; padding-left: 1.2rem; font-size: 0.85rem; line-height: 1.45; }
        .sg-plan-summary li { margin-bottom: 0.2rem; }
        .sg-plan-editor {
          margin-top: 0.45rem; padding: 0.65rem; border: 1px dashed var(--border);
          border-radius: 8px; background: color-mix(in srgb, var(--surface) 80%, var(--bg));
        }
        .sg-plan-editor-title { font-weight: 600; font-size: 0.88rem; }
        .sg-plan-editor-sub { margin: 0.2rem 0 0.55rem; font-size: 0.78rem; color: var(--muted); line-height: 1.4; }
        .sg-plan-presets { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; margin-bottom: 0.55rem; }
        .sg-plan-presets-label { font-size: 0.75rem; color: var(--muted); margin-right: 0.15rem; }
        .sg-plan-chip {
          font: inherit; font-size: 0.78rem; padding: 0.25rem 0.55rem; border-radius: 999px;
          border: 1px solid var(--border); background: var(--bg, var(--surface)); color: var(--text); cursor: pointer;
        }
        .sg-plan-chip:hover:not(:disabled) { border-color: var(--accent); }
        .sg-plan-chip:disabled { opacity: 0.55; cursor: not-allowed; }
        .sg-plan-chip-ghost { opacity: 0.9; }
        .sg-plan-empty { margin: 0.4rem 0; font-size: 0.82rem; color: var(--muted); }
        .sg-plan-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.55rem; }
        .sg-plan-step {
          border: 1px solid var(--border); border-radius: 8px; padding: 0.55rem 0.65rem;
          background: var(--bg, var(--surface));
        }
        .sg-plan-step-toolbar {
          display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin-bottom: 0.25rem;
        }
        .sg-plan-step-num {
          font-size: 0.72rem; font-weight: 600; color: var(--muted); min-width: 1.1rem;
        }
        .sg-plan-type { min-width: 8.5rem; max-width: 11rem; }
        .sg-plan-label { flex: 1 1 10rem; min-width: 8rem; }
        .sg-plan-step-actions { display: flex; gap: 0.2rem; margin-left: auto; }
        .sg-plan-icon-btn {
          width: 1.75rem; height: 1.75rem; padding: 0; border-radius: 6px; border: 1px solid var(--border);
          background: transparent; color: var(--text); cursor: pointer; font-size: 0.9rem; line-height: 1;
        }
        .sg-plan-icon-btn:hover:not(:disabled) { border-color: var(--accent); }
        .sg-plan-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .sg-plan-icon-danger:hover:not(:disabled) { border-color: var(--danger, #c44); color: var(--danger, #c44); }
        .sg-plan-type-hint { margin: 0 0 0.4rem; font-size: 0.72rem; color: var(--muted); }
        .sg-plan-fields {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: 0.45rem 0.65rem;
        }
        .sg-plan-fields label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.78rem; }
        .sg-plan-fields label span { color: var(--muted); }
        .sg-plan-field-wide { grid-column: 1 / -1; }
        @media (max-width: 640px) {
          .sg-plan-step-toolbar { flex-direction: column; align-items: stretch; }
          .sg-plan-step-actions { margin-left: 0; }
          .sg-plan-type, .sg-plan-label { max-width: none; width: 100%; }
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
