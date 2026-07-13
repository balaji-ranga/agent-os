import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../api';

const PANEL_WIDTH = 320;
const PANEL_MAX_HEIGHT = 360;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function computePanelPosition(buttonEl) {
  if (!buttonEl) return null;
  const rect = buttonEl.getBoundingClientRect();
  const margin = 8;
  let left = rect.left;
  const top = rect.bottom + 6;
  if (left + PANEL_WIDTH > window.innerWidth - margin) {
    left = window.innerWidth - PANEL_WIDTH - margin;
  }
  if (left < margin) left = margin;
  return { top, left, width: PANEL_WIDTH };
}

function withinLast3Days(iso) {
  if (!iso) return false;
  const t = Date.parse(String(iso).includes('T') ? iso : String(iso).replace(' ', 'T') + 'Z');
  if (!Number.isFinite(t)) return true;
  return Date.now() - t <= THREE_DAYS_MS;
}

function normalizePlatformNotification(n) {
  return {
    ...n,
    kind: 'platform',
    feedId: `platform-${n.id}`,
    sortAt: n.created_at || '',
  };
}

function normalizeAgentNotification(n) {
  return {
    ...n,
    kind: 'agent',
    feedId: `agent-${n.id}`,
    sortAt: n.completed_at || n.scheduled_at || '',
  };
}

function NotificationLink({ href, onNavigate, children }) {
  const url = String(href || '').trim();
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) {
    return (
      <a href={url} target="_blank" rel="noreferrer" onClick={onNavigate} style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>
        {children}
      </a>
    );
  }
  return (
    <Link to={url.startsWith('/') ? url : `/${url}`} onClick={onNavigate} style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>
      {children}
    </Link>
  );
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState(null);
  const buttonRef = useRef(null);

  const fetchNotifications = () => {
    Promise.all([
      api.platformNotifications(30).catch(() => ({ notifications: [] })),
      api.standupNotifications(20).catch(() => ({ notifications: [] })),
    ]).then(([platformRes, agentRes]) => {
      const platform = (platformRes.notifications || []).map(normalizePlatformNotification);
      // Agent feed: unread is not stored server-side; only show last 3 days
      const agent = (agentRes.notifications || [])
        .filter((n) => withinLast3Days(n.completed_at || n.scheduled_at))
        .map(normalizeAgentNotification);
      const merged = [...platform, ...agent].sort((a, b) => String(b.sortAt).localeCompare(String(a.sortAt)));
      setNotifications(merged);
    });
  };

  const markPlatformRead = async (ids) => {
    const list = (ids || []).filter(Boolean);
    if (!list.length) return;
    try {
      await api.platformNotificationsRead(list);
    } catch (_) {}
    fetchNotifications();
  };

  const clearAll = async () => {
    try {
      await api.platformNotificationsReadAll();
    } catch (_) {}
    // Drop agent items from local view by refetching (agent items stay until 3 days lapse)
    setNotifications((prev) => prev.filter((n) => n.kind !== 'agent'));
    fetchNotifications();
  };

  const updatePanelPosition = useCallback(() => {
    setPanelPos(computePanelPosition(buttonRef.current));
  }, []);

  const toggleOpen = (e) => {
    e.stopPropagation();
    setOpen((wasOpen) => {
      if (wasOpen) return false;
      setPanelPos(computePanelPosition(buttonRef.current));
      return true;
    });
  };

  useEffect(() => {
    fetchNotifications();
    const id = setInterval(fetchNotifications, 10000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    updatePanelPosition();
    const onScrollOrResize = () => updatePanelPosition();
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, updatePanelPosition]);

  const closePanel = () => setOpen(false);

  const onOpenLink = (n) => {
    if (n.kind === 'platform' && n.id) markPlatformRead([n.id]);
    closePanel();
  };

  const panel =
    open && panelPos
      ? createPortal(
          <>
            <div className="notification-overlay-backdrop" aria-hidden onClick={closePanel} />
            <div
              className="notification-overlay-panel"
              role="dialog"
              aria-label="Notifications"
              style={{
                top: panelPos.top,
                left: panelPos.left,
                width: panelPos.width,
                maxHeight: PANEL_MAX_HEIGHT,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="notification-overlay-header">
                <span>Notifications</span>
                {notifications.length > 0 && (
                  <button type="button" onClick={clearAll} className="notification-overlay-clear">
                    Clear
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <div className="notification-overlay-empty">No unread notifications (last 3 days).</div>
              ) : (
                <div className="notification-overlay-list">
                  {notifications.slice(0, 20).map((n) => (
                    <div key={n.feedId} className="notification-overlay-item">
                      {n.kind === 'platform' ? (
                        <>
                          <div style={{ marginBottom: '0.25rem' }}>
                            <strong>{n.title}</strong>
                            <span style={{ marginLeft: '0.35rem', fontSize: '0.75rem', color: 'var(--accent)' }}>
                              {n.created_by === 'system' || n.created_by_name === 'System' ? 'System' : 'Admin'}
                            </span>
                          </div>
                          {n.body && <div className="notification-overlay-snippet">{n.body}</div>}
                          {n.link_url && (
                            <div style={{ marginTop: '0.35rem' }}>
                              <NotificationLink href={n.link_url} onNavigate={() => onOpenLink(n)}>
                                Open →
                              </NotificationLink>
                            </div>
                          )}
                          {!n.link_url && (
                            <button
                              type="button"
                              className="notification-overlay-clear"
                              style={{ marginTop: '0.35rem' }}
                              onClick={() => markPlatformRead([n.id])}
                            >
                              Mark read
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <div style={{ marginBottom: '0.25rem' }}>
                            <strong>{n.agent_name || n.to_agent_id}</strong>
                            {n.is_job_pipeline && (
                              <span style={{ marginLeft: '0.35rem', fontSize: '0.75rem', color: 'var(--accent)' }}>
                                Job pipeline
                              </span>
                            )}
                            {' — '}
                            {n.standup_title || new Date(n.scheduled_at).toLocaleDateString()}
                          </div>
                          {n.response_snippet && (
                            <div className="notification-overlay-snippet">{n.response_snippet}…</div>
                          )}
                          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                            {n.kanban_task_id && (
                              <Link to="/kanban" onClick={closePanel} style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>
                                Kanban →
                              </Link>
                            )}
                            <Link
                              to={`/agents/${encodeURIComponent(n.to_agent_id)}/chat`}
                              onClick={closePanel}
                              style={{ color: 'var(--accent)', fontSize: '0.85rem' }}
                            >
                              Chat →
                            </Link>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        title="Notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
        style={{
          padding: '0.4rem 0.6rem',
          background: notifications.length ? 'var(--accent)' : 'var(--surface)',
          color: notifications.length ? '#fff' : 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          cursor: 'pointer',
          fontSize: '0.9rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          width: '100%',
          justifyContent: 'center',
        }}
      >
        <span aria-hidden>🔔</span>
        {notifications.length > 0 && <span style={{ fontSize: '0.8rem', opacity: 0.9 }}>{notifications.length}</span>}
      </button>
      {panel}
    </>
  );
}
