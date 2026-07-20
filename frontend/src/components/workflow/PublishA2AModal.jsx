import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import MaskedSecretInput from '../MaskedSecretInput.jsx';

const EMPTY = {
  name: '',
  description: '',
  skill_id: 'default',
  skill_name: '',
  skill_description: '',
  version: '1.0.0',
  provider_name: '',
  provider_url: '',
  tags: '',
  examples: '',
  auth_token: '',
};

export default function PublishA2AModal({ open, workflow, existingPublication, onClose, onPublished }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const pub = existingPublication;
    const meta = pub?.metadata || {};
    setForm({
      name: pub?.name || workflow?.name || '',
      description: pub?.description || workflow?.description || '',
      skill_id: pub?.skill_id || 'default',
      skill_name: pub?.skill_name || pub?.name || workflow?.name || '',
      skill_description: pub?.skill_description || pub?.description || workflow?.description || '',
      version: pub?.agent_card?.version || meta.version || '1.0.0',
      provider_name: pub?.agent_card?.provider?.name || meta.provider?.name || '',
      provider_url: pub?.agent_card?.provider?.url || meta.provider?.url || '',
      tags: (meta.tags || []).join(', '),
      examples: (meta.examples || []).join('\n'),
      auth_token: '',
    });
    setError(null);
  }, [open, workflow, existingPublication]);

  if (!open) return null;

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const tags = form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const examples = form.examples
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean);
      const body = {
        name: form.name.trim(),
        description: form.description.trim(),
        skill_id: form.skill_id.trim() || 'default',
        skill_name: form.skill_name.trim() || form.name.trim(),
        skill_description: form.skill_description.trim() || form.description.trim(),
        metadata: {
          version: form.version.trim() || '1.0.0',
          tags,
          examples,
          ...(form.provider_name
            ? { provider: { name: form.provider_name.trim(), url: form.provider_url.trim() || undefined } }
            : {}),
        },
        agent_card: {
          version: form.version.trim() || '1.0.0',
          ...(form.provider_name
            ? { provider: { name: form.provider_name.trim(), url: form.provider_url.trim() || undefined } }
            : {}),
        },
      };
      if (form.auth_token.trim()) body.auth_token = form.auth_token.trim();
      await onPublished(body);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to publish A2A agent');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="wf-a2a-modal-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className="wf-a2a-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wf-a2a-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="wf-a2a-modal-header">
          <div>
            <h2 id="wf-a2a-modal-title">Publish as A2A Agent</h2>
            <p className="wf-a2a-modal-sub">
              Expose this published workflow as an{' '}
              <a href="https://a2a-protocol.org/" target="_blank" rel="noreferrer">
                A2A-compliant
              </a>{' '}
              agent. An agent card and JSON-RPC endpoint will be generated for other agents to invoke.
            </p>
          </div>
          <button type="button" className="wf-a2a-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="wf-a2a-modal-body">
          {existingPublication && (
            <div className="wf-a2a-modal-live">
              <div>
                <strong>Live endpoint:</strong>{' '}
                <a href={existingPublication.endpoint_url} target="_blank" rel="noreferrer">
                  {existingPublication.endpoint_url}
                </a>
              </div>
              <div>
                <strong>Agent card:</strong>{' '}
                <a href={existingPublication.card_url} target="_blank" rel="noreferrer">
                  {existingPublication.card_url}
                </a>
              </div>
            </div>
          )}

          {error && <div className="wf-editor-inline-status wf-editor-inline-status--error">{error}</div>}

          <form id="wf-a2a-publish-form" onSubmit={submit}>
            <label className="mcp-pg-field">
              <span>Agent name *</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                required
              />
            </label>
            <label className="mcp-pg-field">
              <span>Description</span>
              <textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={2}
              />
            </label>
            <div className="mcp-pg-segment">
              <label className="mcp-pg-field">
                <span>Skill ID</span>
                <input type="text" value={form.skill_id} onChange={(e) => set('skill_id', e.target.value)} />
              </label>
              <label className="mcp-pg-field">
                <span>Version</span>
                <input type="text" value={form.version} onChange={(e) => set('version', e.target.value)} />
              </label>
            </div>
            <label className="mcp-pg-field">
              <span>Skill name</span>
              <input type="text" value={form.skill_name} onChange={(e) => set('skill_name', e.target.value)} />
            </label>
            <label className="mcp-pg-field">
              <span>Skill description</span>
              <textarea
                value={form.skill_description}
                onChange={(e) => set('skill_description', e.target.value)}
                rows={2}
              />
            </label>
            <div className="mcp-pg-segment">
              <label className="mcp-pg-field">
                <span>Provider name</span>
                <input
                  type="text"
                  value={form.provider_name}
                  onChange={(e) => set('provider_name', e.target.value)}
                  placeholder="Your org"
                />
              </label>
              <label className="mcp-pg-field">
                <span>Provider URL</span>
                <input
                  type="url"
                  value={form.provider_url}
                  onChange={(e) => set('provider_url', e.target.value)}
                  placeholder="https://example.com"
                />
              </label>
            </div>
            <label className="mcp-pg-field">
              <span>Tags (comma-separated)</span>
              <input
                type="text"
                value={form.tags}
                onChange={(e) => set('tags', e.target.value)}
                placeholder="workflow, automation"
              />
            </label>
            <label className="mcp-pg-field">
              <span>Example prompts (one per line)</span>
              <textarea value={form.examples} onChange={(e) => set('examples', e.target.value)} rows={2} />
            </label>
            <label className="mcp-pg-field">
              <span>Auth token (optional — protects the A2A endpoint)</span>
              <MaskedSecretInput
                value={form.auth_token}
                onChange={(v) => set('auth_token', v)}
                placeholder={
                  existingPublication?.has_auth ? 'Leave blank to keep existing token' : 'Optional Bearer token'
                }
              />
            </label>
          </form>
        </div>

        <footer className="wf-a2a-modal-footer">
          <button type="button" className="wf-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            form="wf-a2a-publish-form"
            className="wf-btn-primary"
            disabled={saving || !form.name.trim()}
          >
            {saving ? 'Publishing…' : existingPublication ? 'Update A2A agent' : 'Publish A2A agent'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
