import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext';
import { formatChatTimestamp, formatLocalDate } from '../utils/formatDateTime';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';

const PANEL_WIDTH = 320;
const PANEL_MAX_HEIGHT = 360;

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

export default function NotificationBell({ compact = false }) {
  const { notifications, markPlatformRead, dismissAgentNotifications, clearAll, hasMoreNotifications, loadingMoreNotifications, loadMoreNotifications } = useNotifications();
  const [open, setOpen] = useState(false);
  const notificationSentinelRef = useInfiniteScroll(loadMoreNotifications, open && hasMoreNotifications && !loadingMoreNotifications);
  const [panelPos, setPanelPos] = useState(null);
  const buttonRef = useRef(null);

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
                  {notifications.map((n) => (
                    <div key={n.feedId} className="notification-overlay-item">
                      {n.kind === 'platform' ? (
                        <>
                          <div style={{ marginBottom: '0.25rem' }} title={n.title || undefined}>
                            <strong>{n.title}</strong>
                            <span style={{ marginLeft: '0.35rem', fontSize: '0.75rem', color: 'var(--accent)' }}>
                              {n.created_by_is_agent || n.source === 'agent_notify'
                                ? n.created_by_name || 'Agent'
                                : n.created_by === 'system' || n.created_by_name === 'System'
                                  ? 'System'
                                  : 'Admin'}
                            </span>
                          </div>
                          {n.sortAt || n.created_at ? (
                            <time className="notification-overlay-time" dateTime={n.sortAt || n.created_at}>
                              {formatChatTimestamp(n.sortAt || n.created_at)}
                            </time>
                          ) : null}
                          {n.body && (
                            <div
                              className="notification-overlay-snippet"
                              title={[n.title, n.body].filter(Boolean).join('\n\n')}
                            >
                              {n.body}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                            {(() => {
                              const chatAgentId =
                                n.created_by_is_agent || n.source === 'agent_notify'
                                  ? String(n.created_by || '').trim()
                                  : '';
                              const chatHref =
                                n.link_url ||
                                (chatAgentId && chatAgentId !== 'agent' && chatAgentId !== 'system'
                                  ? `/agents/${encodeURIComponent(chatAgentId)}/chat`
                                  : null);
                              return chatHref ? (
                                <NotificationLink href={chatHref} onNavigate={() => onOpenLink(n)}>
                                  {chatAgentId ? 'Continue chat →' : 'Open →'}
                                </NotificationLink>
                              ) : null;
                            })()}
                            <button
                              type="button"
                              className="notification-overlay-clear"
                              onClick={() => markPlatformRead([n.id])}
                            >
                              Dismiss
                            </button>
                          </div>
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
                            {n.standup_title || formatLocalDate(n.scheduled_at)}
                          </div>
                          {n.sortAt || n.completed_at || n.scheduled_at ? (
                            <time
                              className="notification-overlay-time"
                              dateTime={n.sortAt || n.completed_at || n.scheduled_at}
                            >
                              {formatChatTimestamp(n.sortAt || n.completed_at || n.scheduled_at)}
                            </time>
                          ) : null}
                          {n.response_snippet && (
                            <div
                              className="notification-overlay-snippet"
                              title={
                                String(n.response_full || n.response_content || n.response_snippet || '').trim() ||
                                undefined
                              }
                            >
                              {n.response_snippet}…
                            </div>
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
                            <button
                              type="button"
                              className="notification-overlay-clear"
                              onClick={() => dismissAgentNotifications([n.id])}
                            >
                              Dismiss
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  <div ref={notificationSentinelRef} style={{ minHeight: 1 }} aria-hidden="true" />
                  {hasMoreNotifications && <button type="button" className="notification-overlay-clear" disabled={loadingMoreNotifications} onClick={loadMoreNotifications}>{loadingMoreNotifications ? 'Loading…' : 'Load more'}</button>}
                </div>
              )}
            </div>
          </>,
          document.body
        )
      : null;

  const hasUnread = notifications.length > 0;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        title="Notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`header-icon-btn${hasUnread ? ' has-unread' : ''}`}
        style={compact ? undefined : { width: '100%', borderRadius: 8 }}
      >
        <span aria-hidden>🔔</span>
        {hasUnread && <span className="header-icon-count">{notifications.length}</span>}
      </button>
      {panel}
    </>
  );
}
