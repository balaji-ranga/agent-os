import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const NotificationContext = createContext(null);

const POLL_MS = 10000;
const DISMISSED_STORAGE_KEY = 'agent-os-dismissed-feed-ids';

function loadLocalDismissed() {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveLocalDismissed(set) {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...set].slice(-200)));
  } catch (_) {}
}

function withinLast3Days(iso) {
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  if (!iso) return false;
  const t = Date.parse(String(iso).includes('T') ? iso : `${String(iso).replace(' ', 'T')}Z`);
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
  const standupId = n.standup_id != null ? String(n.standup_id) : '';
  const agentId = n.to_agent_id != null ? String(n.to_agent_id) : '';
  return {
    ...n,
    kind: 'agent',
    feedId: `agent-${n.id}`,
    dismissKeys: [
      `agent-task-${n.id}`,
      standupId && agentId ? `agent-standup-${agentId}-${standupId}` : null,
    ].filter(Boolean),
    sortAt: n.completed_at || n.scheduled_at || '',
  };
}

function mergeNotifications(platformRes, agentRes, localDismissed) {
  const isDismissed = (n) => {
    if (localDismissed.has(n.feedId)) return true;
    if (n.kind === 'agent' && Array.isArray(n.dismissKeys)) {
      return n.dismissKeys.some((key) => localDismissed.has(key));
    }
    return false;
  };

  const platform = (platformRes.notifications || []).map(normalizePlatformNotification);
  const agent = (agentRes.notifications || [])
    .filter((n) => withinLast3Days(n.completed_at || n.scheduled_at))
    .map(normalizeAgentNotification);

  return [...platform, ...agent]
    .filter((n) => !isDismissed(n))
    .sort((a, b) => String(b.sortAt).localeCompare(String(a.sortAt)));
}

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const [hasMoreNotifications, setHasMoreNotifications] = useState(false);
  const [loadingMoreNotifications, setLoadingMoreNotifications] = useState(false);
  const [localDismissed, setLocalDismissed] = useState(() => loadLocalDismissed());

  const rememberDismissed = useCallback((items) => {
    if (!items?.length) return;
    setLocalDismissed((prev) => {
      const next = new Set(prev);
      for (const n of items) {
        next.add(n.feedId);
        if (n.kind === 'agent' && Array.isArray(n.dismissKeys)) {
          for (const key of n.dismissKeys) next.add(key);
        }
      }
      saveLocalDismissed(next);
      return next;
    });
  }, []);

  const fetchNotifications = useCallback(async () => {
    const [platformRes, agentRes] = await Promise.all([
      api.platformNotifications(30).catch(() => ({ notifications: [] })),
      api.standupNotifications(20).catch(() => ({ notifications: [] })),
    ]);
    const dismissed = loadLocalDismissed();
    setLocalDismissed(dismissed);
    setNotifications(mergeNotifications(platformRes, agentRes, dismissed));
    setHasMoreNotifications(!!platformRes.has_more);
  }, []);

  const loadMoreNotifications = useCallback(async () => {
    if (!hasMoreNotifications || loadingMoreNotifications) return;
    setLoadingMoreNotifications(true);
    try {
      const offset = notifications.filter((n) => n.kind === 'platform').length;
      const response = await api.platformNotifications(30, offset);
      const dismissed = loadLocalDismissed();
      const extra = (response.notifications || []).map(normalizePlatformNotification).filter((n) => !dismissed.has(n.feedId));
      setNotifications((current) => {
        const ids = new Set(current.map((n) => n.feedId));
        return [...current, ...extra.filter((n) => !ids.has(n.feedId))].sort((a, b) => String(b.sortAt).localeCompare(String(a.sortAt)));
      });
      setHasMoreNotifications(!!response.has_more);
    } finally { setLoadingMoreNotifications(false); }
  }, [hasMoreNotifications, loadingMoreNotifications, notifications]);

  useEffect(() => {
    fetchNotifications();
    const id = setInterval(fetchNotifications, POLL_MS);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  const markPlatformRead = useCallback(
    async (ids) => {
      const list = (ids || []).filter(Boolean);
      if (!list.length) return;
      const targets = notifications.filter((n) => n.kind === 'platform' && list.includes(n.id));
      rememberDismissed(targets);
      setNotifications((prev) => prev.filter((n) => !(n.kind === 'platform' && list.includes(n.id))));
      try {
        await api.platformNotificationsRead(list);
      } catch (_) {}
      fetchNotifications();
    },
    [notifications, rememberDismissed, fetchNotifications]
  );

  const dismissAgentNotifications = useCallback(
    async (ids) => {
      const list = (ids || []).filter(Boolean);
      if (!list.length) return;
      const targets = notifications.filter((n) => n.kind === 'agent' && list.includes(n.id));
      rememberDismissed(targets);
      setNotifications((prev) => prev.filter((n) => !(n.kind === 'agent' && list.includes(n.id))));
      try {
        await api.standupNotificationsDismiss(list);
      } catch (_) {}
      fetchNotifications();
    },
    [notifications, rememberDismissed, fetchNotifications]
  );

  const clearAll = useCallback(async () => {
    rememberDismissed(notifications);
    setNotifications([]);
    try {
      await Promise.all([api.platformNotificationsReadAll(), api.standupNotificationsDismissAll()]);
    } catch (_) {}
    fetchNotifications();
  }, [notifications, rememberDismissed, fetchNotifications]);

  const value = useMemo(
    () => ({
      notifications,
      fetchNotifications,
      markPlatformRead,
      dismissAgentNotifications,
      clearAll,
      hasMoreNotifications,
      loadingMoreNotifications,
      loadMoreNotifications,
    }),
    [notifications, fetchNotifications, markPlatformRead, dismissAgentNotifications, clearAll, hasMoreNotifications, loadingMoreNotifications, loadMoreNotifications]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
