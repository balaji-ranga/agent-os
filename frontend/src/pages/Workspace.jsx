import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import AddAgentForm from '../components/AddAgentForm';
import RobotAvatar from '../components/RobotAvatar.jsx';
import PublishAgentToExchangeModal from '../components/PublishAgentToExchangeModal.jsx';

export default function Workspace() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [clearingAgentId, setClearingAgentId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [publishAgent, setPublishAgent] = useState(null);

  const clearSessions = (agentId) => {
    if (!window.confirm('Clear all sessions for this AI employee? Chat and task history will be reset.')) return;
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
    if (!window.confirm('Remove this AI employee? This cannot be undone.')) return;
    api.agentDelete(agentId)
      .then(() => fetchAgents())
      .catch((e) => setError(e.message));
  };

  if (loading && agents.length === 0) {
    return (
      <div className="page">
        <p className="page-muted">Loading AI employees…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-hero">
        <div className="page-hero-top">
          <div className="page-hero-titles">
            <p className="page-hero-kicker">Company Tools · Employees</p>
            <h1>AI Employees</h1>
          </div>
          <button
            type="button"
            className="btn-primary page-hero-action"
            onClick={() => setShowAdd((o) => !o)}
            aria-expanded={showAdd}
          >
            {showAdd ? 'Hide form' : 'Hire AI employee'}
          </button>
        </div>
        <p className="page-hero-sub">
          Hire specialists, open identity docs (SOUL/AGENTS/MEMORY), grant tools, and clear stuck sessions. Org chart stays on My Org.
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
          <h2 className="panel-title">Hire AI employee</h2>
          <p className="page-muted" style={{ marginTop: 0, marginBottom: '0.85rem' }}>
            Creates a digital employee in your isolated tenant. Set department and who they report to for the org chart.
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
              <RobotAvatar src={a.avatar_image} name={a.name} size={40} />
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
                onClick={() => setPublishAgent(a)}
              >
                Publish
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => clearSessions(a.id)}
                disabled={clearingAgentId === a.id}
                title="Clear sessions for this AI employee"
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
            No AI employees yet. Hire your first specialist here.
          </p>
          {!showAdd && (
            <button type="button" className="btn-primary" onClick={() => setShowAdd(true)}>
              Hire AI employee
            </button>
          )}
        </div>
      )}

      {publishAgent && (
        <PublishAgentToExchangeModal
          agent={publishAgent}
          onClose={() => setPublishAgent(null)}
          onChanged={() => fetchAgents()}
        />
      )}
    </div>
  );
}
