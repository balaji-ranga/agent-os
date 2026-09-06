import { useEffect, useState } from 'react';
import { usePrivilegedSession } from '../context/PrivilegedSessionContext';
import { formatLocalDateTime } from '../utils/formatDateTime.js';

function formatRemain(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * Generic OTP gate for admin privileged actions (30-minute session).
 */
export default function PrivilegedSessionGate({ children, title = 'Privileged actions' }) {
  const priv = usePrivilegedSession();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [challenge, setChallenge] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    priv.refreshMeta();
  }, [priv.refreshMeta]);

  useEffect(() => {
    if (!priv.unlocked) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [priv.unlocked]);

  const mode = priv.meta?.mfa_mode || challenge?.mfa_mode || 'TOTP';
  const emailHint = priv.meta?.email_hint || challenge?.email_hint;

  const sendEmail = async () => {
    setBusy('challenge');
    setError(null);
    try {
      const out = await priv.challenge();
      setChallenge(out);
    } catch (e) {
      setError(e.message || 'Failed to send OTP');
    } finally {
      setBusy(null);
    }
  };

  const unlock = async (e) => {
    e?.preventDefault?.();
    if (!code.trim()) {
      setError('Enter the 6-digit OTP');
      return;
    }
    setBusy('verify');
    setError(null);
    try {
      await priv.verify({
        code: code.trim(),
        mfaToken: challenge?.mfa_token,
      });
      setCode('');
      setChallenge(null);
    } catch (err) {
      setError(err.message || 'OTP verification failed');
    } finally {
      setBusy(null);
    }
  };

  if (priv.unlocked) {
    return (
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: '1rem',
            padding: '0.65rem 0.85rem',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--surface)',
            fontSize: '0.85rem',
          }}
        >
          <span>
            Privileged session unlocked. Remaining {formatRemain(priv.remainingMs)}
            {priv.expiresAt ? ` (until ${formatLocalDateTime(priv.expiresAt)})` : ''}.
          </span>
          <button type="button" className="wf-btn wf-btn-ghost" onClick={priv.clear}>
            Lock
          </button>
        </div>
        {children}
      </div>
    );
  }

  return (
    <section
      style={{
        padding: '1rem',
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--surface)',
        maxWidth: 560,
      }}
    >
      <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.1rem' }}>{title}</h2>
      <p style={{ margin: '0 0 0.85rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
        These actions need a one-time OTP. After success you have 30 minutes; then a new OTP is
        required. Authenticator app is used when enrolled; otherwise a code is emailed.
      </p>
      {error && (
        <div className="mcp-pg-banner mcp-pg-banner-err" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}
      <form onSubmit={unlock} style={{ display: 'grid', gap: 8 }}>
        {mode === 'EMAIL' && (
          <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            {challenge?.mfa_token
              ? `Code sent${emailHint ? ` to ${emailHint}` : ''}.`
              : `Email OTP${emailHint ? ` (${emailHint})` : ''}.`}
            <button
              type="button"
              className="wf-btn"
              style={{ marginLeft: 8 }}
              disabled={!!busy}
              onClick={sendEmail}
            >
              {busy === 'challenge' ? 'Sending…' : challenge?.mfa_token ? 'Resend code' : 'Send code'}
            </button>
          </div>
        )}
        <label style={{ fontSize: '0.85rem' }}>
          {mode === 'TOTP' ? 'Authenticator code' : 'Email code'}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            placeholder="123456"
            style={{
              display: 'block',
              marginTop: 4,
              width: 160,
              padding: '0.4rem 0.55rem',
              borderRadius: 6,
              border: '1px solid var(--border)',
            }}
          />
        </label>
        <div>
          <button
            type="submit"
            className="wf-btn"
            disabled={!!busy || (mode === 'EMAIL' && !challenge?.mfa_token)}
          >
            {busy === 'verify' ? 'Verifying…' : 'Unlock for 30 minutes'}
          </button>
        </div>
      </form>
      <span style={{ display: 'none' }}>{tick}</span>
    </section>
  );
}
