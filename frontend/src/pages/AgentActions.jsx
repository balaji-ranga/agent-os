import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatChatTimestamp } from '../utils/formatDateTime.js';

const STATE_LABEL = { working: 'Working now', queued: 'Queued', blocked: 'Blocked', idle: 'Idle' };

function ActionItem({ item }) {
  const body = (
    <>
      <span className="agent-action-kind">{item.kind}</span>
      <span className="agent-action-title">{item.title || `${item.kind} ${item.id}`}</span>
      <span className={`agent-action-status status-${item.status}`}>{String(item.status || '').replaceAll('_', ' ')}</span>
    </>
  );
  return item.link ? <Link className="agent-action-item" to={item.link}>{body}</Link> : <div className="agent-action-item">{body}</div>;
}

export default function AgentActions() {
  const [tab, setTab] = useState('live');
  const [live, setLive] = useState(null);
  const [history, setHistory] = useState({ items: [], offset: 0, has_more: false });
  const [error, setError] = useState('');
  const pageSize = 30;

  useEffect(() => {
    if (tab !== 'live') return undefined;
    let cancelled = false;
    const load = () => api.agentActionsLive().then((r) => {
      if (!cancelled) { setLive(r); setError(''); }
    }).catch((e) => !cancelled && setError(e.message));
    load();
    const timer = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [tab]);

  const loadHistory = (offset = 0) => {
    api.agentActionsHistory({ limit: pageSize, offset })
      .then((r) => { setHistory(r); setError(''); })
      .catch((e) => setError(e.message));
  };
  useEffect(() => { if (tab === 'history') loadHistory(0); }, [tab]);

  return (
    <div className="agent-actions-page">
      <header className="agent-actions-header">
        <div>
          <h1>Agent Actions</h1>
          <p>See what every AI employee is doing, what is next, and what needs your attention.</p>
        </div>
        {live?.generated_at && <span className="agent-actions-updated">Live · {formatChatTimestamp(live.generated_at)}</span>}
      </header>
      <div className="agent-actions-tabs" role="tablist">
        <button className={tab === 'live' ? 'active' : ''} onClick={() => setTab('live')}>Live view</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History</button>
      </div>
      {error && <p className="form-status form-status-error">{error}</p>}

      {tab === 'live' ? (
        <>
          <section className="agent-actions-summary">
            {['working', 'queued', 'blocked', 'idle'].map((key) => (
              <div key={key} className={`agent-actions-metric metric-${key}`}>
                <strong>{live?.summary?.[key] ?? '—'}</strong><span>{STATE_LABEL[key]}</span>
              </div>
            ))}
          </section>
          {live?.approvals?.length ? (
            <section className="agent-actions-attention">
              <h2>Needs attention · approvals and policy blocks</h2>
              {live.approvals.map((item) => <ActionItem key={`${item.kind}-${item.id}`} item={item} />)}
            </section>
          ) : null}
          <section className="agent-live-grid" aria-live="polite">
            {(live?.agents || []).map((agent) => (
              <article className={`agent-live-card state-${agent.state}`} key={agent.id}>
                <div className="agent-live-head">
                  <span className="agent-live-pulse" aria-hidden />
                  <div><h2>{agent.name}</h2><p>{agent.department || agent.role || 'AI employee'}</p></div>
                  <span className="agent-live-state">{STATE_LABEL[agent.state]}</span>
                </div>
                {agent.blocked.length ? <div className="agent-live-lane"><h3>Needs attention</h3>{agent.blocked.map((x) => <ActionItem key={`${x.kind}-${x.id}`} item={x} />)}</div> : null}
                {agent.current.length ? <div className="agent-live-lane"><h3>Now</h3>{agent.current.map((x) => <ActionItem key={`${x.kind}-${x.id}`} item={x} />)}</div> : null}
                {agent.queued.length ? <div className="agent-live-lane"><h3>Next</h3>{agent.queued.slice(0, 4).map((x) => <ActionItem key={`${x.kind}-${x.id}`} item={x} />)}</div> : null}
                {!agent.current.length && !agent.queued.length && !agent.blocked.length ? <p className="agent-live-idle">Ready for work</p> : null}
              </article>
            ))}
          </section>
        </>
      ) : (
        <section className="agent-action-history">
          {(history.items || []).map((item, i) => (
            <article key={`${item.kind}-${item.id}-${i}`}>
              <div><span className="agent-action-kind">{item.kind}</span><strong>{item.title || `${item.kind} ${item.id}`}</strong></div>
              <p>{item.output || item.error_message || 'No output summary recorded.'}</p>
              <footer><span>{item.agent_id || 'Platform'}</span><span>{String(item.status || '').replaceAll('_', ' ')}</span>{item.at && <time>{formatChatTimestamp(item.at)}</time>}{item.link && <Link to={item.link}>Open</Link>}</footer>
            </article>
          ))}
          {!history.items?.length && <p className="agent-live-idle">No action history yet.</p>}
          <div className="agent-action-pager">
            <button disabled={!history.offset} onClick={() => loadHistory(Math.max(0, history.offset - pageSize))}>Previous</button>
            <span>{history.offset + 1}–{history.offset + (history.items?.length || 0)}</span>
            <button disabled={!history.has_more} onClick={() => loadHistory(history.offset + pageSize)}>Next</button>
          </div>
        </section>
      )}
    </div>
  );
}
