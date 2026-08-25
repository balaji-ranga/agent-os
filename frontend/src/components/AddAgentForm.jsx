import { useEffect, useState } from 'react';
import { api } from '../api';
import DepartmentPicker from './DepartmentPicker';
import AgentAvatarPicker from './AgentAvatarPicker.jsx';

/**
 * Hire a CEO-owned AI employee (OpenClaw agent under the tenant + org chart).
 * Used from AI Employees; Org chart Design mode has its own modal.
 */
export default function AddAgentForm({ agents = [], onCreated, compact = false }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [hireTemplateId, setHireTemplateId] = useState('');
  const [hireTemplates, setHireTemplates] = useState([]);
  const [department, setDepartment] = useState('Operations');
  const [parentId, setParentId] = useState('');
  const [tokenBudget, setTokenBudget] = useState('');
  const [errorBudget, setErrorBudget] = useState('');
  const [hourlyRate, setHourlyRate] = useState('10');
  const [avatarImage, setAvatarImage] = useState('');
  const [isOrchestrator, setIsOrchestrator] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .agentHireTemplates()
      .then((r) => setHireTemplates(Array.isArray(r?.templates) ? r.templates : []))
      .catch(() => setHireTemplates([]));
  }, []);

  const selectedHire = hireTemplates.find((t) => t.id === hireTemplateId) || null;

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
      role: role.trim() || selectedHire?.role || 'AI employee',
      department: department.trim() || selectedHire?.department || '',
      monthly_token_budget: tokenBudget || null,
      error_budget_pct: errorBudget || null,
      hourly_rate_usd: hourlyRate === '' ? 10 : Number(hourlyRate),
      parent_id: parentId || coo?.id || undefined,
      avatar_image: avatarImage || '',
      template_base_id: hireTemplateId || undefined,
      is_orchestrator: isOrchestrator || hireTemplateId === 'video-orchestrator',
    };
    api
      .agentCreate(body)
      .then((agent) => {
        setName('');
        setRole('');
        setHireTemplateId('');
        setParentId('');
        setDepartment('Operations');
        setTokenBudget('');
        setErrorBudget('');
        setHourlyRate('10');
        setAvatarImage('');
        setIsOrchestrator(false);
        setMessage(
          `"${agent.name}" hired` +
            (agent.department ? ` · ${agent.department}` : '') +
            (agent.openclaw_runtime_id ? ` (${agent.openclaw_runtime_id})` : '') +
            '. Grant tools in the employee workspace if needed.'
        );
        onCreated?.(agent);
        setTimeout(() => setMessage(null), 12000);
      })
      .catch((err) => setError(err.message || 'Failed to hire AI employee'))
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
          placeholder="Employee name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          aria-label="AI employee name"
          style={inputStyle}
        />
        <AgentAvatarPicker value={avatarImage} name={name} onChange={setAvatarImage} size={48} />
        {hireTemplates.length > 0 && (
          <select
            value={hireTemplateId}
            onChange={(e) => {
              const id = e.target.value;
              setHireTemplateId(id);
              const tpl = hireTemplates.find((t) => t.id === id);
              if (tpl) {
                if (!role.trim()) setRole(tpl.role || '');
                if (tpl.department) setDepartment(tpl.department);
              }
            }}
            aria-label="Role template"
            title={selectedHire?.description || 'Optional role template'}
            style={{ ...inputStyle, minWidth: compact ? 160 : 180 }}
          >
            <option value="">Role template (optional)</option>
            {hireTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
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
        <label className="agent-orchestrator-choice" title="Can goal-plan and delegate to direct reports">
          <input
            type="checkbox"
            checked={isOrchestrator || hireTemplateId === 'video-orchestrator'}
            disabled={hireTemplateId === 'video-orchestrator'}
            onChange={(e) => setIsOrchestrator(e.target.checked)}
          />
          Orchestrator
        </label>
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
          step="0.5"
          placeholder="USD/hr (value)"
          title="Hourly USD value rate used by Digest Est. Value Delivered (default $10/hr)"
          value={hourlyRate}
          onChange={(e) => setHourlyRate(e.target.value)}
          aria-label="Hourly value rate USD"
          style={{ ...inputStyle, width: compact ? 130 : undefined, minWidth: 120 }}
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
          {submitting ? 'Hiring…' : 'Hire AI employee'}
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
