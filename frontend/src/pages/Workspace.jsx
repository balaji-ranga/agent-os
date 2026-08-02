import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import AddAgentForm from '../components/AddAgentForm';

export default function Workspace() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [clearingAgentId, setClearingAgentId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  const clearSessions = (agentId) => {
    if (!window.confirm('Clear all OpenClaw sessions for this agent? Chat and task session history will be reset.')) return;
    setClearingAgentId(agentId);
    api.agentSessionsClear(agentId)
      .then(() => setError(null))
      .catch((e) => setError(e.message))
      .finally(() => setClearingAgentId(null));
  };

  const fetchAgents = () => {
    setLoading(true);
    api.agentsList()
      .then((list) => setAgents(Array.isArray(list) ? list : list?.agents || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  const removeAgent = (agentId) => {
    if (!window.confirm('Remove this agent? This cannot be undone.')) return;
    api.agentDelete(agentId)
      .then(() => fetchAgents())
      .catch((e) => setError(e.message));
  };

  if (loading && agents.length === 0) {
    return (
      <div className="page">
        <p className="page-muted">Loading agents…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-hero">
        <div className="page-hero-top">
          <div className="page-hero-titles">
            <p className="page-hero-kicker">Agentic Workflows</p>
            <h1>Agent Workspaces</h1>
          </div>
          <button
            type="button"
            className="btn-primary page-hero-action"
            onClick={() => setShowAdd((o) => !o)}
            aria-expanded={showAdd}
          >
            {showAdd ? 'Hide form' : 'Add agent'}
          </button>
        </div>
        <p className="page-hero-sub">
          Create specialists, open SOUL/AGENTS/MEMORY, grant tools, and clear stuck sessions. Org chart stays on My Org.
        </p>
      </header>

      {error && (
        <div className="page-banner page-banner-error" role="alert">
          <span>Error: {error}</span>
          <button type="button" className="btn-ghost" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {showAdd && (
        <section className="panel panel-accent" style={{ marginBottom: '1.5rem' }}>
          <h2 className="panel-title">Add agent</h2>
          <p className="page-muted" style={{ marginTop: 0, marginBottom: '0.85rem' }}>
            Creates a custom agent in your OpenClaw tenant. Set department and who they report to for the org chart.
          </p>
          <AddAgentForm
            agents={agents}
            compact
            onCreated={() => {
              fetchAgents();
              setShowAdd(true);
            }}
          />
        </section>
      )}

      <ul className="agent-workspace-list">
        {agents.map((a) => (
          <li key={a.id} className="agent-workspace-card">
            <div className="agent-workspace-card-meta">
              <span className="agent-workspace-card-name">{a.name}</span>
              {a.role && <span className="agent-workspace-card-role">{a.role}</span>}
              {a.department && <span className="agent-workspace-card-dept">{a.department}</span>}
            </div>
            <div className="agent-workspace-card-actions">
              <Link to={`/agents/${a.id}/workspace`} className="btn-primary btn-sm">
                Open workspace
              </Link>
              <Link to={`/agents/${a.id}/chat`} className="btn-secondary btn-sm">
                Chat
              </Link>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => clearSessions(a.id)}
                disabled={clearingAgentId === a.id}
                title="Clear OpenClaw sessions for this agent"
              >
                {clearingAgentId === a.id ? 'Clearing…' : 'Clear sessions'}
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => removeAgent(a.id)}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      {agents.length === 0 && (
        <div className="panel" style={{ textAlign: 'center', padding: '2rem 1.25rem' }}>
          <p className="page-muted" style={{ margin: '0 0 0.75rem' }}>
            No agents yet. Add your first specialist here.
          </p>
          {!showAdd && (
            <button type="button" className="btn-primary" onClick={() => setShowAdd(true)}>
              Add agent
            </button>
          )}
        </div>
      )}
    </div>
  );
}
