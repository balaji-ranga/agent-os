import { useState } from 'react';
import { api } from '../api';
import DepartmentPicker from './DepartmentPicker';

/**
 * Create a CEO-owned OpenClaw agent (tenant + org chart parent).
 * Used from Agent Workspaces; Org chart Design mode has its own modal.
 */
export default function AddAgentForm({ agents = [], onCreated, compact = false }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [department, setDepartment] = useState('Operations');
  const [parentId, setParentId] = useState('');
  const [tokenBudget, setTokenBudget] = useState('');
  const [errorBudget, setErrorBudget] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const inputStyle = {
    padding: '0.5rem 0.75rem',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text)',
    minWidth: compact ? 140 : 160,
    width: compact ? undefined : '100%',
    maxWidth: compact ? undefined : 280,
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setMessage(null);
    setError(null);
    setSubmitting(true);
    const coo = agents.find((a) => a.is_coo);
    const body = {
      name: name.trim(),
      role: role.trim() || 'Agent',
      department: department.trim() || '',
      monthly_token_budget: tokenBudget || null,
      error_budget_pct: errorBudget || null,
      parent_id: parentId || coo?.id || undefined,
    };
    api
      .agentCreate(body)
      .then((agent) => {
        setName('');
        setRole('');
        setParentId('');
        setDepartment('Operations');
        setTokenBudget('');
        setErrorBudget('');
        setMessage(
          `"${agent.name}" added` +
            (agent.department ? ` · ${agent.department}` : '') +
            (agent.openclaw_runtime_id ? ` (${agent.openclaw_runtime_id})` : '') +
            '. Grant tools in the agent workspace if needed.'
        );
        onCreated?.(agent);
        setTimeout(() => setMessage(null), 12000);
      })
      .catch((err) => setError(err.message || 'Failed to add agent'))
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="add-agent-form">
      <form
        onSubmit={onSubmit}
        className={compact ? 'add-agent-form-fields compact' : 'add-agent-form-fields'}
      >
        <input
          type="text"
          placeholder="Agent name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          aria-label="Agent name"
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="Role (optional)"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          aria-label="Role"
          style={inputStyle}
        />
        <DepartmentPicker
          value={department}
          onChange={setDepartment}
          compact
          ariaLabel="Department"
          selectStyle={{ background: 'var(--surface)', ...inputStyle, minWidth: 140 }}
        />
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          aria-label="Reports to"
          style={{ ...inputStyle, minWidth: 160 }}
        >
          <option value="">Reports to (COO default)</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.is_coo ? ' (COO)' : ''}
              {a.department ? ` · ${a.department}` : ''}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          placeholder="Monthly tokens"
          title="Monthly token budget — warn at 80%, block new work at 100%"
          value={tokenBudget}
          onChange={(e) => setTokenBudget(e.target.value)}
          aria-label="Monthly token budget"
          style={{ ...inputStyle, width: compact ? 150 : undefined, minWidth: 130 }}
        />
        <input
          type="number"
          min="0"
          max="100"
          step="0.5"
          placeholder="Error budget %"
          title="Max monthly failure rate before new work is blocked"
          value={errorBudget}
          onChange={(e) => setErrorBudget(e.target.value)}
          aria-label="Error budget percent"
          style={{ ...inputStyle, width: compact ? 130 : undefined, minWidth: 120 }}
        />
        <button type="submit" className="btn-primary" disabled={submitting || !name.trim()}>
          {submitting ? 'Adding…' : 'Add agent'}
        </button>
      </form>
      {error && (
        <p className="form-status form-status-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <div className="form-status form-status-ok" role="status">
          <span>{message}</span>
          <button type="button" className="btn-ghost" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
