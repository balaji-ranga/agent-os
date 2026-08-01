import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function Login() {
  const { login, completeMfa, resendMfa } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminMode, setAdminMode] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [mfa, setMfa] = useState(null); // { mfa_token, mfa_mode, email_hint, mfa_setup_required, ... }
  const [otp, setOtp] = useState('');
  const [totpSecret, setTotpSecret] = useState(null);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotMsg, setForgotMsg] = useState(null);

  const goHome = (user) => {
    navigate(user?.role === 'admin' ? '/admin' : '/');
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await login(email, password, adminMode);
      if (result?.mfa_required) {
        setMfa(result);
        setOtp('');
        return;
      }
      if (result?.mfa_setup_required) {
        // TOTP forced enrollment
        const setup = await api.authMfaSetupChallenge({ mfa_token: result.mfa_token });
        setMfa({ ...result, ...setup });
        setTotpSecret(setup.secret || null);
        setOtp('');
        return;
      }
      goHome(result);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const submitOtp = async (e) => {
    e.preventDefault();
    if (!mfa?.mfa_token) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mfa.mfa_setup_required && mfa.mfa_mode === 'TOTP') {
        const data = await api.authMfaSetupChallenge({ mfa_token: mfa.mfa_token, code: otp });
        if (data.session?.token) {
          // setup-challenge returns session directly — store via complete path
          localStorage.setItem('agent-os-auth-token', data.session.token);
          window.location.href = data.user?.role === 'admin' ? '/admin' : '/';
          return;
        }
        setMfa({ ...mfa, ...data });
        setTotpSecret(data.secret || totpSecret);
        return;
      }
      const user = await completeMfa({ mfa_token: mfa.mfa_token, code: otp });
      goHome(user);
    } catch (err) {
      setError(err.message || 'Invalid code');
    } finally {
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    if (!mfa?.mfa_token || mfa.mfa_mode !== 'EMAIL') return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await resendMfa(mfa.mfa_token);
      setMfa({ ...mfa, ...data });
    } catch (err) {
      setError(err.message || 'Resend failed');
    } finally {
      setSubmitting(false);
    }
  };


  if (forgotMode) {
    return (
      <div style={{ maxWidth: 420, margin: '3rem auto', padding: '0 1rem' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>Reset password</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
          Enter your account email. If it is registered, we will send a reset link.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSubmitting(true);
            setError(null);
            setForgotMsg(null);
            try {
              const data = await api.forgotPassword({ email });
              setForgotMsg(data.message || 'If that email is registered, a reset link was sent.');
            } catch (err) {
              setError(err.message || 'Request failed');
            } finally {
              setSubmitting(false);
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ padding: '0.5rem' }}
          />
          {error && <p style={{ color: '#b91c1c', margin: 0 }}>{error}</p>}
          {forgotMsg && <p style={{ color: '#15803d', margin: 0 }}>{forgotMsg}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
          <button type="button" onClick={() => { setForgotMode(false); setForgotMsg(null); setError(null); }}>
            Back to login
          </button>
        </form>
      </div>
    );
  }

  if (mfa?.mfa_required || mfa?.mfa_setup_required) {
    const isEmail = (mfa.mfa_mode || 'EMAIL') === 'EMAIL';
    return (
      <div style={{ maxWidth: 420, margin: '3rem auto', padding: '0 1rem' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>Verification code</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
          {isEmail
            ? `We sent a 6-digit code to ${mfa.email_hint || 'your email'}.`
            : mfa.mfa_setup_required
              ? 'Scan the authenticator setup, then enter the 6-digit code.'
              : 'Enter the 6-digit code from your authenticator app.'}
        </p>
        {!isEmail && (totpSecret || mfa.secret) && (
          <p style={{ fontSize: '0.8rem', wordBreak: 'break-all', marginBottom: '1rem', color: 'var(--muted)' }}>
            Secret: <code>{totpSecret || mfa.secret}</code>
            {mfa.otpauth_url ? (
              <>
                <br />
                <a href={mfa.otpauth_url}>Open authenticator link</a>
              </>
            ) : null}
          </p>
        )}
        <form onSubmit={submitOtp} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label>
            <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Code</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
              maxLength={6}
              pattern="\d{6}"
              style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', letterSpacing: '0.2em' }}
            />
          </label>
          {error && <div style={{ color: '#f87171', fontSize: '0.9rem' }}>{error}</div>}
          <button
            type="submit"
            disabled={submitting}
            style={{ padding: '0.65rem', borderRadius: 6, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            {submitting ? 'Verifying…' : 'Verify'}
          </button>
        </form>
        {isEmail && (
          <button
            type="button"
            onClick={onResend}
            disabled={submitting}
            style={{ marginTop: '0.75rem', background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0 }}
          >
            Resend code
          </button>
        )}
        <div style={{ marginTop: '1rem' }}>
          <button
            type="button"
            onClick={() => {
              setMfa(null);
              setOtp('');
              setTotpSecret(null);
            }}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0 }}
          >
            ← Back to password
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420, margin: '3rem auto', padding: '0 1rem' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>{adminMode ? 'Admin login' : 'CEO login'}</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
        {adminMode ? 'Platform administration' : 'Sign in to your Agent OS workspace'}
      </p>
      <form onSubmit={submitPassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <label>
          <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
          />
        </label>
        <label>
          <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
          />
        </label>
        {error && <div style={{ color: '#f87171', fontSize: '0.9rem' }}>{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          style={{ padding: '0.65rem', borderRadius: 6, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" onClick={() => setForgotMode(true)} style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0 }}>
          Forgot password?
        </button>
      </form>
      <div style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
        <button
          type="button"
          onClick={() => setAdminMode(!adminMode)}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0 }}
        >
          {adminMode ? '← CEO login' : 'Admin login →'}
        </button>
      </div>
      {!adminMode && (
        <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
          New CEO? <Link to="/register">Register</Link>
        </p>
      )}
      <footer
        style={{
          marginTop: '2.5rem',
          paddingTop: '1rem',
          borderTop: '1px solid var(--border)',
          textAlign: 'center',
          fontSize: '0.85rem',
          color: 'var(--muted)',
        }}
      >
        Flolah (Automate, Innovate, Elevate)
      </footer>
    </div>
  );
}
