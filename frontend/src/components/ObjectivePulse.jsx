import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const money = (value, currency = 'SGD') => new Intl.NumberFormat('en-SG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value) || 0);

export default function ObjectivePulse({ from = null, to = null, compact = false }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    api.companyObjectivesDigest({ from, to, limit: compact ? 4 : 8 }).then((r) => alive && setData(r)).catch(() => alive && setData(null));
    return () => { alive = false; };
  }, [from, to, compact]);
  if (!data?.objectives?.length) return null;
  const summary = data.summary || {};
  return (
    <section className="digest-card objective-pulse" style={{ gridColumn: '1 / -1' }} aria-label="Objective progress">
      <div className="objective-pulse-head"><div><h2 className="digest-card-title">Objective progress</h2><p className="digest-muted">Monthly, quarterly, half-yearly and annual outcomes backed by evidence.</p></div><Link className="digest-more" to="/objectives">All objectives →</Link></div>
      <div className="objective-pulse-summary">
        <span><strong>{summary.active || 0}</strong> active</span><span><strong>{summary.off_track || 0}</strong> need attention</span><span><strong>{summary.awaiting_approval || 0}</strong> approvals</span><span><strong>{money(summary.weighted_pipeline)}</strong> weighted pipeline</span><span><strong>{money(summary.cost)}</strong> cost</span>
      </div>
      <div className="objective-pulse-grid">
        {data.objectives.map((o) => {
          const pipeline = o.key_results?.find((k) => k.formula === 'weighted_pipeline') || o.key_results?.[0];
          return <Link key={o.id} className="objective-pulse-item" to={`/objectives/${encodeURIComponent(o.id)}`}><div><strong>{o.name}</strong><small>{o.period_label} · {String(o.health || '').replaceAll('_', ' ')}</small></div><div className="objective-progress"><i style={{ width: `${pipeline?.progress_pct || 0}%` }} /></div><span>{pipeline?.current_value || 0} / {pipeline?.target || 0} {pipeline?.unit || ''}</span></Link>;
        })}
      </div>
    </section>
  );
}
