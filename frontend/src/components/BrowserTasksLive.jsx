import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function truncate(value, length) {
  const text = String(value || '').trim();
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function copyTaskId(id) {
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(String(id)).catch(() => {});
}

function isActiveStatus(status) {
  return ['pending', 'running', 'recording'].includes(String(status || '').toLowerCase());
}

/**
 * Compact live strip for browse_* task ids.
 * Shown in the chat side pane only when the user opens Browser session.
 * Pass forceShow so the panel has content even when there are no recent tasks.
 */
export default function BrowserTasksLive({ variant = 'sidebar', forceShow = false }) {
  const [tasks, setTasks] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await api.browserSessionTasks({ limit: 8, days: 1 });
        if (!active) return;
        const list = Array.isArray(response?.tasks) ? response.tasks : [];
        const running = list.filter((t) => isActiveStatus(t.status));
        // Prefer active tasks; otherwise show at most one recent completed for the id/summary.
        setTasks(running.length ? running.slice(0, 3) : list.slice(0, 1));
      } catch {
        if (active) setTasks([]);
      } finally {
        if (active) setLoaded(true);
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!tasks.length && !forceShow) return null;

  const sidebar = variant === 'sidebar';

  return (
    <section
      className={sidebar ? 'browser-tasks-live browser-tasks-live--sidebar' : 'browser-tasks-live'}
      aria-label="Live browser tasks"
    >
      <div className="browser-tasks-live__head">
        <strong>Browser session</strong>
        <Link to="/browser-session">Open full</Link>
      </div>
      {!loaded ? (
        <div className="browser-tasks-live__empty">Loading…</div>
      ) : !tasks.length ? (
        <div className="browser-tasks-live__empty">
          No live browser tasks. Start from{' '}
          <Link to="/browser-session">Browser Session</Link> or let an agent use browse_*.
        </div>
      ) : (
        <ul className="browser-tasks-live__list">
          {tasks.map((task) => {
            const active = isActiveStatus(task.status);
            const summary = task.result?.summary || '';
            return (
              <li
                key={task.id}
                className={active ? 'browser-tasks-live__item is-active' : 'browser-tasks-live__item'}
              >
                <div className="browser-tasks-live__row">
                  <button
                    type="button"
                    title="Copy task ID"
                    onClick={() => copyTaskId(task.id)}
                    className="browser-tasks-live__id"
                  >
                    {truncate(task.id, 14)}
                  </button>
                  <span className="browser-tasks-live__status">{task.status}</span>
                </div>
                <div className="browser-tasks-live__goal" title={task.goal_text || ''}>
                  {truncate(task.goal_text, 72)}
                </div>
                {summary ? (
                  <div className="browser-tasks-live__summary" title={summary}>
                    {truncate(summary, 90)}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
