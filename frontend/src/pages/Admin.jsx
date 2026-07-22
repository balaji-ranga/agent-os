import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth, RequireAuth } from '../context/AuthContext';
import ActionFeedbackBanner from '../components/ActionFeedbackBanner';
import { useActionFeedback } from '../hooks/useActionFeedback';

const USERS_PAGE_SIZE = 10;

function AdminPanel() {
  const { logout, impersonateUser } = useAuth();
  const navigate = useNavigate();
  const { feedback, showSuccess, showError, clearFeedback } = useActionFeedback();
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [userPage, setUserPage] = useState(0);
  const [selected, setSelected] = useState(null);
  const [selectedAgents, setSelectedAgents] = useState([]);
  const [impersonatingUserId, setImpersonatingUserId] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', region: '', mobile: '', db_mode: 'tenant' });
  const [notifyForm, setNotifyForm] = useState({
    title: '',
    body: '',
    link_url: '',
    scope: 'all',
    user_ids: [],
  });
  const [notifySending, setNotifySending] = useState(false);
  const [ocConsoleBusy, setOcConsoleBusy] = useState(false);
  const [offboardBusy, setOffboardBusy] = useState(false);
  const [offboardConfirmEmail, setOffboardConfirmEmail] = useState('');
  const [refreshForm, setRefreshForm] = useState({
    scope: 'all',
    user_ids: [],
    force_identity_md: true,
    sync_org: true,
    regrant_defaults: true,
  });
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null);

  const load = () => {
    api.adminUsers()
      .then((r) => setUsers(r.users || []))
      .catch((e) => showError(e.message || 'Failed to load users'));
  };

  useEffect(() => {
    load();
  }, []);

  const loadUser = (userId) => {
    api.adminUserGet(userId).then((r) => {
      setSelected(r.user);
      setSelectedAgents(r.agents || []);
      setOffboardConfirmEmail('');
    });
  };

  const toggleUser = async (userId, enabled) => {
    try {
      await api.adminUserSetEnabled(userId, enabled);
      showSuccess(enabled ? 'User enabled.' : 'User disabled.');
      load();
      if (selected?.id === userId) loadUser(userId);
    } catch (err) {
      showError(err.message || 'Failed to update user');
    }
  };

  const offboardSelectedUser = async () => {
    if (!selected) return;
    const email = String(offboardConfirmEmail || '').trim();
    if (!email || email.toLowerCase() !== String(selected.email || '').toLowerCase()) {
      showError('Type the user email exactly to confirm offboard.');
      return;
    }
    const ok = window.confirm(
      `Permanently offboard ${selected.name} (${selected.email})?\n\nThis deletes standups, workflow schedules, workflows, grants, tenant DB, and the user account. This cannot be undone.`
    );
    if (!ok) return;
    setOffboardBusy(true);
    try {
      await api.adminUserOffboard(selected.id, { confirm_email: email });
      showSuccess(`Offboarded ${selected.name}. Associated data and schedules removed.`);
      setSelected(null);
      setSelectedAgents([]);
      setOffboardConfirmEmail('');
      load();
    } catch (err) {
      showError(err.message || 'Offboard failed');
    } finally {
      setOffboardBusy(false);
    }
  };

  const registerUser = async (e) => {
    e.preventDefault();
    try {
      await api.adminRegisterUser(form);
      setForm({ name: '', email: '', password: '', region: '', mobile: '', db_mode: 'tenant' });
      load();
      showSuccess('User registered successfully.');
    } catch (err) {
      showError(err.message || 'Failed to register user');
    }
  };

  const toggleAgent = async (agentId, enabled) => {
    if (!selected) return;
    try {
      if (enabled) await api.adminEnableAgent(selected.id, agentId);
      else await api.adminDisableAgent(selected.id, agentId);
      loadUser(selected.id);
      showSuccess(enabled ? 'Agent access granted.' : 'Agent access revoked.');
    } catch (err) {
      showError(err.message || 'Failed to update agent access');
    }
  };

  const toggleNotifyUser = (userId) => {
    setNotifyForm((prev) => {
      const has = prev.user_ids.includes(userId);
      return {
        ...prev,
        user_ids: has ? prev.user_ids.filter((id) => id !== userId) : [...prev.user_ids, userId],
      };
    });
  };

  const sendNotification = async (e) => {
    e.preventDefault();
    setNotifySending(true);
    try {
      const result = await api.adminSendNotifications({
        title: notifyForm.title,
        body: notifyForm.body,
        link_url: notifyForm.link_url,
        all_users: notifyForm.scope === 'all',
        user_ids: notifyForm.scope === 'selected' ? notifyForm.user_ids : [],
      });
      setNotifyForm({ title: '', body: '', link_url: '', scope: 'all', user_ids: [] });
      showSuccess(`Notification sent to ${result.sent} user${result.sent === 1 ? '' : 's'}.`);
    } catch (err) {
      showError(err.message || 'Failed to send notification');
    } finally {
      setNotifySending(false);
    }
  };

  const toggleRefreshUser = (userId) => {
    setRefreshForm((prev) => {
      const has = prev.user_ids.includes(userId);
      return {
        ...prev,
        user_ids: has ? prev.user_ids.filter((id) => id !== userId) : [...prev.user_ids, userId],
      };
    });
  };

  const refreshDefaultAgents = async (e) => {
    e.preventDefault();
    setRefreshBusy(true);
    setRefreshResult(null);
    try {
      const result = await api.adminRefreshDefaultAgents({
        all_users: refreshForm.scope === 'all',
        user_ids: refreshForm.scope === 'selected' ? refreshForm.user_ids : [],
        force_identity_md: refreshForm.force_identity_md,
        sync_org: refreshForm.sync_org,
        regrant_defaults: refreshForm.regrant_defaults,
      });
      setRefreshResult(result);
      showSuccess(
        `Default agents refreshed for ${result.users_ok}/${result.users_targeted} CEO(s)` +
          (result.users_failed ? ` (${result.users_failed} failed)` : '')
      );
    } catch (err) {
      showError(err.message || 'Failed to refresh default agents');
    } finally {
      setRefreshBusy(false);
    }
  };

  const viewAsUser = async (userId) => {
    setImpersonatingUserId(userId);
    try {
      const viewedUser = await impersonateUser(userId);
      showSuccess(`Now viewing as ${viewedUser.name}.`);
      navigate(viewedUser.role === 'ceo' ? '/' : '/admin');
    } catch (err) {
      showError(err.message || 'Failed to open user view');
    } finally {
      setImpersonatingUserId(null);
    }
  };

  const openOpenConnectorConsole = async () => {
    setOcConsoleBusy(true);
    try {
      const data = await api.openconnectorConsoleLaunch();
      const url = data.url || '/openconnector/';
      // Same-tab navigation is more reliable for Set-Cookie + oc_launch than a blocked popup.
      window.location.assign(url);
    } catch (err) {
      showError(err.message || 'Failed to launch OpenConnector console');
      setOcConsoleBusy(false);
    }
  };

  const enabledUsers = users.filter((u) => u.enabled);
  const enabledCeos = enabledUsers.filter((u) => u.role === 'ceo');

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const hay = [u.name, u.email, u.role, u.id, u.region, u.mobile, u.industry, u.business_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [users, userSearch]);

  const userPageCount = Math.max(1, Math.ceil(filteredUsers.length / USERS_PAGE_SIZE));
  const safeUserPage = Math.min(userPage, userPageCount - 1);
  const pagedUsers = filteredUsers.slice(
    safeUserPage * USERS_PAGE_SIZE,
    safeUserPage * USERS_PAGE_SIZE + USERS_PAGE_SIZE
  );
  const userRangeStart = filteredUsers.length === 0 ? 0 : safeUserPage * USERS_PAGE_SIZE + 1;
  const userRangeEnd = Math.min((safeUserPage + 1) * USERS_PAGE_SIZE, filteredUsers.length);

  useEffect(() => {
    setUserPage(0);
  }, [userSearch]);

  return (
    <div className="mcp-pg">
      <ActionFeedbackBanner feedback={feedback} onDismiss={clearFeedback} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Admin</h1>
        <div className="admin-toolbar" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Link to="/connectors" className="wf-btn">Connectors</Link>
          <button
            type="button"
            className="wf-btn"
            disabled={ocConsoleBusy}
            onClick={openOpenConnectorConsole}
          >
            {ocConsoleBusy ? 'Opening…' : 'OpenConnector console'}
          </button>
          <Link to="/integrations/mcp" className="wf-btn">MCP Integrations</Link>
          <Link to="/" className="wf-btn">Dashboard</Link>
          <button type="button" className="wf-btn wf-btn-danger" onClick={logout}>
            Logout
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <section>
          <h2>Users</h2>
          <div className="mcp-pg-toolbar" style={{ marginBottom: '0.75rem' }}>
            <input
              type="search"
              className="mcp-pg-search"
              placeholder="Search users by name, email, role…"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              aria-label="Search users"
            />
          </div>
          <p className="mcp-pg-count" style={{ marginTop: 0 }}>
            {filteredUsers.length === 0
              ? 'No users match'
              : `Showing ${userRangeStart}–${userRangeEnd} of ${filteredUsers.length}`}
            {userSearch.trim() ? ` (filtered from ${users.length})` : ''}
          </p>
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {pagedUsers.map((u) => (
              <div
                key={u.id}
                onClick={() => loadUser(u.id)}
                style={{
                  padding: '0.65rem 0.85rem',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: selected?.id === u.id ? 'rgba(124,58,237,0.12)' : 'transparent',
                }}
              >
                <div style={{ fontWeight: 600 }}>{u.name} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({u.role})</span></div>
                <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{u.email}</div>
                {u.role === 'ceo' && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: 2 }}>
                    DB: {u.ceo_db_mode === 'shared' ? 'shared platform' : 'dedicated tenant'}
                  </div>
                )}
                <div style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', color: u.enabled ? '#22c55e' : '#f87171' }}>{u.enabled ? 'Enabled' : 'Disabled'}</span>
                  {u.enabled && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        viewAsUser(u.id);
                      }}
                      disabled={impersonatingUserId === u.id}
                      style={{ fontSize: '0.75rem', padding: '0.15rem 0.45rem', borderRadius: 4, border: '1px solid var(--accent)', background: 'rgba(124,58,237,0.12)', color: 'var(--accent)', cursor: 'pointer' }}
                    >
                      {impersonatingUserId === u.id ? 'Opening…' : 'View as user'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleUser(u.id, !u.enabled);
                    }}
                    style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem', borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer' }}
                  >
                    {u.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            ))}
            {!pagedUsers.length && (
              <div style={{ padding: '0.85rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
                {users.length ? 'No users match your search.' : 'No users yet.'}
              </div>
            )}
          </div>
          {filteredUsers.length > USERS_PAGE_SIZE && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: '0.65rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="wf-btn"
                disabled={safeUserPage <= 0}
                onClick={() => setUserPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                Page {safeUserPage + 1} of {userPageCount}
              </span>
              <button
                type="button"
                className="wf-btn"
                disabled={safeUserPage >= userPageCount - 1}
                onClick={() => setUserPage((p) => Math.min(userPageCount - 1, p + 1))}
              >
                Next
              </button>
            </div>
          )}

          <h3 style={{ marginTop: '1.5rem' }}>Register CEO user</h3>
          <form onSubmit={registerUser} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={{ padding: '0.45rem', borderRadius: 6, border: '1px solid var(--border)' }} />
            <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required style={{ padding: '0.45rem', borderRadius: 6, border: '1px solid var(--border)' }} />
            <input placeholder="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required style={{ padding: '0.45rem', borderRadius: 6, border: '1px solid var(--border)' }} />
            <input placeholder="Region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} style={{ padding: '0.45rem', borderRadius: 6, border: '1px solid var(--border)' }} />
            <input placeholder="Mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} style={{ padding: '0.45rem', borderRadius: 6, border: '1px solid var(--border)' }} />
            <select value={form.db_mode} onChange={(e) => setForm({ ...form, db_mode: e.target.value })} style={{ padding: '0.45rem', borderRadius: 6, border: '1px solid var(--border)' }}>
              <option value="tenant">Dedicated tenant DB</option>
              <option value="shared">Shared platform DB</option>
            </select>
            <button type="submit" style={{ padding: '0.5rem', borderRadius: 6, background: 'var(--accent)', color: '#fff', border: 'none' }}>Register user</button>
          </form>
        </section>

        <section>
          <h2>User details {selected ? `— ${selected.name}` : ''}</h2>
          {!selected && (
            <p style={{ color: 'var(--muted)' }}>
              Select a user to open their platform view (sudo) or manage which agents they can use.
            </p>
          )}
          {selected && (
            <>
              <div
                style={{
                  padding: '0.85rem',
                  marginBottom: '1rem',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'rgba(124,58,237,0.08)',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{selected.name}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{selected.email}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 4 }}>
                  Role: {selected.role}
                  {selected.role === 'ceo' && (
                    <> · DB: {selected.ceo_db_mode === 'shared' ? 'shared platform' : 'dedicated tenant'}</>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!selected.enabled || impersonatingUserId === selected.id}
                  onClick={() => viewAsUser(selected.id)}
                  style={{
                    marginTop: 10,
                    padding: '0.45rem 0.85rem',
                    borderRadius: 6,
                    background: 'var(--accent)',
                    color: '#fff',
                    border: 'none',
                    cursor: selected.enabled && impersonatingUserId !== selected.id ? 'pointer' : 'not-allowed',
                    opacity: selected.enabled ? 1 : 0.55,
                  }}
                >
                  {impersonatingUserId === selected.id ? 'Opening…' : 'View platform as this user'}
                </button>
                {!selected.enabled && (
                  <p style={{ fontSize: '0.8rem', color: '#f87171', margin: '0.5rem 0 0' }}>
                    Enable the user before opening their platform view.
                  </p>
                )}

                {selected.role === 'ceo' && (
                  <div
                    style={{
                      marginTop: '1rem',
                      padding: '0.85rem',
                      border: '1px solid rgba(248,113,113,0.45)',
                      borderRadius: 8,
                      background: 'rgba(248,113,113,0.08)',
                    }}
                  >
                    <div style={{ fontWeight: 650, marginBottom: 6, color: '#b91c1c' }}>Offboard user</div>
                    <p style={{ margin: '0 0 0.65rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
                      Permanently remove this CEO and all associated data: standups, workflow schedules, workflows,
                      agent grants, notifications, tenant DB, Master Data files, and OpenClaw tenant workspaces.
                      Protected accounts (Balaji Ranganathan, Admin, Aru, Senthil Loganathan) cannot be offboarded.
                    </p>
                    <input
                      type="email"
                      placeholder={`Type ${selected.email} to confirm`}
                      value={offboardConfirmEmail}
                      onChange={(e) => setOffboardConfirmEmail(e.target.value)}
                      disabled={offboardBusy}
                      style={{
                        width: '100%',
                        padding: '0.45rem 0.6rem',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        marginBottom: 8,
                        boxSizing: 'border-box',
                      }}
                    />
                    <button
                      type="button"
                      className="wf-btn wf-btn-danger"
                      disabled={
                        offboardBusy ||
                        String(offboardConfirmEmail).trim().toLowerCase() !==
                          String(selected.email || '').trim().toLowerCase()
                      }
                      onClick={offboardSelectedUser}
                    >
                      {offboardBusy ? 'Offboarding…' : 'Offboard & delete all data'}
                    </button>
                  </div>
                )}
              </div>

              <h3 style={{ marginTop: 0 }}>Agent access</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 0 }}>
                Grant or revoke which agents this user can chat with and delegate work to.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selectedAgents.map((a) => (
                  <div key={a.agent_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 6 }}>
                    <div>
                      <strong>{a.name}</strong>
                      <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--muted)' }}>{a.agent_type || 'standard'}</span>
                    </div>
                    <button type="button" onClick={() => toggleAgent(a.agent_id, !a.enabled)} style={{ padding: '0.25rem 0.5rem', borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer' }}>
                      {a.enabled ? 'Revoke' : 'Grant'}
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  api.adminGrantStandardAgents(selected.id)
                    .then(() => {
                      loadUser(selected.id);
                      showSuccess('Standard agents re-granted.');
                    })
                    .catch((err) => showError(err.message || 'Failed to re-grant agents'))
                }
                style={{ marginTop: 12, padding: '0.4rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}
              >
                Re-grant all standard agents
              </button>
            </>
          )}
        </section>
      </div>

      <section style={{ marginTop: '2rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Refresh default agents</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: 0 }}>
          Push template MD files (TOOLS, AGENTS, SOUL, MEMORY, IDENTITY) and tool allowlists for{' '}
          <strong>COO</strong>, <strong>Workflow Builder</strong>, and <strong>Platform Help</strong> into each CEO&apos;s
          tenant OpenClaw workspace. Use after updating <code>openclaw-workspace-templates/</code> or tool grants.
        </p>
        <form onSubmit={refreshDefaultAgents} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
          <fieldset style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '0.65rem 0.85rem', margin: 0 }}>
            <legend style={{ fontSize: '0.85rem', padding: '0 0.35rem' }}>Target CEOs</legend>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                name="refresh-scope"
                checked={refreshForm.scope === 'all'}
                onChange={() => setRefreshForm({ ...refreshForm, scope: 'all', user_ids: [] })}
              />
              All enabled CEOs ({enabledCeos.length})
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="radio"
                name="refresh-scope"
                checked={refreshForm.scope === 'selected'}
                onChange={() => setRefreshForm({ ...refreshForm, scope: 'selected' })}
              />
              Selected CEOs
            </label>
          </fieldset>
          {refreshForm.scope === 'selected' && (
            <div
              style={{
                maxHeight: 180,
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '0.5rem',
              }}
            >
              {enabledCeos.map((u) => (
                <label
                  key={u.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.25rem 0', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={refreshForm.user_ids.includes(u.id)}
                    onChange={() => toggleRefreshUser(u.id)}
                  />
                  <span>
                    {u.name} <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>({u.email})</span>
                  </span>
                </label>
              ))}
              {!enabledCeos.length && (
                <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>No enabled CEO users.</div>
              )}
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={refreshForm.force_identity_md}
              onChange={(e) => setRefreshForm({ ...refreshForm, force_identity_md: e.target.checked })}
            />
            Overwrite SOUL / MEMORY / IDENTITY from templates
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={refreshForm.sync_org}
              onChange={(e) => setRefreshForm({ ...refreshForm, sync_org: e.target.checked })}
            />
            Rebuild ORG.md (and COO AGENTS.md) per CEO
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={refreshForm.regrant_defaults}
              onChange={(e) => setRefreshForm({ ...refreshForm, regrant_defaults: e.target.checked })}
            />
            Re-grant default agent entitlements
          </label>
          <button
            type="submit"
            disabled={refreshBusy || (refreshForm.scope === 'selected' && refreshForm.user_ids.length === 0)}
            style={{
              padding: '0.5rem',
              borderRadius: 6,
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              cursor: refreshBusy ? 'wait' : 'pointer',
              opacity:
                refreshBusy || (refreshForm.scope === 'selected' && refreshForm.user_ids.length === 0) ? 0.65 : 1,
            }}
          >
            {refreshBusy ? 'Refreshing…' : 'Refresh default agents'}
          </button>
        </form>
        {refreshResult && (
          <pre
            style={{
              marginTop: 12,
              padding: '0.75rem',
              borderRadius: 8,
              background: 'var(--bg, #121216)',
              border: '1px solid var(--border)',
              fontSize: '0.75rem',
              maxHeight: 220,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {JSON.stringify(
              {
                users_ok: refreshResult.users_ok,
                users_failed: refreshResult.users_failed,
                default_agent_ids: refreshResult.default_agent_ids,
                failures: (refreshResult.results || [])
                  .filter((r) => r.error)
                  .map((r) => ({ user_id: r.user_id, error: r.error })),
              },
              null,
              2
            )}
          </pre>
        )}
      </section>

      <section style={{ marginTop: '2rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Send notification</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: 0 }}>
          Deliver an in-app notification to all enabled users or a selected subset. Recipients see it in the bell icon.
        </p>
        <form onSubmit={sendNotification} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
          <input
            placeholder="Title"
            value={notifyForm.title}
            onChange={(e) => setNotifyForm({ ...notifyForm, title: e.target.value })}
            required
            style={{ padding: '0.45rem', borderRadius: 6, border: '1px solid var(--border)' }}
          />
          <textarea
            placeholder="Message (optional)"
            value={notifyForm.body}
            onChange={(e) => setNotifyForm({ ...notifyForm, body: e.target.value })}
            rows={4}
            style={{ padding: '0.45rem', borderRadius: 6, border: '1px solid var(--border)', resize: 'vertical' }}
          />
          <input
            placeholder="Link URL (optional, e.g. /workflows or https://…)"
            value={notifyForm.link_url}
            onChange={(e) => setNotifyForm({ ...notifyForm, link_url: e.target.value })}
            style={{ padding: '0.45rem', borderRadius: 6, border: '1px solid var(--border)' }}
          />
          <fieldset style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '0.65rem 0.85rem', margin: 0 }}>
            <legend style={{ fontSize: '0.85rem', padding: '0 0.35rem' }}>Recipients</legend>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                name="notify-scope"
                checked={notifyForm.scope === 'all'}
                onChange={() => setNotifyForm({ ...notifyForm, scope: 'all', user_ids: [] })}
              />
              All enabled users ({enabledUsers.length})
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="radio"
                name="notify-scope"
                checked={notifyForm.scope === 'selected'}
                onChange={() => setNotifyForm({ ...notifyForm, scope: 'selected' })}
              />
              Selected users
            </label>
          </fieldset>
          {notifyForm.scope === 'selected' && (
            <div
              style={{
                maxHeight: 180,
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '0.5rem',
              }}
            >
              {enabledUsers.map((u) => (
                <label
                  key={u.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.25rem 0', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={notifyForm.user_ids.includes(u.id)}
                    onChange={() => toggleNotifyUser(u.id)}
                  />
                  <span>
                    {u.name} <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>({u.role})</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <button
            type="submit"
            disabled={notifySending || (notifyForm.scope === 'selected' && notifyForm.user_ids.length === 0)}
            style={{
              padding: '0.5rem',
              borderRadius: 6,
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              cursor: notifySending ? 'wait' : 'pointer',
              opacity: notifySending || (notifyForm.scope === 'selected' && notifyForm.user_ids.length === 0) ? 0.65 : 1,
            }}
          >
            {notifySending ? 'Sending…' : 'Send notification'}
          </button>
        </form>
      </section>
    </div>
  );
}

export default function Admin() {
  return (
    <RequireAuth role="admin">
      <AdminPanel />
    </RequireAuth>
  );
}
