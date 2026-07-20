import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function AgentExchange() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .agentExchangeList()
      .then((r) => setAgents(r.agents || []))
      .catch((e) => {
        setError(e.message);
        setAgents([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch (_) {}
  };

  return (
    <div className="page" style={{ padding: '1.5rem', maxWidth: 1040 }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <p style={{ color: 'var(--muted)', margin: 0, fontSize: '0.85rem' }}>Agentic Workflows · Marketplace</p>
        <h1 style={{ margin: '0.25rem 0 0' }}>AgentExchange</h1>
        <p style={{ color: 'var(--muted)', marginTop: '0.5rem', maxWidth: 720 }}>
          Browse all published A2A agent cards across the platform — workflows exposed as{' '}
          <a href="https://a2a-protocol.org/" target="_blank" rel="noreferrer">
            A2A-compliant
          </a>{' '}
          agents. Use their endpoints in workflow <strong>External Agent (A2A)</strong> nodes or external A2A clients.
        </p>
      </header>

      {error && (
        <div className="wf-editor-inline-status wf-editor-inline-status--error" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading published agents…</p>
      ) : agents.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--border)',
            borderRadius: 8,
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--muted)',
          }}
        >
          <p>No A2A agents published yet.</p>
          <p style={{ fontSize: '0.9rem' }}>
            Open a published workflow in the{' '}
            <Link to="/workflows">Workflow editor</Link> and use <strong>Publish A2A</strong> to list it here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {agents.map((a) => (
            <article
              key={a.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '1rem 1.25rem',
                background: 'var(--surface)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{a.name}</h2>
                  <p style={{ margin: '0.35rem 0 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
                    by {a.owner_name}
                    {a.owner_email ? ` · ${a.owner_email}` : ''}
                    {a.workflow_name ? ` · workflow: ${a.workflow_name}` : ''}
                  </p>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)', textAlign: 'right' }}>
                  skill: <code>{a.skill_id}</code>
                  {a.published_at && (
                    <>
                      <br />
                      published {new Date(a.published_at).toLocaleString()}
                    </>
                  )}
                </div>
              </div>

              {a.description && (
                <p style={{ margin: '0.75rem 0 0', fontSize: '0.95rem' }}>{a.description}</p>
              )}

              {(a.metadata?.tags || []).length > 0 && (
                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {a.metadata.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.15rem 0.5rem',
                        borderRadius: 999,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div
                style={{
                  marginTop: '1rem',
                  display: 'grid',
                  gap: '0.5rem',
                  fontSize: '0.85rem',
                }}
              >
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>Endpoint:</strong>
                  <code style={{ wordBreak: 'break-all' }}>{a.endpoint_url}</code>
                  <button type="button" className="wf-btn" style={{ padding: '0.2rem 0.5rem' }} onClick={() => copy(a.endpoint_url, `${a.id}-ep`)}>
                    {copied === `${a.id}-ep` ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>Agent card:</strong>
                  <a href={a.card_url} target="_blank" rel="noreferrer">
                    {a.card_url}
                  </a>
                  <button type="button" className="wf-btn" style={{ padding: '0.2rem 0.5rem' }} onClick={() => copy(a.card_url, `${a.id}-card`)}>
                    {copied === `${a.id}-card` ? 'Copied' : 'Copy'}
                  </button>
                </div>
                {a.has_auth && (
                  <p style={{ margin: 0, color: 'var(--muted)' }}>🔒 Endpoint requires Bearer auth token</p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
