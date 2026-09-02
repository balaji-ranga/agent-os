import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

export default function AdminModels() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setError('');
      setData(await api.adminModelsGet());
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => { load(); }, []);

  const deployments = data?.deployments || [];
  const deploymentById = useMemo(
    () => Object.fromEntries(deployments.map((item) => [item.id, item])),
    [deployments]
  );

  const probe = async (id) => {
    setBusy(`probe:${id}`);
    setMessage('');
    setError('');
    try {
      const result = await api.adminModelDeploymentProbe(id);
      setMessage(`${deploymentById[id]?.name || id} is healthy (${result.latency_ms} ms).`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const saveRoute = async (route, patch) => {
    setBusy(`route:${route.alias}`);
    setMessage('');
    setError('');
    try {
      await api.adminModelRouteSave(route.alias, { ...route, ...patch });
      setMessage(`Saved ${route.alias}.`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="page admin-models-page">
      <header className="page-hero">
        <div>
          <span className="promotions-eyebrow">Platform control plane</span>
          <h1>Models & routing</h1>
          <p>Inspect logical model aliases, internal deployments, failover, and recent route outcomes. Secrets remain in deployment environment or the owner vault.</p>
        </div>
        <button type="button" className="wf-btn" onClick={load}>Refresh</button>
      </header>

      {message && <div className="success-message" role="status">{message}</div>}
      {error && <div className="error-message" role="alert">{error}</div>}

      <section className="panel model-router-status">
        <div>
          <small>Registry routing</small>
          <strong>{data?.enabled ? 'Enabled' : 'Compatibility mode'}</strong>
        </div>
        <div>
          <small>LiteLLM gateway</small>
          <strong>{data?.gateway?.configured ? 'Private key configured' : 'Not configured'}</strong>
          <span>{data?.gateway?.base_url || '—'}</span>
        </div>
        <div>
          <small>vLLM</small>
          <strong>Ready, not running</strong>
          <span>Optional deployment profile; Qwen hosting deferred.</span>
        </div>
      </section>

      <section className="panel">
        <header className="model-section-heading">
          <div><h2>Logical routes</h2><p>Consumers use stable aliases while deployments can change behind them.</p></div>
        </header>
        <div className="model-route-grid">
          {(data?.routes || []).map((route) => (
            <article key={route.alias} className="model-route-card">
              <code>{route.alias}</code>
              <small>{route.capability}</small>
              <label>
                Primary deployment
                <select
                  value={route.primary_deployment_id}
                  disabled={busy === `route:${route.alias}`}
                  onChange={(e) => saveRoute(route, { primary_deployment_id: e.target.value })}
                >
                  {deployments.filter((item) => item.enabled && item.capabilities.includes(route.capability)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>
                Fallback policy (managed by gateway)
                <select
                  value={route.fallback_deployment_id || ''}
                  disabled
                  title="LiteLLM owns transport failover so Flolah does not create a second retry loop."
                >
                  <option value="">No fallback</option>
                  {deployments.filter((item) => item.enabled && item.capabilities.includes(route.capability)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <header className="model-section-heading"><div><h2>Deployments</h2><p>Registry metadata only; credential values never enter this page or database.</p></div></header>
        <div className="model-deployment-grid">
          {deployments.map((item) => (
            <article key={item.id} className={`model-deployment-card${item.enabled ? '' : ' disabled'}`}>
              <header><div><strong>{item.name}</strong><small>{item.provider_type}</small></div><span>{item.enabled ? 'Available' : 'Disabled'}</span></header>
              <code>{item.model || 'routing gateway'}</code>
              <p>{item.base_url}</p>
              <div className="model-capabilities">{item.capabilities.map((cap) => <span key={cap}>{cap}</span>)}</div>
              <footer>
                <small>{item.secret_configured ? 'Credential reference ready' : 'Credential reference not configured'}</small>
                {['litellm', 'ollama', 'vllm', 'embedding'].includes(item.provider_type) && (
                  <button type="button" className="wf-btn" disabled={!item.enabled || !!busy} onClick={() => probe(item.id)}>
                    {busy === `probe:${item.id}` ? 'Checking…' : 'Health check'}
                  </button>
                )}
              </footer>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <header className="model-section-heading"><div><h2>Recent routing history</h2><p>Sanitized operational evidence; owner identifiers and secrets are not displayed.</p></div></header>
        <div className="model-events-wrap">
          <table>
            <thead><tr><th>Time</th><th>Route</th><th>Outcome</th><th>Model</th><th>Latency</th><th>Source</th></tr></thead>
            <tbody>
              {(data?.events || []).map((event) => (
                <tr key={event.id}><td>{event.created_at}</td><td><code>{event.route_alias}</code></td><td>{event.outcome}</td><td>{event.model_used || '—'}</td><td>{event.latency_ms == null ? '—' : `${event.latency_ms} ms`}</td><td>{event.source || '—'}</td></tr>
              ))}
              {!data?.events?.length && <tr><td colSpan="6">No routed calls recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
