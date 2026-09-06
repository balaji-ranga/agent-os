import { useEffect, useState } from 'react';
import { api } from '../api';
import AgentAvatarPicker from './AgentAvatarPicker.jsx';
import { formatLocalDateTime } from '../utils/formatDateTime.js';

/**
 * Publish / unpublish an AI employee to Agent Exchange (Flolah or Public).
 */
export default function PublishAgentToExchangeModal({ agent, onClose, onChanged }) {
  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState(null);
  const [name, setName] = useState(agent?.name || '');
  const [description, setDescription] = useState(agent?.role || '');
  const [visibility, setVisibility] = useState('flolah');
  const [avatar, setAvatar] = useState(agent?.avatar_image || '');
  const [saving, setSaving] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .agentA2APublication(agent.id)
      .then((pub) => {
        if (cancelled) return;
        setExisting(pub);
        setName(pub.name || agent?.name || '');
        setDescription(pub.description || agent?.role || '');
        setVisibility(pub.visibility === 'public' ? 'public' : 'flolah');
        setAvatar(pub.avatar_image || agent?.avatar_image || '');
      })
      .catch(() => {
        if (cancelled) return;
        setExisting(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agent?.id, agent?.name, agent?.role, agent?.avatar_image]);

  const publish = async (e) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const pub = await api.agentPublishA2A(agent.id, {
        name: name.trim(),
        description: description.trim(),
        visibility,
        avatar_image: avatar || '',
      });
      setExisting(pub);
      onChanged?.(pub);
      onClose?.();
    } catch (err) {
      setError(err.message || 'Failed to publish');
    } finally {
      setSaving(false);
    }
  };

  const unpublish = async () => {
    if (
      !window.confirm(
        `Unpublish "${existing?.name || agent?.name}" from Agent Exchange? Importers keep their copies. Public A2A (if any) stops immediately.`
      )
    ) {
      return;
    }
    setUnpublishing(true);
    setError(null);
    try {
      await api.agentUnpublishA2A(agent.id);
      onChanged?.(null);
      onClose?.();
    } catch (err) {
      setError(err.message || 'Failed to unpublish');
    } finally {
      setUnpublishing(false);
    }
  };

  return (
    <div className="mcp-pg-modal-backdrop" onClick={() => !saving && onClose?.()}>
      <form className="mcp-pg-modal" onSubmit={publish} onClick={(e) => e.stopPropagation()}>
        <div className="mcp-pg-modal-header">
          <h2>{existing ? 'Update Agent Exchange listing' : 'Publish to Agent Exchange'}</h2>
          <button type="button" className="mcp-pg-btn-icon" onClick={() => onClose?.()} aria-label="Close">
            ×
          </button>
        </div>
        <p className="mcp-pg-card-desc">
          <strong>Flolah</strong> — visible inside Flolah so other CEOs can add this AI employee to
          their org and workspace. Not callable on the public internet.
          <br />
          <strong>Public</strong> — listed on Agent Exchange and callable as A2A at{' '}
          <code>/api/a2a/…</code>.
        </p>
        {loading && <p className="page-muted">Loading listing…</p>}
        {error && <div className="mcp-pg-alert mcp-pg-alert-error">{error}</div>}
        <label className="mcp-pg-field">
          <span>Listing name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="mcp-pg-field">
          <span>Description</span>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <fieldset className="mcp-pg-field" style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontSize: '0.85rem', marginBottom: 6 }}>Publish mode</legend>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
            <input
              type="radio"
              name="agent-publish-vis"
              checked={visibility === 'flolah'}
              onChange={() => setVisibility('flolah')}
            />
            <span>
              <strong>Flolah</strong> — in-app only. Other Flolah users can Add to org.
            </span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              type="radio"
              name="agent-publish-vis"
              checked={visibility === 'public'}
              onChange={() => setVisibility('public')}
            />
            <span>
              <strong>Public</strong> — anyone on the internet can call this agent as A2A.
            </span>
          </label>
        </fieldset>
        <AgentAvatarPicker value={avatar} name={name} onChange={setAvatar} />
        {existing && (
          <p className="page-muted" style={{ fontSize: '0.8rem' }}>
            Published {existing.published_at ? formatLocalDateTime(existing.published_at) : ''}
            {existing.visibility ? ` · ${existing.visibility}` : ''}
          </p>
        )}
        <div className="mcp-pg-card-actions" style={{ marginTop: '0.75rem' }}>
          <button type="submit" className="mcp-pg-btn-primary" disabled={saving || loading}>
            {saving ? 'Publishing…' : existing ? 'Update listing' : 'Publish'}
          </button>
          {existing && (
            <button
              type="button"
              className="mcp-pg-btn-ghost"
              style={{ color: '#dc2626' }}
              disabled={unpublishing}
              onClick={unpublish}
            >
              {unpublishing ? 'Unpublishing…' : 'Unpublish'}
            </button>
          )}
          <button type="button" className="mcp-pg-btn-ghost" onClick={() => onClose?.()}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
