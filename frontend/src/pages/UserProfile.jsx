import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth, RequireAuth } from '../context/AuthContext';

function UserProfilePanel() {
  const { user, reload } = useAuth();
  const [form, setForm] = useState({
    name: '',
    email: '',
    region: '',
    mobile: '',
    current_password: '',
    new_password: '',
    confirm_password: '',
    mfa_policy: 'inherit',
    mfa_mode: 'inherit',
  });
  const [mfaInfo, setMfaInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return;
    setForm((f) => ({
      ...f,
      name: user.name || '',
      email: user.email || '',
      region: user.region || '',
      mobile: user.mobile || '',
      mfa_policy: user.mfa_policy || 'inherit',
      mfa_mode: user.mfa_mode || 'inherit',
    }));
    api
      .authMe()
      .then((data) => {
        const m = data.mfa || {};
        setMfaInfo({
          enabled: data.mfa_enabled ?? m.enabled,
          effective_mode: data.mfa_mode || m.mode,
          platform_require_mfa: m.platform_require_mfa,
          platform_mfa_mode: m.platform_mfa_mode,
          policy: m.policy || data.user?.mfa_policy || 'inherit',
          user_mfa_mode: m.user_mfa_mode ?? data.user?.mfa_mode ?? null,
        });
        setForm((f) => ({
          ...f,
          mfa_policy: data.user?.mfa_policy || m.policy || 'inherit',
          mfa_mode: data.user?.mfa_mode || m.user_mfa_mode || 'inherit',
        }));
      })
      .catch(() => {});
  }, [user]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (form.new_password && form.new_password !== form.confirm_password) {
      setError('New passwords do not match');
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name,
        email: form.email,
        region: form.region,
        mobile: form.mobile,
        mfa_policy: form.mfa_policy,
        mfa_mode: form.mfa_mode === 'inherit' ? 'inherit' : form.mfa_mode,
      };
      if (form.new_password) {
        body.current_password = form.current_password;
        body.new_password = form.new_password;
      }
      const data = await api.authUpdateProfile(body);
      await reload();
      if (data.mfa) {
        setMfaInfo((prev) => ({
          ...prev,
          enabled: data.mfa.enabled,
          effective_mode: data.mfa.mode,
          platform_require_mfa: data.mfa.platform_require_mfa,
          platform_mfa_mode: data.mfa.platform_mfa_mode,
          policy: data.mfa.policy,
          user_mfa_mode: data.mfa.user_mfa_mode,
        }));
      }
      setMessage('Profile updated.');
      setForm((f) => ({ ...f, current_password: '', new_password: '', confirm_password: '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const platRequire = mfaInfo?.platform_require_mfa;
  const platMode = mfaInfo?.platform_mfa_mode || 'EMAIL';

  return (
    <div style={{ padding: '1.5rem', maxWidth: 520, margin: '0 auto' }}>
      <Link to="/" style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>← Dashboard</Link>
      <h1 style={{ margin: '0.5rem 0 0' }}>My profile</h1>
      <p style={{ color: 'var(--muted)', marginTop: '0.25rem' }}>
        Account: {user?.id} · Role: {user?.role}
      </p>

      {error && <div style={{ color: '#f87171', marginTop: '1rem' }}>{error}</div>}
      {message && <div style={{ color: '#22c55e', marginTop: '1rem' }}>{message}</div>}

      <form onSubmit={save} style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Name</span>
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            required
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Email</span>
          <input
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            required
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Region</span>
          <input
            value={form.region}
            onChange={(e) => set('region', e.target.value)}
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Mobile</span>
          <input
            value={form.mobile}
            onChange={(e) => set('mobile', e.target.value)}
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          />
        </label>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0.5rem 0' }} />
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
          Multi-factor authentication
          {mfaInfo && (
            <>
              {' '}
              — currently {mfaInfo.enabled ? 'on' : 'off'} via {mfaInfo.effective_mode}
              {` (platform: ${platRequire ? 'required' : 'optional'} / ${platMode})`}
            </>
          )}
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Require MFA</span>
          <select
            value={form.mfa_policy}
            onChange={(e) => set('mfa_policy', e.target.value)}
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            <option value="inherit">Use platform default ({platRequire ? 'on' : 'off'})</option>
            <option value="on">Always required</option>
            <option value="off">Disabled for this account</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>MFA method</span>
          <select
            value={form.mfa_mode === null || form.mfa_mode === '' ? 'inherit' : form.mfa_mode}
            onChange={(e) => set('mfa_mode', e.target.value)}
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            <option value="inherit">Use platform default ({platMode})</option>
            <option value="EMAIL">Email OTP</option>
            <option value="TOTP">Authenticator app (TOTP)</option>
          </select>
        </label>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0.5rem 0' }} />
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>Change password (optional)</p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Current password</span>
          <input
            type="password"
            value={form.current_password}
            onChange={(e) => set('current_password', e.target.value)}
            autoComplete="current-password"
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>New password</span>
          <input
            type="password"
            value={form.new_password}
            onChange={(e) => set('new_password', e.target.value)}
            autoComplete="new-password"
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Confirm new password</span>
          <input
            type="password"
            value={form.confirm_password}
            onChange={(e) => set('confirm_password', e.target.value)}
            autoComplete="new-password"
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          style={{ padding: '0.65rem 1rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', marginTop: '0.5rem' }}
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </div>
  );
}

export default function UserProfile() {
  return (
    <RequireAuth>
      <UserProfilePanel />
    </RequireAuth>
  );
}
