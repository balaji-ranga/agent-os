import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';

const newConnection = () => ({
  name: '', protocol: 'mqtt', endpoint: 'mqtts://', enabled: true, configText: '{}', vault_refs: {},
});

const PROTOCOLS = [
  { value: 'mqtt', label: 'MQTT', hint: 'IoT telemetry and lightweight event streams' },
  { value: 'kafka', label: 'Kafka', hint: 'High-throughput event streams' },
  { value: 'amqp091', label: 'AMQP 0.9.1', hint: 'RabbitMQ and compatible brokers' },
  { value: 'amqp10', label: 'AMQP 1.0', hint: 'Enterprise messaging and Azure Service Bus' },
  { value: 'stomp', label: 'STOMP', hint: 'Simple text-oriented messaging' },
  { value: 'jms', label: 'JMS / Jakarta Messaging', hint: 'Qpid JMS and ActiveMQ Artemis' },
];

const REF_FIELDS = [
  ['usernameRef', 'Username'], ['passwordRef', 'Password'], ['tokenRef', 'Access token'],
  ['clientIdRef', 'Client ID'], ['clientSecretRef', 'Client secret'], ['caCertRef', 'CA certificate'],
  ['clientCertRef', 'Client certificate'], ['privateKeyRef', 'Private key'],
];

const protocolLabel = (value) => PROTOCOLS.find((item) => item.value === value)?.label || value;

