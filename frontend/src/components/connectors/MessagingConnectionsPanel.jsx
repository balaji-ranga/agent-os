import { useEffect, useState } from 'react';
import { api } from '../../api';

const EMPTY = { name: '', protocol: 'mqtt', endpoint: 'mqtts://', enabled: true, configText: '{}', vault_refs: {} };
const REF_FIELDS = [
  ['usernameRef', 'Username key'], ['passwordRef', 'Password key'], ['tokenRef', 'Token key'],
  ['clientIdRef', 'Client ID key'], ['clientSecretRef', 'Client secret key'],
  ['caCertRef', 'CA certificate key'], ['clientCertRef', 'Client certificate key'], ['privateKeyRef', 'Private key'],
];

export default function MessagingConnectionsPanel() {
  const [connections, setConnections] = useState([]);
  const [vaultKeys, setVaultKeys] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const refresh = async () => {
    const [result, vault] = await Promise.all([api.messagingConnections(), api.userApiKeysList?.().catch(() => ({ keys: [] })) || Promise.resolve({ keys: [] })]);
    setConnections(result.connections || []); setVaultKeys(vault.keys || vault.items || []);
  };
  useEffect(() => { refresh().catch((e) => setError(e.message)); }, []);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { const config = JSON.parse(form.configText || '{}'); const payload = { ...form, config }; delete payload.configText; if (editing) await api.messagingConnectionUpdate(editing, payload); else await api.messagingConnectionCreate(payload); setMessage('Messaging connection saved.'); setForm(EMPTY); setEditing(''); await refresh(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const edit = (item) => { setEditing(item.id); setForm({ name: item.name, protocol: item.protocol, endpoint: item.endpoint, enabled: item.enabled, configText: JSON.stringify(item.config || {}, null, 2), vault_refs: item.vault_refs || {} }); };
  return (
    <section aria-label="Messaging connections">
      <p style={{ color: 'var(--muted)' }}>Connect Kafka, MQTT, AMQP, STOMP or JMS brokers. Passwords, tokens and certificates remain in Settings → API Keys; this page stores only their key names.</p>
      {error && <div className="error-banner">{error}</div>}{message && <div style={{ color: '#16a34a' }}>{message}</div>}
      <form onSubmit={save} style={{ display: 'grid', gap: '0.75rem', maxWidth: 780 }}>
        <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Production events" /></label>
        <label>Protocol<select value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })}>{['mqtt','kafka','amqp091','amqp10','stomp','jms'].map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
        <label>Broker endpoint<input required value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} placeholder="mqtts://broker.example.com:8883" /><small>Do not put credentials in the URL.</small></label>
        <label>Protocol options (JSON)<textarea rows={4} value={form.configText} onChange={(e) => setForm({ ...form, configText: e.target.value })} placeholder='{"clientId":"flolah","saslMechanism":"plain"}' /><small>For JMS set provider to <code>qpid</code> or <code>artemis</code>. Values here must not contain credentials.</small></label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: '0.65rem' }}>
          {REF_FIELDS.map(([field, label]) => <label key={field}>{label}<select value={form.vault_refs?.[field] || ''} onChange={(e) => setForm({ ...form, vault_refs: { ...(form.vault_refs || {}), [field]: e.target.value } })}><option value="">— none —</option>{vaultKeys.map((key) => <option key={key.key_name} value={key.key_name}>{key.key_name}</option>)}</select></label>)}
        </div>
        <label><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled</label>
        <div style={{ display: 'flex', gap: 8 }}><button type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Update connection' : 'Add connection'}</button>{editing && <button type="button" onClick={() => { setEditing(''); setForm(EMPTY); }}>Cancel</button>}</div>
      </form>
      <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
        {connections.map((item) => <article key={item.id} className="card" style={{ padding: 14 }}><strong>{item.name}</strong> · {item.protocol}<div><code>{item.endpoint}</code></div><small>{item.enabled ? 'Enabled' : 'Disabled'} · Vault: {Object.values(item.vault_refs || {}).join(', ') || 'no credentials'}</small><div style={{ display: 'flex', gap: 8, marginTop: 8 }}><button type="button" onClick={() => edit(item)}>Edit</button><button type="button" onClick={async () => { setBusy(true); try { await api.messagingConnectionTest(item.id); setMessage(`${item.name}: connection successful`); } catch (e) { setError(e.message); } finally { setBusy(false); } }}>Test</button><button type="button" onClick={async () => { if (!window.confirm(`Delete ${item.name}?`)) return; try { await api.messagingConnectionDelete(item.id); await refresh(); } catch (e) { setError(e.message); } }}>Delete</button></div></article>)}
      </div>
    </section>
  );
}
