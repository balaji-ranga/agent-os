import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatLocalDateTime } from '../utils/formatDateTime.js';

function Kpi({ label, value, hint, tone = 'blue' }) {
  return (
    <div className={`home-kpi-card home-kpi-${tone}`} title={hint || ''}>
      <div>
        <div className="home-kpi-label">{label}</div>
        <div className="home-kpi-value">{value}</div>
      </div>
    </div>
  );
}

function Highlight({ label, value }) {
  return (
    <div
      style={{
        padding: '0.65rem 0.8rem',
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--surface)',
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 650, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function UserTable({ title, rows, empty }) {
  return (
    <section style={{ marginTop: '1.25rem' }}>
      <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.5rem' }}>{title}</h2>
      {!rows.length ? (
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>{empty}</p>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', background: 'var(--surface)' }}>
                <th style={{ padding: '0.5rem 0.7rem' }}>Name</th>
                <th style={{ padding: '0.5rem 0.7rem' }}>Email</th>
                <th style={{ padding: '0.5rem 0.7rem' }}>Role</th>
                <th style={{ padding: '0.5rem 0.7rem' }}>Registered</th>
                <th style={{ padding: '0.5rem 0.7rem' }}>Last used</th>
                <th style={{ padding: '0.5rem 0.7rem' }}>Idle</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.5rem 0.7rem' }}>
                    {u.name || '—'}
                    {u.business_name ? (
                      <div style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>{u.business_name}</div>
                    ) : null}
                  </td>
                  <td style={{ padding: '0.5rem 0.7rem' }}>{u.email || '—'}</td>
                  <td style={{ padding: '0.5rem 0.7rem' }}>{u.role === 'org_user' ? 'employee' : u.role}</td>
                  <td style={{ padding: '0.5rem 0.7rem' }}>{formatLocalDateTime(u.created_at)}</td>
                  <td style={{ padding: '0.5rem 0.7rem' }}>{formatLocalDateTime(u.last_login_at)}</td>
                  <td style={{ padding: '0.5rem 0.7rem' }}>
                    {u.days_idle != null ? `${u.days_idle}d` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function AdminUserInsights() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .adminUserInsights()
      .then(setData)
      .catch((e) => setError(e.message || 'Failed to load insights'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const k = data?.kpis || {};
  const c = data?.companies || {};
  const e = data?.employees || {};
  const h = data?.highlights || {};

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem 1rem 2.5rem' }}>
      <header className="page-hero" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '1.45rem' }}>User Insights</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="wf-btn" onClick={load} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <Link to="/admin" className="wf-btn">
              Back to Admin
            </Link>
          </div>
        </div>
        <p style={{ margin: '0.4rem 0 0', color: 'var(--muted)', maxWidth: 780 }}>
          Platform adoption for company owners (CEO) and invited employees. Windows are{' '}
          <strong>UTC</strong> (today, Monday–now week, calendar month). Inactive means no login for more
          than {data?.inactive_after_days || 7} days (never-logged-in accounts older than 7 days count). Test
          names starting with {(data?.exclude_name_prefixes || ['SR Import', 'Connector Test']).join(' / ')} are
          excluded.
        </p>
      </header>

      {error && (
        <div className="mcp-pg-banner mcp-pg-banner-err" style={{ marginBottom: '0.75rem' }}>
          {error}
        </div>
      )}

      <div className="home-kpi-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.65rem' }}>
        <Kpi label="Registered today" value={k.registered_today ?? '—'} hint="CEO + employee logins created today (UTC)" tone="green" />
        <Kpi label="Registered this week" value={k.registered_this_week ?? '—'} hint="Monday 00:00 UTC through now" tone="blue" />
        <Kpi label="Inactive (7+ days)" value={k.inactive_7d ?? '—'} hint="Enabled accounts with no use in 7 days" tone="amber" />
        <Kpi label="Active (7 days)" value={k.active_7d ?? '—'} hint="Logged in within the last 7 days" tone="green" />
      </div>

      <h2 style={{ fontSize: '1.05rem', margin: '1.35rem 0 0.55rem' }}>Adoption highlights</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem' }}>
        <Highlight label="Companies (enabled)" value={c.enabled ?? '—'} />
        <Highlight label="New companies today" value={c.registered_today ?? '—'} />
        <Highlight label="New companies this week" value={c.registered_this_week ?? '—'} />
        <Highlight label="Employees (enabled)" value={e.enabled ?? '—'} />
        <Highlight label="Employees invited today" value={e.invited_today ?? '—'} />
        <Highlight label="Employees invited this week" value={e.invited_this_week ?? '—'} />
        <Highlight label="Became inactive this week" value={k.newly_inactive_this_week ?? '—'} />
        <Highlight label="Never logged in" value={h.never_logged_in ?? '—'} />
        <Highlight label="CEO activation" value={c.activation_pct != null ? `${c.activation_pct}%` : '—'} />
        <Highlight label="Company setup done" value={c.company_setup_done ?? '—'} />
        <Highlight label="CRM enabled" value={c.crm_enabled ?? '—'} />
        <Highlight label="ERP enabled" value={c.erp_enabled ?? '—'} />
        <Highlight label="Connectors linked" value={c.connectors_linked ?? '—'} />
        <Highlight label="Companies with AI employees" value={c.with_ai_employees ?? '—'} />
        <Highlight label="Registered this month" value={k.registered_this_month ?? '—'} />
      </div>

      {Array.isArray(h.industry_mix) && h.industry_mix.length > 0 && (
        <section style={{ marginTop: '1.25rem' }}>
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.5rem' }}>Industry mix (enabled companies)</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {h.industry_mix.map((row) => (
              <span
                key={row.industry}
                style={{
                  padding: '0.3rem 0.6rem',
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                  fontSize: '0.85rem',
                }}
              >
                {row.industry} · {row.count}
              </span>
            ))}
          </div>
        </section>
      )}

      <UserTable title="Newest accounts" rows={data?.newest || []} empty="No recent registrations." />
      <UserTable
        title="Inactive accounts (7+ days)"
        rows={data?.inactive || []}
        empty="No enabled accounts are idle past 7 days."
      />
      {data?.inactive?.length >= 100 && (
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Showing the 100 longest-idle accounts.</p>
      )}

      {data?.generated_at && (
        <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '1.25rem' }}>
          Snapshot {formatLocalDateTime(data.generated_at)} · {data.timezone}
        </p>
      )}
    </div>
  );
}
