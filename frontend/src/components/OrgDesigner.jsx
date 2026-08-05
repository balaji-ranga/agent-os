import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ensureDepartmentsTable, loadDepartments, addDepartment } from '../utils/departmentsMasterData.js';
import { DEPARTMENT_PRESETS, mapOrgLeafMembersToAgents } from '../utils/orgHierarchy.js';

/**
 * Visual org designer: department columns, drag-drop agents, create dept / add agent.
 */
export default function OrgDesigner({
  agents = [],
  onChanged,
  onRemove,
}) {
  const [departments, setDepartments] = useState([...DEPARTMENT_PRESETS]);
  const [deptMeta, setDeptMeta] = useState(new Map());
  const [leafMembers, setLeafMembers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [newDept, setNewDept] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({
    name: '',
    role: '',
    department: 'Operations',
    parent_id: '',
    monthly_token_budget: '',
    error_budget_pct: '',
  });
  const [dragId, setDragId] = useState(null);

  const loadDepts = async () => {
    try {
      await ensureDepartmentsTable();
      const { departments: rows } = await loadDepartments();
      const names = (rows || []).map((d) => d.name).filter(Boolean);
      if (names.length) setDepartments(names);
      setDeptMeta(new Map((rows || []).map((d) => [d.name, d])));
    } catch (_) {
      /* presets remain */
    }
  };

  useEffect(() => {
    loadDepts();
    api
      .orgMembers()
      .then((r) => setLeafMembers(r.members || []))
      .catch(() => setLeafMembers([]));
  }, []);

  const byDept = useMemo(() => {
    const map = new Map();
    for (const d of departments) map.set(d, []);
    map.set('Unassigned', []);
    for (const a of agents) {
      const d = String(a.department || '').trim() || 'Unassigned';
      if (!map.has(d)) map.set(d, []);
      map.get(d).push({ ...a, _leaf: false });
    }
    for (const leaf of mapOrgLeafMembersToAgents(leafMembers)) {
      const d = String(leaf.department || '').trim() || 'Unassigned';
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(leaf);
    }
    return [...map.entries()];
  }, [agents, departments, leafMembers]);

  const flash = (msg) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3500);
  };

  const moveAgent = async (agentId, department) => {
    setBusy(true);
    setError(null);
    try {
      await api.agentUpdate(agentId, { department: department === 'Unassigned' ? '' : department });
      await onChanged?.();
      flash(`Moved to ${department}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setDragId(null);
    }
  };

  const createDepartment = async (e) => {
    e.preventDefault();
    const name = newDept.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await ensureDepartmentsTable();
      await addDepartment(name);
      setNewDept('');
      await loadDepts();
      flash(`Department “${name}” created`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const createAgent = async (e) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.agentCreate({
        name: draft.name.trim(),
        role: draft.role.trim() || undefined,
        department: draft.department || undefined,
        parent_id: draft.parent_id || undefined,
        monthly_token_budget: draft.monthly_token_budget || null,
        error_budget_pct: draft.error_budget_pct || null,
      });
      setShowAdd(false);
      setDraft({
        name: '',
        role: '',
        department: departments[0] || 'Operations',
        parent_id: '',
        monthly_token_budget: '',
        error_budget_pct: '',
      });
      await onChanged?.();
      flash(`Agent “${draft.name.trim()}” created`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => setShowAdd(true)}
          style={{
            padding: '0.45rem 0.9rem',
            borderRadius: 6,
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '0.85rem',
          }}
        >
          Hire AI employee
        </button>
        <form onSubmit={createDepartment} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input
            value={newDept}
            onChange={(e) => setNewDept(e.target.value)}
            placeholder="New department"
            style={{
              padding: '0.4rem 0.65rem',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '0.85rem',
            }}
          />
          <button
            type="submit"
            disabled={busy || !newDept.trim()}
            style={{
              padding: '0.4rem 0.75rem',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Create dept
          </button>
        </form>
        <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
          Drag agent tiles between departments. Changes save immediately.
        </span>
      </div>

      {error && <div style={{ color: '#f87171', marginBottom: 8, fontSize: '0.85rem' }}>{error}</div>}
      {message && <div style={{ color: '#22c55e', marginBottom: 8, fontSize: '0.85rem' }}>{message}</div>}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 12,
          alignItems: 'start',
        }}
      >
        {byDept.map(([department, members]) => (
          <div
            key={department}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/agent-id') || dragId;
              if (id) moveAgent(id, department);
            }}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '0.75rem',
              minHeight: 140,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: '0.95rem' }}>
              {department}{' '}
              <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({members.length})</span>
              {deptMeta.get(department)?.purpose && (
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 400, marginTop: 2 }}>
                  {deptMeta.get(department).purpose}
                </div>
              )}
              {deptMeta.get(department)?.monthly_token_budget != null && (
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 400 }}>
                  Budget {deptMeta.get(department).monthly_token_budget.toLocaleString()} tokens/mo
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {members.map((a) => (
                <div
                  key={a.id}
                  draggable={!a.is_coo && !a._leaf}
                  onDragStart={(e) => {
                    if (a.is_coo || a._leaf) {
                      e.preventDefault();
                      return;
                    }
                    setDragId(a.id);
                    e.dataTransfer.setData('text/agent-id', a.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  style={{
                    padding: '0.55rem 0.65rem',
                    borderRadius: 8,
                    border: a._leaf ? '1px dashed var(--border)' : '1px solid var(--border)',
                    background: 'var(--bg, #121216)',
                    cursor: a.is_coo || a._leaf ? 'default' : 'grab',
                    opacity: dragId === a.id ? 0.6 : a._leaf && !a._enabled ? 0.6 : 1,
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    {a.name}
                    {a._leaf && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: '0.65rem',
                          fontWeight: 500,
                          padding: '1px 6px',
                          borderRadius: 999,
                          border: '1px solid var(--border)',
                          color: 'var(--muted)',
                        }}
                        title="External / published A2A agent — leaf member, cannot manage others"
                      >
                        {a._kind === 'a2a_publish' ? 'A2A' : 'External'}
                      </span>
                    )}
                  </div>
                  {a.role && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{a.role}</div>
                  )}
                  {a._leaf ? (
                    <div style={{ marginTop: 6, fontSize: '0.72rem', color: 'var(--muted)' }}>
                      Reports to {a.parent_id || 'COO'} · manage on{' '}
                      {a._kind === 'a2a_publish' ? (
                        <Link to="/agent-exchange" style={{ fontSize: '0.72rem' }}>
                          AgentExchange
                        </Link>
                      ) : (
                        <Link to="/integrations/external-agents" style={{ fontSize: '0.72rem' }}>
                          External Agents
                        </Link>
                      )}
                      {' · '}
                      <button
                        type="button"
                        onClick={async () => {
                          if (
                            !window.confirm(
                              'Remove from org chart? The agent itself is not deleted. Sync org when you want AGENTS.md updated.'
                            )
                          ) {
                            return;
                          }
                          try {
                            await api.orgMemberDelete(a.id);
                            setLeafMembers((prev) => prev.filter((m) => m.id !== a.id));
                          } catch (err) {
                            setError(err?.message || 'Failed to remove from org');
                          }
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--muted)',
                          cursor: 'pointer',
                          fontSize: '0.72rem',
                          padding: 0,
                          textDecoration: 'underline',
                        }}
                      >
                        Remove from org
                      </button>
                    </div>
                  ) : (
                  <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Link to={`/agents/${a.id}/workspace`} style={{ fontSize: '0.75rem' }}>
                      Workspace
                    </Link>
                    <Link to={`/agents/${a.id}/chat`} style={{ fontSize: '0.75rem' }}>
                      Chat
                    </Link>
                    <Link to={`/agents/${a.id}/virtual-room`} style={{ fontSize: '0.75rem' }}>
                      Virtual Room
                    </Link>
                    {typeof onRemove === 'function' && !a.is_coo && (
                      <button
                        type="button"
                        onClick={() => onRemove(a.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--muted)',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          padding: 0,
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  )}
                </div>
              ))}
              {!members.length && (
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)', fontStyle: 'italic' }}>
                  Drop agents here
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: 16,
          }}
          onClick={() => !busy && setShowAdd(false)}
        >
          <form
            onSubmit={createAgent}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 420,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <h3 style={{ margin: 0 }}>Hire AI employee</h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
              Creates a digital employee in your company (isolated — not shared with other CEOs).
            </p>
            <label style={{ fontSize: '0.85rem' }}>
              Name
              <input
                required
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 4,
                  padding: '0.5rem',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg, #121216)',
                  color: 'var(--text)',
                }}
              />
            </label>
            <label style={{ fontSize: '0.85rem' }}>
              Role
              <input
                value={draft.role}
                onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 4,
                  padding: '0.5rem',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg, #121216)',
                  color: 'var(--text)',
                }}
              />
            </label>
            <label style={{ fontSize: '0.85rem' }}>
              Department
              <select
                value={draft.department}
                onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))}
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 4,
                  padding: '0.5rem',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg, #121216)',
                  color: 'var(--text)',
                }}
              >
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: '0.85rem' }}>
              Reports to
              <select
                value={draft.parent_id}
                onChange={(e) => setDraft((d) => ({ ...d, parent_id: e.target.value }))}
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 4,
                  padding: '0.5rem',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg, #121216)',
                  color: 'var(--text)',
                }}
              >
                <option value="">COO (default)</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: '0.85rem' }}>
              Monthly token budget
              <input
                type="number"
                min="0"
                value={draft.monthly_token_budget}
                onChange={(e) => setDraft((d) => ({ ...d, monthly_token_budget: e.target.value }))}
                placeholder="e.g. 500000 (leave blank for no limit)"
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 4,
                  padding: '0.5rem',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg, #121216)',
                  color: 'var(--text)',
                }}
              />
            </label>
            <label style={{ fontSize: '0.85rem' }}>
              Error budget (max monthly failure %)
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={draft.error_budget_pct}
                onChange={(e) => setDraft((d) => ({ ...d, error_budget_pct: e.target.value }))}
                placeholder="e.g. 5"
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 4,
                  padding: '0.5rem',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg, #121216)',
                  color: 'var(--text)',
                }}
              />
            </label>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted)' }}>
              You get a warning at 80% of either budget; new delegated or chat work is blocked at
              100% until next month or a higher budget.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                disabled={busy}
                style={{
                  padding: '0.45rem 0.9rem',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                style={{
                  padding: '0.45rem 0.9rem',
                  borderRadius: 6,
                  border: 'none',
                  background: 'var(--accent)',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                {busy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
