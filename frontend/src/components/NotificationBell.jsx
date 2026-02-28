import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const NOTIFICATIONS_DISMISSED_KEY = 'agent-os-dismissed-notification-ids';
const MAX_DISMISSED_IDS = 200;

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [dismissedIds, setDismissedIds] = useState(() => {
    try {
      const raw = localStorage.getItem(NOTIFICATIONS_DISMISSED_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(-MAX_DISMISSED_IDS) : [];
    } catch (_) {
      return [];
    }
  });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const visible = notifications.filter((n) => !dismissedIds.includes(n.id));

  const persistDismissed = (ids) => {
    const next = Array.isArray(ids) ? ids.slice(-MAX_DISMISSED_IDS) : [];
    setDismissedIds(next);
    try {
      localStorage.setItem(NOTIFICATIONS_DISMISSED_KEY, JSON.stringify(next));
    } catch (_) {}
  };

  const clearAll = () => {
    const ids = notifications.map((n) => n.id).filter(Boolean);
    if (ids.length > 0) persistDismissed([...dismissedIds, ...ids]);
  };

  const fetchNotifications = () => {
    api.standupNotifications(20).then((data) => setNotifications(data.notifications || [])).catch(() => setNotifications([]));
  };

  useEffect(() => {
    fetchNotifications();
    const id = setInterval(fetchNotifications, 10000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', onOutside);
    return () => document.removeEventListener('click', onOutside);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Agent responses"
        style={{
          padding: '0.4rem 0.6rem',
          background: visible.length ? 'var(--accent)' : 'var(--surface)',
          color: visible.length ? '#fff' : 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          cursor: 'pointer',
          fontSize: '0.9rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
        }}
      >
        <span aria-hidden>🔔</span>
        {visible.length > 0 && <span style={{ fontSize: '0.8rem', opacity: 0.9 }}>{visible.length}</span>}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            minWidth: 260,
            maxWidth: 340,
            maxHeight: 320,
            overflowY: 'auto',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 100,
            padding: '0.5rem 0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', fontWeight: 600, fontSize: '0.9rem', borderBottom: '1px solid var(--border)' }}>
            <span>Agent responses</span>
            {visible.length > 0 && (
              <button type="button" onClick={clearAll} style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--muted)' }}>
                Clear
              </button>
            )}
          </div>
          {visible.length === 0 ? (
            <div style={{ padding: '0.75rem', color: 'var(--muted)', fontSize: '0.9rem' }}>No recent responses.</div>
          ) : (
            visible.slice(0, 15).map((n) => (
              <div key={n.id} style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
                <div style={{ marginBottom: '0.25rem' }}>
                  <strong>{n.to_agent_id}</strong> — {n.standup_title || new Date(n.scheduled_at).toLocaleDateString()}
                </div>
                {n.response_snippet && <div style={{ color: 'var(--muted)', marginBottom: '0.35rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.response_snippet}…</div>}
                <Link to={`/agents/${encodeURIComponent(n.to_agent_id)}/chat`} onClick={() => setOpen(false)} style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>
                  Chat →
                </Link>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
