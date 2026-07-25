import { useEffect, useState } from 'react';
import { api } from '../api';
import DepartmentPicker from './DepartmentPicker.jsx';

/**
 * Place an external agent or published A2A workflow in the org chart as a leaf member.
 * Leaf members always report to an internal agent and never manage others.
 *
 * @param {{ kind: 'external'|'a2a_publish', refId: string, defaultName?: string,
 *           defaultPurpose?: string, existing?: object|null, onClose: Function, onSaved?: Function }} props
 */
export default function AddToOrgDialog({
  kind,
  refId,
  defaultName = '',
  defaultPurpose = '',
  existing = null,
  onClose,
  onSaved,
}) {
  const [agents, setAgents] = useState([]);
  const [displayName, setDisplayName] = useState(existing?.display_name || defaultName);
  const [purpose, setPurpose] = useState(existing?.purpose || defaultPurpose);
  const [department, setDepartment] = useState(existing?.department || '');
  const [parentId, setParentId] = useState(existing?.parent_id || '');
  const [tokenBudget, setTokenBudget] = useState(
    existing?.monthly_token_budget == null ? '' : String(existing.monthly_token_budget)
  );
  const [errorBudget, setErrorBudget] = useState(
    existing?.error_budget_pct == null ? '' : String(existing.error_budget_pct)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .agentsList()
      .then((list) => {
        if (cancelled) return;
        const rows = Array.isArray(list) ? list : list?.agents || [];
        setAgents(rows);
        setParentId((cur) => cur || rows.find((a) => a.is_coo)?.id || rows[0]?.id || '');
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.orgMemberUpsert({
        kind,
        ref_id: refId,
        display_name: displayName.trim() || defaultName,
        purpose: purpose.trim(),
        department,
        parent_id: parentId,
        monthly_token_budget: tokenBudget || null,
        error_budget_pct: errorBudget || null,
      });
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.message || 'Failed to add to org');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mcp-pg-modal-backdrop" onClick={() => !saving && onClose?.()}>
      <form className="mcp-pg-modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <div className="mcp-pg-modal-header">
          <h2>{existing ? 'Update org placement' : 'Add to org'}</h2>
          <button type="button" className="mcp-pg-btn-icon" onClick={() => onClose?.()} aria-label="Close">
            ×
          </button>
        </div>
        <p className="mcp-pg-card-desc">
          This agent joins your org chart as a leaf member: it gets a department and reports to an
          internal agent, and the COO can delegate matching work to it. It cannot manage other agents.
        </p>
        {error && <div className="mcp-pg-alert mcp-pg-alert-error">{error}</div>}
        <label className="mcp-pg-field">
          <span>Display name</span>
          <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="mcp-pg-field">
          <span>Purpose (used by the COO to route work)</span>
          <textarea rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </label>
        <div className="mcp-pg-field">
          <span>Department</span>
          <DepartmentPicker value={department} onChange={setDepartment} allowEmpty compact />
        </div>
        <label className="mcp-pg-field">
          <span>Reports to (internal agent)</span>
          <select required value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Select an internal agent…</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.is_coo ? ' (COO)' : ''}
                {a.department ? ` · ${a.department}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="mcp-pg-field">
          <span>Monthly token budget (blank = unlimited)</span>
          <input
            type="number"
            min="0"
            value={tokenBudget}
            onChange={(e) => setTokenBudget(e.target.value)}
          />
        </label>
        <label className="mcp-pg-field">
          <span>Error budget — max monthly failure %</span>
          <input
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={errorBudget}
            onChange={(e) => setErrorBudget(e.target.value)}
          />
        </label>
        <div className="mcp-pg-card-actions" style={{ marginTop: '0.5rem' }}>
          <button type="submit" className="mcp-pg-btn-primary" disabled={saving || !parentId}>
            {saving ? 'Saving…' : existing ? 'Update' : 'Add to org'}
          </button>
          <button type="button" className="mcp-pg-btn-ghost" onClick={() => onClose?.()}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
