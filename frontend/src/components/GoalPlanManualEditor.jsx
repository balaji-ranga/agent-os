/**
 * Manual editor for scheduled-goal execution plans (goal-plan schema).
 */
import { useMemo } from 'react';

const STEP_TYPES = [
  { id: 'workflow_trigger', label: 'Workflow', hint: 'Seed phrase that starts a published workflow' },
  { id: 'specialty_task', label: 'Specialty AI', hint: 'Hand off one unit of work to an AI employee' },
  { id: 'agent_continue', label: 'Schedule agent', hint: 'Run on the agent who owns this schedule' },
  { id: 'notify_ceo', label: 'Notify CEO', hint: 'Bell when earlier steps finish' },
  { id: 'agent_tool', label: 'Tool', hint: 'Call one named platform tool on the schedule agent' },
];

const INTENT_PRESETS = [
  { id: 'crm_mc', label: 'CRM maker-checker', type: 'workflow_trigger', stepLabel: 'CRM maker-checker workflow', phrase: 'run crm maker checker', phase: 'crm_phase' },
  { id: 'erp_mc', label: 'ERP maker-checker', type: 'workflow_trigger', stepLabel: 'ERP O2C maker-checker workflow', phrase: 'run erp maker checker', phase: 'erp_phase' },
  { id: 'platform_help', label: 'Platform Help', type: 'specialty_task', stepLabel: 'Platform Help', agent_id: 'platformhelp', message: 'Answer the CEO how-to from platform help docs.' },
  { id: 'notify', label: 'Notify CEO', type: 'notify_ceo', stepLabel: 'Notify CEO' },
];

function emptySpec(type) {
  if (type === 'workflow_trigger') return { phrase: '', phase: 'generic', workflow_id: null };
  if (type === 'specialty_task') return { agent_id: '', message: '', parallel_group: null, phase: 'specialty' };
  if (type === 'notify_ceo') return { title: null, body: null };
  if (type === 'agent_tool') return { tool_name: '', args: {} };
  return { message: null };
}

function blankStep(type = 'workflow_trigger', partial = {}) {
  const t = partial.type || type;
  return {
    step_index: 0,
    type: t,
    label: partial.label || STEP_TYPES.find((x) => x.id === t)?.label || 'Step',
    spec: { ...emptySpec(t), ...(partial.spec || {}) },
  };
}

function reindex(steps) {
  return (steps || []).map((s, i) => ({
    ...s,
    step_index: i,
    type: s.type || 'workflow_trigger',
    label: s.label || ('Step ' + (i + 1)),
    spec: s.spec && typeof s.spec === 'object' ? { ...s.spec } : emptySpec(s.type),
  }));
}

function fromPlan(plan) {
  if (!plan || !Array.isArray(plan.steps)) return [];
  return reindex(
    plan.steps.map((s) => ({
      type: s.type || s.step_type || 'workflow_trigger',
      label: s.label || '',
      spec: s.spec && typeof s.spec === 'object' ? { ...s.spec } : emptySpec(s.type),
    }))
  );
}

export function buildPlanFromEditorSteps(steps, { prompt = '', base = null } = {}) {
  const list = reindex(steps).filter((s) => s && s.type);
  return {
    version: 1,
    prompt: prompt || base?.prompt || '',
    steps: list,
    uses_goal_run_mode: list.some((s) =>
      ['workflow_trigger', 'specialty_task', 'agent_tool'].includes(String(s.type || ''))
    ),
    generated_at: new Date().toISOString(),
    feedback_applied: base?.feedback_applied || null,
    amended_manually: true,
  };
}

