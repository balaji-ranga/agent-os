import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import HoverFixedTooltip from '../components/HoverFixedTooltip.jsx';

function clipNames(avatar) {
  const catalog = avatar?.animation_catalog || [];
  return catalog
    .map((c) => (typeof c === 'string' ? c : c?.name))
    .map((n) => String(n || '').trim())
    .filter(Boolean);
}

function AvatarAnimationsTooltip({ avatar, children }) {
  const names = clipNames(avatar);
  const content = (
    <div className="avatar-anim-tooltip">
      <div className="avatar-anim-tooltip-title">Supported animations</div>
      {names.length ? (
        <ul className="avatar-anim-tooltip-list">
          {names.map((n) => (
            <li key={n}>
              <code>{n}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="avatar-anim-tooltip-empty">No animation clips found in this GLB/GLTF.</p>
      )}
      <p className="avatar-anim-tooltip-hint">
        Used by Virtual Room playback and the avatar outbound workflow.
      </p>
    </div>
  );

  return (
    <HoverFixedTooltip
      as="span"
      className="avatar-anim-hover"
      tooltipClassName="avatar-anim-tooltip-panel"
      placement="auto"
      content={content}
      tagProps={{
        tabIndex: 0,
        'aria-label': names.length
          ? `${names.length} animations: ${names.join(', ')}`
          : 'No animations in this avatar',
      }}
    >
      {children}
    </HoverFixedTooltip>
  );
}

export default function Avatars() {
  const nav = useNavigate();
  const [avatars, setAvatars] = useState([]);
  const [agents, setAgents] = useState([]);
  const [hunyuan, setHunyuan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');

  async function refresh() {
    const [a, ag, h] = await Promise.all([
      api.avatarsList(),
      api.agentsList(),
      api.avatarsHunyuanStatus().catch(() => ({ ok: false })),
    ]);
    setAvatars(a.avatars || []);
    const list = Array.isArray(ag) ? ag : ag.agents || [];
    setAgents(list.filter((x) => x && x.id && !x._leaf));
    setHunyuan(h);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message || String(e)));
  }, []);

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const contentBase64 = btoa(binary);
      await api.avatarsUpload({
        filename: file.name,
        mimeType: file.type || 'model/gltf-binary',
        name: name || file.name,
        contentBase64,
      });
      setMessage('Avatar uploaded');
      setName('');
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function onGenerate() {
    if (!prompt.trim()) return;
    setBusy(true);
    setError('');
    setMessage('Generating with Hunyuan3D (may take several minutes)...');
    try {
      await api.avatarsGenerate({ prompt: prompt.trim(), name: name || undefined });
      setMessage('Avatar generated');
      setPrompt('');
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
      setMessage('');
    } finally {
      setBusy(false);
    }
  }

  async function onAssign(avatarId, agentId) {
    setBusy(true);
    setError('');
    try {
      await api.avatarsAssignAgent(avatarId, agentId);
      setMessage('Agent assigned; inbound/outbound workflows created');
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onUnassign(avatarId) {
    setBusy(true);
    try {
      await api.avatarsUnassignAgent(avatarId);
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onIdleClip(avatarId, idleClip) {
    setBusy(true);
    setError('');
    try {
      await api.avatarsUpdate(avatarId, { idleClip: idleClip || null });
      setMessage(idleClip ? `Idle animation set to ${idleClip}` : 'Idle animation cleared (auto)');
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(avatarId) {
    if (!confirm('Delete this avatar?')) return;
    setBusy(true);
    try {
      await api.avatarsDelete(avatarId);
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>3D Avatars</h1>
      <p style={{ color: 'var(--muted)', maxWidth: 720 }}>
        Upload GLB/GLTF models, map an org agent, and open Virtual Room. Mapping creates reusable inbound/outbound
        workflows (STT/TTS + animation + 3D playback). Choose an <strong>Idle</strong> animation for rest pose;
        speak gestures still come from the workflow. Hover the clip count for the full catalog.
      </p>
      {error && <p style={{ color: 'var(--danger, #b91c1c)' }}>{error}</p>}
      {message && <p style={{ color: 'var(--ok, #15803d)' }}>{message}</p>}

      <section style={{ marginTop: '1.5rem', display: 'grid', gap: '1rem', maxWidth: 640 }}>
        <h2 style={{ fontSize: '1.1rem' }}>Onboard</h2>
        <label>
          Display name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Optional name"
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <label>
          Upload GLB / GLTF
          <input
            type="file"
            accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
            onChange={onUpload}
            disabled={busy}
            style={{ display: 'block' }}
          />
        </label>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
          <h3 style={{ fontSize: '1rem' }}>Create with Hunyuan3D</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            {hunyuan?.configured
              ? hunyuan.ok
                ? 'Hunyuan3D service is reachable.'
                : `Configured but unhealthy: ${hunyuan.error || hunyuan.reason || 'check GPU container'}`
              : 'Not configured (optional-hunyuan3d profile + HUNYUAN3D_URL).'}
          </p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="Text prompt for a humanoid avatar..."
            style={{ width: '100%' }}
            disabled={!hunyuan?.ok || busy}
          />
          <button
            type="button"
            onClick={onGenerate}
            disabled={!hunyuan?.ok || busy || !prompt.trim()}
            style={{ marginTop: 8 }}
          >
            Generate from text
          </button>
        </div>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Your avatars</h2>
        {!avatars.length && <p style={{ color: 'var(--muted)' }}>No avatars yet.</p>}
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '1rem' }}>
          {avatars.map((a) => {
            const names = clipNames(a);
            return (
              <li key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
                <strong>{a.name}</strong>
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--muted)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    alignItems: 'center',
                  }}
                >
                  <span>
                    {a.filename} · {(a.size_bytes / 1024 / 1024).toFixed(2)} MB · {a.source}
                  </span>
                  <span aria-hidden>·</span>
                  <AvatarAnimationsTooltip avatar={a}>
                    <span className="avatar-anim-badge">
                      clips: {names.length}
                      <span className="avatar-anim-badge-hint" aria-hidden>
                        {' '}
                        ⓘ
                      </span>
                    </span>
                  </AvatarAnimationsTooltip>
                </div>
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <select
                    value={a.agent_id || ''}
                    onChange={(e) => (e.target.value ? onAssign(a.id, e.target.value) : onUnassign(a.id))}
                    disabled={busy}
                  >
                    <option value="">Assign agent...</option>
                    {agents.map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        {ag.name || ag.id}
                      </option>
                    ))}
                  </select>
                  {a.agent_id ? (
                    <Link to={`/agents/${a.agent_id}/virtual-room`}>Virtual Room</Link>
                  ) : (
                    <button type="button" onClick={() => nav(`/avatars/${a.id}/room`)}>
                      Preview room
                    </button>
                  )}
                  <button type="button" onClick={() => onDelete(a.id)} disabled={busy}>
                    Delete
                  </button>
                </div>
                {(a.inbound_workflow_id || a.outbound_workflow_id) && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 6 }}>
                    In: {a.inbound_workflow_id || '—'} · Out: {a.outbound_workflow_id || '—'}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
