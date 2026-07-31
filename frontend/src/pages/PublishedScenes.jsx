import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function PublishedScenes() {
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  async function refresh() {
    const r = await api.vrRoomsPublished();
    setRooms(r.rooms || []);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message || String(e)));
  }, []);

  async function onUnpublish(id) {
    if (!window.confirm('Unpublish this scene? Guests will lose access.')) return;
    setBusy(true);
    setError('');
    try {
      await api.vrRoomsUnpublish(id);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function copyPublicUrl(room) {
    const path = room.public_url || (room.public_slug ? `/p/vr/${room.public_slug}` : '');
    if (!path) return;
    const abs = `${window.location.origin}${path}`;
    navigator.clipboard?.writeText(abs).then(() => {
      setCopied(room.id);
      setTimeout(() => setCopied(''), 2000);
    });
  }

  return (
    <div className="page published-scenes">
      <h1>Published Scenes</h1>
      <p style={{ color: 'var(--muted)', maxWidth: 560 }}>
        Rooms you published as guest-accessible Virtual Rooms. Share the public link — chat stays in the visitor&apos;s
        browser only.
      </p>
      {error && <p style={{ color: 'var(--danger, #b91c1c)' }}>{error}</p>}
      {!rooms.length && !error && (
        <p style={{ color: 'var(--muted)' }}>
          No published rooms yet. Open <Link to="/avatars">3D Avatars</Link>, create a room with members, then Publish.
        </p>
      )}
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '1rem', maxWidth: 720 }}>
        {rooms.map((r) => (
          <li key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <strong>{r.publish_title || r.name}</strong>
                {r.published_at && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                    Published {new Date(r.published_at).toLocaleString()}
                  </div>
                )}
                <div style={{ fontSize: '0.85rem', marginTop: 4 }}>
                  {(r.members || []).map((m) => `@${m.handle}`).join(', ') || 'No members'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Link to={`/vr-rooms/${r.id}`}>Open Room</Link>
                {r.public_slug && (
                  <a href={`/p/vr/${encodeURIComponent(r.public_slug)}`} target="_blank" rel="noreferrer">
                    Guest view
                  </a>
                )}
                <button type="button" onClick={() => copyPublicUrl(r)} disabled={busy}>
                  {copied === r.id ? 'Copied' : 'Copy URL'}
                </button>
                <button type="button" onClick={() => onUnpublish(r.id)} disabled={busy}>
                  Unpublish
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
