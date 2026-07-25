import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import MaskedSecretInput from '../components/MaskedSecretInput';
import VaultOrLiteralSecret from '../components/VaultOrLiteralSecret';
import AddToOrgDialog from '../components/AddToOrgDialog';

const EMPTY_FORM = {
  name: '',
  description: '',
  card_url: '',
  endpoint_url: '',
  skill_id: '',
  auth_header: '',
  auth_header_ref: '',
};

function statusClass(status) {
  if (status === 'healthy') return 'mcp-pg-status-healthy';
  if (status === 'disabled') return 'mcp-pg-status-disabled';
  return 'mcp-pg-status-draft';
}

export default function ExternalAgents() {
  const { user } = useAuth();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [testMessage, setTestMessage] = useState('Hello from Agent OS');
  const [testResult, setTestResult] = useState(null);
  const [vaultKeys, setVaultKeys] = useState([]);
  const [orgMembers, setOrgMembers] = useState([]);
  const [orgDialog, setOrgDialog] = useState(null);

  useEffect(() => {
    api
      .userApiKeysList()
      .then((r) => setVaultKeys(r.keys || []))
      .catch(() => setVaultKeys([]));
  }, []);

  const loadOrgMembers = useCallback(() => {
    api
      .orgMembers()
      .then((r) => setOrgMembers(r.members || []))
      .catch(() => setOrgMembers([]));
  }, []);

  useEffect(() => {
    loadOrgMembers();
  }, [loadOrgMembers]);

  const orgMemberFor = (externalId) =>
    orgMembers.find((m) => m.kind === 'external' && m.ref_id === externalId) || null;

  const removeFromOrg = async (memberId) => {
    if (!window.confirm('Remove this agent from the org chart?')) return;
    setBusy(`org-${memberId}`);
    try {
      await api.orgMemberDelete(memberId);
      loadOrgMembers();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const load = useCallback(() => {
    setLoading(true);
    api
      .externalAgentsList()
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
      const hay = [a.name, a.description, a.id, a.endpoint_url, a.card_url, a.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [agents, search]);

  const register = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.externalAgentCreate(form);
      setModalOpen(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const discover = async (id) => {
    setBusy(`discover-${id}`);
    setError(null);
    try {
      await api.externalAgentDiscover(id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this external agent?')) return;
    setBusy(`del-${id}`);
    try {
      await api.externalAgentDelete(id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const testInvoke = async (id) => {
    setBusy(`test-${id}`);
    setTestResult(null);
    setError(null);
    try {
      const out = await api.externalAgentInvoke(id, { message: testMessage });
      setTestResult(out);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mcp-pg mcp-pg-registry">
      <header className="page-hero">
        <div className="page-hero-top">
          <div className="page-hero-titles">
            <p className="page-hero-kicker">Integrations · A2A</p>
            <h1>External Agents</h1>
          </div>
          <button type="button" className="mcp-pg-btn-primary page-hero-action" onClick={() => setModalOpen(true)}>
            + Register Agents
          </button>
        </div>
        <p className="page-hero-sub">
          Register third-party agents that speak the{' '}
          <a href="https://a2a-protocol.org/" target="_blank" rel="noreferrer">
            A2A protocol
          </a>
          . Discover their agent card, then use them in workflow <strong>External Agent (A2A)</strong> nodes.
          {user?.role === 'admin' ? ' Admin registrations can be shared platform-wide.' : ''}
        </p>
      </header>

      {error && <div className="mcp-pg-alert mcp-pg-alert-error">{error}</div>}

      <div className="mcp-pg-toolbar">
        <input
          type="search"
          className="mcp-pg-search"
          placeholder="Search external agents…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="mcp-pg-loading">
          <div className="mcp-pg-spinner" />
          <p>Loading external agents…</p>
        </div>
      ) : (
        <>
          <p className="mcp-pg-count">
            {filtered.length} agent{filtered.length === 1 ? '' : 's'}
          </p>
          <div className="mcp-pg-grid">
            {filtered.map((a) => (
              <article key={a.id} className="mcp-pg-card" style={{ cursor: 'default' }}>
                <div className="mcp-pg-card-head">
                  <div className="mcp-pg-card-icon">{a.name?.charAt(0)?.toUpperCase() || 'A'}</div>
                  <div className="mcp-pg-card-badges">
                    <span className={`mcp-pg-status ${statusClass(a.status)}`}>{a.status}</span>
                    <span className="mcp-pg-transport">A2A</span>
                  </div>
                </div>
                <h3>{a.name}</h3>
                <p className="mcp-pg-card-desc">{a.description || 'No description'}</p>
                {a.endpoint_url ? (
                  <code className="mcp-pg-card-url">{a.endpoint_url}</code>
                ) : (
                  <code className="mcp-pg-card-url">{a.id}</code>
                )}
                <div className="mcp-pg-card-meta">
                  {a.agent_card?.skills?.length > 0 && (
                    <span>{a.agent_card.skills.length} skill{a.agent_card.skills.length === 1 ? '' : 's'}</span>
                  )}
                  {a.is_shared && <span className="mcp-pg-tag platform">Platform</span>}
                  {a.is_mine && !a.is_shared && <span className="mcp-pg-tag mine">Yours</span>}
                </div>
                {a.agent_card?.skills?.length > 0 && (
                  <p className="mcp-pg-card-desc" style={{ marginTop: 0 }}>
                    Skills: {a.agent_card.skills.map((s) => s.name || s.id).filter(Boolean).join(', ')}
                  </p>
                )}
                <div className="mcp-pg-card-actions">
                  <button
                    type="button"
                    className="mcp-pg-btn-primary mcp-pg-btn-sm"
                    disabled={!!busy}
                    onClick={() => discover(a.id)}
                  >
                    {busy === `discover-${a.id}` ? 'Discovering…' : 'Discover'}
                  </button>
                  <button
                    type="button"
                    className="mcp-pg-btn-ghost mcp-pg-btn-sm"
                    disabled={!!busy}
                    onClick={() =>
                      setOrgDialog({
                        kind: 'external',
                        refId: a.id,
                        defaultName: a.name,
                        defaultPurpose: a.description || '',
                        existing: orgMemberFor(a.id),
                      })
                    }
                    title="Place this agent in your org chart so the COO can delegate to it"
                  >
                    {orgMemberFor(a.id) ? 'Edit org placement' : 'Add to org'}
                  </button>
                  {orgMemberFor(a.id) && (
                    <button
                      type="button"
                      className="mcp-pg-btn-ghost mcp-pg-btn-sm"
                      disabled={!!busy}
                      onClick={() => removeFromOrg(orgMemberFor(a.id).id)}
                    >
                      Remove from org
                    </button>
                  )}
                  <button
                    type="button"
                    className="mcp-pg-btn-ghost mcp-pg-btn-sm mcp-pg-btn-danger"
                    disabled={!!busy || !a.can_delete}
                    onClick={() => remove(a.id)}
                  >
                    Delete
                  </button>
                </div>
                {orgMemberFor(a.id) && (
                  <p className="mcp-pg-card-desc" style={{ marginTop: '0.4rem' }}>
                    In org: {orgMemberFor(a.id).department || 'Unassigned'} · reports to{' '}
                    {orgMemberFor(a.id).parent_id}
                  </p>
                )}
                {a.status === 'healthy' && (
                  <div style={{ marginTop: '0.75rem', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      value={testMessage}
                      onChange={(e) => setTestMessage(e.target.value)}
                      className="mcp-pg-search"
                      style={{ flex: 1, minWidth: 140 }}
                      placeholder="Test message"
                    />
                    <button
                      type="button"
                      className="mcp-pg-btn-primary mcp-pg-btn-sm"
                      disabled={!!busy}
                      onClick={() => testInvoke(a.id)}
                    >
                      {busy === `test-${a.id}` ? 'Sending…' : 'Test invoke'}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
          {!filtered.length && (
            <div className="mcp-pg-empty">
              <p>{agents.length ? 'No external agents match your search.' : 'No external agents registered yet.'}</p>
              <button type="button" className="mcp-pg-btn-primary" onClick={() => setModalOpen(true)}>
                Register your first agent
              </button>
            </div>
          )}
        </>
      )}

      {testResult && (
        <div className="mcp-pg-card" style={{ marginTop: '1rem', cursor: 'default' }}>
          <h3 style={{ marginTop: 0 }}>Last test result</h3>
          <pre style={{ fontSize: '0.8rem', overflow: 'auto', maxHeight: 240, margin: 0 }}>
            {JSON.stringify(testResult, null, 2)}
          </pre>
        </div>
      )}

      <p style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
        Use registered agents in the <Link to="/workflows">Workflow editor</Link> → add{' '}
        <strong>External Agent (A2A)</strong> node.
      </p>

      {orgDialog && (
        <AddToOrgDialog
          kind={orgDialog.kind}
          refId={orgDialog.refId}
          defaultName={orgDialog.defaultName}
          defaultPurpose={orgDialog.defaultPurpose}
          existing={orgDialog.existing}
          onClose={() => setOrgDialog(null)}
          onSaved={loadOrgMembers}
        />
      )}

      {modalOpen && (
        <div className="mcp-pg-modal-backdrop" onClick={() => setModalOpen(false)}>
          <form className="mcp-pg-modal" onSubmit={register} onClick={(e) => e.stopPropagation()}>
            <div className="mcp-pg-modal-header">
              <h2>Register external agent</h2>
              <button type="button" className="mcp-pg-btn-icon" onClick={() => setModalOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <label className="mcp-pg-field">
              <span>Name</span>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="mcp-pg-field">
              <span>Description</span>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <label className="mcp-pg-field">
              <span>Agent card URL (base or full)</span>
              <input
                value={form.card_url}
                onChange={(e) => setForm({ ...form, card_url: e.target.value })}
                placeholder="https://hello-world-gxfr.onrender.com"
              />
              <small className="mcp-pg-hint" style={{ margin: 0 }}>
                Tries /.well-known/agent-card.json then /.well-known/agent.json
              </small>
            </label>
            <label className="mcp-pg-field">
              <span>A2A endpoint URL (optional if in card)</span>
              <input
                value={form.endpoint_url}
                onChange={(e) => setForm({ ...form, endpoint_url: e.target.value })}
                placeholder="https://agent.example.com/"
              />
            </label>
            <label className="mcp-pg-field">
              <span>Default skill ID</span>
              <input value={form.skill_id} onChange={(e) => setForm({ ...form, skill_id: e.target.value })} />
            </label>
            <div className="mcp-pg-field">
              <VaultOrLiteralSecret
                label="Auth (Bearer token)"
                literalValue={form.auth_header}
                keyRef={form.auth_header_ref}
                onLiteralChange={(v) => setForm({ ...form, auth_header: v, auth_header_ref: '' })}
                onKeyRefChange={(v) => setForm({ ...form, auth_header_ref: v, auth_header: '' })}
                vaultKeys={vaultKeys}
                placeholder="optional"
                MaskedInput={MaskedSecretInput}
              />
            </div>
            <div className="mcp-pg-card-actions" style={{ marginTop: '0.5rem' }}>
              <button type="submit" className="mcp-pg-btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Register'}
              </button>
              <button type="button" className="mcp-pg-btn-ghost" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
