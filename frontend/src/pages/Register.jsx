import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function Register() {
  const { register, completeMfa, resendMfa } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    region: '',
    mobile: '',
    db_mode: 'tenant',
    mfa_policy: 'inherit',
    mfa_mode: 'inherit',
  });
  const [platform, setPlatform] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [mfa, setMfa] = useState(null);
  const [otp, setOtp] = useState('');
  const [totpSecret, setTotpSecret] = useState(null);

  useEffect(() => {
    api.authMfaDefaults()
      .then(setPlatform)
      .catch(() => setPlatform(null));
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const goHome = () => navigate('/job-profiles');

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        ...form,
        mfa_mode: form.mfa_mode === 'inherit' ? null : form.mfa_mode,
      };
      const result = await register(body);
      if (result?.mfa_required) {
        setMfa(result);
        setOtp('');
        return;
      }
      if (result?.mfa_setup_required) {
        const setup = await api.authMfaSetupChallenge({ mfa_token: result.mfa_token });
        setMfa({ ...result, ...setup });
        setTotpSecret(setup.secret || null);
        setOtp('');
        return;
      }
      goHome();
    } catch (err) {
      setError(err.message || 'Registration failed');
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
          localStorage.setItem('agent-os-auth-token', data.session.token);
          window.location.href = '/job-profiles';
          return;
        }
        setMfa({ ...mfa, ...data });
        setTotpSecret(data.secret || totpSecret);
        return;
      }
      await completeMfa({ mfa_token: mfa.mfa_token, code: otp });
      goHome();
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

  const field = (label, key, type = 'text', required = false) => (
    <label>
      <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>{label}</span>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
        required={required}
        style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
      />
    </label>
  );

  if (mfa?.mfa_required || mfa?.mfa_setup_required) {
    const isEmail = (mfa.mfa_mode || 'EMAIL') === 'EMAIL';
    return (
      <div style={{ maxWidth: 480, margin: '2rem auto', padding: '0 1rem' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>Verification code</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
          {isEmail
            ? `Account created. We sent a 6-digit code to ${mfa.email_hint || 'your email'}.`
            : mfa.mfa_setup_required
              ? 'Scan the authenticator setup, then enter the 6-digit code.'
              : 'Enter the 6-digit code from your authenticator app.'}
        </p>
        {!isEmail && (totpSecret || mfa.secret) && (
          <p style={{ fontSize: '0.8rem', wordBreak: 'break-all', marginBottom: '1rem', color: 'var(--muted)' }}>
            Secret: <code>{totpSecret || mfa.secret}</code>
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
          {error && <div style={{ color: '#f87171' }}>{error}</div>}
          <button type="submit" disabled={submitting} style={{ padding: '0.65rem', borderRadius: 6, background: 'var(--accent)', color: '#fff', border: 'none' }}>
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
      </div>
    );
  }

  const platRequire = platform?.platform_require_mfa;
  const platMode = platform?.platform_mfa_mode || 'EMAIL';

  return (
    <div style={{ maxWidth: 480, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Register CEO account</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        Choose where your job pipeline, kanban, and chat history are stored. Standard workspace agents are granted either way.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {field('Full name', 'name', 'text', true)}
        {field('Email', 'email', 'email', true)}
        {field('Password', 'password', 'password', true)}
        {field('Region', 'region')}
        {field('Mobile', 'mobile', 'tel')}
        <label>
          <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Tenancy Model</span>
          <select
            value={form.db_mode}
            onChange={(e) => set('db_mode', e.target.value)}
            style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
          >
            <option value="tenant">Dedicated</option>
            <option value="shared">Shared</option>
          </select>
          <small style={{ display: 'block', marginTop: 4, color: 'var(--muted)' }}>
            Workflows and MCP always use the shared platform database. This setting applies to jobs, kanban, and agent chat.
          </small>
        </label>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0.25rem 0' }} />
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
          Multi-factor authentication
          {platform && (
            <>
              {' '}
              — platform default: {platRequire ? 'required' : 'optional'}, mode {platMode}
            </>
          )}
        </p>
        <label>
          <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Require MFA</span>
          <select
            value={form.mfa_policy}
            onChange={(e) => set('mfa_policy', e.target.value)}
            style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
          >
            <option value="inherit">Use platform default ({platRequire ? 'on' : 'off'})</option>
            <option value="on">Always required</option>
            <option value="off">Disabled for this account</option>
          </select>
        </label>
        <label>
          <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>MFA method</span>
          <select
            value={form.mfa_mode}
            onChange={(e) => set('mfa_mode', e.target.value)}
            style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
          >
            <option value="inherit">Use platform default ({platMode})</option>
            <option value="EMAIL">Email OTP</option>
            <option value="TOTP">Authenticator app (TOTP)</option>
          </select>
        </label>

        {error && <div style={{ color: '#f87171' }}>{error}</div>}
        <button type="submit" disabled={submitting} style={{ padding: '0.65rem', borderRadius: 6, background: 'var(--accent)', color: '#fff', border: 'none' }}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
