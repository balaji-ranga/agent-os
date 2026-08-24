import { useState, useEffect } from 'react';
import { api } from '../api';
import { RequireAuth } from '../context/AuthContext';

const PLACEHOLDER = `Examples:
- Never share confidential financial data outside approved channels.
- Do not generate sexual, abusive, or harassing content.
- Prefer local tools over browser automation for Master Data.
- Escalate legal or medical advice to a human specialist.`;

function PoliciesPanel() {
  const [activeTab, setActiveTab] = useState('guardrails');
  const [policyText, setPolicyText] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [actionControl, setActionControl] = useState([]);
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
        if (data.exception_policy) setExceptionPolicy(data.exception_policy);
      })
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
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
            Approval required and the call has no CEO approval. Applies to every entitled employee — not a
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
