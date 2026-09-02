import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

function newTurnId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function useChatActivity(agentId, ownerUserId) {
  const [activity, setActivity] = useState(null);
  const timerRef = useRef(null);
  const turnRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const poll = useCallback(async (turnId) => {
    if (!agentId || !turnId) return;
    try {
      const next = await api.agentChatActivity(agentId, turnId, ownerUserId || 'default');
      if (turnRef.current === turnId && next?.status !== 'idle') setActivity(next);
    } catch (_) {
      // A progress hint is optional; the chat request remains authoritative.
    }
  }, [agentId, ownerUserId]);

  const startActivity = useCallback(() => {
    clearTimer();
    const turnId = newTurnId();
    turnRef.current = turnId;
    setActivity({
      status: 'running',
      current: { phase: 'sending', label: 'Sending request', detail: '' },
      events: [],
      tool_calls: [],
    });
    timerRef.current = setInterval(() => poll(turnId), 850);
    return turnId;
  }, [clearTimer, poll]);

  const stopActivity = useCallback(async () => {
    const turnId = turnRef.current;
    clearTimer();
    if (turnId) await poll(turnId);
    setTimeout(() => {
      if (turnRef.current === turnId) {
        turnRef.current = null;
        setActivity(null);
      }
    }, 1100);
  }, [clearTimer, poll]);

  useEffect(() => () => clearTimer(), [clearTimer]);
  return { activity, startActivity, stopActivity };
}

function eventKey(event, index) {
  return `${event.phase || 'event'}-${event.at || index}-${index}`;
}

export default function ChatActivityIndicator({ activity }) {
  if (!activity) return null;
  const current = activity.current || { label: 'Agent is working', detail: '' };
  const events = (activity.events || []).slice(-4);
  const tools = (activity.tool_calls || []).slice(-4);
  const running = activity.status === 'running';
  return (
    <div className="chat-live-activity" role="status" aria-live="polite" aria-label={current.label}>
      <div className="chat-live-activity__current">
        <span className={`chat-live-activity__pulse${running ? ' is-running' : ''}`} aria-hidden="true" />
        <div>
          <strong>{current.label || 'Agent is working'}</strong>
          {current.detail ? <div className="chat-live-activity__detail">{current.detail}</div> : null}
        </div>
      </div>
      {(events.length > 1 || tools.length > 0) ? (
        <div className="chat-live-activity__trail" aria-label="Work completed so far">
          {events.slice(0, -1).map((event, index) => (
            <span key={eventKey(event, index)}>✓ {event.label}</span>
          ))}
          {tools.map((tool) => (
            <span key={`tool-${tool.id || `${tool.tool_name}-${tool.created_at}`}`}>
              {tool.status === 'failed' ? '!' : '✓'} Tool: {tool.tool_name} {tool.status === 'failed' ? 'failed' : 'worked'}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
