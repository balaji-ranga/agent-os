import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { formatLocalDateTime } from '../utils/formatDateTime.js';

const emptyForm = {
  name: '',
  display_name: '',
  purpose: '',
  image: '',
  container_port: 80,
  invoke_path: '/',
  method: 'POST',
  request_schema: '{\n  "type": "object"\n}',
  response_schema: '{\n  "type": "object"\n}',
  auth_header: '',
};

function parseSchema(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  return JSON.parse(t);
}

export default function AdminToolOnboarding() {
  const [status, setStatus] = useState(null);
  const [tools, setTools] = useState([]);
  const [discovered, setDiscovered] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [totp, setTotp] = useState('');
  const [stepup, setStepup] = useState('');
  const [stepupExp, setStepupExp] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [healthByName, setHealthByName] = useState({});

  const unlocked = !!stepup;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([api.adminToolOnboardingStatus(), api.adminToolOnboardingList()])
      .then(([st, list]) => {
        setStatus(st);
        setTools(list.tools || st.tools || []);
      })
      .catch((e) => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const withBusy = async (label, fn) => {
    setBusy(label);
    setError(null);
    setFlash(null);
    try {
      const out = await fn();
      if (typeof out === 'string') setFlash(out);
      load();
      return out;
    } catch (e) {
      setError(e.message || label + ' failed');
      throw e;
    } finally {
      setBusy(null);
    }
  };

  const issueStepup = async () => {
    setBusy('stepup');
    setError(null);
    try {
      const r = await api.adminToolOnboardingStepup(totp);
      setStepup(r.stepup_token);
      setStepupExp(r.expires_at);
      setTotp('');
      setFlash('Privileged actions unlocked until ' + formatLocalDateTime(r.expires_at));
    } catch (e) {
      setStepup('');
      setStepupExp('');
      setError(
        e.message ||
          'TOTP step-up failed. Enroll authenticator MFA for this admin account, then enter a fresh 6-digit code.'
      );
    } finally {
      setBusy(null);
    }
  };

  const declare = () =>
    withBusy('declare', async () => {
      if (!stepup) throw new Error('Unlock with TOTP first');
      let request_schema = null;
      let response_schema = null;
      try {
        request_schema = parseSchema(form.request_schema);
        response_schema = parseSchema(form.response_schema);
      } catch {
        throw new Error('request/response schema must be valid JSON');
      }
      await api.adminToolOnboardingDeclare(
        {
          ...form,
          container_port: Number(form.container_port) || 80,
          request_schema,
          response_schema,
        },
        stepup
      );
      return 'Declared ' + form.name;
    });

  const runAction = (label, name, fn) =>
    withBusy(label + ':' + name, async () => {
      if (label !== 'health' && !stepup) {
        throw new Error('Unlock with TOTP first (section above), then retry ' + label);
      }
      const out = await fn();
      if (label === 'health') {
        setHealthByName((prev) => ({ ...prev, [name]: out }));
        const http = out?.http;
        const httpPart = http
          ? http.ok
            ? `HTTP ${http.status}`
            : `HTTP fail ${http.error || http.status || ''}`
          : 'no HTTP probe';
        return `health ${name}: running=${out?.running ? 'yes' : 'no'} · ${httpPart}`;
      }
      return `${label} ${name} ok`;
    });

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem 1rem 2.5rem' }}>
      <header className="page-hero" style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.45rem' }}>Tools Onboarding</h1>
        <p style={{ margin: '0.35rem 0 0', color: 'var(--muted)', maxWidth: 720 }}>
          Pull a Docker image, deploy it on the Compose network (no host ports), and register it as a content tool.
          Agents/workflows call only via backend /api/tools/invoke. Privileged actions need TOTP step-up. Agent grants stay manual.
        </p>
      </header>

      {flash && <div className="mcp-pg-banner mcp-pg-banner-ok" style={{ marginBottom: '0.75rem' }}>{flash}</div>}
      {error && <div className="mcp-pg-banner mcp-pg-banner-err" style={{ marginBottom: '0.75rem' }}>{error}</div>}

      <section style={{ marginBottom: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Runtime policy</h2>
        {loading && !status ? (
          <p>Loading…</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
            <li>Enabled: <strong>{status?.enabled ? 'yes' : 'no'}</strong></li>
            <li>Docker socket: {status?.docker_ok ? 'ok' : 'unavailable (' + (status?.docker_error || 'n/a') + ')'}</li>
            <li>Network: {status?.network_resolved || status?.network || '(auto)'}</li>
            <li>Allow: {(status?.registry_allow || []).join(', ') || '(empty = deny all)'}</li>
            <li>Deny: {(status?.registry_deny || []).join(', ') || '(none)'}</li>
            <li>Limits: {status?.max_memory_mb} MB / {status?.max_cpus} CPU</li>
          </ul>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="mcp-pg-btn-ghost mcp-pg-btn-sm" onClick={load} disabled={!!busy}>Refresh</button>
          <button
            type="button"
            className="mcp-pg-btn-ghost mcp-pg-btn-sm"
            disabled={!!busy}
            onClick={() =>
              withBusy('discover', async () => {
                const r = await api.adminToolOnboardingDiscover();
                setDiscovered(r.containers || []);
                return 'discovered ' + (r.containers || []).length + ' container(s)';
              }).catch(() => {})
            }
          >
            Discover
          </button>
        </div>
      </section>

      <section
        style={{
          marginBottom: '1.25rem',
          padding: '1rem',
          border: unlocked ? '1px solid #16a34a' : '1px solid #b45309',
          borderRadius: 8,
          background: unlocked ? 'rgba(22,163,74,0.06)' : 'rgba(180,83,9,0.08)',
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>
          TOTP step-up {unlocked ? '— unlocked' : '— required first'}
        </h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 0 }}>
          Pull, deploy, stop, restart, declare, and delete stay locked until you unlock with your admin authenticator
          (same TOTP used at admin login). Health and Discover work without step-up.
          {stepupExp ? ` Token expires ${formatLocalDateTime(stepupExp)}.` : ''}
        </p>
        {!unlocked && (
          <p style={{ fontSize: '0.85rem', margin: '0 0 0.75rem', color: '#92400e' }}>
            Buttons below look present but are disabled until this unlock succeeds. If unlock fails, enroll MFA for
            this admin (or use <code>admin2</code> which already has TOTP).
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            placeholder="6-digit TOTP"
            inputMode="numeric"
            autoComplete="one-time-code"
            style={{ padding: '0.4rem 0.6rem', minWidth: 140 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && totp && !busy) issueStepup();
            }}
          />
          <button type="button" className="mcp-pg-btn-primary mcp-pg-btn-sm" onClick={issueStepup} disabled={!!busy || !totp}>
            {busy === 'stepup' ? 'Verifying…' : unlocked ? 'Refresh unlock' : 'Unlock with TOTP'}
          </button>
          {unlocked && (
            <button
              type="button"
              className="mcp-pg-btn-ghost mcp-pg-btn-sm"
              disabled={!!busy}
              onClick={() => {
                setStepup('');
                setStepupExp('');
                setFlash('Privileged actions locked again');
              }}
            >
              Lock again
            </button>
          )}
          <span style={{ fontSize: '0.85rem', color: unlocked ? '#15803d' : '#92400e' }}>
            {unlocked ? 'Privileged actions enabled' : 'Privileged actions locked'}
          </span>
        </div>
      </section>

      <section style={{ marginBottom: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Declare tool</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            ['name', 'Tool name (content tool id)'],
            ['display_name', 'Display name'],
            ['image', 'Docker image (e.g. ealen/echo-server:0.9.2)'],
            ['purpose', 'Purpose'],
            ['container_port', 'Container port'],
            ['invoke_path', 'Invoke path'],
            ['method', 'Method (POST)'],
            ['auth_header', 'Optional Authorization header on invoke'],
          ].map(([key, label]) => (
            <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem' }}>
              {label}
              <input value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} style={{ padding: '0.4rem 0.55rem' }} />
            </label>
          ))}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem', gridColumn: '1 / -1' }}>
            Request JSON schema
            <textarea rows={4} value={form.request_schema} onChange={(e) => setForm((f) => ({ ...f, request_schema: e.target.value }))} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem', gridColumn: '1 / -1' }}>
            Response JSON schema
            <textarea rows={4} value={form.response_schema} onChange={(e) => setForm((f) => ({ ...f, response_schema: e.target.value }))} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem' }} />
          </label>
        </div>
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="mcp-pg-btn-primary mcp-pg-btn-sm"
            disabled={!!busy || !unlocked}
            title={unlocked ? 'Declare tool' : 'Unlock with TOTP first'}
            onClick={() => declare().catch(() => {})}
          >
            {busy === 'declare' ? 'Saving…' : unlocked ? 'Declare' : 'Declare (locked — unlock TOTP)'}
          </button>
        </div>
      </section>

      <section style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>Onboarded tools</h2>
        {!unlocked && tools.length > 0 && (
          <p style={{ color: '#92400e', fontSize: '0.85rem' }}>
            pull / deploy / stop / restart / delete are disabled until you unlock with TOTP above. Health works now.
          </p>
        )}
        {!tools.length && <p style={{ color: 'var(--muted)' }}>No docker tools declared yet.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tools.map((t) => (
            <div key={t.id || t.name} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.85rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <strong>{t.display_name || t.name}</strong> <code style={{ fontSize: '0.8rem' }}>{t.name}</code>
                  <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 4 }}>
                    {t.image} · status=<strong>{t.status}</strong>
                    {t.content_tool ? ' · in Content Tools' : ''}
                  </div>
                  <div style={{ fontSize: '0.8rem', marginTop: 4 }}>endpoint: <code>{t.endpoint || '—'}</code></div>
                  {t.last_error && <div style={{ color: '#b91c1c', fontSize: '0.8rem' }}>{t.last_error}</div>}
                  {healthByName[t.name] && (
                    <pre style={{ fontSize: '0.72rem', marginTop: 8, background: 'var(--surface)', padding: 8, borderRadius: 6, overflow: 'auto' }}>
                      {JSON.stringify(healthByName[t.name], null, 2)}
                    </pre>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignContent: 'flex-start' }}>
                  {[
                    ['pull', true, () => api.adminToolOnboardingPull(t.name, stepup)],
                    ['deploy', true, () => api.adminToolOnboardingDeploy(t.name, stepup)],
                    ['stop', true, () => api.adminToolOnboardingStop(t.name, stepup)],
                    ['restart', true, () => api.adminToolOnboardingRestart(t.name, stepup)],
                    ['health', false, () => api.adminToolOnboardingHealth(t.name)],
                    ['delete', true, () => api.adminToolOnboardingDelete(t.name, stepup, true)],
                  ].map(([label, needsStepup, fn]) => {
                    const locked = needsStepup && !unlocked;
                    const thisBusy = busy === label + ':' + t.name;
                    return (
                      <button
                        key={label}
                        type="button"
                        className="mcp-pg-btn-ghost mcp-pg-btn-sm"
                        disabled={!!busy || locked}
                        title={locked ? 'Unlock with TOTP first' : label}
                        onClick={() => runAction(label, t.name, fn).catch(() => {})}
                      >
                        {thisBusy ? '…' : locked ? label + ' 🔒' : label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {!!discovered.length && (
        <section>
          <h2 style={{ fontSize: '1.05rem' }}>Discovered managed containers</h2>
          <pre style={{ fontSize: '0.75rem', overflow: 'auto', background: 'var(--surface)', padding: 12, borderRadius: 8 }}>
            {JSON.stringify(discovered, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
