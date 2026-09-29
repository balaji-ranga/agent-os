import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { formatLocalDateTime } from '../../utils/formatDateTime.js';

const box = { border: '1px solid var(--border)', borderRadius: 8, padding: '1rem', marginTop: '1rem' };
const grid = { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' };
const input = { width: '100%', boxSizing: 'border-box' };

export default function EventProductivityPanel() {
  const [data, setData] = useState({ summary: null, subscriptions: [], events: [], bindings: [], receipts: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [actionNotice, setActionNotice] = useState(null);
  const [secret, setSecret] = useState('');
  const [connectorActions, setConnectorActions] = useState([]);
  const [actionsBusy, setActionsBusy] = useState(false);
  const [actionsError, setActionsError] = useState('');
  const [sub, setSub] = useState({ name: '', provider: 'google_workspace', event_type: 'calendar.event.changed', target_type: 'inbox', target_id: '', goal_prompt_template: '', listener_enabled: false, listener_poll_seconds: 300, dedupe_mode: 'provider_object_id', source_disposition: 'retain' });
  const [history, setHistory] = useState(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [binding, setBinding] = useState({ operation: 'calendar_list_events', provider: 'google_workspace', app_id: '', action_id: '', connection_name: '', verify_action_id: '' });

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

  const operationCatalog = data.summary?.capabilities?.operations || {};
  const providers = data.summary?.capabilities?.providers || {};
  const eventTypesByProvider = data.summary?.capabilities?.event_types || {};
  const providerEventTypes = useMemo(() => eventTypesByProvider[sub.provider] || [], [eventTypesByProvider, sub.provider]);
  const operations = useMemo(() => Object.entries(operationCatalog)
    .filter(([name, spec]) => name !== 'productivity_capabilities' && (spec.providers || []).includes(binding.provider))
    .map(([name]) => name), [operationCatalog, binding.provider]);
  const connectedApps = data.summary?.connected_apps || [];
  const compatibleApps = useMemo(() => {
    const providerApps = new Set(providers[binding.provider]?.apps || []);
    const operationApps = new Set(operationCatalog[binding.operation]?.apps || []);
    const supported = new Set([...providerApps].filter((appId) => operationApps.has(appId)));
    return connectedApps.filter((app) => supported.has(app.id));
  }, [connectedApps, providers, operationCatalog, binding.provider, binding.operation]);

  useEffect(() => {
    if (providerEventTypes.length && !providerEventTypes.some((event) => event.id === sub.event_type)) {
      setSub((current) => ({ ...current, event_type: providerEventTypes[0].id }));
    }
  }, [providerEventTypes, sub.event_type]);

  useEffect(() => {
    setBinding((current) => {
      const operation = operations.includes(current.operation) ? current.operation : (operations[0] || '');
      const appId = compatibleApps.some((app) => app.id === current.app_id) ? current.app_id : (compatibleApps[0]?.id || '');
      if (operation === current.operation && appId === current.app_id) return current;
      return { ...current, operation, app_id: appId, action_id: '', verify_action_id: '' };
    });
  }, [operations, compatibleApps]);

  useEffect(() => {
    let active = true;
    if (!binding.app_id) {
      setConnectorActions([]);
      setActionsError('');
      return () => { active = false; };
    }
    setActionsBusy(true);
    setActionsError('');
    api.openconnectorActions(binding.app_id)
      .then((result) => { if (active) setConnectorActions(result.actions || []); })
      .catch((e) => { if (active) { setConnectorActions([]); setActionsError(e.message || 'Unable to load connector actions.'); } })
      .finally(() => { if (active) setActionsBusy(false); });
    return () => { active = false; };
  }, [binding.app_id]);

  function selectProvider(provider) {
    const supported = eventTypesByProvider[provider] || [];
    setSub((current) => ({
      ...current,
      provider,
      event_type: supported.some((event) => event.id === current.event_type) ? current.event_type : (supported[0]?.id || ''),
    }));
  }

  function selectBindingProvider(provider) {
    setConnectorActions([]);
    setBinding((current) => ({ ...current, provider, app_id: '', action_id: '', verify_action_id: '' }));
  }

  function selectBindingApp(appId) {
    setConnectorActions([]);
    setBinding((current) => ({ ...current, app_id: appId, action_id: '', verify_action_id: '' }));
  }

  async function act(fn, success, working = 'Working…') {
    setBusy(true); setError(''); setMessage('');
    setActionNotice({ tone: 'progress', text: working });
    try {
      const result = await fn();
      if (result?.webhook_secret) setSecret(result.webhook_secret);
      setMessage(success);
      setActionNotice({ tone: 'success', text: success });
      await refresh();
      return result;
    }
    catch (e) {
      const detail = e?.message || 'Action failed.';
      setError(detail);
      setActionNotice({ tone: 'error', text: detail });
      return null;
    }
    finally { setBusy(false); }
  }

  async function showHistory(row) {
    setHistoryBusy(true); setError('');
    setActionNotice({ tone: 'progress', text: `Loading event history for ${row.name}…` });
    try {
      const result = await api.eventProductivityEvents({ subscription_id: row.id, limit: 100 });
      setHistory({ subscription: row, events: result.events || [] });
      setActionNotice({ tone: 'success', text: `History loaded: ${(result.events || []).length} processed event${(result.events || []).length === 1 ? '' : 's'}.` });
    } catch (e) {
      const detail = e?.message || 'Unable to load event history.';
      setError(detail);
      setActionNotice({ tone: 'error', text: detail });
    }
    finally { setHistoryBusy(false); }
  }

  const listenerStatus = (row) => {
    if (!row.listener_enabled) return { label: 'Listener disabled', color: '#64748b' };
    if (row.listener_status === 'active' && row.listener_active) return { label: 'Listener active', color: '#16a34a' };
    if (row.listener_status === 'checking' || row.listener_status === 'starting') return { label: row.listener_status === 'checking' ? 'Checking now' : 'Starting', color: '#d97706' };
    if (row.listener_status === 'error') return { label: 'Listener error', color: '#dc2626' };
    return { label: row.listener_status || 'Listener stale', color: '#d97706' };
  };

  return (
    <div style={{ marginTop: '1rem' }}>
      {actionNotice && <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed', right: 20, bottom: 20, zIndex: 1200, maxWidth: 440,
          padding: '12px 42px 12px 14px', borderRadius: 10, boxShadow: '0 12px 30px rgba(15,23,42,.24)',
          color: actionNotice.tone === 'error' ? '#991b1b' : actionNotice.tone === 'success' ? '#166534' : '#92400e',
          background: actionNotice.tone === 'error' ? '#fee2e2' : actionNotice.tone === 'success' ? '#dcfce7' : '#fef3c7',
          border: `1px solid ${actionNotice.tone === 'error' ? '#fca5a5' : actionNotice.tone === 'success' ? '#86efac' : '#fcd34d'}`,
        }}
      >
        <strong>{actionNotice.tone === 'error' ? 'Failed' : actionNotice.tone === 'success' ? 'Success' : 'In progress'}</strong>
        <div style={{ marginTop: 2 }}>{actionNotice.text}</div>
        <button type="button" aria-label="Dismiss action message" onClick={() => setActionNotice(null)} style={{ position: 'absolute', top: 8, right: 8, border: 0, background: 'transparent', cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>}
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
          <select aria-label="Event provider" value={sub.provider} onChange={(e) => selectProvider(e.target.value)}>{Object.entries(providers).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}</select>
          <select aria-label="Event type" value={sub.event_type} onChange={(e) => setSub({ ...sub, event_type: e.target.value })} disabled={!providerEventTypes.length}>
            {!providerEventTypes.length && <option value="">No supported event types</option>}
            {providerEventTypes.map((event) => <option key={event.id} value={event.id}>{event.label} ({event.id})</option>)}
          </select>
          <select value={sub.target_type} onChange={(e) => setSub({ ...sub, target_type: e.target.value })}><option value="inbox">Inbox only</option><option value="workflow">Workflow</option><option value="goal">Goal</option></select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={sub.listener_enabled} onChange={(e) => setSub({ ...sub, listener_enabled: e.target.checked })} /> Enable provider listener</label>
          <label>Check interval<select style={input} value={sub.listener_poll_seconds} onChange={(e) => setSub({ ...sub, listener_poll_seconds: Number(e.target.value) })}><option value={60}>Every minute</option><option value={300}>Every 5 minutes</option><option value={900}>Every 15 minutes</option><option value={3600}>Every hour</option></select></label>
          <label>Duplicate handling<select style={input} value={sub.dedupe_mode} onChange={(e) => setSub({ ...sub, dedupe_mode: e.target.value })}><option value="provider_object_id">Store provider object ID and skip repeats</option></select></label>
          {sub.provider === 'google_workspace' && sub.event_type === 'email.message.received' && <label>After processing<select style={input} value={sub.source_disposition} onChange={(e) => setSub({ ...sub, source_disposition: e.target.value })}><option value="retain">Keep source email</option><option value="trash">Move source email to Trash</option></select></label>}
          {sub.target_type !== 'inbox' && <input style={input} placeholder={sub.target_type === 'workflow' ? 'Workflow ID' : 'Agent ID (default balserve)'} value={sub.target_id} onChange={(e) => setSub({ ...sub, target_id: e.target.value })} />}
          {sub.target_type === 'goal' && <input style={input} placeholder="Goal prompt; supports {{event_id}}" value={sub.goal_prompt_template} onChange={(e) => setSub({ ...sub, goal_prompt_template: e.target.value })} />}
        </div>
        <button className="wf-btn-primary" disabled={busy || !sub.name.trim() || !sub.event_type} onClick={() => act(() => api.eventProductivitySubscriptionCreate(sub), 'Subscription created.') } style={{ marginTop: 10 }}>Create subscription</button>
        {data.subscriptions.map((row) => {
          const status = listenerStatus(row);
          return <div key={row.id} style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10 }}>
            <div><strong>{row.name}</strong> · {row.provider} · {row.event_type} → {row.target_type}</div>
            <div style={{ fontSize: '.82rem', margin: '5px 0', color: status.color }}><strong>{status.label}</strong>{row.listener_last_check_at ? ` · Last check ${formatLocalDateTime(row.listener_last_check_at)}` : ''}{row.last_event_at ? ` · Last event ${formatLocalDateTime(row.last_event_at)}` : ''}</div>
            <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>Deduplication: provider object ID · skipped repeats: {row.listener_duplicate_count || 0} · source: {row.source_disposition === 'trash' ? 'move Gmail to Trash' : 'retain'}</div>
            {row.listener_last_error && <div style={{ fontSize: '.8rem', color: '#dc2626', marginTop: 4 }}>{row.listener_last_error}</div>}
            <div style={{ fontSize: '.8rem', color: 'var(--muted)', wordBreak: 'break-all', margin: '5px 0' }}>Webhook fallback: POST /api/event-productivity/webhooks/{row.id}</div>
            <button className="wf-btn" disabled={busy} onClick={() => act(() => api.eventProductivitySubscriptionUpdate(row.id, { listener_enabled: !row.listener_enabled }), row.listener_enabled ? 'Listener disabled successfully.' : 'Listener enabled successfully.', row.listener_enabled ? 'Disabling listener…' : 'Enabling listener…')} style={{ marginRight: 6 }}>{row.listener_enabled ? 'Disable listener' : 'Enable listener'}</button>
            <button className="wf-btn" disabled={busy || !row.listener_enabled} onClick={() => act(() => api.eventProductivityListenerCheck(row.id), 'Listener check completed successfully.', 'Checking the provider for new events…')} style={{ marginRight: 6 }}>Check now</button>
            <button className="wf-btn" disabled={busy || historyBusy} onClick={() => showHistory(row)} style={{ marginRight: 6 }}>History</button>
            <button className="wf-btn" disabled={busy} onClick={() => act(() => api.eventProductivitySecretRotate(row.id), 'Webhook secret rotated successfully. Copy the new secret from the highlighted panel.', 'Rotating webhook secret…')} style={{ marginRight: 6 }}>Rotate secret</button>
            <button className="wf-btn" disabled={busy} onClick={() => window.confirm('Delete this subscription?') && act(() => api.eventProductivitySubscriptionDelete(row.id), 'Subscription deleted successfully.', 'Deleting subscription…')}>Delete</button>
          </div>;
        })}
      </section>

      {history && <div role="dialog" aria-modal="true" aria-label="Subscription event history" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.66)', display: 'grid', placeItems: 'center', padding: 16 }} onClick={() => setHistory(null)}>
        <div style={{ width: 'min(900px,96vw)', maxHeight: '82vh', overflow: 'auto', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, boxShadow: '0 24px 60px rgba(15,23,42,.34)' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ position: 'sticky', top: -18, zIndex: 1, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', margin: '-18px -18px 0', padding: '16px 18px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', borderRadius: '14px 14px 0 0' }}><h2 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text)' }}>{history.subscription.name} · event history</h2><button className="wf-btn" onClick={() => setHistory(null)}>Close</button></div>
          <p style={{ color: 'var(--muted)', fontSize: '.82rem', lineHeight: 1.5 }}>Retained using the CEO company profile retention period. Repeated provider object IDs are skipped and counted on the subscription.</p>
          {!history.events.length && <div style={{ padding: '18px 14px', border: '1px dashed var(--border)', borderRadius: 10, background: 'var(--surface-muted)', color: 'var(--muted)' }}>No events processed by this listener yet.</div>}
          <div style={{ display: 'grid', gap: 10 }}>
            {history.events.map((event) => {
              const payload = event.payload || {};
              const heading = payload.subject || payload.title || '(No subject or title)';
              const sender = payload.sender || payload.organizer?.emailAddress?.address || payload.organizer?.email || payload.organizer?.displayName || '';
              const preview = String(payload.body_text || payload.bodyPreview || payload.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 320);
              const objectId = event.subject_id || event.provider_event_id || '—';
              return <article key={event.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', background: 'var(--surface-muted)', color: 'var(--text)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{event.event_type}</div>
                    <strong style={{ display: 'block', marginTop: 3, overflowWrap: 'anywhere' }}>{heading}</strong>
                  </div>
                  <span style={{ flex: '0 0 auto', padding: '3px 8px', borderRadius: 999, fontSize: '.75rem', fontWeight: 700, color: event.status === 'completed' ? '#166534' : 'var(--text)', background: event.status === 'completed' ? '#dcfce7' : 'var(--surface)', border: '1px solid var(--border)' }}>{event.status}</span>
                </div>
                <div style={{ marginTop: 7, color: 'var(--muted)', fontSize: '.8rem', lineHeight: 1.45 }}>
                  <div>{formatLocalDateTime(event.received_at)}{sender ? ` · From ${sender}` : ''}</div>
                  {(payload.start || payload.end) && <div>{payload.start?.dateTime || payload.start || '—'} → {payload.end?.dateTime || payload.end || '—'}</div>}
                  <div style={{ marginTop: 3 }}>Object <code style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', color: 'var(--text)' }}>{objectId}</code></div>
                </div>
                {preview && <p style={{ margin: '9px 0 0', padding: '8px 10px', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', lineHeight: 1.45, overflowWrap: 'anywhere' }}>{preview}{String(payload.body_text || payload.bodyPreview || payload.snippet || '').length > 320 ? '…' : ''}</p>}
                {event.last_error && <div style={{ marginTop: 8, color: '#b91c1c', background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 8, padding: '7px 9px', fontSize: '.8rem', overflowWrap: 'anywhere' }}>{event.last_error}</div>}
              </article>;
            })}
          </div>
        </div>
      </div>}

      <section style={box}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Capability binding</h2>
        <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>
          A capability is the stable intent an agent or workflow requests, such as <code>calendar_list_events</code>. A binding is your company&apos;s routing rule from that intent and provider to one exact action exposed by a connected app. At run time Flolah resolves the binding, applies Action Control, executes only that action, prevents duplicate execution with an idempotency key, and stores an action receipt. Agents never guess an App ID or Action ID.
        </p>
        <p style={{ color: 'var(--muted)', fontSize: '.82rem' }}>
          App ID lists the compatible apps currently connected under OpenConnector. Action ID lists the actions reported by the selected app. An optional verification action reads the provider result back after a write.
        </p>
        <div style={grid}>
          <select value={binding.operation} onChange={(e) => setBinding({ ...binding, operation: e.target.value })}>{operations.map((name) => <option key={name}>{name}</option>)}</select>
          <select aria-label="Binding provider" value={binding.provider} onChange={(e) => selectBindingProvider(e.target.value)}>{Object.entries(providers).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}</select>
          <select aria-label="Connected app" value={binding.app_id} onChange={(e) => selectBindingApp(e.target.value)} disabled={!compatibleApps.length}>
            {!compatibleApps.length && <option value="">No compatible connected app</option>}
            {compatibleApps.map((app) => <option key={app.id} value={app.id}>{app.name || app.id} ({app.id})</option>)}
          </select>
          <select aria-label="Connector action" value={binding.action_id} onChange={(e) => setBinding({ ...binding, action_id: e.target.value })} disabled={!binding.app_id || actionsBusy || !connectorActions.length}>
            <option value="">{actionsBusy ? 'Loading actions…' : 'Select an action'}</option>
            {connectorActions.map((action) => <option key={action.id} value={action.id}>{action.id}{action.description ? ` — ${action.description.slice(0, 80)}` : ''}</option>)}
          </select>
          <input style={input} placeholder="Connection name (optional)" value={binding.connection_name} onChange={(e) => setBinding({ ...binding, connection_name: e.target.value })} />
          <select aria-label="Verification action" value={binding.verify_action_id} onChange={(e) => setBinding({ ...binding, verify_action_id: e.target.value })} disabled={!binding.app_id || actionsBusy || !connectorActions.length}>
            <option value="">No verification action</option>
            {connectorActions.map((action) => <option key={action.id} value={action.id}>{action.id}{action.description ? ` — ${action.description.slice(0, 80)}` : ''}</option>)}
          </select>
        </div>
        {!compatibleApps.length && <p style={{ color: '#d97706', fontSize: '.82rem' }}>Connect a compatible app under OpenConnector before creating this provider binding.</p>}
        {actionsError && <p style={{ color: '#dc2626', fontSize: '.82rem' }}>{actionsError}</p>}
        <button className="wf-btn-primary" disabled={busy || actionsBusy || !binding.operation || !binding.app_id || !binding.action_id} onClick={() => act(() => api.eventProductivityBindingSave(binding), 'Binding saved.') } style={{ marginTop: 10 }}>Save binding</button>
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
