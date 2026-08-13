import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { usePrivilegedSession } from '../context/PrivilegedSessionContext';
import PrivilegedSessionGate from '../components/PrivilegedSessionGate';

function badge(ok, okLabel = 'OK', badLabel = 'Issue') {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.1rem 0.45rem',
        borderRadius: 999,
        fontSize: '0.75rem',
        background: ok ? 'rgba(34,197,94,0.15)' : 'rgba(248,113,113,0.15)',
        color: ok ? '#15803d' : '#b91c1c',
      }}
    >
      {ok ? okLabel : badLabel}
    </span>
  );
}

export default function AdminOpenclawRecovery() {
  const priv = usePrivilegedSession();
  const [status, setStatus] = useState(null);
  const [ceoId, setCeoId] = useState('');
  const [agents, setAgents] = useState([]);
  const [agentId, setAgentId] = useState('');
  const [crons, setCrons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [restartOnUnblock, setRestartOnUnblock] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const st = await api.adminOpenclawRecoveryStatus(ceoId || undefined);
      setStatus(st);
      if (!ceoId && st.ceos?.length) {
        const firstBusy = st.ceos.find((c) => (c.queues?.open_delegations || 0) > 0) || st.ceos[0];
        if (firstBusy?.id) setCeoId(firstBusy.id);
      }
    } catch (e) {
      setError(e.message || 'Failed to load AgentSystem status');
    } finally {
      setLoading(false);
    }
  }, [ceoId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!ceoId) {
      setAgents([]);
      return undefined;
    }
    api
      .adminOpenclawRecoveryAgents(ceoId)
      .then((r) => setAgents(r.agents || []))
      .catch(() => setAgents([]));
  }, [ceoId]);

  const loadCrons = async () => {
    try {
      const r = await api.adminOpenclawRecoveryGatewayCrons();
      setCrons(r.jobs || []);
    } catch (e) {
      setError(e.message || 'Failed to list gateway crons');
    }
  };

  const run = async (label, fn) => {
    if (!priv.unlocked) {
      setError('Unlock with OTP first');
      return;
    }
    setBusy(label);
    setError(null);
    setFlash(null);
    try {
      const out = await fn();
      setFlash(`${label} finished`);
      await load();
      return out;
    } catch (e) {
      if (e.status === 401) priv.clear();
      setError(e.message || `${label} failed`);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const gw = status?.gateway;
  const cfg = status?.config;
  const q = status?.queues || {};
  const kanbanOff = !!status?.failure_kanban?.disabled;

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem 1rem 2.5rem' }}>
      <header className="page-hero" style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.45rem' }}>AgentSystem recovery</h1>
        <p style={{ margin: '0.35rem 0 0', color: 'var(--muted)', maxWidth: 760 }}>
          Diagnose and unblock the AgentSystem gateway when chat queues or fails. No Control UI —
          these are the same recovery steps used after a saturated session lane. Pause platform
          feeders anytime from <Link to="/admin/crons">Admin → Crons</Link>.
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

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button type="button" className="wf-btn" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh status'}
        </button>
      </div>

      <section
        style={{
          marginBottom: '1rem',
          padding: '1rem',
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface)',
        }}
      >
        <h2 style={{ margin: '0 0 0.65rem', fontSize: '1.05rem' }}>Gateway</h2>
        {status ? (
          <div style={{ display: 'grid', gap: 6, fontSize: '0.9rem' }}>
            <div>
              Reachable {badge(!!gw?.root?.ok)} · chat endpoint{' '}
              {badge(!!gw?.chat?.ok, `HTTP ${gw?.chat?.http ?? '—'}`, gw?.chat?.wiped_chat_endpoint ? '404 wiped' : `HTTP ${gw?.chat?.http ?? 'down'}`)}
            </div>
            <div>
              Config {badge(!!cfg?.present)} · chatCompletions {badge(!!cfg?.chat_completions_enabled)} ·
              model catalog {badge(!cfg?.model_catalog_empty, `${cfg?.model_count || 0} models`, 'empty')}
            </div>
            <div>
              Docker socket {badge(!!status.docker?.reachable, 'reachable', 'not mounted')} · gateway
              crons {status.gateway_cron_count ?? 0}
            </div>
            <div>
              Goal-plan recovery Kanban {badge(!kanbanOff, 'on', 'kill-switch off')}
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--muted)', margin: 0 }}>Loading…</p>
        )}
      </section>

      <section
        style={{
          marginBottom: '1rem',
          padding: '1rem',
          border: '1px solid var(--border)',
          borderRadius: 8,
        }}
      >
        <h2 style={{ margin: '0 0 0.65rem', fontSize: '1.05rem' }}>CEO lane</h2>
        <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: 10 }}>
          CEO
          <select
            value={ceoId}
            onChange={(e) => setCeoId(e.target.value)}
            style={{ display: 'block', marginTop: 4, minWidth: 280, padding: '0.4rem 0.5rem' }}
          >
            <option value="">Select…</option>
            {(status?.ceos || []).map((c) => (
              <option key={c.id} value={c.id}>
                {(c.name || c.email || c.id) +
                  ` · dels ${c.queues?.open_delegations || 0} · goals ${c.queues?.open_goal_runs || 0}`}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.9rem', marginBottom: 8 }}>
          <span>Open delegations: <strong>{q.open_delegations ?? '—'}</strong></span>
          <span>Goal runs: <strong>{q.open_goal_runs ?? '—'}</strong></span>
          <span>Recovery Kanban: <strong>{q.recovery_kanban ?? '—'}</strong></span>
          <span>Browser tasks: <strong>{q.open_browser_tasks ?? '—'}</strong></span>
          <span>Active scheduled goals: <strong>{q.active_scheduled_goals ?? '—'}</strong></span>
        </div>
        {status?.samples?.delegations?.length ? (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>Sample open delegations</summary>
            <ul style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
              {status.samples.delegations.map((d) => (
                <li key={d.id}>
                  #{d.id} {d.to_agent_id} [{d.status}] {d.prompt}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <PrivilegedSessionGate title="Unlock recovery actions">
        <section
          style={{
            padding: '1rem',
            border: '1px solid var(--border)',
            borderRadius: 8,
            marginBottom: '1rem',
          }}
        >
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>Unblock gateway lane</h2>
          <p style={{ margin: '0 0 0.75rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
            Fails open delegations and looping goal runs, cancels Goal recovery Kanban, pauses
            scheduled goals, cancels browser tasks for the selected CEO, then optionally restarts
            the gateway container.
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem', marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={restartOnUnblock}
              onChange={(e) => setRestartOnUnblock(e.target.checked)}
            />
            Restart AgentSystem gateway after drain
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="wf-btn wf-btn-danger"
              disabled={!!busy || !ceoId}
              onClick={() => {
                if (!window.confirm('Drain this CEO’s feeder queues and optionally restart the gateway?')) return;
                return run('Unblock lane', () =>
                  api.adminOpenclawRecoveryUnblock(priv.token, {
                    ceo_user_id: ceoId,
                    restart_gateway: restartOnUnblock,
                  })
                );
              }}
            >
              {busy === 'Unblock lane' ? 'Working…' : 'Unblock lane'}
            </button>
            <button
              type="button"
              className="wf-btn"
              disabled={!!busy || !ceoId}
              onClick={() =>
                run('Drain queues', () =>
                  api.adminOpenclawRecoveryDrain(priv.token, { ceo_user_id: ceoId })
                )
              }
            >
              Drain queues only
            </button>
            <button
              type="button"
              className="wf-btn"
              disabled={!!busy}
              onClick={() => {
                if (!window.confirm('Restart the AgentSystem gateway container? In-flight chats drop.')) return;
                return run('Restart gateway', () => api.adminOpenclawRecoveryRestart(priv.token));
              }}
            >
              Restart gateway
            </button>
          </div>
        </section>

        <section
          style={{
            padding: '1rem',
            border: '1px solid var(--border)',
            borderRadius: 8,
            marginBottom: '1rem',
          }}
        >
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>Config, workspaces, kill-switch</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="wf-btn"
              disabled={!!busy}
              onClick={() => run('Repair config', () => api.adminOpenclawRecoveryRepairConfig(priv.token))}
            >
              Repair gateway config
            </button>
            <button
              type="button"
              className="wf-btn"
              disabled={!!busy || !ceoId}
              onClick={() =>
                run('Heal workspaces', () =>
                  api.adminOpenclawRecoveryHeal(priv.token, { ceo_user_id: ceoId })
                )
              }
            >
              Heal workspaces + allowlists
            </button>
            <button
              type="button"
              className="wf-btn"
              disabled={!!busy}
              onClick={() =>
                run('Kill-switch', () =>
                  api.adminOpenclawRecoveryFailureKanban(priv.token, { enabled: kanbanOff })
                )
              }
            >
              {kanbanOff ? 'Re-enable recovery Kanban' : 'Disable recovery Kanban'}
            </button>
          </div>
        </section>

        <section
          style={{
            padding: '1rem',
            border: '1px solid var(--border)',
            borderRadius: 8,
            marginBottom: '1rem',
          }}
        >
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>Sessions</h2>
          <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: 10 }}>
            Agent
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              style={{ display: 'block', marginTop: 4, minWidth: 240, padding: '0.4rem 0.5rem' }}
            >
              <option value="">Select…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.id})
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="wf-btn"
              disabled={!!busy || !ceoId || !agentId}
              onClick={() =>
                run('Clear session', () =>
                  api.adminOpenclawRecoveryClearSession(priv.token, {
                    ceo_user_id: ceoId,
                    agent_id: agentId,
                  })
                )
              }
            >
              Clear chat session
            </button>
            <button
              type="button"
              className="wf-btn"
              disabled={!!busy || !ceoId || !agentId}
              onClick={() => {
                if (!window.confirm('Reset native sessions.json for this agent? A backup is kept.')) return;
                return run('Reset session store', () =>
                  api.adminOpenclawRecoveryResetStore(priv.token, {
                    ceo_user_id: ceoId,
                    agent_id: agentId,
                  })
                );
              }}
            >
              Reset native session store
            </button>
          </div>
        </section>

        <section
          style={{
            padding: '1rem',
            border: '1px solid var(--border)',
            borderRadius: 8,
          }}
        >
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>Gateway crons</h2>
          <p style={{ margin: '0 0 0.65rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
            Separate from platform timers on Admin → Crons. Leftover Kanban-watch jobs can keep
            waking agents.
          </p>
          <button type="button" className="wf-btn" disabled={!!busy} onClick={loadCrons}>
            List gateway crons
          </button>
          {crons.length > 0 && (
            <ul style={{ marginTop: 10, fontSize: '0.85rem' }}>
              {crons.map((j) => (
                <li key={j.id || j.name} style={{ marginBottom: 6 }}>
                  <code>{j.id || '—'}</code> {j.name || ''} {j.schedule || ''}
                  {j.id && (
                    <button
                      type="button"
                      className="wf-btn wf-btn-ghost"
                      style={{ marginLeft: 8 }}
                      disabled={!!busy}
                      onClick={() =>
                        run('Remove cron', () =>
                          api.adminOpenclawRecoveryRemoveCron(priv.token, { id: j.id })
                        ).then(() => loadCrons())
                      }
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </PrivilegedSessionGate>
    </div>
  );
}
