import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function AgentExchange() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => {
      const tags = (a.metadata?.tags || []).join(' ');
      const hay = [a.name, a.description, a.owner_name, a.owner_email, a.workflow_name, a.skill_id, a.endpoint_url, tags]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [agents, search]);

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch (_) {}
  };

  return (
    <div className="mcp-pg mcp-pg-registry">
      <header className="page-hero">
        <div className="page-hero-top">
          <div className="page-hero-titles">
            <p className="page-hero-kicker">Agentic Workflows · Marketplace</p>
            <h1>AgentExchange</h1>
          </div>
          <button
            type="button"
            className="mcp-pg-btn-primary page-hero-action"
            onClick={() => navigate('/workflows')}
          >
            + Publish from Workflow
          </button>
        </div>
        <p className="page-hero-sub">
          Browse all published A2A agent cards across the platform — workflows exposed as{' '}
          <a href="https://a2a-protocol.org/" target="_blank" rel="noreferrer">
            A2A-compliant
          </a>{' '}
          agents. Use their endpoints in workflow <strong>External Agent (A2A)</strong> nodes or external A2A clients.
        </p>
      </header>

      {error && <div className="mcp-pg-alert mcp-pg-alert-error">{error}</div>}

      <div className="mcp-pg-toolbar">
        <input
          type="search"
          className="mcp-pg-search"
          placeholder="Search published agents…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="mcp-pg-loading">
          <div className="mcp-pg-spinner" />
          <p>Loading published agents…</p>
        </div>
      ) : (
        <>
          <p className="mcp-pg-count">
            {filtered.length} published agent{filtered.length === 1 ? '' : 's'}
          </p>
          <div className="mcp-pg-grid">
            {filtered.map((a) => (
              <article key={a.id} className="mcp-pg-card" style={{ cursor: 'default' }}>
                <div className="mcp-pg-card-head">
                  <div className="mcp-pg-card-icon">{a.name?.charAt(0)?.toUpperCase() || 'A'}</div>
                  <div className="mcp-pg-card-badges">
                    <span className="mcp-pg-status mcp-pg-status-healthy">published</span>
                    <span className="mcp-pg-transport">A2A</span>
                    {(a.auth_mode === 'secured' || a.has_auth) && (
                      <span className="mcp-pg-tag platform">Secured</span>
                    )}
                    {a.auth_mode !== 'secured' && !a.has_auth && (
                      <span className="mcp-pg-tag mine">Public</span>
                    )}
                  </div>
                </div>
                <h3>{a.name}</h3>
                <p className="mcp-pg-card-desc">{a.description || 'No description'}</p>
                <code className="mcp-pg-card-url">{a.endpoint_url}</code>
                <div className="mcp-pg-card-meta">
                  <span>by {a.owner_name || 'Unknown'}</span>
                  {a.workflow_name && <span>{a.workflow_name}</span>}
                  {(a.auth_mode === 'secured' || a.has_auth) && (
                    <span className="mcp-pg-tag platform">OAuth client credentials</span>
                  )}
                </div>
                {a.auth_mode === 'secured' && a.token_url && (
                  <div className="mcp-pg-card-meta">
                    <span>
                      token: <code style={{ wordBreak: 'break-all' }}>{a.token_url}</code>
                    </span>
                  </div>
                )}
                {(a.metadata?.tags || []).length > 0 && (
                  <div className="mcp-pg-card-meta">
                    {(a.metadata.tags || []).map((tag) => (
                      <span key={tag} className="mcp-pg-tag mine">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mcp-pg-card-meta">
                  <span>
                    skill: <code>{a.skill_id}</code>
                  </span>
                  {a.published_at && <span>{new Date(a.published_at).toLocaleString()}</span>}
                </div>
                <div className="mcp-pg-card-actions">
                  <button
                    type="button"
                    className="mcp-pg-btn-primary mcp-pg-btn-sm"
                    onClick={() => copy(a.endpoint_url, `${a.id}-ep`)}
                  >
                    {copied === `${a.id}-ep` ? 'Copied endpoint' : 'Copy endpoint'}
                  </button>
                  <button
                    type="button"
                    className="mcp-pg-btn-ghost mcp-pg-btn-sm"
                    onClick={() => copy(a.card_url, `${a.id}-card`)}
                  >
                    {copied === `${a.id}-card` ? 'Copied card' : 'Copy card URL'}
                  </button>
                  {a.card_url && (
                    <a
                      className="mcp-pg-btn-ghost mcp-pg-btn-sm"
                      href={a.card_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
                    >
                      Open card
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
          {!filtered.length && (
            <div className="mcp-pg-empty">
              <p>{agents.length ? 'No published agents match your search.' : 'No A2A agents published yet.'}</p>
              <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
                Open a published workflow and use <strong>Publish A2A</strong> to list it here.
              </p>
              <Link to="/workflows" className="mcp-pg-btn-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>
                Go to Workflows
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
