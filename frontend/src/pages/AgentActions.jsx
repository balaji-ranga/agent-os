import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatChatTimestamp } from '../utils/formatDateTime.js';

const STATE_LABEL = { working: 'Working now', queued: 'Queued', blocked: 'Blocked', idle: 'Idle' };

function NetworkNode({ agent, index, total }) {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
  const radius = total > 8 ? 41 : 37;
  const style = {
    '--node-x': `${50 + Math.cos(angle) * radius}%`,
    '--node-y': `${50 + Math.sin(angle) * radius}%`,
  };
  return (
    <div className={`ops-network-node state-${agent.state}`} style={style} title={`${agent.name}: ${STATE_LABEL[agent.state]}`}>
      <span className="ops-node-orb">{agent.name?.slice(0, 1) || 'A'}</span>
      <strong>{agent.name}</strong>
      <small>{agent.current[0]?.title || agent.queued[0]?.title || STATE_LABEL[agent.state]}</small>
    </div>
  );
}

function OperationsDashboard({ live }) {
  const agents = live?.agents || [];
  const summary = live?.summary || {};
  const activeWork = agents.reduce((n, a) => n + a.current.length, 0);
  const totalAgents = agents.length;
  const ready = agents.filter((a) => a.state === 'idle').length;
  const events = agents.flatMap((agent) => [
    ...agent.blocked.map((item) => ({ ...item, agent: agent.name, lane: 'blocked' })),
    ...agent.current.map((item) => ({ ...item, agent: agent.name, lane: 'working' })),
    ...agent.queued.map((item) => ({ ...item, agent: agent.name, lane: 'queued' })),
  ]).sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 8);
  const visibleAgents = agents.slice(0, 12);

  return (
    <div className="ops-dashboard">
      <section className="ops-metrics" aria-label="Live operating metrics">
        <div><span>Active agents</span><strong>{summary.working ?? 0}</strong><small>of {totalAgents} AI employees</small></div>
        <div><span>Tasks running</span><strong>{activeWork}</strong><small>current executions</small></div>
        <div><span>Queued work</span><strong>{summary.queued ?? 0}</strong><small>waiting to run</small></div>
        <div><span>Needs attention</span><strong>{summary.blocked ?? 0}</strong><small>blocked or approval</small></div>
        <div><span>Ready agents</span><strong>{ready}</strong><small>available for work</small></div>
      </section>

      <div className="ops-main-grid">
        <section className="ops-panel ops-event-panel">
          <header><h2>Live event stream</h2><span className="ops-live-badge">Live</span></header>
          <div className="ops-event-list">
            {events.map((item, i) => (
              <div className={`ops-event lane-${item.lane}`} key={`${item.agent}-${item.kind}-${item.id}-${i}`}>
                <span className="ops-event-dot" aria-hidden />
                <div><strong>{item.agent}</strong><p>{item.title}</p><small>{item.kind} · {String(item.status || '').replaceAll('_', ' ')}</small></div>
              </div>
            ))}
            {!events.length && <p className="agent-live-idle">No work is active right now.</p>}
          </div>
        </section>

        <section className="ops-panel ops-network" aria-label="Live agent network">
          <div className="ops-network-lines" aria-hidden />
          <div className="ops-network-core"><span>✦</span><strong>Flolah</strong><small>Agent network</small></div>
          {visibleAgents.map((agent, index) => <NetworkNode key={agent.id} agent={agent} index={index} total={visibleAgents.length} />)}
          {agents.length > visibleAgents.length && <span className="ops-more-agents">+{agents.length - visibleAgents.length} more</span>}
        </section>

        <aside className="ops-side-stack">
          <section className="ops-panel ops-health">
            <header><h2>Agent health</h2></header>
            {['working', 'queued', 'blocked', 'idle'].map((state) => {
              const count = agents.filter((a) => a.state === state).length;
              const pct = totalAgents ? Math.round((count / totalAgents) * 100) : 0;
              return <div className={`ops-health-row state-${state}`} key={state}><span>{STATE_LABEL[state]}</span><div><i style={{ width: `${pct}%` }} /></div><strong>{count}</strong></div>;
            })}
          </section>
          <section className="ops-panel ops-funnel">
            <header><h2>Execution flow</h2></header>
            <div><span>Running</span><strong>{activeWork}</strong></div>
            <div><span>Queued</span><strong>{summary.queued ?? 0}</strong></div>
            <div><span>Attention</span><strong>{summary.blocked ?? 0}</strong></div>
            <div><span>Ready</span><strong>{ready}</strong></div>
          </section>
        </aside>
      </div>
    </div>
  );
}

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
  const [tab, setTab] = useState('operations');
  const [live, setLive] = useState(null);
  const [history, setHistory] = useState({ items: [], offset: 0, has_more: false });
  const [error, setError] = useState('');
  const pageSize = 30;

  useEffect(() => {
    if (!['operations', 'works'].includes(tab)) return undefined;
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
          <h1>Live Operations</h1>
          <p>Your company operating now — agents, work, queues, approvals, and blockers.</p>
        </div>
        {live?.generated_at && <span className="agent-actions-updated">Live · {formatChatTimestamp(live.generated_at)}</span>}
      </header>
      <div className="agent-actions-tabs" role="tablist">
        <button className={tab === 'operations' ? 'active' : ''} onClick={() => setTab('operations')}>Live Operations</button>
        <button className={tab === 'works' ? 'active' : ''} onClick={() => setTab('works')}>Agent Works</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History</button>
      </div>
      {error && <p className="form-status form-status-error">{error}</p>}

      {tab === 'operations' ? <OperationsDashboard live={live} /> : tab === 'works' ? (
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
