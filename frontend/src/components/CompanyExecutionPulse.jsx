import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatLocalDateTime } from '../utils/formatDateTime.js';

const LABELS = { goal_plan: 'Goal', workflow: 'Workflow', browser: 'Browser', kanban: 'Task' };

export default function CompanyExecutionPulse() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = () => api.companyExecutions({ limit: 8 })
      .then((next) => { if (active) { setData(next); setError(''); } })
      .catch((e) => { if (active) setError(e.message); });
    load();
    const timer = setInterval(load, 15000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  if (error) return null;
  const counts = data?.counts || {};
  const rows = data?.executions || [];
  return (
    <section style={{ margin: '0 0 1.5rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Company execution pulse</h2>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
            One view of goals, workflows, browser work and delegated tasks. “Unverified” means activity finished without outcome evidence.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: '0.85rem', flexWrap: 'wrap' }}>
          <span>{counts.running || 0} running</span><span>{counts.blocked || 0} blocked</span>
          <span>{counts.failed || 0} failed</span><span>{counts.unverified || 0} unverified</span>
        </div>
      </div>
      {rows.length ? (
        <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
          {rows.map((row) => (
            <Link key={row.id} to={row.detail_path || '#'} style={{ color: 'inherit', textDecoration: 'none', display: 'grid', gridTemplateColumns: '80px minmax(0,1fr) 100px 150px', gap: 10, alignItems: 'center', padding: '0.55rem 0.65rem', borderRadius: 7, background: 'var(--bg)' }}>
              <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>{LABELS[row.source_type] || row.source_type}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</span>
              <span style={{ fontSize: '0.8rem' }}>{row.status}</span>
              <span style={{ color: row.verification?.state === 'unverified' ? '#f59e0b' : 'var(--muted)', fontSize: '0.78rem', textAlign: 'right' }}>
                {row.verification?.state === 'unverified' ? 'outcome unverified' : formatLocalDateTime(row.updated_at || row.created_at)}
              </span>
            </Link>
          ))}
        </div>
      ) : <p style={{ color: 'var(--muted)', marginBottom: 0 }}>No company executions yet.</p>}
    </section>
  );
}
