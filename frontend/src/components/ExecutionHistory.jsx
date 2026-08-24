import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatLocalDateTime } from '../utils/formatDateTime.js';

const LABELS = { goal_plan: 'Goal', workflow: 'Workflow', browser: 'Browser work', kanban: 'Delegated task' };
const STATUS_TEXT = {
  pending: 'Waiting to start', running: 'In progress', blocked: 'Needs attention', failed: 'Failed', completed: 'Completed',
};

function Evidence({ execution }) {
  const evidence = execution?.verification?.evidence || [];
  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: '0.78rem' }}>Technical details</summary>
      <div style={{ marginTop: 6, fontSize: '0.78rem', color: 'var(--muted)', overflowWrap: 'anywhere' }}>
        <div>Execution: {execution.id}</div>
        {execution.parent_execution_id ? <div>Parent: {execution.parent_execution_id}</div> : null}
        {execution.executor ? <div>Executor: {execution.executor}</div> : null}
        {evidence.length ? evidence.map((item, index) => (
          <div key={`${item.type}-${index}`}>{item.type}: {String(item.value)}</div>
        )) : <div>No typed outcome evidence was recorded.</div>}
        {execution.error ? <div style={{ color: 'var(--danger, #dc2626)' }}>Error: {execution.error}</div> : null}
      </div>
    </details>
  );
}

function ExecutionLine({ execution, nested = false }) {
  const unverified = execution?.verification?.state === 'unverified';
  return (
    <div style={{ padding: nested ? '0.55rem 0.65rem' : '0.75rem', border: '1px solid var(--border)', borderRadius: 8, background: nested ? 'var(--surface)' : 'var(--bg)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{LABELS[execution.source_type] || execution.source_type}</div>
          <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{execution.title || execution.source_id}</div>
          <div style={{ color: unverified ? '#b45309' : 'var(--muted)', fontSize: '0.8rem', marginTop: 3 }}>
            {STATUS_TEXT[execution.status] || execution.status}
            {execution.status === 'completed' ? (unverified ? ' · Outcome evidence missing' : ' · Outcome verified') : ''}
            {execution.parent_execution_id ? ' · Part of a goal' : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '0.78rem', color: 'var(--muted)' }}>
          <div>{formatLocalDateTime(execution.updated_at || execution.created_at)}</div>
          {execution.detail_path ? <Link to={execution.detail_path}>Open source record →</Link> : null}
        </div>
      </div>
      {execution.source_type === 'goal_plan' && execution.children?.length ? (
        <details style={{ marginTop: 9 }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.82rem' }}>
            {execution.children.length} linked execution{execution.children.length === 1 ? '' : 's'}
          </summary>
          <div style={{ display: 'grid', gap: 6, marginTop: 7 }}>
            {execution.children.map((child) => <ExecutionLine key={child.id} execution={child} nested />)}
          </div>
        </details>
      ) : null}
      <Evidence execution={execution} />
    </div>
  );
}

export default function ExecutionHistory({ from, to }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => setPage(1), [from, to]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api.companyExecutions({ page, pageSize: 10, from, to })
      .then((next) => { if (active) { setData(next); setError(''); } })
      .catch((err) => { if (active) setError(err?.message || 'Execution history failed to load'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, from, to]);

  const counts = data?.counts || {};
  const pulse = data?.pulse || {};
  const pagination = data?.pagination || {};
  return (
    <section className="digest-row" aria-label="Execution history">
      <article className="digest-card" style={{ gridColumn: '1 / -1' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 className="digest-card-title">Execution history</h2>
            <p className="digest-muted" style={{ marginTop: 0 }}>
              Goals and the work Flolah actually ran. Completed work is verified only when an outcome or provider receipt was recorded.
            </p>
          </div>
        </div>
        {data ? (
          <div style={{ border: '1px solid color-mix(in srgb, var(--accent) 26%, var(--border))', borderRadius: 12, padding: '0.85rem', marginBottom: '0.9rem', background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 9%, var(--surface)), var(--surface))' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))', gap: 8 }}>
              {[
                ['Active', pulse.active ?? counts.running ?? 0, '#2563eb'],
                ['Blocked', pulse.blocked ?? counts.blocked ?? 0, '#b45309'],
                ['Failed', pulse.failed ?? counts.failed ?? 0, '#dc2626'],
                ['Unverified', pulse.unverified ?? counts.unverified ?? 0, '#7c3aed'],
                ['Evidence', pulse.artifacts ?? 0, '#059669'],
                ['Est. LLM cost', `$${Number(pulse.estimated_llm_cost_usd || 0).toFixed(4)}`, 'var(--text)'],
              ].map(([label, value, color]) => (
                <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: '0.65rem' }}>
                  <div style={{ fontSize: '1.08rem', fontWeight: 750, color }}>{value}</div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.72rem', marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: '0.82rem' }}><strong>Next action:</strong> {pulse.next_action?.label || 'No intervention needed'}</div>
              {pulse.next_action?.detail_path ? <Link to={pulse.next_action.detail_path}>Open →</Link> : null}
            </div>
            <div style={{ color: 'var(--muted)', fontSize: '0.7rem', marginTop: 6 }}>Estimated LLM cost uses the configured price book and is not a provider invoice.</div>
          </div>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
        {loading && !data ? <p className="digest-muted">Loading execution history…</p> : null}
        {!loading && data && !data.executions?.length ? <p className="digest-muted">No executions were recorded in this week.</p> : null}
        <div style={{ display: 'grid', gap: 8 }}>
          {(data?.executions || []).map((execution) => <ExecutionLine key={execution.id} execution={execution} />)}
        </div>
        {pagination.page_count > 1 ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <button type="button" className="btn" disabled={!pagination.has_previous || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <span className="digest-muted" style={{ fontSize: '0.8rem' }}>Page {pagination.page} of {pagination.page_count} · {pagination.total} records</span>
            <button type="button" className="btn" disabled={!pagination.has_next || loading} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        ) : null}
      </article>
    </section>
  );
}
