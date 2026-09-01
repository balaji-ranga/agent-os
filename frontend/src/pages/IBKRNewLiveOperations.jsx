import { useEffect, useState } from 'react';
import { api } from '../api';

const json = (v) => JSON.stringify(v || {}, null, 2);
const card = { background: 'var(--surface, #fff)', border: '1px solid var(--border, #dbe2ea)', borderRadius: 12, padding: 18 };

export default function IBKRNewLiveOperations() {
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState(''); const [credentials, setCredentials] = useState(null);
  const load = () => api.ibkrNewLiveOperations().then((x) => { setData(x); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); const timer = setInterval(load, 5000); return () => clearInterval(timer); }, []);
  const act = async (fn) => { setBusy(true); try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const initialize = () => act(() => api.ibkrNewInitialize());
  const register = () => act(async () => { setCredentials(await api.ibkrNewRegisterBridge(accountId)); setAccountId(''); });
  const revoke = (id) => { if (window.confirm('Revoke this IBKRNew bridge and cancel its pending commands?')) act(() => api.ibkrNewRevokeBridge(id)); };
  const approve = (id) => act(() => api.ibkrNewApprove(id));
  const dashboard = data?.dashboard; const bridges = dashboard?.bridges || []; const budgets = dashboard?.budgets || {};
  return <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
    <h1>IBKRNew0 · Live Operations</h1>
    <p>Desktop, bridge, Gateway, spool, positions, executions, approvals, and errors. History follows your profile retention policy ({data?.retention_days || '—'} days).</p>
    {error && <p className="error-text">{error}</p>}
    {!dashboard && <button disabled={busy} onClick={initialize}>Initialize IBKRNew0</button>}
    <div className="this-week-grid">
      <section className="this-week-card"><small>Daily opening exposure</small><h2>${Number(budgets.daily_used_usd || 0).toFixed(2)}</h2><div>of ${Number(budgets.daily_limit_usd || 0).toFixed(2)}</div></section>
      <section className="this-week-card"><small>Total gross ceiling</small><h2>${Number(budgets.total_limit_usd || 0).toFixed(2)}</h2><div>Cash and positions combined</div></section>
      <section className="this-week-card"><small>IBKR account snapshot</small><h2>{dashboard?.account ? 'Received' : 'Waiting'}</h2><div>{dashboard?.account?.captured_at || 'No broker state'}</div></section>
      <section className="this-week-card"><small>Bridge</small><h2>{bridges[0]?.effective_status || 'Not registered'}</h2><div>{bridges[0]?.last_seen_at || 'A local desktop bridge is required'}</div></section>
    </div>
    <section style={{ ...card, marginTop: 16 }}><h3>Dedicated desktop bridge</h3><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="DU-prefixed paper account ID" /><button disabled={busy || !accountId.trim()} onClick={register}>Create credentials</button></div><p style={{ opacity: .65 }}>Credentials are isolated to IBKRNew0 and the token is shown only once.</p>{credentials && <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{json(credentials)}</pre>}{bridges.map((x) => <article key={x.bridge_id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}><strong>{x.account_id}</strong> · {x.effective_status} · sequence {x.last_sequence}<div><small>{x.bridge_id}</small></div>{!x.revoked_at && <button disabled={busy} onClick={() => revoke(x.bridge_id)}>Revoke</button>}</article>)}</section>
    <section className="this-week-card"><h3>Pending CEO approvals</h3>{(dashboard?.approvals || []).length === 0 ? <p>None.</p> : dashboard.approvals.map((x) => <article key={x.authorization_id}><strong>{x.expression}</strong> · expires {x.expires_at} <button disabled={busy} onClick={() => approve(x.authorization_id)}>Approve once</button></article>)}</section>
    <section className="this-week-card"><h3>Component health</h3><div className="this-week-grid">{(data?.health || []).map((x) => <article key={`${x.bridge_id}-${x.component_id}`}><strong>{x.component_id}</strong><div>{x.component_type} · <mark>{x.effective_status}</mark></div><small>Last seen {x.last_seen_at} · errors {x.error_count}</small>{x.last_error && <p className="error-text">{x.last_error}</p>}</article>)}</div></section>
    <section className="this-week-card"><h3>Current positions</h3><pre style={{ whiteSpace: 'pre-wrap' }}>{json(dashboard?.account?.positions)}</pre></section>
    <section className="this-week-card"><h3>Position and account snapshots</h3>{(data?.snapshots || []).slice(0, 30).map((x) => <details key={x.snapshot_id}><summary>{x.captured_at} · {x.snapshot_type}</summary><pre>{json(x.payload)}</pre></details>)}</section>
    <section className="this-week-card"><h3>Executions and commissions</h3><div style={{ overflowX: 'auto' }}><table><thead><tr><th>Time</th><th>Execution</th><th>Role</th><th>Side</th><th>Qty</th><th>Price</th><th>Commission</th><th>Realized P&amp;L</th></tr></thead><tbody>{(data?.executions || []).map((x) => <tr key={x.execution_id}><td>{x.occurred_at}</td><td>{x.execution_id}</td><td>{x.order_role}</td><td>{x.side}</td><td>{x.quantity}</td><td>{x.price}</td><td>{x.commission_usd}</td><td>{x.realized_pnl_usd}</td></tr>)}</tbody></table></div></section>
    <section className="this-week-card"><h3>Desktop and bridge errors</h3>{(data?.errors || []).map((x) => <article key={x.error_id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}><strong>{x.component_id} · {x.error_code || 'ERROR'}</strong><div>{x.message}</div><small>{x.occurred_at}</small></article>)}</section>
    <section className="this-week-card"><h3>Causal event timeline</h3>{(dashboard?.events || []).map((x) => <article key={x.event_id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}><strong>{x.event_type}</strong> · {x.status}<div><small>{x.event_id} · seq {x.sequence} · {x.occurred_at}</small></div>{x.reason && <p className="error-text">{x.reason}</p>}</article>)}</section>
  </div>;
}
