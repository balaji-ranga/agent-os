import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

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
  auth_mode: 'public',
  rotate_credentials: false,
};

export default function PublishA2AModal({ open, workflow, existingPublication, onClose, onPublished }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [issuedCredentials, setIssuedCredentials] = useState(null);
  const [copied, setCopied] = useState(null);

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
      auth_mode: pub?.auth_mode === 'secured' || pub?.has_auth ? 'secured' : 'public',
      rotate_credentials: false,
    });
    setIssuedCredentials(null);
    setError(null);
    setCopied(null);
  }, [open, workflow, existingPublication]);

  if (!open) return null;

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const copyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch (_) {}
  };

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
        auth_mode: form.auth_mode,
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
      if (form.auth_mode === 'secured' && form.rotate_credentials) {
        body.rotate_credentials = true;
      }
      const pub = await onPublished(body);
      if (pub?.credentials?.client_secret) {
        setIssuedCredentials(pub.credentials);
      } else {
        onClose();
      }
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
      onClick={() => {
        if (!issuedCredentials) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !issuedCredentials) onClose();
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
            <h2 id="wf-a2a-modal-title">
              {issuedCredentials ? 'Save your A2A credentials' : 'Publish as A2A Agent'}
            </h2>
            <p className="wf-a2a-modal-sub">
              {issuedCredentials
                ? 'Client secret is shown once. Store it securely — you will need it to request access tokens.'
                : (
                  <>
                    Expose this published workflow as an{' '}
                    <a href="https://a2a-protocol.org/" target="_blank" rel="noreferrer">
                      A2A-compliant
                    </a>{' '}
                    agent. Choose Public (open invoke) or Secured (OAuth client credentials → Bearer token).
                  </>
                )}
            </p>
          </div>
          {!issuedCredentials && (
            <button type="button" className="wf-a2a-modal-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </header>

        <div className="wf-a2a-modal-body">
          {issuedCredentials ? (
            <div className="wf-a2a-modal-live">
              <div>
                <strong>client_id</strong>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.25rem' }}>
                  <code style={{ flex: 1, wordBreak: 'break-all' }}>{issuedCredentials.client_id}</code>
                  <button
                    type="button"
                    className="wf-btn"
                    onClick={() => copyText(issuedCredentials.client_id, 'id')}
                  >
                    {copied === 'id' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                <strong>client_secret</strong>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.25rem' }}>
                  <code style={{ flex: 1, wordBreak: 'break-all' }}>{issuedCredentials.client_secret}</code>
                  <button
                    type="button"
                    className="wf-btn"
                    onClick={() => copyText(issuedCredentials.client_secret, 'secret')}
                  >
                    {copied === 'secret' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                <strong>token_url</strong>
                <div style={{ marginTop: '0.25rem' }}>
                  <code style={{ wordBreak: 'break-all' }}>{issuedCredentials.token_url}</code>
                </div>
              </div>
              <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: 'var(--muted)' }}>
                POST <code>grant_type=client_credentials</code> with these credentials, then call the A2A
                endpoint with <code>Authorization: Bearer &lt;access_token&gt;</code>.
              </p>
            </div>
          ) : (
            <>
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
                  {existingPublication.auth_mode === 'secured' && existingPublication.client_id && (
                    <div>
                      <strong>client_id:</strong> <code>{existingPublication.client_id}</code>
                    </div>
                  )}
                  {existingPublication.token_url && existingPublication.auth_mode === 'secured' && (
                    <div>
                      <strong>token_url:</strong>{' '}
                      <a href={existingPublication.token_url} target="_blank" rel="noreferrer">
                        {existingPublication.token_url}
                      </a>
                    </div>
                  )}
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

                <fieldset className="mcp-pg-field" style={{ border: 'none', padding: 0, margin: 0 }}>
                  <legend style={{ fontSize: '0.85rem', marginBottom: '0.35rem' }}>Access</legend>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <input
                      type="radio"
                      name="a2a-auth-mode"
                      checked={form.auth_mode === 'public'}
                      onChange={() => set('auth_mode', 'public')}
                    />
                    <span>
                      <strong>Public</strong> — anyone with the endpoint can invoke (no token).
                    </span>
                  </label>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                    <input
                      type="radio"
                      name="a2a-auth-mode"
                      checked={form.auth_mode === 'secured'}
                      onChange={() => set('auth_mode', 'secured')}
                    />
                    <span>
                      <strong>Secured</strong> — clients exchange <code>client_id</code> +{' '}
                      <code>client_secret</code> for a Bearer access token, then call A2A.
                    </span>
                  </label>
                  {form.auth_mode === 'secured' && existingPublication?.auth_mode === 'secured' && (
                    <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem' }}>
                      <input
                        type="checkbox"
                        checked={form.rotate_credentials}
                        onChange={(e) => set('rotate_credentials', e.target.checked)}
                      />
                      <span>Rotate client secret (invalidates previous secret and tokens)</span>
                    </label>
                  )}
                </fieldset>

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
              </form>
            </>
          )}
        </div>

        <footer className="wf-a2a-modal-footer">
          {issuedCredentials ? (
            <button type="button" className="wf-btn-primary" onClick={onClose}>
              Done — I saved the secret
            </button>
          ) : (
            <>
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
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body
  );
}
