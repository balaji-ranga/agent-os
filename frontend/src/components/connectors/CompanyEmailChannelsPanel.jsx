import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

const panel = { border: '1px solid var(--border)', borderRadius: 10, padding: '1rem', marginTop: '1rem', background: 'var(--surface, transparent)' };
const grid = { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))' };
const field = { display: 'grid', gap: 5, fontSize: '.85rem', color: 'var(--muted)' };
const input = { width: '100%', boxSizing: 'border-box' };
const initialForm = {
  provider: 'outlook', mailbox_address: '', display_name: '', direction: 'both',
  default_agent_id: '', marketing_agent_id: '', routing_mode: 'inbox', routing_target_id: '',
  initial_lookback_hours: '24', goal_prompt_template: '',
};

function dateTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function agentName(agents, id) {
  if (!id) return 'Not assigned';
  const row = agents.find((agent) => String(agent.id) === String(id));
  return row?.name || row?.display_name || id;
}

function channelForm(row) {
  return {
    provider: row.provider || 'outlook',
    mailbox_address: row.mailbox_address || '',
    display_name: row.display_name || '',
    direction: row.direction || 'both',
    default_agent_id: row.default_agent_id || '',
    marketing_agent_id: row.marketing_agent_id || '',
    routing_mode: row.routing_mode || 'inbox',
    routing_target_id: row.routing_target_id || '',
    initial_lookback_hours: String(row.config?.initial_lookback_hours || 24),
    goal_prompt_template: row.config?.goal_prompt_template || '',
  };
}