export function GoalPlanManualEditor({ plan, onChange, agents = [], prompt = '', disabled = false }) {
  const steps = useMemo(() => fromPlan(plan), [plan]);

  const emit = (nextSteps) => {
    onChange?.(buildPlanFromEditorSteps(nextSteps, { prompt, base: plan }));
  };

  const updateStep = (idx, patch) => {
    const next = steps.map((s, i) => {
      if (i !== idx) return s;
      const type = patch.type || s.type;
      let spec = { ...s.spec, ...(patch.spec || {}) };
      if (patch.type && patch.type !== s.type) {
        spec = { ...emptySpec(patch.type), ...((patch.spec && typeof patch.spec === 'object') ? patch.spec : {}) };
      }
      return { ...s, ...patch, type, label: patch.label != null ? patch.label : s.label, spec };
    });
    emit(next);
  };

  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    const tmp = next[idx];
    next[idx] = next[j];
    next[j] = tmp;
    emit(next);
  };

  const remove = (idx) => emit(steps.filter((_, i) => i !== idx));

  const addStep = (type = 'workflow_trigger', partial = {}) => {
    emit([...steps, blankStep(type, partial)]);
  };

  const addPreset = (preset) => {
    if (preset.type === 'workflow_trigger') {
      addStep('workflow_trigger', {
        label: preset.stepLabel,
        spec: { phrase: preset.phrase, phase: preset.phase || 'generic', workflow_id: null },
      });
      return;
    }
    if (preset.type === 'specialty_task') {
      addStep('specialty_task', {
        label: preset.stepLabel,
        spec: { agent_id: preset.agent_id || '', message: preset.message || '', parallel_group: null, phase: 'specialty' },
      });
      return;
    }
    if (preset.type === 'notify_ceo') {
      addStep('notify_ceo', { label: preset.stepLabel || 'Notify CEO' });
    }
  };

  return (
    <div className="sg-plan-editor" aria-label="Manual goal plan editor">
      <div className="sg-plan-editor-head">
        <div className="sg-plan-editor-title">Amend plan</div>
        <p className="sg-plan-editor-sub">
          Each row is one step in a dynamic goal plan (workflow, specialty, notify). Map the intent you meant, then save draft or approve.
        </p>
      </div>

      <div className="sg-plan-presets" aria-label="Quick intent add">
        <span className="sg-plan-presets-label">Add intent</span>
        {INTENT_PRESETS.map((p) => (
          <button key={p.id} type="button" className="sg-plan-chip" disabled={disabled} onClick={() => addPreset(p)} title={'Add ' + p.label + ' step'}>
            + {p.label}
          </button>
        ))}
        <button type="button" className="sg-plan-chip sg-plan-chip-ghost" disabled={disabled} onClick={() => addStep('workflow_trigger')}>
          + Custom step
        </button>
      </div>

      {steps.length === 0 ? (
        <p className="sg-plan-empty">No steps yet. Generate a draft plan or add an intent above.</p>
      ) : (
        <ol className="sg-plan-steps">
          {steps.map((step, idx) => {
            const typeMeta = STEP_TYPES.find((t) => t.id === step.type) || STEP_TYPES[0];
            return (
              <li key={'step-' + idx + '-' + step.type} className="sg-plan-step">
                <div className="sg-plan-step-toolbar">
                  <span className="sg-plan-step-num">{idx + 1}</span>
                  <select className="sg-plan-type" value={step.type} disabled={disabled} aria-label={'Step ' + (idx + 1) + ' type'} onChange={(e) => updateStep(idx, { type: e.target.value })}>
                    {STEP_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                  <input className="sg-plan-label" value={step.label || ''} disabled={disabled} placeholder="Step label" aria-label={'Step ' + (idx + 1) + ' label'} onChange={(e) => updateStep(idx, { label: e.target.value })} />
                  <div className="sg-plan-step-actions">
                    <button type="button" className="sg-plan-icon-btn" disabled={disabled || idx === 0} onClick={() => move(idx, -1)} aria-label="Move up" title="Move up">↑</button>
                    <button type="button" className="sg-plan-icon-btn" disabled={disabled || idx === steps.length - 1} onClick={() => move(idx, 1)} aria-label="Move down" title="Move down">↓</button>
                    <button type="button" className="sg-plan-icon-btn sg-plan-icon-danger" disabled={disabled} onClick={() => remove(idx)} aria-label="Remove step" title="Remove">×</button>
                  </div>
                </div>
                <p className="sg-plan-type-hint">{typeMeta.hint}</p>
                {step.spec?.selection_rationale && (
                  <p className="sg-plan-rationale"><b>Why selected:</b> {step.spec.selection_rationale}</p>
                )}

                {step.type === 'workflow_trigger' && (
                  <div className="sg-plan-fields">
                    <label>
                      <span>Trigger phrase</span>
                      <input value={step.spec?.phrase || ''} disabled={disabled} placeholder="run crm maker checker" onChange={(e) => updateStep(idx, { spec: { ...step.spec, phrase: e.target.value } })} />
                    </label>
                    <label>
                      <span>Phase</span>
                      <select value={step.spec?.phase || 'generic'} disabled={disabled} onChange={(e) => updateStep(idx, { spec: { ...step.spec, phase: e.target.value } })}>
                        <option value="crm_phase">crm_phase</option>
                        <option value="erp_phase">erp_phase</option>
                        <option value="generic">generic</option>
                        <option value="specialty">specialty</option>
                      </select>
                    </label>
                  </div>
                )}

                {step.type === 'specialty_task' && (
                  <div className="sg-plan-fields">
                    <label>
                      <span>AI employee</span>
                      <select value={step.spec?.agent_id || ''} disabled={disabled} onChange={(e) => updateStep(idx, { spec: { ...step.spec, agent_id: e.target.value } })}>
                        <option value="">Select…</option>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name || a.id}{a.is_coo ? ' (COO)' : ''}
                          </option>
                        ))}
                        {!agents.some((a) => a.id === 'platformhelp') && (
                          <option value="platformhelp">Platform Help</option>
                        )}
                      </select>
                    </label>
                    <label className="sg-plan-field-wide">
                      <span>Work message</span>
                      <textarea rows={2} value={step.spec?.message || ''} disabled={disabled} placeholder="What this specialist should deliver" onChange={(e) => updateStep(idx, { spec: { ...step.spec, message: e.target.value } })} />
                    </label>
                    <label>
                      <span>Parallel group (optional)</span>
                      <input type="number" min={0} value={step.spec?.parallel_group ?? ''} disabled={disabled} placeholder="empty = sequential" onChange={(e) => {
                        const v = e.target.value;
                        updateStep(idx, { spec: { ...step.spec, parallel_group: v === '' ? null : Number(v) } });
                      }} />
                    </label>
                  </div>
                )}

                {step.type === 'agent_continue' && (
                  <div className="sg-plan-fields">
                    <label className="sg-plan-field-wide">
                      <span>Message (optional override)</span>
                      <textarea rows={2} value={step.spec?.message || ''} disabled={disabled} placeholder="Leave empty to use the full goal prompt" onChange={(e) => updateStep(idx, { spec: { ...step.spec, message: e.target.value || null } })} />
                    </label>
                  </div>
                )}

                {step.type === 'notify_ceo' && (
                  <div className="sg-plan-fields">
                    <label>
                      <span>Notification title (optional)</span>
                      <input value={step.spec?.title || ''} disabled={disabled} placeholder="Uses goal title if empty" onChange={(e) => updateStep(idx, { spec: { ...step.spec, title: e.target.value || null } })} />
                    </label>
                    <label className="sg-plan-field-wide">
                      <span>Body (optional)</span>
                      <textarea rows={2} value={step.spec?.body || ''} disabled={disabled} placeholder="Uses goal summary if empty" onChange={(e) => updateStep(idx, { spec: { ...step.spec, body: e.target.value || null } })} />
                    </label>
                  </div>
                )}

                {step.type === 'agent_tool' && (
                  <div className="sg-plan-fields">
                    <label>
                      <span>Tool name</span>
                      <input value={step.spec?.tool_name || ''} disabled={disabled} placeholder="e.g. this_week_digest" onChange={(e) => updateStep(idx, { spec: { ...step.spec, tool_name: e.target.value } })} />
                    </label>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default GoalPlanManualEditor;
