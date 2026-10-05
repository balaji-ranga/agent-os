import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatLocalDateTime } from '../utils/formatDateTime.js';
import { selectActiveBridge } from '../utils/selectActiveBridge.js';

const json = (value) => JSON.stringify(value || {}, null, 2);
const agentLabel = (name = '') => name.replace(/^IBKRNew/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
const statusLabel = (status = 'waiting') => status.replaceAll('_', ' ');

export default function IBKRNewLiveOperations() {
  const [data, setData] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [eventPage, setEventPage] = useState(1);
  const [eventType, setEventType] = useState('');
  const [eventStatus, setEventStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [timelineBusy, setTimelineBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [credentials, setCredentials] = useState(null);

  const loadCore = () => api.ibkrNewLiveOperations(50).then((result) => { setData(result); setError(''); }).catch((e) => setError(e.message));
  const loadTimeline = () => {
    setTimelineBusy(true);
    return api.ibkrNewEvents({ page: eventPage, pageSize: 20, eventType, status: eventStatus, environment: data?.dashboard?.environment })
      .then((result) => { setTimeline(result); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setTimelineBusy(false));
  };

  useEffect(() => { loadCore(); const timer = setInterval(loadCore, 10000); return () => clearInterval(timer); }, []);
  useEffect(() => { loadTimeline(); const timer = setInterval(loadTimeline, 10000); return () => clearInterval(timer); }, [eventPage, eventType, eventStatus, data?.dashboard?.environment]);

  const act = async (fn) => { setBusy(true); try { await fn(); await Promise.all([loadCore(), loadTimeline()]); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const initialize = () => act(() => api.ibkrNewInitialize());
  const register = () => act(async () => { setCredentials(await api.ibkrNewRegisterBridge(dashboard?.environment || 'paper')); });
  const revoke = (id) => { if (window.confirm('Revoke this IBKRNew bridge and cancel its pending commands?')) act(() => api.ibkrNewRevokeBridge(id)); };
  const approve = (id) => act(() => api.ibkrNewApprove(id));
  const viewEvent = async (eventId) => {
    setDetailBusy(true);
    try { setSelectedEvent(await api.ibkrNewEventDetail(eventId)); setError(''); } catch (e) { setError(e.message); } finally { setDetailBusy(false); }
  };

  const dashboard = data?.dashboard;
  const bridges = dashboard?.bridges || [];
  const activeBridge = bridges.find((bridge) => bridge.bridge_id === data?.active_bridge_id) || selectActiveBridge(bridges.filter((bridge) => bridge.environment === dashboard?.environment));
  const executionMode = dashboard?.execution_mode || { requested_mode: 'paper', activation_state: 'AWAITING_BRIDGE' };
  const budgets = dashboard?.budgets || {};
  const goal = dashboard?.goal;
  const cycle = goal?.cycle;

  return <div className="page page-wide ibkrnew-page">
    <header className="page-hero">
      <div className="page-hero-top"><div className="page-hero-titles"><p className="page-hero-kicker">Prebuilt Workflows · IBKRNew0</p><h1>Live operations</h1></div><span className={`ibkrnew-environment is-${executionMode.requested_mode}`}>{executionMode.requested_mode.toUpperCase()} · {statusLabel(executionMode.activation_state)}</span></div>
      <p className="page-hero-sub">A correlated audit of the six service-driven trading roles, desktop bridge, Gateway, decisions, approvals, positions, and executions. History is retained for {data?.retention_days || '—'} days.</p>
    </header>

    {error && <div className="page-banner page-banner-error" role="alert"><span>{error}</span><button type="button" className="btn-ghost" onClick={() => setError('')}>Dismiss</button></div>}
    {!dashboard && <button type="button" className="btn-primary" disabled={busy} onClick={initialize}>Initialize IBKRNew0</button>}

    <div className="this-week-grid">
      <section className="this-week-card"><small>Daily opening exposure</small><h2>${Number(budgets.daily_used_usd || 0).toFixed(2)}</h2><div>of ${Number(budgets.daily_limit_usd || 0).toFixed(2)}</div></section>
      <section className="this-week-card"><small>Total gross ceiling</small><h2>${Number(budgets.total_limit_usd || 0).toFixed(2)}</h2><div>Cash and positions combined</div></section>
      <section className="this-week-card"><small>IBKR account snapshot</small><h2>{dashboard?.account ? 'Received' : 'Waiting'}</h2><div>{dashboard?.account?.captured_at ? formatLocalDateTime(dashboard.account.captured_at) : 'No broker state'}</div></section>
      <section className="this-week-card"><small>Bridge</small><h2>{activeBridge?.effective_status || 'Not registered'}</h2><div>{activeBridge?.last_accepted_heartbeat_at ? `Accepted heartbeat ${formatLocalDateTime(activeBridge.last_accepted_heartbeat_at)}` : 'Waiting for an accepted desktop heartbeat'}</div></section>
      <section className="this-week-card"><small>Account attestation</small><h2>{executionMode.attestation_status || (executionMode.requested_mode === 'paper' ? 'Local bridge required' : 'Waiting')}</h2><div>{executionMode.attested_at ? formatLocalDateTime(executionMode.attested_at) : executionMode.attestation_reason || 'The account number remains desktop-only'}</div></section>
      <section className="this-week-card"><small>Goal cycle</small><h2>{cycle?.status || goal?.block_reason || 'Waiting'}</h2><div>{cycle ? `$${Number(cycle.net_realized_profit_usd).toFixed(2)} of $${Number(cycle.target_profit_usd).toFixed(2)} · ${cycle.days_remaining} days` : 'Waiting for eligible capital'}</div></section>
    </div>

    {dashboard?.inactive_live_account && <section className="panel ibkrnew-section ibkrnew-live-exposure-warning" role="alert">
      <div className="ibkrnew-section-heading"><div><p className="page-hero-kicker">Live exposure remains at IBKR</p><h2 className="panel-title">Paper mode does not close broker positions or protective orders</h2></div><span className="ibkrnew-environment is-live">LIVE EXPOSURE</span></div>
      <p>New live entries are disabled, but the last live account snapshot still reports exposure. Reconcile it in IBKR and keep the live bridge available for monitoring.</p>
      <details open><summary>{dashboard.inactive_live_account.positions.length} position(s) · {dashboard.inactive_live_account.open_orders.length} open order(s) · snapshot {formatLocalDateTime(dashboard.inactive_live_account.captured_at)}</summary><pre className="ibkrnew-pre">{json({ positions: dashboard.inactive_live_account.positions, open_orders: dashboard.inactive_live_account.open_orders })}</pre></details>
    </section>}

    <section className="panel ibkrnew-section">
      <div className="ibkrnew-section-heading"><div><h2 className="panel-title">Six-agent activity</h2><p className="page-muted">These are correlated runtime roles in the event pipeline—not synthetic chat messages. Open an event below for exact evidence at every stage.</p></div><span className="ibkrnew-version">{data?.agent_activity?.length || 0} roles</span></div>
      <div className="ibkrnew-agent-grid">{(data?.agent_activity || []).map((item) => <article className="ibkrnew-agent-card" key={item.agent_name}>
        <div className="ibkrnew-agent-card-head"><div><small>{item.workflow_id}</small><h3>{agentLabel(item.agent_name)}</h3></div><span className={`ibkrnew-stage-status is-${item.status}`}>{statusLabel(item.status)}</span></div>
        <p>{item.summary}</p>
        <dl><div><dt>Responsibility</dt><dd>{item.responsibility}</dd></div><div><dt>Latest correlated event</dt><dd>{item.last_event_type || 'Waiting'}{item.last_seen_at ? ` · ${formatLocalDateTime(item.last_seen_at)}` : ''}</dd></div></dl>
      </article>)}</div>
    </section>

    <section className="panel ibkrnew-section"><h2 className="panel-title">Dedicated desktop bridge</h2><div className="ibkrnew-inline-form"><button type="button" className="btn-primary" disabled={busy} onClick={register}>Create {dashboard?.environment || 'paper'} credentials</button></div><p className="page-muted">Your real IBKR account ID stays only in the desktop bridge configuration. The VPS stores an opaque account reference and sanitized environment attestation; the bridge token is shown only once.</p>{credentials && <pre className="ibkrnew-pre">{json(credentials)}</pre>}{bridges.map((item) => <article key={item.bridge_id} className="ibkrnew-list-item"><strong>{item.environment.toUpperCase()} · {item.account_ref}</strong><span>{item.effective_status} · sequence {item.last_sequence}</span><small>{item.bridge_id}</small>{!item.revoked_at && <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => revoke(item.bridge_id)}>Revoke</button>}</article>)}</section>

    <section className="panel ibkrnew-section"><h2 className="panel-title">Pending CEO approvals</h2>{(dashboard?.approvals || []).length === 0 ? <p className="page-muted">None.</p> : dashboard.approvals.map((item) => <article className="ibkrnew-list-item" key={item.authorization_id}><strong>{item.expression}</strong><span>Expires {formatLocalDateTime(item.expires_at)}</span><button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => approve(item.authorization_id)}>Approve once</button></article>)}</section>

    <section className="panel ibkrnew-section"><h2 className="panel-title">Component health</h2><p className="page-muted">Current {dashboard?.environment || 'paper'} bridge. Status is based on accepted events; failed delivery or a stale heartbeat reports offline.</p><div className="this-week-grid">{(data?.health || []).map((item) => <article key={`${item.bridge_id}-${item.component_id}`}><strong>{item.component_id}</strong><div>{item.component_type} · <span className="ibkrnew-status">{item.effective_status}</span></div><small>Last seen {formatLocalDateTime(item.last_seen_at)} · historical errors {item.error_count}</small>{item.last_error && <details><summary>Last recorded error</summary><p className="error-text">{item.last_error}</p></details>}</article>)}</div>{!!data?.historical_health?.length && <details><summary>Historical bridge components ({data.historical_health.length})</summary>{data.historical_health.map((item) => <article className="ibkrnew-list-item" key={`${item.bridge_id}-${item.component_id}`}><strong>{item.component_id} · {item.effective_status}</strong><small>{item.bridge_id} · last seen {formatLocalDateTime(item.last_seen_at)}</small></article>)}</details>}</section>

    <section className="panel ibkrnew-section"><h2 className="panel-title">Cached universe profiles</h2><div className="ibkrnew-table-wrap"><table className="ibkrnew-table"><thead><tr><th>Symbol</th><th>Type</th><th>Fundamentals</th><th>Membership</th><th>Corporate events</th><th>Updated</th></tr></thead><tbody>{(data?.instrument_profiles || []).map((item) => <tr key={`${item.symbol}-${item.security_type}`}><td><strong>{item.symbol}</strong></td><td>{item.security_type}</td><td>{item.fundamentals_at ? formatLocalDateTime(item.fundamentals_at) : 'Missing'}</td><td>{item.membership_at ? formatLocalDateTime(item.membership_at) : 'Not required'}</td><td>{item.corporate_events_at ? formatLocalDateTime(item.corporate_events_at) : 'Missing'}</td><td>{formatLocalDateTime(item.updated_at)}</td></tr>)}</tbody></table>{!data?.instrument_profiles?.length && <p className="page-muted">Waiting for the desktop bridge to refresh instrument profiles.</p>}</div></section>

    <section className="panel ibkrnew-section"><h2 className="panel-title">Current positions</h2><pre className="ibkrnew-pre">{json(dashboard?.account?.positions)}</pre></section>
    <section className="panel ibkrnew-section"><h2 className="panel-title">Position and account snapshots</h2>{(data?.snapshots || []).map((item) => <details key={item.snapshot_id}><summary>{formatLocalDateTime(item.captured_at)} · {item.snapshot_type}</summary><pre className="ibkrnew-pre">{json(item.payload)}</pre></details>)}</section>
    <section className="panel ibkrnew-section"><h2 className="panel-title">Executions and commissions</h2><div className="ibkrnew-table-wrap"><table className="ibkrnew-table"><thead><tr><th>Time</th><th>Execution</th><th>Role</th><th>Side</th><th>Qty</th><th>Price</th><th>Commission</th><th>Realized P&amp;L</th></tr></thead><tbody>{(data?.executions || []).map((item) => <tr key={item.execution_id}><td>{formatLocalDateTime(item.occurred_at)}</td><td>{item.execution_id}</td><td>{item.order_role}</td><td>{item.side}</td><td>{item.quantity}</td><td>{item.price}</td><td>{item.commission_usd}</td><td>{item.realized_pnl_usd}</td></tr>)}</tbody></table></div></section>
    <section className="panel ibkrnew-section"><h2 className="panel-title">Desktop and bridge errors</h2>{(data?.errors || []).length === 0 ? <p className="page-muted">No retained component errors.</p> : data.errors.map((item) => <article key={item.error_id} className="ibkrnew-list-item"><strong>{item.component_id} · {item.error_code || 'ERROR'}</strong><span>{item.message}</span><small>{formatLocalDateTime(item.occurred_at)}</small></article>)}</section>

    <section className="panel ibkrnew-section">
      <div className="ibkrnew-section-heading"><div><h2 className="panel-title">Causal event timeline</h2><p className="page-muted">Loaded 20 at a time from the server for the selected {timeline?.environment || dashboard?.environment || 'paper'} mode. Descriptions explain what changed; lifecycle details show who handled it and the correlated authorization, command, trade, and execution evidence.</p></div>{timelineBusy && <span className="ibkrnew-version">Refreshing</span>}</div>
      <div className="ibkrnew-event-filters">
        <label className="ibkrnew-field"><span>Event type</span><select value={eventType} onChange={(e) => { setEventType(e.target.value); setEventPage(1); }}><option value="">All event types</option>{(timeline?.filters?.event_types || []).map((item) => <option key={item.event_type} value={item.event_type}>{item.event_type} ({item.count})</option>)}</select></label>
        <label className="ibkrnew-field"><span>Status</span><select value={eventStatus} onChange={(e) => { setEventStatus(e.target.value); setEventPage(1); }}><option value="">All statuses</option>{(timeline?.filters?.statuses || []).map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}</select></label>
      </div>
      <div className="ibkrnew-event-list">{(timeline?.items || []).map((item) => <article className="ibkrnew-event-row" key={item.event_id}>
        <span className={`ibkrnew-event-marker is-${item.status}`} aria-hidden="true" />
        <div className="ibkrnew-event-copy"><div><strong>{item.description}</strong><span className={`ibkrnew-stage-status is-${item.status}`}>{statusLabel(item.status)}</span></div><p>{agentLabel(item.agent_name)} · {item.workflow_id || 'runtime supervision'}</p><small>{item.event_type} · {formatLocalDateTime(item.occurred_at)} · correlation {item.correlation_id}</small></div>
        <button type="button" className="btn-secondary btn-sm" disabled={detailBusy} onClick={() => viewEvent(item.event_id)}>View lifecycle</button>
      </article>)}{!timelineBusy && !(timeline?.items || []).length && <p className="page-muted">No events match these filters.</p>}</div>
      <div className="ibkrnew-pagination"><button type="button" className="btn-secondary" disabled={!timeline?.pagination?.has_previous || timelineBusy} onClick={() => setEventPage((page) => Math.max(1, page - 1))}>Previous</button><span>Page {timeline?.pagination?.page || 1} of {timeline?.pagination?.total_pages || 1} · {timeline?.pagination?.total_items || 0} events</span><button type="button" className="btn-secondary" disabled={!timeline?.pagination?.has_next || timelineBusy} onClick={() => setEventPage((page) => page + 1)}>Next</button></div>
    </section>

    {selectedEvent && <section className="panel ibkrnew-section ibkrnew-event-detail">
      <div className="ibkrnew-section-heading"><div><p className="page-hero-kicker">Correlation {selectedEvent.correlation_id}</p><h2 className="panel-title">{selectedEvent.description}</h2><p className="page-muted">{selectedEvent.event_type} · {formatLocalDateTime(selectedEvent.occurred_at)}</p></div><button type="button" className="btn-ghost" onClick={() => setSelectedEvent(null)}>Close</button></div>
      <div className="ibkrnew-lifecycle">{(selectedEvent.lifecycle || []).map((stage, index) => <article className="ibkrnew-stage-card" key={stage.agent_name}><span className="ibkrnew-stage-index">{index + 1}</span><div><div className="ibkrnew-agent-card-head"><h3>{agentLabel(stage.agent_name)}</h3><span className={`ibkrnew-stage-status is-${stage.status}`}>{statusLabel(stage.status)}</span></div><p>{stage.summary}</p><small>{stage.workflow_id} · {stage.responsibility}</small>{Object.values(stage.evidence || {}).some((value) => value != null) && <details><summary>Evidence IDs</summary><pre className="ibkrnew-pre">{json(stage.evidence)}</pre></details>}</div></article>)}</div>
      <details><summary>Canonical event payload</summary><pre className="ibkrnew-pre">{json(selectedEvent.payload)}</pre></details>
      {selectedEvent.reaction && <details><summary>Persisted planner and risk decision</summary><pre className="ibkrnew-pre">{json(selectedEvent.reaction)}</pre></details>}
      {!!selectedEvent.executions?.length && <details><summary>Correlated executions</summary><pre className="ibkrnew-pre">{json(selectedEvent.executions)}</pre></details>}
    </section>}
  </div>;
}
