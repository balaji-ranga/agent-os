import { useState, useEffect } from 'react';
import { api } from '../api';
import { RequireAuth } from '../context/AuthContext';

const PLACEHOLDER = `Examples:
- Never share confidential financial data outside approved channels.
- Do not generate sexual, abusive, or harassing content.
- Prefer local tools over browser automation for Master Data.
- Escalate legal or medical advice to a human specialist.`;

function SearchMultiSelect({ label, options, selected, onChange, loading }) {
  const [query, setQuery] = useState('');
  const visible = options.filter((item) => `${item.label} ${item.description || ''} ${item.value}`.toLowerCase().includes(query.toLowerCase()));
  const toggle = (value) => onChange(selected.includes(value) ? selected.filter((id) => id !== value) : [...selected, value]);
  return (
    <div>
      <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--muted)', marginBottom: 4 }}>{label}</span>
      <details style={{ border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)', position: 'relative' }}>
        <summary style={{ cursor: 'pointer', padding: '0.65rem 0.75rem', listStyle: 'none', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{loading ? 'Loading…' : selected.length ? `${selected.length} selected` : 'Search and select…'}</span><span aria-hidden>⌄</span>
        </summary>
        <div style={{ borderTop: '1px solid var(--border)', padding: '0.65rem', display: 'grid', gap: 6 }}>
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${label.toLowerCase()}`} style={{ width: '100%', boxSizing: 'border-box', padding: '0.55rem 0.65rem', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg)', color: 'var(--text)' }} />
          <div style={{ maxHeight: 220, overflow: 'auto', display: 'grid', gap: 3 }}>
            {visible.map((item) => (
              <label key={item.value} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '0.48rem', borderRadius: 7, cursor: 'pointer', background: selected.includes(item.value) ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent' }}>
                <input type="checkbox" checked={selected.includes(item.value)} onChange={() => toggle(item.value)} />
                <span><strong style={{ fontSize: '0.84rem' }}>{item.label}</strong>{item.description ? <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.72rem' }}>{item.description}</span> : null}</span>
              </label>
            ))}
            {!visible.length ? <span style={{ color: 'var(--muted)', fontSize: '0.8rem', padding: 6 }}>No matching items.</span> : null}
          </div>
        </div>
      </details>
      {selected.length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>{selected.map((value) => {
        const item = options.find((candidate) => candidate.value === value);
        return <button type="button" key={value} onClick={() => toggle(value)} title="Remove" style={{ border: '1px solid var(--border)', borderRadius: 999, background: 'var(--bg)', color: 'var(--text)', padding: '0.28rem 0.55rem', fontSize: '0.74rem', cursor: 'pointer' }}>{item?.label || value} ×</button>;
      })}</div> : null}
    </div>
  );
}

function PoliciesPanel() {
  const [activeTab, setActiveTab] = useState('guardrails');
  const [policyText, setPolicyText] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [actionControl, setActionControl] = useState([]);
  const [actionOverrides, setActionOverrides] = useState([]);
  const [scopeCatalog, setScopeCatalog] = useState({ goal: [], workflow: [], agent: [], tool: [] });
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [overrideDraft, setOverrideDraft] = useState({
    scope_type: 'tool', scope_ids: [], action_family: 'communicate_external', mode: 'autonomous',
    permitted_email_ids: '', permitted_websites: '', expires_at: '', max_uses: '',
  });
  const [exceptionPolicy, setExceptionPolicy] = useState({
    retry_limit: 1,
    create_kanban: true,
    agent_pickup: true,
  });
  const [exceptionBusy, setExceptionBusy] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .ceoGuardrailsGet()
      .then((data) => {
        const g = data.guardrails || {};
        setPolicyText(g.policy_text || '');
        setEnabled(g.enabled !== false);
        setUpdatedAt(g.updated_at || null);
        setActionControl(Array.isArray(data.action_control) ? data.action_control : []);
        setActionOverrides(Array.isArray(data.action_overrides) ? data.action_overrides : []);
        if (data.exception_policy) setExceptionPolicy(data.exception_policy);
      })
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    Promise.allSettled([
      api.scheduledGoalsList(), api.agentWorkflowList({ limit: 500, offset: 0 }), api.agentsList(), api.contentToolsMeta(),
    ]).then(([goals, workflows, agents, tools]) => {
      const goalRows = goals.status === 'fulfilled' ? (goals.value?.goals || []) : [];
      const workflowRows = workflows.status === 'fulfilled' ? (workflows.value?.workflows || []) : [];
      const agentRows = agents.status === 'fulfilled' ? (Array.isArray(agents.value) ? agents.value : agents.value?.agents || []) : [];
      const toolRows = tools.status === 'fulfilled' ? (tools.value?.tools || []) : [];
      setScopeCatalog({
        goal: goalRows.map((row) => ({ value: String(row.id), label: row.title || row.prompt || row.id, description: `${row.status || 'goal'} · ${row.id}` })),
        workflow: workflowRows.map((row) => ({ value: String(row.id), label: row.name || row.title || row.id, description: `${row.status || 'workflow'} · ${row.id}` })),
        agent: agentRows.map((row) => ({ value: String(row.id), label: row.name || row.display_name || row.id, description: `${row.role_title || row.purpose || 'AI employee'} · ${row.id}` })),
        tool: toolRows.filter((row) => row.enabled !== false && row.enabled !== 0).map((row) => ({ value: String(row.name), label: row.label || row.name, description: row.description || row.name })),
      });
    }).finally(() => setCatalogLoading(false));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const data = await api.ceoGuardrailsSave({
        policy_text: policyText,
        enabled,
      });
      const g = data.guardrails || {};
      setPolicyText(g.policy_text || '');
      setEnabled(g.enabled !== false);
      setUpdatedAt(g.updated_at || null);
      const synced = data.workspaces_synced != null ? data.workspaces_synced : 0;
      setMessage(
        `Saved. Synced POLICY.md to ${synced} agent workspace${synced === 1 ? '' : 's'}. Brain nodes will use this on the next run.`
      );
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveControl = async () => {
    setControlBusy(true);
    setMessage(null);
    setError(null);
    try {
      const data = await api.ceoActionControlSave({ policies: actionControl });
      setActionControl(Array.isArray(data.action_control) ? data.action_control : actionControl);
      setMessage('Action control saved. Tool invokes for your company now use these three states.');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setControlBusy(false);
    }
  };

  const setFamilyMode = (family, mode) => {
    setActionControl((prev) =>
      (prev || []).map((row) => (row.family === family ? { ...row, mode } : row))
    );
  };

  const saveOverride = async () => {
    setOverrideBusy(true);
    setMessage(null);
    setError(null);
    try {
      const split = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
      const results = await Promise.all(overrideDraft.scope_ids.map((scopeId) => api.ceoActionOverrideSave({
        scope_type: overrideDraft.scope_type, scope_id: scopeId, action_family: overrideDraft.action_family,
        mode: overrideDraft.mode, constraints: { permitted_email_ids: split(overrideDraft.permitted_email_ids), permitted_websites: split(overrideDraft.permitted_websites) },
        expires_at: overrideDraft.expires_at ? new Date(overrideDraft.expires_at).toISOString() : null,
        max_uses: overrideDraft.max_uses === '' ? null : Number(overrideDraft.max_uses),
      })));
      const savedRows = results.map((result) => result.action_override);
      setActionOverrides((prev) => [...prev.filter((row) => !savedRows.some((saved) => row.id === saved.id || (row.scope_type === saved.scope_type && row.scope_id === saved.scope_id && row.action_family === saved.action_family))), ...savedRows]);
      setOverrideDraft((prev) => ({ ...prev, scope_ids: [], permitted_email_ids: '', permitted_websites: '', expires_at: '', max_uses: '' }));
      setMessage(`${savedRows.length} scoped override${savedRows.length === 1 ? '' : 's'} saved and effective immediately.`);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setOverrideBusy(false);
    }
  };

  const deleteOverride = async (row) => {
    if (!window.confirm(`Delete ${row.scope_type} override for ${row.scope_id}?`)) return;
    setOverrideBusy(true);
    setError(null);
    try {
      await api.ceoActionOverrideDelete(row.id);
      setActionOverrides((prev) => prev.filter((item) => item.id !== row.id));
      setMessage('Scoped action override deleted; company policy is now the fallback.');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setOverrideBusy(false);
    }
  };

  const saveExceptionPolicy = async () => {
    setExceptionBusy(true);
    setMessage(null);
    setError(null);
    try {
      const data = await api.ceoExceptionPolicySave(exceptionPolicy);
      setExceptionPolicy(data.exception_policy || exceptionPolicy);
      setMessage('Exception policy saved. New goal and workflow failures will use it immediately.');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setExceptionBusy(false);
    }
  };

  const enrichWithAi = async () => {
    setEnrichBusy(true);
    setMessage(null);
    setError(null);
    try {
      const out = await api.ceoGuardrailsEnrich({ policy_text: policyText });
      if (out.policy_text) {
        setPolicyText(out.policy_text);
        setMessage(
          out.model
            ? `AI enriched your draft (model: ${out.model}). Review, then Save & sync.`
            : 'AI enriched your draft. Review, then Save & sync.'
        );
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setEnrichBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <header className="page-hero" style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0 }}>Policies &amp; guardrails</h1>
        <p style={{ margin: '0.4rem 0 0', color: 'var(--muted)', maxWidth: 560 }}>
          Set once for your CEO account. These rules are a prerequisite for every agent (via{' '}
          <code>POLICY.md</code>) and every workflow Brain node. Day 1 seeds a universal baseline: no sexual,
          abusive, or discriminatory content.
        </p>
      </header>

      <div role="tablist" aria-label="Organisation policy sections" style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'guardrails'}
          className={activeTab === 'guardrails' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('guardrails')}
        >
          Policies &amp; guardrails
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'exceptions'}
          className={activeTab === 'exceptions' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('exceptions')}
        >
          Exception policy
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : activeTab === 'guardrails' ? (
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={enabled} onChange={(ev) => setEnabled(ev.target.checked)} />
            <span>Enforce these guardrails for all agents and Brain nodes</span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Common policy text</span>
            <textarea
              value={policyText}
              onChange={(ev) => setPolicyText(ev.target.value)}
              rows={14}
              placeholder={PLACEHOLDER}
              style={{
                padding: '0.75rem',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontFamily: 'inherit',
                lineHeight: 1.45,
                resize: 'vertical',
              }}
            />
          </label>

          {updatedAt && (
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>Last saved: {updatedAt} (UTC)</p>
          )}

          {message && (
            <p style={{ margin: 0, color: 'var(--accent)', fontSize: '0.9rem' }} role="status">
              {message}
            </p>
          )}
          {error && (
            <p style={{ margin: 0, color: 'var(--danger, #c44)', fontSize: '0.9rem' }} role="alert">
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button type="submit" className="btn-primary" disabled={busy || enrichBusy}>
              {busy ? 'Saving…' : 'Save & sync to agents'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || enrichBusy}
              onClick={enrichWithAi}
              title="AI clarifies and structures your draft; universal safety is preserved"
            >
              {enrichBusy ? 'Enriching…' : 'Enrich with AI'}
            </button>
            <button
              type="button"
              disabled={busy || enrichBusy}
              onClick={load}
              style={{
                padding: '0.45rem 0.85rem',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              Reload
            </button>
          </div>
        </form>
      ) : (
        <section role="tabpanel" aria-label="Exception policy" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.15rem' }}>Exception policy</h2>
            <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.45 }}>
              Applies to failed goal-plan steps and workflow nodes. Completed earlier steps stay completed. Flolah
              retries only the failed step, then creates a visible Kanban task if the retry is unsuccessful.
            </p>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, maxWidth: 260 }}>
            <span>Automatic retries per failed step</span>
            <input
              type="number"
              min="0"
              max="5"
              value={exceptionPolicy.retry_limit}
              onChange={(ev) => setExceptionPolicy((prev) => ({ ...prev, retry_limit: Number(ev.target.value) }))}
              style={{ padding: '0.55rem', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
            />
            <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>Default: 1. Set 0 to escalate immediately.</span>
          </label>

          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={exceptionPolicy.create_kanban !== false}
              onChange={(ev) => setExceptionPolicy((prev) => ({ ...prev, create_kanban: ev.target.checked }))}
            />
            <span>
              <strong>Create a Kanban task after retries are exhausted</strong>
              <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.82rem' }}>
                The task links the failed run and exact step so you can rectify it and continue from there.
              </span>
            </span>
          </label>

          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={exceptionPolicy.agent_pickup !== false}
              disabled={exceptionPolicy.create_kanban === false}
              onChange={(ev) => setExceptionPolicy((prev) => ({ ...prev, agent_pickup: ev.target.checked }))}
            />
            <span>
              <strong>Let the responsible agent pick up the recovery task</strong>
              <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.82rem' }}>
                The assigned employee works only on the failed step. If credentials, policy, or user input is needed,
                the task remains visible for you with a precise explanation.
              </span>
            </span>
          </label>

          {message && <p role="status" style={{ margin: 0, color: 'var(--accent)' }}>{message}</p>}
          {error && <p role="alert" style={{ margin: 0, color: 'var(--danger, #c44)' }}>{error}</p>}
          <div>
            <button type="button" className="btn-primary" disabled={exceptionBusy} onClick={saveExceptionPolicy}>
              {exceptionBusy ? 'Saving…' : 'Save exception policy'}
            </button>
          </div>
        </section>
      )}

      {!loading && activeTab === 'guardrails' && actionControl.length > 0 ? (
        <section style={{ marginTop: '1.75rem' }}>
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.35rem' }}>Action control</h2>
          <p style={{ margin: '0 0 0.75rem', color: 'var(--muted)', fontSize: '0.88rem', maxWidth: 560 }}>
            Three states per action family for your company. Tool invokes are blocked when Prohibited, or when
            Approval required and the call has no valid CEO grant. Applies to every entitled employee — not a
            second policy product.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {actionControl.map((row) => (
              <label
                key={row.family}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  padding: '0.55rem 0.65rem',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                }}
              >
                <span>
                  <strong>{row.label}</strong>
                  <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                    {' '}
                    ({row.default_tier})
                  </span>
                </span>
                <select
                  value={row.mode}
                  onChange={(ev) => setFamilyMode(row.family, ev.target.value)}
                  style={{
                    padding: '0.35rem 0.5rem',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                  }}
                >
                  <option value="autonomous">Autonomous</option>
                  <option value="approval_required">Approval required</option>
                  <option value="prohibited">Prohibited</option>
                </select>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: '0.85rem' }}
            disabled={controlBusy}
            onClick={saveControl}
          >
            {controlBusy ? 'Saving…' : 'Save action control'}
          </button>

          <section style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 14, background: 'linear-gradient(145deg, color-mix(in srgb, var(--accent) 6%, var(--surface)), var(--surface))' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div><h2 style={{ fontSize: '1.08rem', margin: '0 0 0.25rem' }}>Scoped overrides &amp; recurring grants</h2><span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>Precise autonomy without repeated approvals</span></div>
              <span style={{ border: '1px solid var(--border)', borderRadius: 999, padding: '0.3rem 0.6rem', fontSize: '0.72rem', background: 'var(--surface)' }}>{actionOverrides.length} saved rule{actionOverrides.length === 1 ? '' : 's'}</span>
            </div>
            <p style={{ margin: '0 0 0.85rem', color: 'var(--muted)', fontSize: '0.86rem', lineHeight: 1.45 }}>
              Apply a narrower rule to one goal, workflow, employee, or tool. Resolution order is goal → workflow →
              employee → tool → company. For recurring email or publishing automation, choose Autonomous and bound
              it by permitted recipients/websites, expiry, and maximum uses.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.75rem' }}>
              <label><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--muted)' }}>Override target</span>
                <select value={overrideDraft.scope_type} onChange={(e) => setOverrideDraft((p) => ({ ...p, scope_type: e.target.value, scope_ids: [] }))} style={{ width: '100%', padding: '0.58rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
                  <option value="goal">Goal</option><option value="workflow">Workflow</option>
                  <option value="agent">Employee/agent</option><option value="tool">Tool</option>
                </select>
              </label>
              <SearchMultiSelect label={`Select ${overrideDraft.scope_type}s`} options={scopeCatalog[overrideDraft.scope_type] || []} selected={overrideDraft.scope_ids} onChange={(scope_ids) => setOverrideDraft((p) => ({ ...p, scope_ids }))} loading={catalogLoading} />
              <label><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--muted)' }}>Action family</span>
                <select value={overrideDraft.action_family} onChange={(e) => setOverrideDraft((p) => ({ ...p, action_family: e.target.value }))} style={{ width: '100%', padding: '0.48rem' }}>
                  {actionControl.map((row) => <option key={row.family} value={row.family}>{row.label}</option>)}
                </select>
              </label>
              <label><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--muted)' }}>Effective mode</span>
                <select value={overrideDraft.mode} onChange={(e) => setOverrideDraft((p) => ({ ...p, mode: e.target.value }))} style={{ width: '100%', padding: '0.48rem' }}>
                  <option value="autonomous">Autonomous grant</option><option value="approval_required">Approval required</option><option value="prohibited">Prohibited</option>
                </select>
              </label>
              <label><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--muted)' }}>Permitted email IDs (comma-separated)</span>
                <input value={overrideDraft.permitted_email_ids} onChange={(e) => setOverrideDraft((p) => ({ ...p, permitted_email_ids: e.target.value }))} placeholder="ceo@example.com" style={{ width: '100%', padding: '0.48rem', boxSizing: 'border-box' }} />
              </label>
              <label><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--muted)' }}>Permitted websites/domains</span>
                <input value={overrideDraft.permitted_websites} onChange={(e) => setOverrideDraft((p) => ({ ...p, permitted_websites: e.target.value }))} placeholder="linkedin.com, medium.com" style={{ width: '100%', padding: '0.48rem', boxSizing: 'border-box' }} />
              </label>
              <label><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--muted)' }}>Expires (optional)</span>
                <input type="datetime-local" value={overrideDraft.expires_at} onChange={(e) => setOverrideDraft((p) => ({ ...p, expires_at: e.target.value }))} style={{ width: '100%', padding: '0.48rem', boxSizing: 'border-box' }} />
              </label>
              <label><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--muted)' }}>Maximum uses (optional)</span>
                <input type="number" min="1" max="100000" value={overrideDraft.max_uses} onChange={(e) => setOverrideDraft((p) => ({ ...p, max_uses: e.target.value }))} placeholder="90" style={{ width: '100%', padding: '0.48rem', boxSizing: 'border-box' }} />
              </label>
            </div>
            <button type="button" className="btn-primary" disabled={overrideBusy || !overrideDraft.scope_ids.length} onClick={saveOverride} style={{ marginTop: '0.9rem' }}>
              {overrideBusy ? 'Saving…' : `Apply to ${overrideDraft.scope_ids.length || 0} selected`}
            </button>
            {actionOverrides.length > 0 && <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              {actionOverrides.map((row) => <div key={row.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.65rem', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div><strong>{row.scope_type}: {row.scope_id}</strong><div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                  {row.action_family} · {row.mode} · uses {row.use_count}{row.max_uses == null ? '/unbounded' : `/${row.max_uses}`}{row.expires_at ? ` · expires ${new Date(row.expires_at).toLocaleString()}` : ''}
                  {row.constraints?.permitted_email_ids?.length ? ` · email: ${row.constraints.permitted_email_ids.join(', ')}` : ''}
                  {row.constraints?.permitted_websites?.length ? ` · sites: ${row.constraints.permitted_websites.join(', ')}` : ''}
                </div></div>
                <button type="button" className="btn-secondary" disabled={overrideBusy} onClick={() => deleteOverride(row)}>Delete</button>
              </div>)}
            </div>}
          </section>
        </section>
      ) : null}
    </div>
  );
}

export default function Policies() {
  return (
    <RequireAuth>
      <PoliciesPanel />
    </RequireAuth>
  );
}
