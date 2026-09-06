import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { formatLocalDateTime } from '../utils/formatDateTime.js';

const SCOPES = [
  { id: 'all', label: 'All (platform + CRM workspaces)' },
  { id: 'platform', label: 'Platform only (apex / login / www)' },
  { id: 'crm', label: 'CRM workspaces' },
];

export default function AdminTlsCerts() {
  const [status, setStatus] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [scope, setScope] = useState('all');
  const [totp, setTotp] = useState('');
  const [stepup, setStepup] = useState('');
  const [stepupExp, setStepupExp] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [st, j] = await Promise.all([api.adminTlsCertsStatus(), api.adminTlsCertsJobs()]);
      setStatus(st);
      setJobs(j.jobs || []);
    } catch (e) {
      setError(e.message || 'Failed to load TLS status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const pollJob = (jobId) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const r = await api.adminTlsCertsJob(jobId);
        setActiveJob(r.job);
        if (r.job?.status && r.job.status !== 'running') {
          stopPoll();
          load();
          if (r.job.status === 'succeeded') setFlash('TLS refresh finished successfully');
          else setError(r.job.error || `TLS refresh failed (exit ${r.job.exit_code ?? '?'})`);
        }
      } catch (e) {
        stopPoll();
        setError(e.message || 'Failed to poll job');
      }
    }, 2500);
  };

  const issueStepup = async () => {
    setBusy('stepup');
    setError(null);
    try {
      const r = await api.adminTlsCertsStepup(totp);
      setStepup(r.stepup_token);
      setStepupExp(r.expires_at);
      setTotp('');
      setFlash('Privileged actions unlocked until ' + formatLocalDateTime(r.expires_at));
    } catch (e) {
      setStepup('');
      setStepupExp('');
      setError(e.message || 'TOTP step-up failed');
    } finally {
      setBusy(null);
    }
  };

  const startRefresh = async () => {
    if (!stepup) {
      setError('Unlock with TOTP first');
      return;
    }
    setBusy('refresh');
    setError(null);
    setFlash(null);
    try {
      const out = await api.adminTlsCertsRefresh(scope, stepup);
      setFlash(`Started job ${out.job_id} (scope=${out.scope}). Nginx may drop briefly for ALPN.`);
      setActiveJob({ id: out.job_id, status: 'running', log_text: '', scope: out.scope });
      pollJob(out.job_id);
      load();
    } catch (e) {
      setError(e.message || 'Failed to start refresh');
    } finally {
      setBusy(null);
    }
  };

  const cert = status?.certificate;
  const workspaces = status?.crm_workspaces || [];

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem 1rem 2.5rem' }}>
      <header className="page-hero" style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.45rem' }}>TLS / Let&apos;s Encrypt</h1>
        <p style={{ margin: '0.35rem 0 0', color: 'var(--muted)', maxWidth: 760 }}>
          View current certificate SANs and refresh certificates via acme.sh TLS-ALPN (same path as the VPS
          expand scripts). Brief nginx downtime is expected while ports free for ALPN. CRM multi-workspace hosts
          need DNS before they can be added as SANs.
        </p>
      </header>

      {flash && (
        <div className="mcp-pg-banner mcp-pg-banner-ok" style={{ marginBottom: '0.75rem' }}>
          {flash}
        </div>
      )}
      {error && (
        <div className="mcp-pg-banner mcp-pg-banner-err" style={{ marginBottom: '0.75rem' }}>
          {error}
        </div>
      )}

      <section style={{ marginBottom: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Runtime</h2>
        {loading && !status ? (
          <p style={{ color: 'var(--muted)' }}>Loading…</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.1rem', lineHeight: 1.55, color: 'var(--muted)', fontSize: '0.92rem' }}>
            <li>
              Docker socket: {status?.docker_ping ? 'ok' : 'unavailable'}
              {status?.docker_socket === false ? ' (DOCKER_TOOLS not enabled)' : ''}
            </li>
            <li>Host root: {status?.host_root || '—'}</li>
            <li>
              Scripts: refresh · expand-login · expand-crm · ensure-crm-dns under deploy/scripts/
            </li>
          </ul>
        )}
        {(status?.notes || []).length > 0 && (
          <ul style={{ margin: '0.6rem 0 0', paddingLeft: '1.1rem', fontSize: '0.88rem', color: 'var(--muted)' }}>
            {status.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginBottom: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Current certificate</h2>
          <button type="button" className="btn btn-ghost" onClick={load} disabled={!!busy}>
            Refresh status
          </button>
        </div>
        {cert?.error && <p style={{ color: 'var(--danger, #b00020)' }}>{cert.error}</p>}
        {cert && !cert.error && (
          <>
            <p style={{ margin: '0.5rem 0 0.25rem', fontSize: '0.9rem' }}>
              <span style={{ color: 'var(--muted)' }}>Subject:</span> {cert.subject || '—'}
            </p>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>
              <span style={{ color: 'var(--muted)' }}>Valid:</span> {cert.not_before || '—'} →{' '}
              {cert.not_after || '—'}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(cert.sans || []).length === 0 && (
                <span style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>No SANs parsed</span>
              )}
              {(cert.sans || []).map((s) => (
                <code
                  key={s}
                  style={{
                    fontSize: '0.8rem',
                    padding: '0.15rem 0.45rem',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    background: 'var(--surface-2, transparent)',
                  }}
                >
                  {s}
                </code>
              ))}
            </div>
          </>
        )}
      </section>

      <section style={{ marginBottom: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>CRM workspaces (Twenty)</h2>
        {workspaces.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', margin: 0 }}>
            {status?.crm_workspaces_error || 'No workspaces listed (or twenty-db unavailable).'}
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '0.35rem 0.4rem' }}>Host</th>
                <th style={{ padding: '0.35rem 0.4rem' }}>Name</th>
                <th style={{ padding: '0.35rem 0.4rem' }}>Status</th>
                <th style={{ padding: '0.35rem 0.4rem' }}>On cert</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => (
                <tr key={w.subdomain || w.host} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.35rem 0.4rem' }}>
                    <code style={{ fontSize: '0.8rem' }}>{w.host}</code>
                  </td>
                  <td style={{ padding: '0.35rem 0.4rem' }}>{w.display_name || '—'}</td>
                  <td style={{ padding: '0.35rem 0.4rem' }}>{w.activation_status || '—'}</td>
                  <td style={{ padding: '0.35rem 0.4rem' }}>{w.on_cert ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginBottom: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Privileged unlock (TOTP)</h2>
        <p style={{ margin: '0 0 0.75rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
          Admin authenticator code required before running acme. Same pattern as Tools Onboarding.
          {stepupExp ? ` Unlocked until ${stepupExp}.` : ''}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit TOTP"
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            style={{ width: 140 }}
            disabled={!!busy}
          />
          <button type="button" className="btn" onClick={issueStepup} disabled={!!busy || totp.length < 6}>
            {busy === 'stepup' ? 'Verifying…' : stepup ? 'Re-unlock' : 'Unlock'}
          </button>
          {stepup && (
            <span style={{ fontSize: '0.85rem', color: 'var(--ok, #0a7)' }}>Step-up active</span>
          )}
        </div>
      </section>

      <section style={{ marginBottom: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Refresh certificates</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: '0.75rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.9rem' }}>
            Scope
            <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={!!busy}>
              {SCOPES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={startRefresh}
            disabled={!!busy || !stepup || !status?.docker_ping}
          >
            {busy === 'refresh' ? 'Starting…' : 'Run Let’s Encrypt refresh'}
          </button>
        </div>
        {(status?.scopes || []).map((s) => (
          <p key={s.id} style={{ margin: '0.25rem 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
            <strong>{s.id}:</strong> {s.description}
          </p>
        ))}
      </section>

      {activeJob && (
        <section style={{ marginBottom: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>
            Job {activeJob.id || activeJob.job_id}{' '}
            <span style={{ fontWeight: 400, color: 'var(--muted)' }}>({activeJob.status})</span>
          </h2>
          <pre
            style={{
              margin: 0,
              maxHeight: 360,
              overflow: 'auto',
              fontSize: '0.78rem',
              padding: '0.75rem',
              background: 'var(--surface-2, #0b0d12)',
              borderRadius: 6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {activeJob.log_text || '(waiting for logs…)'}
          </pre>
        </section>
      )}

      <section style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Recent jobs</h2>
        {jobs.length === 0 ? (
          <p style={{ color: 'var(--muted)', margin: 0, fontSize: '0.9rem' }}>No jobs yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '0.3rem' }}>When</th>
                <th style={{ padding: '0.3rem' }}>Scope</th>
                <th style={{ padding: '0.3rem' }}>Status</th>
                <th style={{ padding: '0.3rem' }}>Exit</th>
                <th style={{ padding: '0.3rem' }} />
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.3rem' }}>{formatLocalDateTime(j.started_at)}</td>
                  <td style={{ padding: '0.3rem' }}>{j.scope}</td>
                  <td style={{ padding: '0.3rem' }}>{j.status}</td>
                  <td style={{ padding: '0.3rem' }}>{j.exit_code ?? '—'}</td>
                  <td style={{ padding: '0.3rem' }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: '0.8rem' }}
                      onClick={async () => {
                        try {
                          const r = await api.adminTlsCertsJob(j.id);
                          setActiveJob(r.job);
                          if (r.job?.status === 'running') pollJob(j.id);
                        } catch (e) {
                          setError(e.message);
                        }
                      }}
                    >
                      View log
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