export default function CompanyEmailChannelsPanel() {
  const [data, setData] = useState({ providers: {}, channels: [], connected_apps: [] });
  const [agents, setAgents] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [channelsResult, agentsResult, workflowsResult] = await Promise.all([
        api.companyEmailChannels(),
        api.agentsList(),
        api.agentWorkflowList({ limit: 500, offset: 0 }),
      ]);
      setData(channelsResult || { providers: {}, channels: [], connected_apps: [] });
      setAgents(Array.isArray(agentsResult) ? agentsResult : agentsResult?.agents || []);
      setWorkflows(workflowsResult?.workflows || []);
    } catch (err) {
      setError(err.message || 'Could not load company Email channels.');
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh]);

  const connectedApps = useMemo(
    () => new Set((data.connected_apps || []).map((row) => String(row.app_id || '').toLowerCase())),
    [data.connected_apps]
  );

  async function act(key, fn, success) {
    setBusy(key); setError(''); setMessage('');
    try {
      const result = await fn();
      setMessage(typeof success === 'function' ? success(result) : success);
      await refresh();
      return result;
    } catch (err) {
      setError(err.message || 'The Email channel action failed.');
      return null;
    } finally {
      setBusy('');
    }
  }

  function payload() {
    return {
      provider: form.provider,
      mailbox_address: form.mailbox_address.trim(),
      display_name: form.display_name.trim(),
      direction: form.direction,
      default_agent_id: form.default_agent_id || null,
      marketing_agent_id: form.marketing_agent_id || null,
      routing_mode: form.routing_mode,
      routing_target_id: form.routing_mode === 'workflow' ? form.routing_target_id : null,
      config: {
        initial_lookback_hours: Number(form.initial_lookback_hours) || 24,
        ...(form.goal_prompt_template.trim() ? { goal_prompt_template: form.goal_prompt_template.trim() } : {}),
      },
    };
  }

  async function save(event) {
    event.preventDefault();
    const result = await act('save', () => editingId
      ? api.companyEmailChannelUpdate(editingId, payload())
      : api.companyEmailChannelCreate(payload()), editingId ? 'Email channel updated.' : 'Email channel created. Connect OAuth, test, then enable it.');
    if (result) { setEditingId(''); setForm(initialForm); }
  }

  async function connectOAuth(provider) {
    setBusy(`oauth:${provider}`); setError(''); setMessage('');
    try {
      await api.openconnectorProvision({ ensure_connections: false });
      const result = await api.openconnectorOAuthStart(provider);
      if (!result.authorization_url) throw new Error('No authorization URL returned.');
      const popup = window.open(result.authorization_url, `company-email-${provider}`, 'width=640,height=720');
      setMessage(`Complete ${data.providers?.[provider]?.label || provider} OAuth in the popup. This page will update automatically.`);
      const started = Date.now();
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        if (Date.now() - started > 5 * 60 * 1000) {
          clearInterval(pollRef.current); pollRef.current = null; setBusy('');
          setMessage('OAuth wait ended. Use Refresh after completing the connection.');
          return;
        }
        try {
          const latest = await api.companyEmailChannels();
          setData(latest);
          const connected = (latest.connected_apps || []).some((row) => String(row.app_id).toLowerCase() === provider);
          if (connected) {
            clearInterval(pollRef.current); pollRef.current = null; setBusy('');
            if (popup && !popup.closed) popup.close();
            setMessage(`${latest.providers?.[provider]?.label || provider} is connected. Test and enable the mailbox.`);
          }
        } catch { /* continue bounded OAuth polling */ }
      }, 2000);
    } catch (err) {
      setBusy(''); setError(err.message || 'Could not start OAuth.');
    }
  }

  function edit(row) {
    setEditingId(row.id); setForm(channelForm(row)); setError(''); setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <section style={{ ...panel, borderColor: 'color-mix(in srgb, var(--accent) 32%, var(--border))' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Company Email channels</h2>
        <p style={{ color: 'var(--muted)', marginBottom: 6 }}>
          Connect the company mailbox once for this CEO. Campaign replies go to Marketing; other inbound mail enters the existing Events &amp; Productivity inbox and follows the route selected below.
        </p>
        <p style={{ color: 'var(--muted)', fontSize: '.84rem', margin: 0 }}>
          Message history is not duplicated here. Review it in <Link to="/connectors?tab=events">Events &amp; Productivity</Link>. OAuth secrets remain in OpenConnector and are never displayed or stored in Marketing.
        </p>
      </section>

      {error && <div style={{ color: '#dc2626', marginTop: 12 }}>{error}</div>}
      {message && <div style={{ color: '#16a34a', marginTop: 12 }}>{message}</div>}

      <form onSubmit={save} style={panel}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>{editingId ? 'Edit Email channel' : 'Add company mailbox'}</h2>
        <div style={grid}>
          <label style={field}>Provider
            <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              {Object.entries(data.providers || {}).map(([id, provider]) => <option key={id} value={id}>{provider.label}</option>)}
              {!Object.keys(data.providers || {}).length && <><option value="outlook">Microsoft 365 / Outlook</option><option value="gmail">Google Workspace / Gmail</option></>}
            </select>
          </label>
          <label style={field}>Mailbox address
            <input type="email" required style={input} placeholder="company@example.com" value={form.mailbox_address} onChange={(e) => setForm({ ...form, mailbox_address: e.target.value })} />
          </label>
          <label style={field}>Display name
            <input style={input} placeholder="CEO company inbox" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </label>
          <label style={field}>Direction
            <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}><option value="both">Inbound and outbound</option><option value="inbound">Inbound only</option><option value="outbound">Outbound only</option></select>
          </label>
          <label style={field}>Default handling agent
            <select value={form.default_agent_id} onChange={(e) => setForm({ ...form, default_agent_id: e.target.value })}><option value="">None — inbox only</option>{agents.map((row) => <option key={row.id} value={row.id}>{row.name || row.display_name || row.id}</option>)}</select>
          </label>
          <label style={field}>Campaign response agent
            <select value={form.marketing_agent_id} onChange={(e) => setForm({ ...form, marketing_agent_id: e.target.value })}><option value="">Marketing attribution only</option>{agents.map((row) => <option key={row.id} value={row.id}>{row.name || row.display_name || row.id}</option>)}</select>
          </label>
          <label style={field}>Non-campaign mail route
            <select value={form.routing_mode} onChange={(e) => setForm({ ...form, routing_mode: e.target.value, routing_target_id: '' })}><option value="inbox">Live Event Inbox only</option><option value="workflow">Run a workflow</option><option value="goal">Create an agent goal</option></select>
          </label>
          {form.routing_mode === 'workflow' && <label style={field}>Workflow
            <select required value={form.routing_target_id} onChange={(e) => setForm({ ...form, routing_target_id: e.target.value })}><option value="">Select workflow</option>{workflows.map((row) => <option key={row.id} value={row.id}>{row.name || row.id}</option>)}</select>
          </label>}
          <label style={field}>First sync lookback
            <select value={form.initial_lookback_hours} onChange={(e) => setForm({ ...form, initial_lookback_hours: e.target.value })}><option value="1">1 hour</option><option value="6">6 hours</option><option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option></select>
          </label>
        </div>
        {form.routing_mode === 'goal' && <label style={{ ...field, marginTop: 10 }}>Goal instructions
          <textarea rows={3} style={input} placeholder="Optional. {{event_id}} is available to the goal." value={form.goal_prompt_template} onChange={(e) => setForm({ ...form, goal_prompt_template: e.target.value })} />
        </label>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button type="submit" className="wf-btn-primary" disabled={!!busy}>{busy === 'save' ? 'Saving…' : editingId ? 'Update channel' : 'Save channel'}</button>
          {editingId && <button type="button" className="wf-btn" disabled={!!busy} onClick={() => { setEditingId(''); setForm(initialForm); }}>Cancel</button>}
          <button type="button" className="wf-btn" disabled={!!busy} onClick={refresh}>Refresh</button>
        </div>
      </form>

      <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Configured mailboxes</h2>
        {!data.channels?.length && <p style={{ color: 'var(--muted)' }}>No company mailbox configured yet.</p>}
        {(data.channels || []).map((row) => {
          const connected = row.oauth_connected || connectedApps.has(row.connector_app_id);
          return <article key={row.id} style={{ borderTop: '1px solid var(--border)', padding: '14px 0' }}>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div><strong>{row.display_name || row.mailbox_masked}</strong><div style={{ color: 'var(--muted)', fontSize: '.84rem' }}>{row.provider_label} · {row.mailbox_masked} · {row.direction}</div></div>
              <span style={{ border: '1px solid var(--border)', borderRadius: 999, padding: '3px 9px', color: row.healthy ? '#16a34a' : 'var(--muted)', fontSize: '.8rem' }}>{row.healthy ? 'Healthy' : row.status}</span>
            </div>
            <div style={{ ...grid, marginTop: 10, fontSize: '.84rem' }}>
              <div><strong>OAuth</strong><div style={{ color: connected ? '#16a34a' : '#d97706' }}>{connected ? 'Connected' : 'Connection required'}</div></div>
              <div><strong>Normal mail</strong><div style={{ color: 'var(--muted)' }}>{row.routing_mode === 'inbox' ? 'Live Event Inbox' : row.routing_mode === 'workflow' ? `Workflow · ${workflows.find((item) => item.id === row.routing_target_id)?.name || row.routing_target_id}` : `Goal · ${agentName(agents, row.default_agent_id)}`}</div></div>
              <div><strong>Campaign replies</strong><div style={{ color: 'var(--muted)' }}>{agentName(agents, row.marketing_agent_id)} · Marketing leads</div></div>
              <div><strong>Last sync</strong><div style={{ color: 'var(--muted)' }}>{dateTime(row.last_sync_at)}</div></div>
            </div>
            {row.last_error && <p style={{ color: '#dc2626', fontSize: '.84rem' }}>{row.last_error}</p>}
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10 }}>
              {!connected && <button type="button" className="wf-btn-primary" disabled={!!busy} onClick={() => connectOAuth(row.connector_app_id)}>{busy === `oauth:${row.connector_app_id}` ? 'Waiting for OAuth…' : 'Connect OAuth'}</button>}
              <button type="button" className="wf-btn" disabled={!!busy || !connected} onClick={() => act(`test:${row.id}`, () => api.companyEmailChannelTest(row.id), 'Connection test passed.')}>Test</button>
              {row.status === 'enabled'
                ? <button type="button" className="wf-btn" disabled={!!busy} onClick={() => act(`disable:${row.id}`, () => api.companyEmailChannelDisable(row.id), 'Email channel paused.')}>Pause</button>
                : <button type="button" className="wf-btn-primary" disabled={!!busy || !connected} onClick={() => act(`enable:${row.id}`, () => api.companyEmailChannelEnable(row.id), 'Email channel enabled.')}>Enable</button>}
              <button type="button" className="wf-btn" disabled={!!busy || row.status !== 'enabled' || !row.inbound_enabled} onClick={() => act(`sync:${row.id}`, () => api.companyEmailChannelSync(row.id), (result) => `Sync complete: ${result.processed || 0} processed, ${result.marketing || 0} campaign, ${result.inbox || 0} inbox.`)}>Sync now</button>
              <button type="button" className="wf-btn" disabled={!!busy} onClick={() => edit(row)}>Edit</button>
              <button type="button" className="wf-btn" disabled={!!busy} onClick={() => window.confirm('Delete this company Email channel? Retention-governed processing receipts remain until expiry.') && act(`delete:${row.id}`, () => api.companyEmailChannelDelete(row.id), 'Email channel deleted.')}>Delete</button>
            </div>
            {!!row.recent_receipts?.length && <details style={{ marginTop: 10 }}><summary>Recent routing receipts ({row.recent_receipts.length})</summary>{row.recent_receipts.slice(0, 10).map((receipt) => <div key={receipt.id} style={{ borderTop: '1px solid var(--border)', padding: '7px 0', fontSize: '.82rem' }}><strong>{receipt.route_type}</strong> · {receipt.status} · {receipt.subject}<div style={{ color: 'var(--muted)' }}>{receipt.sender_masked || 'unknown sender'} · {dateTime(receipt.received_at)}</div></div>)}</details>}
          </article>;
        })}
      </section>
    </div>
  );
}
