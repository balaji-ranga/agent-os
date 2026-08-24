import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tokenFromUrl = params.get('token') || '';
  const [token, setToken] = useState(tokenFromUrl);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (password.length < 12) {
      setError('Password must be at least 12 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword({ token, password });
      setOk('Password updated. You can sign in now.');
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err.message || 'Reset failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '3rem auto', padding: '0 1rem' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Set new password</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
        Paste the token from your email link if it is not already filled in.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ fontSize: '0.85rem' }}>
          Reset token
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            style={{ display: 'block', width: '100%', marginTop: 4, padding: '0.5rem' }}
          />
        </label>
        <label style={{ fontSize: '0.85rem' }}>
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            style={{ display: 'block', width: '100%', marginTop: 4, padding: '0.5rem' }}
          />
        </label>
        <label style={{ fontSize: '0.85rem' }}>
          Confirm password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={12}
            style={{ display: 'block', width: '100%', marginTop: 4, padding: '0.5rem' }}
          />
        </label>
        {error && <p style={{ color: '#b91c1c', margin: 0 }}>{error}</p>}
        {ok && <p style={{ color: '#15803d', margin: 0 }}>{ok}</p>}
        <button type="submit" disabled={busy} className="wf-btn wf-btn-primary">
          {busy ? 'Saving?' : 'Update password'}
        </button>
      </form>
      <p style={{ marginTop: '1rem' }}>
        <Link to="/login">Back to login</Link>
      </p>
    </div>
  );
}
