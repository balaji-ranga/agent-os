import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import WorkflowRunGraph from '../components/workflow/WorkflowRunGraph.jsx';
import WorkflowStepTooltip from '../components/WorkflowStepTooltip.jsx';
import { summarizeStepIo } from '../utils/workflowStepIo.js';
import ActionFeedbackBanner from '../components/ActionFeedbackBanner.jsx';
import { useActionFeedback } from '../hooks/useActionFeedback.js';

const STATUS_COLORS = {
  completed: '#16a34a',
  running: '#2563eb',
  listening: '#0284c7',
  failed: '#dc2626',
  paused: '#d97706',
  pending: '#94a3b8',
};

function StatusBadge({ status }) {
  return (
    <span
      style={{
        fontSize: '0.7rem',
        padding: '2px 8px',
        borderRadius: 999,
        background: `${STATUS_COLORS[status] || 'var(--muted)'}22`,
        color: STATUS_COLORS[status] || 'var(--muted)',
        textTransform: 'uppercase',
        fontWeight: 600,
      }}
    >
      {status}
    </span>
  );
}

export default function WorkflowRunAudit() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const { feedback, showSuccess, showError, clearFeedback } = useActionFeedback();
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);

  const loadRun = useCallback(() => {
    const id = Number(runId);
    if (!Number.isFinite(id) || id <= 0) {
      setLoading(false);
      showError('Invalid run id');
      return Promise.resolve();
    }
    return api
      .agentWorkflowRunGet(id)
      .then((res) => setRun(res.run || res))
      .catch((e) => showError(e.message || 'Failed to load run'))
      .finally(() => setLoading(false));
  }, [runId, showError]);

  useEffect(() => {
    setLoading(true);
    loadRun();
  }, [loadRun]);

  useEffect(() => {
    if (!run || !['running', 'listening', 'pending'].includes(run.status)) return undefined;
    const t = setInterval(() => loadRun(), 2500);
    return () => clearInterval(t);
  }, [run?.id, run?.status, loadRun]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') navigate(`/workflows?run_id=${encodeURIComponent(runId)}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, runId]);

  const stepRepeatCounts = useMemo(() => {
    const counts = {};
    for (const step of run?.steps || []) {
      counts[step.node_id] = (counts[step.node_id] || 0) + 1;
    }
    return counts;
  }, [run?.steps]);

  const pauseRun = async () => {
    if (!run) return;
    setBusy(true);
    try {
      await api.agentWorkflowRunPause(run.id);
      showSuccess('Run paused');
      await loadRun();
    } catch (e) {
      showError(e.message || 'Pause failed');
    } finally {
      setBusy(false);
    }
  };

  const retryRun = async (mode) => {
    if (!run) return;
    setBusy(true);
    try {
      const out = await api.agentWorkflowRunRetry(run.id, { mode });
      if (mode === 'from_start' && out?.run_id && Number(out.run_id) !== Number(run.id)) {
        showSuccess(out.message || `Started run #${out.run_number}`);
        navigate(`/workflows/runs/${out.run_id}`);
        return;
      }
      showSuccess(out.message || 'Retry started');
      await loadRun();
    } catch (e) {
      showError(e.message || 'Retry failed');
    } finally {
      setBusy(false);
    }
  };

  const deleteRun = async () => {
    if (!run) return;
    if (!window.confirm(`Delete run #${run.run_number}?`)) return;
    setBusy(true);
    try {
      await api.agentWorkflowRunDelete(run.id);
      showSuccess('Run deleted');
      navigate('/workflows');
    } catch (e) {
      showError(e.message || 'Delete failed');
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="wf-run-audit-layout">
        <div style={{ padding: '1.5rem' }}>Loading run audit…</div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="wf-run-audit-layout">
        <header className="wf-run-audit-header">
          <Link to="/workflows" className="wf-editor-exit">
            ← Back to workflows
          </Link>
        </header>
        <ActionFeedbackBanner feedback={feedback} onDismiss={clearFeedback} />
        <p style={{ padding: '1rem', color: 'var(--muted)' }}>Run not found.</p>
      </div>
    );
  }

  return (
    <div className="wf-run-audit-layout">
      <header className="wf-run-audit-header">
        <div className="wf-editor-header-meta">
          <Link
            to={`/workflows?run_id=${encodeURIComponent(run.id)}`}
            className="wf-editor-exit"
            title="Exit fullscreen run audit (Esc)"
          >
            ← Exit run audit
          </Link>
          <h1>
            Run #{run.run_number} · {run.definition_name || run.definition_id}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <StatusBadge status={run.status} />
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{run.progress_pct ?? 0}%</span>
            <code style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>id {run.id}</code>
            {run.definition_id && (
              <Link
                to={`/workflows/${encodeURIComponent(run.definition_id)}/edit`}
                style={{ fontSize: '0.8rem' }}
              >
                Open editor
              </Link>
            )}
          </div>
        </div>
        <div className="wf-editor-actions">
          <button type="button" className="wf-btn" disabled={busy} onClick={() => loadRun()}>
            Refresh
          </button>
          <button
            type="button"
            className="wf-btn"
            disabled={busy}
            onClick={() => setStepsOpen((v) => !v)}
            title="Toggle step list"
          >
            {stepsOpen ? 'Hide steps' : 'Show steps'}
          </button>
          {['running', 'pending'].includes(run.status) && (
            <button type="button" className="wf-btn" disabled={busy} onClick={pauseRun}>
              Pause
            </button>
          )}
          {['failed', 'paused'].includes(run.status) && (
            <button
              type="button"
              className="wf-btn"
              disabled={busy}
              onClick={() => retryRun('from_failed_step')}
              title="Re-dispatch the failed step on this run"
            >
              Retry failed step
            </button>
          )}
          {['failed', 'paused', 'completed', 'cancelled'].includes(run.status) && (
            <button
              type="button"
              className="wf-btn"
              disabled={busy}
              onClick={() => retryRun('from_start')}
              title="Start a new run with the same input"
            >
              Retry from start
            </button>
          )}
          <button type="button" className="wf-btn wf-btn-danger" disabled={busy} onClick={deleteRun}>
            Delete
          </button>
        </div>
      </header>

      <ActionFeedbackBanner feedback={feedback} onDismiss={clearFeedback} />

      {run.error_message && (
        <p className="wf-run-audit-error">{run.error_message}</p>
      )}

      <div className={`wf-run-audit-body ${stepsOpen ? 'wf-run-audit-body--split' : ''}`}>
        <div className="wf-run-audit-graph-wrap">
          <WorkflowRunGraph run={run} fill />
        </div>
        {stepsOpen && (
          <aside className="wf-run-audit-steps">
            <h2>Steps</h2>
            <ul className="wf-steps">
              {(run.steps || []).map((s) => (
                <WorkflowStepTooltip key={s.id} step={s}>
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span>
                        {s.node_label || s.node_id}
                        {(stepRepeatCounts[s.node_id] || 0) > 1 ? (
                          <small style={{ color: 'var(--muted)' }}> #{s.iteration ?? 1}</small>
                        ) : null}{' '}
                        <small>({s.node_type})</small>
                      </span>
                      <StatusBadge status={s.status} />
                    </div>
                    {s.input && (
                      <div className="wf-step-io">
                        <strong>Inputs:</strong> {summarizeStepIo(s.input, 'input')}
                      </div>
                    )}
                    {s.output && (
                      <div className="wf-step-io">
                        <strong>Outputs:</strong> {summarizeStepIo(s.output, 'output')}
                      </div>
                    )}
                    {s.error_message && <small style={{ color: '#dc2626' }}>{s.error_message}</small>}
                  </>
                </WorkflowStepTooltip>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}