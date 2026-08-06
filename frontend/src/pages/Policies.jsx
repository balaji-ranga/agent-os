import { useState, useEffect } from 'react';
import { api } from '../api';
import { RequireAuth } from '../context/AuthContext';

const PLACEHOLDER = `Examples:
- Never share confidential financial data outside approved channels.
- Do not generate sexual, abusive, or harassing content.
- Prefer local tools over browser automation for Master Data.
- Escalate legal or medical advice to a human specialist.`;

function PoliciesPanel() {
  const [policyText, setPolicyText] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
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

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : (
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
      )}
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
