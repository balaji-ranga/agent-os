import { useEffect, useState } from 'react';
import { api } from '../api';

const panel = { background: 'var(--surface, #fff)', border: '1px solid var(--border, #dbe2ea)', borderRadius: 12, padding: 18 };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 };
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 12 };

function Metric({ label, value, detail }) {
  return <div style={panel}><div style={{ opacity: .68, fontSize: 13 }}>{label}</div><div style={{ fontSize: 25, fontWeight: 700, marginTop: 7 }}>{value}</div>{detail && <div style={{ opacity: .68, marginTop: 5 }}>{detail}</div>}</div>;
}

export default function IBKRNewEventTrader() {
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('operations'); const [editor, setEditor] = useState(''); const [kind, setKind] = useState('policy');
  const [accountId, setAccountId] = useState(''); const [credentials, setCredentials] = useState(null);
  const load = async () => { try { setError(''); setData(await api.ibkrNewDashboard()); } catch (e) { setError(e.message); } };
  useEffect(() => { load(); const timer = setInterval(load, 10000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (data?.configs?.[kind]) setEditor(JSON.stringify(data.configs[kind], null, 2)); }, [data, kind]);
  const initialize = async () => { setBusy(true); try { await api.ibkrNewInitialize(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const publish = async () => { setBusy(true); try { const doc = JSON.parse(editor); delete doc.id; delete doc.version; delete doc.status; try { await api.ibkrNewPublishConfig(kind, doc, false); } catch (e) { if (e.status !== 409 || !window.confirm('This change loosens trading risk. Publish it with explicit CEO confirmation?')) throw e; await api.ibkrNewPublishConfig(kind, doc, true); } await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const register = async () => { setBusy(true); try { setCredentials(await api.ibkrNewRegisterBridge(accountId)); setAccountId(''); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const revoke = async (id) => { if (!window.confirm('Revoke this IBKRNew bridge and cancel its pending commands?')) return; setBusy(true); try { await api.ibkrNewRevokeBridge(id); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const approve = async (id) => { setBusy(true); try { await api.ibkrNewApprove(id); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const b = data?.budgets || {}; const bridges = data?.bridges || [];
  return <div style={{ padding: '24px', maxWidth: 1300, margin: '0 auto' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div><h1 style={{ margin: 0 }}>IBKRNew Event Trader</h1><p style={{ opacity: .72, maxWidth: 760 }}>Isolated, paper-only, event-driven US stock and long-option trading through a dedicated desktop bridge. Legacy IBKR workflows are not used.</p></div>
      <div style={{ padding: '7px 11px', borderRadius: 99, background: '#e7f6ec', color: '#176b37', fontWeight: 700 }}>PAPER ONLY</div>
    </div>
    {error && <div style={{ background: '#fff0f0', color: '#9f2020', padding: 12, borderRadius: 8, marginBottom: 14 }}>{error}</div>}
    {!data ? <button disabled={busy} onClick={initialize}>Initialize IBKRNew</button> : <>
      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>{['operations','configuration','bridge','audit'].map((x) => <button key={x} onClick={() => setTab(x)} style={{ fontWeight: tab === x ? 700 : 400 }}>{x[0].toUpperCase()+x.slice(1)}</button>)}</div>
      {tab === 'operations' && <><div style={grid}>
        <Metric label="Daily opening exposure" value={`$${Number(b.daily_used_usd || 0).toFixed(2)}`} detail={`of $${Number(b.daily_limit_usd || 0).toFixed(2)}; closes do not restore it`} />
        <Metric label="Total gross ceiling" value={`$${Number(b.total_limit_usd || 0).toFixed(2)}`} detail="Stocks, shorts with stress buffer, options, and pending entries" />
        <Metric label="Desktop bridge" value={bridges[0]?.effective_status || 'Not registered'} detail={bridges[0]?.last_seen_at || 'New entries require a fresh heartbeat'} />
        <Metric label="Account state" value={data.account ? 'Fresh snapshot received' : 'Waiting'} detail={data.account?.captured_at || 'No broker state received'} />
      </div><div style={{ ...panel, marginTop: 14 }}><h3>Safety state</h3><ul><li>Live execution is structurally unavailable.</li><li>Commands expire instead of waiting for surprise execution.</li><li>Entries require fresh quote, account state, a protective stop, and an atomic budget reservation.</li></ul></div></>}
      {tab === 'configuration' && <div style={panel}><div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>{['policy','strategy','universe','market_data'].map((x) => <button key={x} onClick={() => setKind(x)}>{x}</button>)}</div><textarea value={editor} onChange={(e) => setEditor(e.target.value)} rows={27} style={{ ...mono, width: '100%', boxSizing: 'border-box' }} /><div style={{ marginTop: 10 }}><button disabled={busy} onClick={publish}>Publish immutable {kind} version</button></div><p style={{ opacity: .65 }}>Increasing either headline budget requires a separate explicit risk-loosening confirmation and is rejected by this screen.</p></div>}
      {tab === 'bridge' && <div style={grid}><div style={panel}><h3>Register dedicated bridge</h3><input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="DU-prefixed IBKR paper account ID" /><button disabled={busy || !accountId.trim()} onClick={register} style={{ marginLeft: 8 }}>Create credentials</button><p style={{ opacity: .65 }}>This token cannot access legacy IBKR endpoints.</p></div>{credentials && <div style={panel}><h3>Copy now — token shown once</h3><pre style={{ ...mono, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(credentials, null, 2)}</pre></div>}{bridges.map((x) => <div key={x.bridge_id} style={panel}><strong>{x.bridge_id}</strong><div>{x.account_id} · {x.effective_status}</div><div style={{ opacity: .65 }}>sequence {x.last_sequence}</div>{!x.revoked_at && <button disabled={busy} onClick={() => revoke(x.bridge_id)}>Revoke</button>}</div>)}</div>}
      {tab === 'audit' && <div style={panel}><h3>Pending CEO approvals</h3>{(data.approvals || []).length === 0 ? <p>None.</p> : data.approvals.map((a) => <div key={a.authorization_id} style={{ padding: '8px 0' }}><strong>{a.expression}</strong> · expires {a.expires_at} <button disabled={busy} onClick={() => approve(a.authorization_id)}>Approve once</button></div>)}<h3>Causal event timeline</h3>{(data.events || []).length === 0 ? <p>No IBKRNew events yet.</p> : data.events.map((e) => <div key={e.event_id} style={{ borderTop: '1px solid var(--border, #ddd)', padding: '10px 0' }}><strong>{e.event_type}</strong> · {e.status}<div style={{ ...mono, opacity: .7 }}>{e.event_id} · seq {e.sequence} · {e.occurred_at}</div>{e.reason && <div style={{ color: '#9f2020' }}>{e.reason}</div>}</div>)}</div>}
    </>}
  </div>;
}
