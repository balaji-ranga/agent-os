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
  input_schema_text: '',
  invoke_mode: 'sync',
  callback_url: '',
  as_new_agent: false,
  publish_id: '',
};

export default function PublishA2AModal({
  open,
  workflow,
  existingPublication,
  existingPublications = [],
  onClose,
  onPublished,
}) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [issuedCredentials, setIssuedCredentials] = useState(null);
  const [copied, setCopied] = useState(null);

  const pubs =
    existingPublications?.length > 0
      ? existingPublications
      : existingPublication
        ? [existingPublication]
        : [];

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
    const list =
      existingPublications?.length > 0
        ? existingPublications
        : existingPublication
          ? [existingPublication]
          : [];
    const pub = list[0] || null;
    const meta = pub?.metadata || {};
    const trigger =
      workflow?.draft_graph?.nodes?.find((n) => n.type === 'trigger') ||
      workflow?.published_graph?.nodes?.find((n) => n.type === 'trigger');
    const fromTrigger = trigger?.data?.inputSchema || trigger?.data?.input_schema || null;
    const schema =
      pub?.input_schema ||
      workflow?.input_schema ||
      fromTrigger ||
      null;
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
      input_schema_text: schema ? JSON.stringify(schema, null, 2) : '',
      invoke_mode: pub?.invoke_mode === 'async' ? 'async' : 'sync',
      callback_url: pub?.callback_url || '',
      as_new_agent: false,
      publish_id: pub?.id || '',
    });
    setIssuedCredentials(null);
    setError(null);
    setCopied(null);
  }, [open, workflow, existingPublication, existingPublications]);

  if (!open) return null;

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const selectPublication = (pubId) => {
    const pub = pubs.find((p) => p.id === pubId);
    if (!pub) {
      set('publish_id', pubId);
      return;
    }
    const meta = pub.metadata || {};
    setForm((f) => ({
      ...f,
      as_new_agent: false,
      publish_id: pub.id,
      name: pub.name || f.name,
      description: pub.description || '',
      skill_id: pub.skill_id || 'default',
      skill_name: pub.skill_name || pub.name || '',
      skill_description: pub.skill_description || pub.description || '',
      auth_mode: pub.auth_mode === 'secured' || pub.has_auth ? 'secured' : 'public',
      invoke_mode: pub.invoke_mode === 'async' ? 'async' : 'sync',
      callback_url: pub.callback_url || '',
      version: pub.agent_card?.version || meta.version || f.version,
      tags: (meta.tags || []).join(', '),
      examples: (meta.examples || []).join('\n'),
      input_schema_text: pub.input_schema
        ? JSON.stringify(pub.input_schema, null, 2)
        : f.input_schema_text,
    }));
  };

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
      if (form.invoke_mode === 'async' && form.callback_url.trim()) {
        try {
          // eslint-disable-next-line no-new
          new URL(form.callback_url.trim());
        } catch {
          setError('Callback URL must be a valid absolute URL');
          setSaving(false);
          return;
        }
      }
      const tags = form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const examples = form.examples
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean);
      let input_schema = null;
      if (form.input_schema_text.trim()) {
        try {
          input_schema = JSON.parse(form.input_schema_text);
        } catch {
          setError('Input JSON Schema must be valid JSON');
          setSaving(false);
          return;
        }
      }
      const body = {
        name: form.name.trim(),
        description: form.description.trim(),
        skill_id: form.skill_id.trim() || 'default',
        skill_name: form.skill_name.trim() || form.name.trim(),
        skill_description: form.skill_description.trim() || form.description.trim(),
        auth_mode: form.auth_mode,
        invoke_mode: form.invoke_mode === 'async' ? 'async' : 'sync',
        callback_url: form.invoke_mode === 'async' ? form.callback_url.trim() || null : null,
        input_schema,
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
      if (form.as_new_agent) {
        body.as_new_agent = true;
      } else if (form.publish_id) {
        body.publish_id = form.publish_id;
      }
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

  const selectedPub = !form.as_new_agent && form.publish_id
    ? pubs.find((p) => p.id === form.publish_id)
    : null;
  const isUpdate = !form.as_new_agent && !!selectedPub;

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
                    agent. Choose sync or async invoke, Public or Secured access. You can publish the same
                    workflow as multiple agents with different names.
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
              {pubs.length > 0 && (
                <div className="wf-a2a-modal-live">
                  <strong>Existing A2A agents for this workflow</strong>
                  <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem' }}>
                    {pubs.map((p) => (
                      <li key={p.id} style={{ marginBottom: '0.35rem' }}>
                        <button
                          type="button"
                          className="wf-btn"
                          style={{ marginRight: '0.35rem' }}
                          onClick={() => selectPublication(p.id)}
                          disabled={form.as_new_agent}
                        >
                          {form.publish_id === p.id && !form.as_new_agent ? 'Selected' : 'Edit'}
                        </button>
                        {p.name}{' '}
                        <code style={{ fontSize: '0.8rem' }}>{p.id}</code>
                        {' · '}
                        {p.invoke_mode || 'sync'}
                        {' · '}
                        <a href={p.card_url} target="_blank" rel="noreferrer">
                          card
                        </a>
                      </li>
                    ))}
                  </ul>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem' }}>
                    <input
                      type="checkbox"
                      checked={form.as_new_agent}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setForm((f) => ({
                          ...f,
                          as_new_agent: on,
                          publish_id: on ? '' : f.publish_id || pubs[0]?.id || '',
                        }));
                      }}
                    />
                    <span>Publish as a <strong>new</strong> agent (different name / endpoint)</span>
                  </label>
                </div>
              )}

              {selectedPub && !form.as_new_agent && (
                <div className="wf-a2a-modal-live">
                  <div>
                    <strong>Live endpoint:</strong>{' '}
                    <a href={selectedPub.endpoint_url} target="_blank" rel="noreferrer">
                      {selectedPub.endpoint_url}
                    </a>
                  </div>
                  <div>
                    <strong>Agent card:</strong>{' '}
                    <a href={selectedPub.card_url} target="_blank" rel="noreferrer">
                      {selectedPub.card_url}
                    </a>
                  </div>
                  {selectedPub.auth_mode === 'secured' && selectedPub.client_id && (
                    <div>
                      <strong>client_id:</strong> <code>{selectedPub.client_id}</code>
                    </div>
                  )}
                  {selectedPub.token_url && selectedPub.auth_mode === 'secured' && (
                    <div>
                      <strong>token_url:</strong>{' '}
                      <a href={selectedPub.token_url} target="_blank" rel="noreferrer">
                        {selectedPub.token_url}
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

                <fieldset className="mcp-pg-field" style={{ border: 'none', padding: 0, margin: '0 0 0.75rem' }}>
                  <legend style={{ fontSize: '0.85rem', marginBottom: '0.35rem' }}>Invoke mode</legend>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <input
                      type="radio"
                      name="a2a-invoke-mode"
                      checked={form.invoke_mode === 'sync'}
                      onChange={() => set('invoke_mode', 'sync')}
                    />
                    <span>
                      <strong>Sync</strong> — HTTP waits for the run (up to ~2 minutes). Response includes final
                      output and run metadata.
                    </span>
                  </label>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                    <input
                      type="radio"
                      name="a2a-invoke-mode"
                      checked={form.invoke_mode === 'async'}
                      onChange={() => set('invoke_mode', 'async')}
                    />
                    <span>
                      <strong>Async</strong> — returns immediately with a task id. Callers poll{' '}
                      <code>enquire-progress</code> / <code>tasks/get</code>, and/or receive a callback POST.
                    </span>
                  </label>
                </fieldset>

                {form.invoke_mode === 'async' && (
                  <label className="mcp-pg-field">
                    <span>Callback URL (optional)</span>
                    <input
                      type="url"
                      value={form.callback_url}
                      onChange={(e) => set('callback_url', e.target.value)}
                      placeholder="https://example.com/hooks/a2a-result"
                    />
                    <small style={{ display: 'block', marginTop: 4, opacity: 0.8 }}>
                      When the run finishes, Flolah POSTs final output + run status/metadata here. Callers may
                      also override per-invoke via <code>params.metadata.callbackUrl</code>.
                    </small>
                  </label>
                )}

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
                  {form.auth_mode === 'secured' && selectedPub?.auth_mode === 'secured' && !form.as_new_agent && (
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
                <label className="mcp-pg-field">
                  <span>Input JSON Schema (optional)</span>
                  <textarea
                    value={form.input_schema_text}
                    onChange={(e) => set('input_schema_text', e.target.value)}
                    rows={8}
                    spellCheck={false}
                    placeholder='{"type":"object","required":["message"],"properties":{"message":{"type":"string"}},"additionalProperties":false}'
                  />
                  <small style={{ display: 'block', marginTop: 4, opacity: 0.8 }}>
                    Prefills from the Trigger node. When set, appears on the A2A agent card skill and validates
                    invocations.
                  </small>
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
                {saving
                  ? 'Publishing…'
                  : form.as_new_agent
                    ? 'Publish new A2A agent'
                    : isUpdate
                      ? 'Update A2A agent'
                      : 'Publish A2A agent'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body
  );
}
