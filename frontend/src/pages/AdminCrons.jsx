import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { formatLocalDateTime } from '../utils/formatDateTime.js';

function statusBadge(status) {
  if (status === 'running') return { bg: 'rgba(34,197,94,0.15)', color: '#15803d', label: 'Active' };
  if (status === 'paused') return { bg: 'rgba(245,158,11,0.15)', color: '#b45309', label: 'Paused' };
  return { bg: 'rgba(100,116,139,0.12)', color: '#475569', label: 'Disabled' };
}

export default function AdminCrons() {
  const [crons, setCrons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [flash, setFlash] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .adminCrons()
      .then((r) => setCrons(r.crons || []))
      .catch((e) => setError(e.message || 'Failed to load crons'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id, action) => {
    setBusyId(id);
    setFlash(null);
    setError(null);
    try {
      if (action === 'pause') await api.adminCronPause(id);
      else if (action === 'resume') await api.adminCronResume(id);
      else if (action === 'run') await api.adminCronRun(id);
      setFlash(
        action === 'run'
          ? `Triggered ${id}`
          : action === 'pause'
            ? `Paused ${id}`
            : `Resumed ${id}`
      );
      load();
    } catch (e) {
      setError(e.message || `Failed to ${action} ${id}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem 1rem 2.5rem' }}>
      <header className="page-hero" style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.45rem' }}>Platform crons</h1>
        <p style={{ margin: '0.35rem 0 0', color: 'var(--muted, #64748b)', maxWidth: 640 }}>
          Platform-level timers (one per backend process). Pause / resume persists across restarts.
          Ad-hoc Run executes the job now without waiting for the schedule. Status-checker email is
          sent only by the daily batch job — not by CEO UI or the COO tool.
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

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <button type="button" className="mcp-pg-btn-ghost mcp-pg-btn-sm" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading && !crons.length ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : !crons.length ? (
        <p style={{ color: 'var(--muted)' }}>No platform crons registered (backend may still be starting).</p>
      ) : (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          {crons.map((c) => {
            const badge = statusBadge(c.status);
            const busy = busyId === c.id;
            return (
              <article
                key={c.id}
                style={{
                  border: '1px solid var(--border, #e2e8f0)',
                  borderRadius: 10,
                  padding: '0.9rem 1rem',
                  background: 'var(--surface, #fff)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.5rem 1rem',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong>{c.name}</strong>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          padding: '0.15rem 0.45rem',
                          borderRadius: 999,
                          background: badge.bg,
                          color: badge.color,
                          fontWeight: 600,
                        }}
                      >
                        {badge.label}
                        {c.running_now ? ' · running now' : ''}
                      </span>
                      <code style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{c.id}</code>
                    </div>
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.9rem', color: 'var(--muted)' }}>
                      {c.description}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {c.enabled && !c.paused && (
                      <button
                        type="button"
                        className="mcp-pg-btn-ghost mcp-pg-btn-sm"
                        disabled={busy}
                        onClick={() => act(c.id, 'pause')}
                      >
                        Pause
                      </button>
                    )}
                    {c.enabled && c.paused && (
                      <button
                        type="button"
                        className="mcp-pg-btn-ghost mcp-pg-btn-sm"
                        disabled={busy}
                        onClick={() => act(c.id, 'resume')}
                      >
                        Resume
                      </button>
                    )}
                    <button
                      type="button"
                      className="mcp-pg-btn mcp-pg-btn-sm"
                      disabled={busy || !c.enabled || c.running_now}
                      onClick={() => act(c.id, 'run')}
                      title="Run now (ad-hoc)"
                    >
                      {busy ? '…' : 'Run now'}
                    </button>
                  </div>
                </div>
                <dl
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: '0.35rem 1rem',
                    margin: '0.75rem 0 0',
                    fontSize: '0.82rem',
                  }}
                >
                  <div>
                    <dt style={{ color: 'var(--muted)' }}>Schedule</dt>
                    <dd style={{ margin: 0 }}>
                      <code>{c.schedule || '—'}</code>
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: 'var(--muted)' }}>Env var</dt>
                    <dd style={{ margin: 0 }}>
                      <code>{c.env_var || '—'}</code>
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: 'var(--muted)' }}>Last run</dt>
                    <dd style={{ margin: 0 }}>
                      {c.last_run_at ? formatLocalDateTime(c.last_run_at) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: 'var(--muted)' }}>Last error</dt>
                    <dd style={{ margin: 0, color: c.last_error ? '#b91c1c' : undefined }}>
                      {c.last_error || '—'}
                    </dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
