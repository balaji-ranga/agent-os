import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

/**
 * Daily operating Workspace (Product: Workspace).
 * Distinct from Home (/) and AI Employees (/workspace).
 *
 * Bottom command bar:
 * - Type a message and Go -> opens default COO chat on Home with message auto-sent.
 * - Type @name and pick (or @id message) -> opens that AI employee chat with message auto-sent.
 */
export default function OperatingWorkspace() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const inputRef = useRef(null);

  const agents = data?.agents || [];

  const load = () => {
    setLoading(true);
    api
      .companyWorkspaceSnapshot()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const mentionQuery = useMemo(() => {
    const m = cmd.match(/(?:^|\s)@([^\s@]*)$/);
    return m ? m[1].toLowerCase() : null;
  }, [cmd]);

  const mentionChoices = useMemo(() => {
    if (mentionQuery == null) return [];
    const q = mentionQuery;
    return agents
      .filter((a) => {
        const id = String(a.id || '').toLowerCase();
        const name = String(a.name || '').toLowerCase();
        if (!q) return true;
        return id.includes(q) || name.includes(q) || name.replace(/\s+/g, '').includes(q);
      })
      .slice(0, 8);
  }, [agents, mentionQuery]);

  useEffect(() => {
    setMentionOpen(mentionQuery != null && mentionChoices.length > 0);
  }, [mentionQuery, mentionChoices.length]);

  const openChat = (agentId, message = '', { autoSend = false } = {}) => {
    const q = new URLSearchParams();
    if (message) q.set('message', message);
    if (autoSend && message) q.set('autosend', '1');
    const qs = q.toString() ? `?${q.toString()}` : '';
    if (agentId) {
      navigate(`/agents/${encodeURIComponent(agentId)}/chat${qs}`);
    } else {
      // Home = COO chat
      navigate(`/${qs}`);
    }
  };

  const pickMention = (agent) => {
    // Replace trailing @query with @Name + space
    const next = cmd.replace(/(?:^|\s)@([^\s@]*)$/, (full) => {
      const lead = full.startsWith(' ') || full.startsWith('\t') ? full[0] : '';
      return `${lead}@${agent.name} `;
    });
    setCmd(next.startsWith('@') || next.includes('@') ? next : `@${agent.name} `);
    setMentionOpen(false);
    inputRef.current?.focus();
  };

  /** Resolve trailing/leading @mention to an agent + remaining message text. */
  function resolveMention(text) {
    const raw = String(text || '').trim();
    if (!raw.startsWith('@')) return { agent: null, message: raw };

    // "@Name with spaces rest" — longest name/id match
    const body = raw.slice(1);
    const sorted = [...agents].sort(
      (a, b) => String(b.name || b.id).length - String(a.name || a.id).length
    );
    for (const a of sorted) {
      const name = String(a.name || '');
      const id = String(a.id || '');
      if (name && body.toLowerCase().startsWith(name.toLowerCase())) {
        const rest = body.slice(name.length).replace(/^[\s,:|-]+/, '');
        return { agent: a, message: rest };
      }
      if (id && body.toLowerCase().startsWith(id.toLowerCase())) {
        const rest = body.slice(id.length).replace(/^[\s,:|-]+/, '');
        return { agent: a, message: rest };
      }
    }
    // first token as id/name fragment
    const m = body.match(/^([\w-]+)\s*(.*)$/s);
    if (m) {
      const needle = m[1].toLowerCase();
      const agent = agents.find(
        (a) =>
          String(a.id).toLowerCase() === needle ||
          String(a.name || '')
            .toLowerCase()
            .includes(needle)
      );
      if (agent) return { agent, message: (m[2] || '').trim() };
    }
    return { agent: null, message: raw };
  }

  const onCommand = (e) => {
    e.preventDefault();
    const text = cmd.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const { agent, message } = resolveMention(text);
      if (agent) {
        openChat(agent.id, message || `Hi ${agent.name}`, { autoSend: Boolean(message) });
      } else if (text.startsWith('@') && !agent) {
        setError('No matching AI employee for that @mention. Try typing @ and picking from the list.');
      } else {
        // No mention: COO on Home (or first available)
        const coo = agents.find((a) => a.is_coo) || agents[0];
        if (coo && !coo.is_coo) {
          openChat(coo.id, message || text, { autoSend: true });
        } else {
          openChat(null, message || text, { autoSend: true });
        }
      }
      setCmd('');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="page">
        <p className="page-muted">Loading Workspace…</p>
      </div>
    );
  }

  const m = data?.metrics || {};
  const business = data?.business || {};

  return (
    <div className="page operating-workspace">
      <header className="page-hero">
        <div className="page-hero-top">
          <div className="page-hero-titles">
            <p className="page-hero-kicker">Daily operating system</p>
            <h1>Workspace</h1>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Link className="btn-ghost" to="/">
              Executive Home
            </Link>
            <Link className="btn-ghost" to="/kanban">
              Kanban board
            </Link>
            <Link className="btn-primary" to="/workspace">
              AI Employees
            </Link>
          </div>
        </div>
        <p className="page-hero-sub">
          Run the day with humans and AI employees together. Home stays the company pulse; this
          surface is for work in motion.
        </p>
      </header>

      {error && (
        <div className="page-banner page-banner-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn-ghost" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
          gap: '0.75rem',
          marginBottom: '1.25rem',
        }}
      >
        {[
          { label: 'Tasks open', value: m.tasks_open ?? '—' },
          { label: 'AI employees', value: m.agents_active ?? '—' },
          {
            label: 'CRM',
            value: business.crm_enabled ? business.crm_provider : 'off',
          },
          {
            label: 'ERP',
            value: business.erp_enabled ? business.erp_provider : 'off',
          },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '0.75rem 1rem',
              background: 'var(--surface, transparent)',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{card.label}</div>
            <div style={{ fontSize: '1.35rem', fontWeight: 600 }}>{card.value}</div>
          </div>
        ))}
      </section>

      {business.platform_crm && (
        <p className="page-muted" style={{ marginTop: 0 }}>
          Twenty workspace:{' '}
          {data?.twenty?.bound
            ? `${data.twenty.workspace_name || data.twenty.workspace_id}`
            : 'not bound yet — select CRM in Profile'}
        </p>
      )}

      <div className="ow-panels">
        <section className="ow-panel">
          <h2 className="ow-panel-title">My tasks</h2>
          <div className="ow-panel-scroll">
            {(data?.tasks || []).length === 0 ? (
              <p className="page-muted">No tasks yet. Create one on Kanban or ask an AI employee.</p>
            ) : (
              <ul className="ow-list">
                {(data.tasks || []).map((t) => (
                  <li key={t.id} className="ow-list-item">
                    <span>
                      {t.title || `Task ${t.id}`}
                      <span className="page-muted" style={{ marginLeft: 8 }}>
                        {t.status}
                      </span>
                    </span>
                    {t.assigned_agent_id && (
                      <button
                        type="button"
                        className="btn-ghost"
                        style={{ fontSize: '0.75rem' }}
                        onClick={() => openChat(t.assigned_agent_id)}
                      >
                        {t.assigned_agent_id}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="ow-panel-footer">
            <Link to="/kanban">Open Kanban →</Link>
          </div>
        </section>

        <section className="ow-panel">
          <h2 className="ow-panel-title">AI workforce</h2>
          <div className="ow-panel-scroll">
            {agents.length === 0 ? (
              <p className="page-muted">
                No AI employees entitled yet. Hire from AI Employees, or complete company setup.
              </p>
            ) : (
              <ul className="ow-list">
                {agents.map((a) => (
                  <li key={a.id} className="ow-list-item">
                    <span>
                      {a.name}
                      <span className="page-muted" style={{ marginLeft: 6 }}>
                        {a.department || a.role || ''}
                      </span>
                    </span>
                    <button type="button" className="btn-ghost" onClick={() => openChat(a.id)}>
                      Chat
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="ow-panel">
          <h2 className="ow-panel-title">Recent AI activity</h2>
          <div className="ow-panel-scroll">
            {(data?.activity || []).length === 0 ? (
              <p className="page-muted">No recent feedback activity.</p>
            ) : (
              <ul className="ow-list" style={{ fontSize: '0.85rem' }}>
                {(data.activity || []).map((row) => (
                  <li key={row.id} className="ow-list-item ow-list-item-stack">
                    <div>
                      <strong>{row.agent_id}</strong>{' '}
                      <span className="page-muted">{row.created_at}</span>
                    </div>
                    <div className="page-muted">{row.snippet}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <style>{`
        .operating-workspace {
          display: flex;
          flex-direction: column;
          min-height: calc(100vh - 4.5rem);
          max-height: calc(100vh - 4.5rem);
          overflow: hidden;
        }
        .operating-workspace .page-hero {
          flex: 0 0 auto;
        }
        .ow-panels {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1rem;
          flex: 1 1 auto;
          min-height: 12rem;
          height: min(48vh, 28rem);
          max-height: min(48vh, 28rem);
          margin-bottom: 0.75rem;
          overflow: hidden;
          align-items: stretch;
        }
        .ow-panel {
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0.85rem 1rem;
          display: flex;
          flex-direction: column;
          min-height: 0;
          height: 100%;
          max-height: 100%;
          background: var(--surface, transparent);
          overflow: hidden;
        }
        .ow-panel-title {
          font-size: 1rem;
          margin: 0 0 0.5rem;
          flex: 0 0 auto;
        }
        .ow-panel-scroll {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .ow-panel-scroll::-webkit-scrollbar {
          width: 0;
          height: 0;
          display: none;
        }
        .ow-panel-footer {
          flex: 0 0 auto;
          margin-top: 0.65rem;
          padding-top: 0.35rem;
        }
        .ow-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .ow-list-item {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 0.5rem;
          padding: 0.35rem 0;
          border-bottom: 1px solid var(--border);
          font-size: 0.9rem;
        }
        .ow-list-item-stack {
          flex-direction: column;
        }
        .operating-workspace form {
          flex: 0 0 auto;
        }
        @media (max-height: 720px) {
          .operating-workspace {
            max-height: none;
            overflow: auto;
          }
          .ow-panel {
            max-height: 42vh;
          }
        }
      `}</style>

      <form
        onSubmit={onCommand}
        style={{
          position: 'sticky',
          bottom: 12,
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '0.75rem',
          background: 'var(--bg, #0f1115)',
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
        }}
      >
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          {mentionOpen && (
            <ul
              role="listbox"
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 0,
                margin: '0 0 4px',
                padding: 0,
                listStyle: 'none',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--surface, #1a1d24)',
                maxHeight: 200,
                overflow: 'auto',
                zIndex: 20,
              }}
            >
              {mentionChoices.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => pickMention(a)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.5rem 0.75rem',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text)',
                      cursor: 'pointer',
                      font: 'inherit',
                    }}
                  >
                    <strong>{a.name}</strong>
                    <span className="page-muted" style={{ marginLeft: 8, fontSize: '0.8rem' }}>
                      @{a.id}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={inputRef}
            type="text"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setMentionOpen(false);
            }}
            placeholder="Message COO, or @mention an AI employee then Go…"
            style={{ width: '100%', boxSizing: 'border-box' }}
            disabled={busy}
            aria-autocomplete="list"
            aria-expanded={mentionOpen}
          />
          <p className="page-muted" style={{ margin: '0.35rem 0 0', fontSize: '0.75rem' }}>
            Expected: Go opens chat and sends your message. Use @ to pick who; no @ uses COO on Home.
          </p>
        </div>
        <button type="submit" className="btn-primary" disabled={busy || !cmd.trim()}>
          Go
        </button>
        <button type="button" className="btn-ghost" onClick={() => navigate('/kanban')}>
          Create task
        </button>
        <button type="button" className="btn-ghost" onClick={() => navigate('/workspace')}>
          Hire AI
        </button>
        <button type="button" className="btn-ghost" onClick={load}>
          Refresh
        </button>
      </form>
    </div>
  );
}
