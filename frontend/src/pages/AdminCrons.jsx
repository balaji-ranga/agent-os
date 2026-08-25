import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { formatLocalDateTime } from '../utils/formatDateTime.js';

function statusBadge(status) {
  if (status === 'running') return { bg: 'rgba(34,197,94,0.15)', color: '#15803d', label: 'Active' };
  if (status === 'paused') return { bg: 'rgba(245,158,11,0.15)', color: '#b45309', label: 'Paused' };
  return { bg: 'rgba(100,116,139,0.12)', color: '#475569', label: 'Disabled' };
}

function bytesLabel(value) {
  const n = Number(value || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function CleanupPolicy({ cron, busy, onSaved }) {
  const [policy, setPolicy] = useState(cron.cleanup_policy || null);
  const [saving, setSaving] = useState(false);
  const [policyError, setPolicyError] = useState(null);

  useEffect(() => setPolicy(cron.cleanup_policy || null), [cron.cleanup_policy]);
  if (!policy) return null;
  const updateNumber = (key, value) => setPolicy((p) => ({ ...p, [key]: value }));
  const save = async () => {
    setSaving(true);
    setPolicyError(null);
    try {
      await api.adminCronConfigUpdate(cron.id, policy);
      onSaved?.('Cleanup policy saved');
    } catch (e) {
      setPolicyError(e.message || 'Failed to save cleanup policy');
    } finally {
      setSaving(false);
    }
  };
  const last = cron.cleanup_last_run;
  const result = last?.result || {};
  return (
    <section
      style={{
        marginTop: '0.9rem',
        padding: '0.85rem',
        borderRadius: 8,
        border: `1px solid ${policy.dry_run ? '#bae6fd' : '#fdba74'}`,
        background: policy.dry_run ? 'rgba(14,165,233,0.06)' : 'rgba(249,115,22,0.07)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div>
          <strong style={{ fontSize: '0.9rem' }}>Cleanup safety policy</strong>
          <div style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: 2 }}>
            Only known execution sessions with owner/reference checks qualify. Unknown and chat sessions are preserved.
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, fontSize: '0.82rem' }}>
          <input
            type="checkbox"
            checked={!!policy.dry_run}
            onChange={(e) => setPolicy((p) => ({ ...p, dry_run: e.target.checked }))}
          />
          Dry run (no deletion)
        </label>
      </div>
      {!policy.dry_run && (
        <div style={{ color: '#c2410c', fontSize: '0.78rem', fontWeight: 600, marginTop: '0.45rem' }}>
          Live deletion is enabled. Run once in dry-run mode and review candidate counts first.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: '0.6rem', marginTop: '0.75rem' }}>
        {[
          ['terminal_retention_days', 'Terminal retention', 'days', 1, 365],
          ['missing_reference_grace_hours', 'Missing-reference grace', 'hours', 24, 720],
          ['recent_activity_minutes', 'Recent-activity guard', 'minutes', 5, 1440],
          ['batch_size', 'Maximum per run', 'sessions/files', 1, 5000],
        ].map(([key, label, unit, min, max]) => (
          <label key={key} style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>
            {label}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
              <input
                type="number"
                min={min}
                max={max}
                value={policy[key]}
                onChange={(e) => updateNumber(key, e.target.value)}
                style={{ width: 82, padding: '0.3rem 0.4rem', border: '1px solid var(--border)', borderRadius: 5 }}
              />
              <span>{unit}</span>
            </div>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" className="mcp-pg-btn-ghost mcp-pg-btn-sm" disabled={busy || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save policy'}
        </button>
        {policyError && <span style={{ color: '#b91c1c', fontSize: '0.78rem' }}>{policyError}</span>}
        {last && (
          <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
            Last audit: {last.dry_run ? 'dry run' : 'live'} · {result.candidate_sessions || 0} candidates ·{' '}
            {result.deleted_sessions || 0} index entries + {result.deleted_files || 0} files deleted ·{' '}
            {bytesLabel(result.reclaimed_bytes)} reclaimed
          </span>
        )}
      </div>
    </section>
  );
}

export default function AdminCrons() {
  const [crons, setCrons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [flash, setFlash] = useState(null);

  const policySaved = (message) => {
    setFlash(message);
    load();
  };

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
        <h1 style={{ margin: 0, fontSize: '1.45rem' }}>Platform crons & watchers</h1>
        <p style={{ margin: '0.35rem 0 0', color: 'var(--muted, #64748b)', maxWidth: 720 }}>
          Platform timers and event watchers (workflow terminal, goal-plan completion nudge, timeout reap).
          Pause / resume persists across restarts (event pause is a kill-switch). Run now fires the job or
          reconcile sweep immediately. Status-checker email is only from the daily batch job.
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
                      {c.kind === 'event' && (
                        <span
                          style={{
                            fontSize: '0.7rem',
                            padding: '0.12rem 0.4rem',
                            borderRadius: 4,
                            background: 'rgba(59,130,246,0.12)',
                            color: '#1d4ed8',
                            fontWeight: 600,
                          }}
                        >
                          event
                        </span>
                      )}
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
                    <dt style={{ color: 'var(--muted)' }}>
                      {c.kind === 'event' ? 'Event / schedule' : 'Schedule'}
                    </dt>
                    <dd style={{ margin: 0 }}>
                      <code>{c.schedule_display || c.schedule || '—'}</code>
                      {c.kind === 'event' && c.schedule ? (
                        <span style={{ color: 'var(--muted)', marginLeft: 6 }}>
                          (safety <code>{c.schedule}</code>)
                        </span>
                      ) : null}
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
                {c.id === 'openclaw_session_cleanup' && (
                  <CleanupPolicy cron={c} busy={busy} onSaved={policySaved} />
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
