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
  const [scenes, setScenes] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [hunyuan, setHunyuan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');
  const [sceneName, setSceneName] = useState('');
  const [sceneJsonText, setSceneJsonText] = useState('');
  const [roomName, setRoomName] = useState('');
  const [roomSceneId, setRoomSceneId] = useState('');
  const [memberPick, setMemberPick] = useState({});

  async function refresh() {
    const [a, ag, h, sc, rm] = await Promise.all([
      api.avatarsList(),
      api.agentsList(),
      api.avatarsHunyuanStatus().catch(() => ({ ok: false })),
      api.vrScenesList().catch(() => ({ scenes: [] })),
      api.vrRoomsList().catch(() => ({ rooms: [] })),
    ]);
    setAvatars(a.avatars || []);
    const list = Array.isArray(ag) ? ag : ag.agents || [];
    setAgents(list.filter((x) => x && x.id && !x._leaf));
    setHunyuan(h);
    setScenes(sc.scenes || []);
    setRooms(rm.rooms || []);
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

  async function fileToBase64(file) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function onSceneUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      let sceneJson = {};
      if (sceneJsonText.trim()) {
        sceneJson = JSON.parse(sceneJsonText);
      }
      const contentBase64 = await fileToBase64(file);
      await api.vrScenesUpload({
        filename: file.name,
        mimeType: file.type || 'model/gltf-binary',
        name: sceneName || file.name,
        contentBase64,
        sceneJson,
      });
      setMessage('Scene uploaded');
      setSceneName('');
      setSceneJsonText('');
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function onSceneDelete(sceneId) {
    if (!confirm('Delete this scene?')) return;
    setBusy(true);
    try {
      await api.vrScenesDelete(sceneId);
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onCreateRoom() {
    if (!roomName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const { room } = await api.vrRoomsCreate({
        name: roomName.trim(),
        sceneId: roomSceneId || null,
      });
      setMessage(`Room created: ${room.name}`);
      setRoomName('');
      await refresh();
      if (room?.id) nav(`/vr-rooms/${room.id}`);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onAddMember(roomId) {
    const avatarId = memberPick[roomId];
    if (!avatarId) return;
    setBusy(true);
    setError('');
    try {
      await api.vrRoomsAddMember(roomId, avatarId);
      setMemberPick((p) => ({ ...p, [roomId]: '' }));
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveMember(roomId, avatarId) {
    setBusy(true);
    try {
      await api.vrRoomsRemoveMember(roomId, avatarId);
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteRoom(roomId) {
    if (!confirm('Delete this virtual room?')) return;
    setBusy(true);
    try {
      await api.vrRoomsDelete(roomId);
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onPublishRoom(roomId) {
    setBusy(true);
    setError('');
    try {
      const { room } = await api.vrRoomsPublish(roomId, {});
      const path = room?.public_url || (room?.public_slug ? `/p/vr/${room.public_slug}` : '');
      setMessage(path ? `Published — share ${window.location.origin}${path}` : 'Published');
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onUnpublishRoom(roomId) {
    setBusy(true);
    setError('');
    try {
      await api.vrRoomsUnpublish(roomId);
      setMessage('Unpublished — guest link disabled');
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRoomScene(roomId, sceneId) {
    setBusy(true);
    try {
      await api.vrRoomsPatchScene(roomId, sceneId || null);
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  const assignableAvatars = avatars.filter((a) => a.agent_id);

  return (
    <div className="page">
      <h1>3D Avatars</h1>
      <p style={{ color: 'var(--muted)', maxWidth: 720 }}>
        Upload GLB/GLTF models, map an org agent, build Virtual Rooms with multiple members, and import environment
        scenes. Mapping creates reusable inbound/outbound workflows (STT/TTS + animation + 3D playback). Choose an{' '}
        <strong>Idle</strong> animation for rest pose; speak gestures still come from the workflow. Hover the clip
        count for the full catalog.
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
                  <label style={{ fontSize: '0.8rem', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    Idle
                    <select
                      value={a.idle_clip || ''}
                      onChange={(e) => onIdleClip(a.id, e.target.value)}
                      disabled={busy || !names.length}
                      title="Animation used when the avatar is not speaking"
                    >
                      <option value="">Auto (Blink / Look_Around)</option>
                      {names
                        .filter((n) => !/mouth|lip|viseme|jaw|phoneme/i.test(n))
                        .map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                    </select>
                  </label>
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

      <section style={{ marginTop: '2.5rem', maxWidth: 720 }}>
        <h2 style={{ fontSize: '1.1rem' }}>Scenes</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
          Import a GLB/GLTF environment. Optional scene JSON defines spawn points and media panel slots
          (video/chart/graph overlays).
        </p>
        <label>
          Scene name
          <input
            value={sceneName}
            onChange={(e) => setSceneName(e.target.value)}
            placeholder="Office floor"
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <label style={{ display: 'block', marginTop: 8 }}>
          Scene JSON (optional)
          <textarea
            value={sceneJsonText}
            onChange={(e) => setSceneJsonText(e.target.value)}
            rows={4}
            placeholder='{"mediaSlots":[{"id":"panel-1","position":[1.2,1.4,-1.5],"kind":"chart"}],"spawnPoints":[{"id":"a","position":[0,0,0]}]}'
            style={{ display: 'block', width: '100%', fontFamily: 'monospace', fontSize: 12 }}
          />
        </label>
        <label style={{ display: 'block', marginTop: 8 }}>
          Upload scene GLB / GLTF
          <input
            type="file"
            accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
            onChange={onSceneUpload}
            disabled={busy}
            style={{ display: 'block' }}
          />
        </label>
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '1rem', display: 'grid', gap: 8 }}>
          {scenes.map((s) => (
            <li
              key={s.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '0.75rem 1rem',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <div>
                <strong>{s.name}</strong>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                  {s.filename} · {((s.size_bytes || 0) / 1024 / 1024).toFixed(2)} MB
                  {Array.isArray(s.scene_json?.mediaSlots)
                    ? ` · ${s.scene_json.mediaSlots.length} media slot(s)`
                    : ''}
                </div>
              </div>
              <button type="button" onClick={() => onSceneDelete(s.id)} disabled={busy}>
                Delete
              </button>
            </li>
          ))}
          {!scenes.length && <li style={{ color: 'var(--muted)' }}>No scenes yet.</li>}
        </ul>
      </section>

      <section style={{ marginTop: '2.5rem', maxWidth: 720 }}>
        <h2 style={{ fontSize: '1.1rem' }}>Virtual Rooms</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
          Create a named room, add avatars that have agents assigned, then open the room. Use @handle in chat when
          there are multiple members.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
          <label>
            Room name
            <input
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="Standup room"
              style={{ display: 'block' }}
            />
          </label>
          <label>
            Default scene
            <select value={roomSceneId} onChange={(e) => setRoomSceneId(e.target.value)} style={{ display: 'block' }}>
              <option value="">Empty stage</option>
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onCreateRoom} disabled={busy || !roomName.trim()}>
            Create room
          </button>
        </div>
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '1rem', display: 'grid', gap: '1rem' }}>
          {rooms.map((r) => (
            <li key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong>
                  {r.name}
                  {r.published ? (
                    <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--accent)' }}>Published</span>
                  ) : null}
                </strong>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Link to={`/vr-rooms/${r.id}`}>Open Room</Link>
                  {r.published ? (
                    <>
                      {r.public_slug && (
                        <a href={`/p/vr/${encodeURIComponent(r.public_slug)}`} target="_blank" rel="noreferrer">
                          Guest
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const path = r.public_url || `/p/vr/${r.public_slug}`;
                          navigator.clipboard?.writeText(`${window.location.origin}${path}`);
                          setMessage('Public URL copied');
                        }}
                        disabled={busy}
                      >
                        Copy URL
                      </button>
                      <button type="button" onClick={() => onUnpublishRoom(r.id)} disabled={busy}>
                        Unpublish
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => onPublishRoom(r.id)} disabled={busy || !(r.members || []).length}>
                      Publish
                    </button>
                  )}
                  <button type="button" onClick={() => onDeleteRoom(r.id)} disabled={busy}>
                    Delete
                  </button>
                </div>
              </div>
              <label style={{ fontSize: '0.85rem', display: 'inline-flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                Scene
                <select
                  value={r.scene_id || ''}
                  onChange={(e) => onRoomScene(r.id, e.target.value)}
                  disabled={busy}
                >
                  <option value="">Empty stage</option>
                  {scenes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ marginTop: 8, fontSize: '0.85rem' }}>
                Members:{' '}
                {(r.members || []).length
                  ? (r.members || []).map((m) => (
                      <span key={m.avatar_id} style={{ marginRight: 8 }}>
                        @{m.handle}
                        <button
                          type="button"
                          style={{ marginLeft: 4, fontSize: 11 }}
                          onClick={() => onRemoveMember(r.id, m.avatar_id)}
                          disabled={busy}
                        >
                          ×
                        </button>
                      </span>
                    ))
                  : 'none'}
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  value={memberPick[r.id] || ''}
                  onChange={(e) => setMemberPick((p) => ({ ...p, [r.id]: e.target.value }))}
                  disabled={busy}
                >
                  <option value="">Add member…</option>
                  {assignableAvatars
                    .filter((a) => !(r.members || []).some((m) => m.avatar_id === a.id))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
                <button type="button" onClick={() => onAddMember(r.id)} disabled={busy || !memberPick[r.id]}>
                  Add
                </button>
              </div>
            </li>
          ))}
          {!rooms.length && <li style={{ color: 'var(--muted)' }}>No rooms yet.</li>}
        </ul>
      </section>
    </div>
  );
}
