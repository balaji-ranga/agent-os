import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';

const box = { border: '1px solid var(--border)', borderRadius: 8, padding: '1rem', marginTop: '1rem' };
const grid = { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' };
const input = { width: '100%', boxSizing: 'border-box' };

export default function EventProductivityPanel() {
  const [data, setData] = useState({ summary: null, subscriptions: [], events: [], bindings: [], receipts: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [secret, setSecret] = useState('');
  const [sub, setSub] = useState({ name: '', provider: 'google_workspace', event_type: 'calendar.event.changed', target_type: 'inbox', target_id: '', goal_prompt_template: '' });
  const [binding, setBinding] = useState({ operation: 'calendar_list_events', provider: 'google_workspace', app_id: 'google_calendar', action_id: '', connection_name: '', verify_action_id: '' });

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [summary, subscriptions, events, bindings, receipts] = await Promise.all([
        api.eventProductivitySummary(), api.eventProductivitySubscriptions(), api.eventProductivityEvents({ limit: 50 }), api.eventProductivityBindings(), api.eventProductivityReceipts(),
      ]);
      setData({ summary, subscriptions: subscriptions.subscriptions || [], events: events.events || [], bindings: bindings.bindings || [], receipts: receipts.receipts || [] });
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const operations = useMemo(() => Object.keys(data.summary?.capabilities?.operations || {}).filter((name) => name !== 'productivity_capabilities'), [data.summary]);
  const providers = data.summary?.capabilities?.providers || {};

  async function act(fn, success) {
    setBusy(true); setError(''); setMessage('');
    try { const result = await fn(); if (result?.webhook_secret) setSecret(result.webhook_secret); setMessage(success); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <p style={{ color: 'var(--muted)' }}>
        Normalize provider events into one durable inbox, trigger an owner-scoped workflow or goal, and run exact calendar/document/spreadsheet/message actions through existing connector links. R2 external actions still follow Action Control.
      </p>
      {error && <div style={{ color: '#dc2626' }}>{error}</div>}
      {message && <div style={{ color: '#16a34a' }}>{message}</div>}
      {secret && <div style={{ ...box, borderColor: '#d97706' }}><strong>Copy the webhook secret now.</strong><pre style={{ whiteSpace: 'pre-wrap' }}>{secret}</pre><button className="wf-btn" onClick={() => navigator.clipboard.writeText(secret)}>Copy</button></div>}

      <section style={box}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Connected capability health</h2>
        <div style={grid}>
          <div><strong>{data.summary?.subscriptions || 0}</strong><div style={{ color: 'var(--muted)' }}>Subscriptions</div></div>
          <div><strong>{(data.summary?.connected_apps || []).length}</strong><div style={{ color: 'var(--muted)' }}>Connected apps</div></div>
          <div><strong>{data.events.length}</strong><div style={{ color: 'var(--muted)' }}>Recent events</div></div>
          <div><strong>{data.bindings.length}</strong><div style={{ color: 'var(--muted)' }}>Action bindings</div></div>
        </div>
        <button className="wf-btn" disabled={busy} onClick={refresh} style={{ marginTop: 12 }}>Refresh</button>
      </section>

      <section style={box}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Event subscription</h2>
        <div style={grid}>
          <input style={input} placeholder="Subscription name" value={sub.name} onChange={(e) => setSub({ ...sub, name: e.target.value })} />
          <select value={sub.provider} onChange={(e) => setSub({ ...sub, provider: e.target.value })}>{Object.entries(providers).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}</select>
          <input style={input} placeholder="Event type" value={sub.event_type} onChange={(e) => setSub({ ...sub, event_type: e.target.value })} />
          <select value={sub.target_type} onChange={(e) => setSub({ ...sub, target_type: e.target.value })}><option value="inbox">Inbox only</option><option value="workflow">Workflow</option><option value="goal">Goal</option></select>
          {sub.target_type !== 'inbox' && <input style={input} placeholder={sub.target_type === 'workflow' ? 'Workflow ID' : 'Agent ID (default balserve)'} value={sub.target_id} onChange={(e) => setSub({ ...sub, target_id: e.target.value })} />}
          {sub.target_type === 'goal' && <input style={input} placeholder="Goal prompt; supports {{event_id}}" value={sub.goal_prompt_template} onChange={(e) => setSub({ ...sub, goal_prompt_template: e.target.value })} />}
        </div>
        <button className="wf-btn-primary" disabled={busy || !sub.name.trim()} onClick={() => act(() => api.eventProductivitySubscriptionCreate(sub), 'Subscription created.') } style={{ marginTop: 10 }}>Create subscription</button>
        {data.subscriptions.map((row) => <div key={row.id} style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10 }}><strong>{row.name}</strong> · {row.provider} · {row.event_type} → {row.target_type}<div style={{ fontSize: '.8rem', color: 'var(--muted)', wordBreak: 'break-all' }}>POST /api/event-productivity/webhooks/{row.id}</div><button className="wf-btn" disabled={busy} onClick={() => act(() => api.eventProductivitySecretRotate(row.id), 'Secret rotated.')} style={{ marginRight: 6 }}>Rotate secret</button><button className="wf-btn" disabled={busy} onClick={() => window.confirm('Delete this subscription?') && act(() => api.eventProductivitySubscriptionDelete(row.id), 'Subscription deleted.')}>Delete</button></div>)}
      </section>

      <section style={box}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Capability binding</h2>
        <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>Select an exact action ID discovered from OpenConnector. This prevents a model from guessing which external action to run.</p>
        <div style={grid}>
          <select value={binding.operation} onChange={(e) => setBinding({ ...binding, operation: e.target.value })}>{operations.map((name) => <option key={name}>{name}</option>)}</select>
          <select value={binding.provider} onChange={(e) => setBinding({ ...binding, provider: e.target.value })}>{Object.entries(providers).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}</select>
          <input style={input} placeholder="App ID" value={binding.app_id} onChange={(e) => setBinding({ ...binding, app_id: e.target.value })} />
          <input style={input} placeholder="Exact action ID" value={binding.action_id} onChange={(e) => setBinding({ ...binding, action_id: e.target.value })} />
          <input style={input} placeholder="Connection name (optional)" value={binding.connection_name} onChange={(e) => setBinding({ ...binding, connection_name: e.target.value })} />
          <input style={input} placeholder="Verification action ID (optional)" value={binding.verify_action_id} onChange={(e) => setBinding({ ...binding, verify_action_id: e.target.value })} />
        </div>
        <button className="wf-btn-primary" disabled={busy || !binding.action_id.trim()} onClick={() => act(() => api.eventProductivityBindingSave(binding), 'Binding saved.') } style={{ marginTop: 10 }}>Save binding</button>
        {data.bindings.map((row) => <div key={row.id} style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10 }}><strong>{row.operation}</strong> · {row.provider} → <code>{row.action_id}</code>{row.verify_action_id && <> · verify <code>{row.verify_action_id}</code></>} <button className="wf-btn" disabled={busy} onClick={() => act(() => api.eventProductivityBindingDelete(row.id), 'Binding deleted.')}>Delete</button></div>)}
      </section>

      <section style={box}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Live event inbox</h2>
        {!data.events.length && <p style={{ color: 'var(--muted)' }}>No events received yet.</p>}
        {data.events.map((row) => <div key={row.id} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}><strong>{row.event_type}</strong> · {row.provider} · {row.status}<div style={{ fontSize: '.8rem', color: 'var(--muted)' }}>{row.received_at}{row.last_error ? ` · ${row.last_error}` : ''}</div>{['failed', 'dead_letter'].includes(row.status) && <button className="wf-btn" disabled={busy} onClick={() => act(() => api.eventProductivityEventReplay(row.id), 'Event replayed.')}>Replay</button>}<button className="wf-btn" disabled={busy} onClick={() => act(() => api.eventProductivityEventAcknowledge(row.id), 'Event acknowledged.')}>Acknowledge</button></div>)}
      </section>

      <section style={box}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Recent action receipts</h2>
        {!data.receipts.length && <p style={{ color: 'var(--muted)' }}>No actions executed yet.</p>}
        {data.receipts.slice(0, 25).map((row) => <div key={row.id} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}><strong>{row.operation}</strong> · {row.status} · verification {row.verification_status}<div style={{ fontSize: '.8rem', color: 'var(--muted)' }}>{row.created_at}{row.external_resource_id ? ` · ${row.external_resource_id}` : ''}</div></div>)}
      </section>
    </div>
  );
}