export default function MessagingConnectionsPanel() {
  const [connections, setConnections] = useState([]);
  const [vaultKeys, setVaultKeys] = useState([]);
  const [form, setForm] = useState(newConnection);
  const [editing, setEditing] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [result, vault] = await Promise.all([
        api.messagingConnections(),
        api.userApiKeysList?.().catch(() => ({ keys: [] })) || Promise.resolve({ keys: [] }),
      ]);
      setConnections(result.connections || []);
      setVaultKeys(vault.keys || vault.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const enabledCount = useMemo(
    () => connections.filter((connection) => connection.enabled).length,
    [connections]
  );

  const resetForm = () => {
    setEditing('');
    setForm(newConnection());
  };

  const save = async (event) => {
    event.preventDefault();
    setBusyAction('save');
    setError('');
    setMessage('');
    try {
      const config = JSON.parse(form.configText || '{}');
      const payload = { ...form, config };
      delete payload.configText;
      if (editing) await api.messagingConnectionUpdate(editing, payload);
      else await api.messagingConnectionCreate(payload);
      setMessage(editing ? 'Connection updated successfully.' : 'Connection added successfully.');
      resetForm();
      await refresh();
    } catch (err) {
      setError(err instanceof SyntaxError ? 'Protocol options must be valid JSON.' : err.message);
    } finally {
      setBusyAction('');
    }
  };

  const edit = (item) => {
    setEditing(item.id);
    setMessage('');
    setError('');
    setForm({
      name: item.name,
      protocol: item.protocol,
      endpoint: item.endpoint,
      enabled: item.enabled,
      configText: JSON.stringify(item.config || {}, null, 2),
      vault_refs: item.vault_refs || {},
    });
    document.getElementById('messaging-connection-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const testConnection = async (item) => {
    setBusyAction(`test:${item.id}`);
    setError('');
    setMessage('');
    try {
      await api.messagingConnectionTest(item.id);
      setMessage(`${item.name} connected successfully.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyAction('');
    }
  };

  const deleteConnection = async (item) => {
    if (!window.confirm(`Delete ${item.name}? Workflows using this connection will need a replacement.`)) return;
    setBusyAction(`delete:${item.id}`);
    setError('');
    setMessage('');
    try {
      await api.messagingConnectionDelete(item.id);
      if (editing === item.id) resetForm();
      setMessage(`${item.name} deleted.`);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyAction('');
    }
  };

  return (
    <section className="messaging-connections" aria-label="Messaging and IoT connections">
      <header className="messaging-hero">
        <div>
          <span className="messaging-eyebrow">EVENT CONNECTIVITY</span>
          <h2>Messaging &amp; IoT</h2>
          <p>
            Connect event brokers to start workflows from incoming messages or send messages from a workflow.
            Credentials stay in your API Keys Vault.
          </p>
        </div>
        <div className="messaging-summary" aria-label="Connection summary">
          <div><strong>{connections.length}</strong><span>Total</span></div>
          <div><strong>{enabledCount}</strong><span>Enabled</span></div>
          <button type="button" className="wf-btn" disabled={loading || !!busyAction} onClick={refresh}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && <div className="messaging-notice messaging-notice-error" role="alert">{error}</div>}
      {message && <div className="messaging-notice messaging-notice-success" role="status">{message}</div>}

      <div className="messaging-layout">
        <form id="messaging-connection-form" className="messaging-panel messaging-form" onSubmit={save}>
          <div className="messaging-panel-heading">
            <div>
              <span className="messaging-step">{editing ? 'EDIT CONNECTION' : 'NEW CONNECTION'}</span>
              <h3>{editing ? 'Update broker connection' : 'Connect a broker'}</h3>
              <p>Use a broker endpoint without embedded credentials.</p>
            </div>
            {editing && <span className="messaging-editing-badge">Editing</span>}
          </div>

          <div className="messaging-form-grid">
            <label className="messaging-field">
              <span>Connection name</span>
              <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Production events" />
              <small>A clear name that workflow authors will recognize.</small>
            </label>
            <label className="messaging-field">
              <span>Protocol</span>
              <select value={form.protocol} onChange={(event) => setForm({ ...form, protocol: event.target.value })}>
                {PROTOCOLS.map((protocol) => <option key={protocol.value} value={protocol.value}>{protocol.label}</option>)}
              </select>
              <small>{PROTOCOLS.find((item) => item.value === form.protocol)?.hint}</small>
            </label>
            <label className="messaging-field messaging-field-wide">
              <span>Broker endpoint</span>
              <input required value={form.endpoint} onChange={(event) => setForm({ ...form, endpoint: event.target.value })} placeholder="mqtts://broker.example.com:8883" inputMode="url" />
              <small>Credentials in URLs are blocked. Select Vault keys below.</small>
            </label>
          </div>

          <details className="messaging-disclosure" open>
            <summary>
              <span>Authentication from API Keys Vault</span>
              <small>{Object.values(form.vault_refs || {}).filter(Boolean).length} selected</small>
            </summary>
            <p>Select only the credentials required by this broker. Secret values are never copied here.</p>
            <div className="messaging-vault-grid">
              {REF_FIELDS.map(([field, label]) => (
                <label className="messaging-field" key={field}>
                  <span>{label}</span>
                  <select value={form.vault_refs?.[field] || ''} onChange={(event) => setForm({ ...form, vault_refs: { ...(form.vault_refs || {}), [field]: event.target.value } })}>
                    <option value="">Not configured</option>
                    {vaultKeys.map((key) => <option key={key.key_name} value={key.key_name}>{key.key_name}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {!vaultKeys.length && !loading && <p className="messaging-inline-help">No Vault keys found. Add credentials under Settings → API Keys first.</p>}
          </details>

          <details className="messaging-disclosure">
            <summary><span>Advanced protocol options</span><small>Optional JSON</small></summary>
            <label className="messaging-field">
              <span>Configuration</span>
              <textarea rows={5} value={form.configText} onChange={(event) => setForm({ ...form, configText: event.target.value })} placeholder='{"clientId":"flolah","saslMechanism":"plain"}' spellCheck="false" />
              <small>For JMS, set provider to <code>qpid</code> or <code>artemis</code>. Do not include secrets.</small>
            </label>
          </details>

          <div className="messaging-form-footer">
            <label className="messaging-toggle">
              <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
              <span><strong>Enable connection</strong><small>Available to published workflows</small></span>
            </label>
            <div className="messaging-actions">
              {editing && <button type="button" className="wf-btn" onClick={resetForm}>Cancel</button>}
              <button type="submit" className="wf-btn-primary" disabled={busyAction === 'save'}>
                {busyAction === 'save' ? 'Saving…' : editing ? 'Save changes' : 'Add connection'}
              </button>
            </div>
          </div>
        </form>

        <section className="messaging-panel messaging-list" aria-labelledby="messaging-saved-heading">
          <div className="messaging-panel-heading">
            <div>
              <span className="messaging-step">SAVED CONNECTIONS</span>
              <h3 id="messaging-saved-heading">Broker connections</h3>
              <p>Test, update, or remove connections used by workflows.</p>
            </div>
          </div>
          {loading ? (
            <div className="messaging-empty" aria-live="polite"><span className="messaging-spinner" aria-hidden="true" /><strong>Loading connections…</strong></div>
          ) : !connections.length ? (
            <div className="messaging-empty"><span className="messaging-empty-icon" aria-hidden="true">↔</span><strong>No broker connections yet</strong><p>Add the first connection using the form. It will then be available in Workflow Builder.</p></div>
          ) : (
            <div className="messaging-card-list">
              {connections.map((item) => {
                const refs = Object.values(item.vault_refs || {}).filter(Boolean);
                return (
                  <article key={item.id} className={`messaging-card${editing === item.id ? ' is-editing' : ''}`}>
                    <div className="messaging-card-top">
                      <div className="messaging-protocol-mark" aria-hidden="true">{protocolLabel(item.protocol).slice(0, 2).toUpperCase()}</div>
                      <div className="messaging-card-title"><h4>{item.name}</h4><span className={`messaging-status ${item.enabled ? 'is-enabled' : 'is-disabled'}`}>{item.enabled ? 'Enabled' : 'Disabled'}</span></div>
                    </div>
                    <dl className="messaging-card-details">
                      <div><dt>Protocol</dt><dd>{protocolLabel(item.protocol)}</dd></div>
                      <div><dt>Endpoint</dt><dd title={item.endpoint}>{item.endpoint}</dd></div>
                      <div><dt>Vault credentials</dt><dd>{refs.length ? `${refs.length} configured` : 'None'}</dd></div>
                    </dl>
                    <div className="messaging-card-actions">
                      <button type="button" className="wf-btn" disabled={!!busyAction} onClick={() => edit(item)}>Edit</button>
                      <button type="button" className="wf-btn" disabled={!!busyAction} onClick={() => testConnection(item)}>{busyAction === `test:${item.id}` ? 'Testing…' : 'Test connection'}</button>
                      <button type="button" className="wf-btn wf-btn-danger" disabled={!!busyAction} onClick={() => deleteConnection(item)}>{busyAction === `delete:${item.id}` ? 'Deleting…' : 'Delete'}</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
