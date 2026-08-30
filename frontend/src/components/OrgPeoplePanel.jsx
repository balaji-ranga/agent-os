import { useEffect, useState } from 'react';
import { api } from '../api';
import { isTenantFullAccess } from '../utils/orgAccess.js';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

export default function OrgPeoplePanel({ agents = [] }) {
  const { user } = useAuth();
  const canManage = isTenantFullAccess(user);
  const [people, setPeople] = useState([]);
  const [roles, setRoles] = useState([]);
  const [catalog, setCatalog] = useState({ groups: [], always_on: [] });
  const [selectedId, setSelectedId] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState({ name: '', email: '', mobile: '', department: '', org_role_id: '', parent_id: '' });
  const [newRoleName, setNewRoleName] = useState('');

  const load = async () => {
    const [p, r, c] = await Promise.all([
      api.orgPeople(),
      canManage ? api.orgPeopleRoles().catch(() => ({ roles: [] })) : { roles: [] },
      api.orgPeopleCatalog().catch(() => ({ groups: [], always_on: [] })),
    ]);
    setPeople(p.people || []);
    setRoles(r.roles || []);
    setCatalog(c);
    setSelectedId((cur) => cur || p.people?.[0]?.id || '');
    setSelectedRoleId((cur) => cur || r.roles?.find((x) => !x.is_ceo_delegate)?.id || r.roles?.[0]?.id || '');
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [canManage]);

  const flash = (msg) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3500);
  };

  const selected = people.find((p) => p.id === selectedId) || null;
  const selectedRole = roles.find((r) => r.id === selectedRoleId) || null;
  const departments = [...new Set(agents.map((a) => a.department).filter(Boolean))];

  const submitInvite = async (e) => {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api.orgPeopleInvite(invite);
      await load();
      setSelectedId(out.person?.id || '');
      setInvite({ name: '', email: '', mobile: '', department: invite.department, org_role_id: '', parent_id: '' });
      flash(out.invite?.emailed ? 'Invite email sent' : 'Employee added (invite email could not be sent — check SMTP)');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const savePerson = async (patch) => {
    if (!selected || !canManage) return;
    const personId = selected.id;
    setBusy(true);
    setError(null);
    try {
      await api.orgPeopleUpdate(personId, patch);
      // Do not reload the full collection here. A blur save for one field can
      // finish while the user is already editing the next field; replacing the
      // collection with that older response would erase the newer draft before
      // its blur event can persist it. Merge only the fields this request owns.
      setPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, ...patch } : p)));
      flash('Saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const togglePerm = async (key) => {
    if (!selectedRole || selectedRole.is_ceo_delegate || !canManage) return;
    const next = new Set(selectedRole.permissions || []);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setBusy(true);
    try {
      await api.orgPeopleRoleUpdate(selectedRole.id, { permissions: [...next] });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(280px, 1.4fr)', gap: 16 }}>
      <section>
        <h3 style={{ marginTop: 0 }}>Employees</h3>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
          Sub-users of this company. They inherit the CEO (root) entitlements — tools, knowledge, and AgentSystem workspaces stay on the company.
        </p>
        {canManage && (
          <form onSubmit={submitInvite} style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
            <input
              required
              placeholder="Employee name"
              value={invite.name}
              onChange={(e) => setInvite({ ...invite, name: e.target.value })}
            />
            <input
              required
              type="email"
              placeholder="Email"
              value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })}
            />
            <input
              placeholder="Phone"
              value={invite.mobile}
              onChange={(e) => setInvite({ ...invite, mobile: e.target.value })}
            />
            <select
              value={invite.department}
              onChange={(e) => setInvite({ ...invite, department: e.target.value })}
            >
              <option value="">Department (optional)</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <button type="submit" disabled={busy}>
              Add employee & send password link
            </button>
          </form>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {people.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              style={{
                textAlign: 'left',
                padding: '0.55rem 0.7rem',
                borderRadius: 8,
                border: p.id === selectedId ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: p.id === selectedId ? 'var(--surface-2, transparent)' : 'transparent',
              }}
            >
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                {p.email} · {p.org_role_name || 'Member'} · {p.department || 'No dept'}
                {!p.enabled ? ' · disabled' : ''}
              </div>
            </button>
          ))}
          {!people.length && <p style={{ color: 'var(--muted)' }}>No employees yet.</p>}
        </div>
      </section>

      <section>
        {error && <div style={{ color: '#f87171', marginBottom: 8 }}>{error}</div>}
        {message && <div style={{ color: '#22c55e', marginBottom: 8 }}>{message}</div>}
        {selected && (
          <>
            <h3 style={{ marginTop: 0 }}>{selected.name}</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{selected.email}</p>
            {!selected.is_self && selected.id !== user?.id && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                <Link className="button-link" to={`/people/${encodeURIComponent(selected.id)}/chat`}>Chat with {selected.name}</Link>
                <button type="button" onClick={async () => { try { const out = await api.humanVoiceInvite(selected.id); await navigator.clipboard.writeText(out.url); window.open(out.url, '_blank', 'noopener,noreferrer'); flash('Short-lived voice link copied'); } catch (e) { setError(e.message); } }}>Voice call link</button>
              </div>
            )}
            {canManage && (
              <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
                <label>
                  Role
                  <select
                    value={selected.org_role_id || ''}
                    onChange={(e) => savePerson({ org_role_id: e.target.value })}
                  >
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Department
                  <select
                    value={selected.department || ''}
                    onChange={(e) => savePerson({ department: e.target.value })}
                  >
                    <option value="">Unassigned</option>
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label>Specialty<input value={selected.specialty || ''} onChange={(e) => setPeople((prev) => prev.map((p) => p.id === selected.id ? { ...p, specialty: e.target.value } : p))} onBlur={(e) => savePerson({ specialty: e.target.value })} placeholder="e.g. enterprise collections" /></label>
                <label>Purpose<input value={selected.purpose || ''} onChange={(e) => setPeople((prev) => prev.map((p) => p.id === selected.id ? { ...p, purpose: e.target.value } : p))} onBlur={(e) => savePerson({ purpose: e.target.value })} placeholder="What this employee owns" /></label>
                <label>
                  Reports to
                  <select
                    value={selected.parent_id || ''}
                    onChange={(e) => savePerson({ parent_id: e.target.value })}
                  >
                    <option value="">COO (default)</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" disabled={busy} onClick={() => api.orgPeopleResendInvite(selected.id).then(() => flash('Invite resent')).catch((e) => setError(e.message))}>
                    Resend password link
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => savePerson({ enabled: !selected.enabled })}
                  >
                    {selected.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {canManage && (
          <>
            <h3>Roles & permissions</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
              CEO Delegate has full company access. Custom roles cannot manage people. Home, Kanban, and Profile are always on. Agent chat controls access to the COO and same-department AI employees.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {roles.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRoleId(r.id)}
                  style={{
                    border: r.id === selectedRoleId ? '1px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius: 999,
                    padding: '0.25rem 0.7rem',
                  }}
                >
                  {r.name}
                </button>
              ))}
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newRoleName.trim()) return;
                setBusy(true);
                try {
                  const out = await api.orgPeopleRoleCreate({ name: newRoleName.trim(), permissions: [] });
                  setNewRoleName('');
                  await load();
                  if (out.role?.id) setSelectedRoleId(out.role.id);
                } catch (err) {
                  setError(err.message);
                } finally {
                  setBusy(false);
                }
              }}
              style={{ display: 'flex', gap: 8, marginBottom: 12 }}
            >
              <input
                placeholder="New role name"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
              />
              <button type="submit" disabled={busy}>
                Create role
              </button>
            </form>
            {selectedRole && (
              <div>
                {selectedRole.is_ceo_delegate ? (
                  <p>This role is on par with the CEO across the company (except platform Admin).</p>
                ) : (
                  (catalog.groups || []).map((g) => (
                    <div key={g.id} style={{ marginBottom: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>{g.label}</div>
                      {(g.keys || []).map((key) => (
                        <label key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}>
                          <input
                            type="checkbox"
                            checked={(selectedRole.permissions || []).includes(key)}
                            onChange={() => togglePerm(key)}
                          />
                          {key}
                        </label>
                      ))}
                    </div>
                  ))
                )}
                {!selectedRole.is_builtin && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm('Delete this role? Employees on it become Members.')) return;
                      await api.orgPeopleRoleDelete(selectedRole.id);
                      await load();
                    }}
                  >
                    Delete role
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
