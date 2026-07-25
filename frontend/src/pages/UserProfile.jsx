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
    industry: 'personal',
    industry_other: '',
    business_name: '',
    current_password: '',
    new_password: '',
    confirm_password: '',
    mfa_policy: 'inherit',
    mfa_mode: 'inherit',
    llm_provider: 'platform_decided',
    llm_api_key: '',
    clear_llm_api_key: false,
    data_retention_days: 90,
  });
  const [industries, setIndustries] = useState([]);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [lastLoginAt, setLastLoginAt] = useState(null);
  const [mfaInfo, setMfaInfo] = useState(null);
  const [llmHint, setLlmHint] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [oc, setOc] = useState({
    runtime_token: '',
    runtime_token_ref: '',
    clear_runtime_token: false,
    connection_name: '',
    runtime_token_hint: null,
    runtime_token_set: false,
    last_error: null,
  });
  const [ocConnections, setOcConnections] = useState([]);
  const [vaultKeys, setVaultKeys] = useState([]);

  const loadOcConnections = () => {
    api
      .openconnectorConnections()
      .then((data) => setOcConnections(data.connections || []))
      .catch(() => setOcConnections([]));
  };

  useEffect(() => {
    if (!user) return;
    setForm((f) => ({
      ...f,
      name: user.name || '',
      email: user.email || '',
      region: user.region || '',
      mobile: user.mobile || '',
      industry: user.industry || 'personal',
      industry_other: user.industry_other || '',
      business_name: user.business_name || '',
      mfa_policy: user.mfa_policy || 'inherit',
      mfa_mode: user.mfa_mode || 'inherit',
      llm_provider: user.llm_provider || 'platform_decided',
      llm_api_key: '',
      clear_llm_api_key: false,
      data_retention_days: user.data_retention_days || 90,
    }));
    setLastLoginAt(user.last_login_at || null);
    setLlmHint(user.llm_api_key_hint || null);
    api
      .authIndustries()
      .then((d) => setIndustries(d.industries || []))
      .catch(() => setIndustries([]));
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
          llm_provider: data.user?.llm_provider || 'platform_decided',
          industry: data.user?.industry || f.industry || 'personal',
          industry_other: data.user?.industry_other || '',
          business_name: data.user?.business_name || '',
          data_retention_days: data.user?.data_retention_days || f.data_retention_days || 90,
        }));
        setLastLoginAt(data.user?.last_login_at || null);
        setLlmHint(data.user?.llm_api_key_hint || null);
      })
      .catch(() => {});
    api
      .openconnectorLink()
      .then((data) =>
        setOc((prev) => ({
          ...prev,
          runtime_token: '',
          runtime_token_ref: data.runtime_token_ref || '',
          clear_runtime_token: false,
          connection_name: data.connection_name || '',
          runtime_token_hint: data.runtime_token_hint || null,
          runtime_token_set: !!data.runtime_token_set,
          last_error: data.last_error || null,
        }))
      )
      .catch(() => {});
    api
      .userApiKeysList()
      .then((r) => setVaultKeys(r.keys || []))
      .catch(() => setVaultKeys([]));
    loadOcConnections();
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
        industry: form.industry,
        industry_other: form.industry_other,
        business_name: form.business_name,
        mfa_policy: form.mfa_policy,
        mfa_mode: form.mfa_mode === 'inherit' ? 'inherit' : form.mfa_mode,
        llm_provider: form.llm_provider,
        data_retention_days: Number(form.data_retention_days) || 90,
      };
      if (form.new_password) {
        body.current_password = form.current_password;
        body.new_password = form.new_password;
      }
      if (form.clear_llm_api_key) {
        body.clear_llm_api_key = true;
      }
      // llm_api_key no longer accepted — use Management → API Keys (Platform_BYOK)
      const data = await api.authUpdateProfile(body);
      if (
        oc.clear_runtime_token ||
        (oc.runtime_token && oc.runtime_token.trim()) ||
        oc.runtime_token_ref ||
        oc.connection_name
      ) {
        const link = await api.openconnectorLinkUpdate({
          runtime_token: oc.runtime_token && oc.runtime_token.trim() ? oc.runtime_token.trim() : undefined,
          runtime_token_ref: oc.runtime_token_ref || undefined,
          clear_runtime_token: oc.clear_runtime_token,
          connection_name: oc.connection_name,
        });
        setOc((prev) => ({
          ...prev,
          runtime_token: '',
          runtime_token_ref: link.runtime_token_ref || '',
          clear_runtime_token: false,
          connection_name: link.connection_name || prev.connection_name,
          runtime_token_hint: link.runtime_token_hint || null,
          runtime_token_set: !!link.runtime_token_set,
          last_error: link.last_error || null,
        }));
      }
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
      setLlmHint(data.user?.llm_api_key_hint || null);
      setMessage('Profile updated.');
      setForm((f) => ({
        ...f,
        current_password: '',
        new_password: '',
        confirm_password: '',
        llm_api_key: '',
        clear_llm_api_key: false,
        llm_provider: data.user?.llm_provider || f.llm_provider,
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const platRequire = mfaInfo?.platform_require_mfa;
  const platMode = mfaInfo?.platform_mfa_mode || 'EMAIL';

  const provisionOpenConnector = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = await api.openconnectorProvision();
      setOc((prev) => ({
        ...prev,
        runtime_token: '',
        clear_runtime_token: false,
        connection_name: data.connection_name || prev.connection_name,
        runtime_token_hint: data.runtime_token_hint || null,
        runtime_token_set: !!data.runtime_token_set,
        last_error: data.last_error || null,
      }));
      setMessage(
        data.created_token === false && data.runtime_token_set
          ? 'OpenConnector link refreshed (existing token kept).'
          : 'OpenConnector runtime token provisioned.'
      );
      loadOcConnections();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: 520, margin: '0 auto' }}>
      <Link to="/" style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>← Dashboard</Link>
      <h1 style={{ margin: '0.5rem 0 0' }}>My profile</h1>
      <p style={{ color: 'var(--muted)', marginTop: '0.25rem' }}>
        Account: {user?.id} · Role: {user?.role}
      </p>
      <p style={{ color: 'var(--muted)', marginTop: '0.25rem', fontSize: '0.9rem' }}>
        Last login:{' '}
        {lastLoginAt
          ? new Date(lastLoginAt.endsWith('Z') || lastLoginAt.includes('+') ? lastLoginAt : `${lastLoginAt}Z`).toLocaleString()
          : '—'}
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
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Data persistence (retention)</span>
          <select
            value={form.data_retention_days || 90}
            onChange={(e) => set('data_retention_days', Number(e.target.value))}
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            {[30, 60, 90, 120, 365].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            After this period, chats, standup history, and workflow run instances are permanently deleted (daily job + Dashboard purge).
          </span>
        </label>
        <button
          type="button"
          disabled={purgeBusy || busy}
          onClick={async () => {
            if (
              !window.confirm(
                `Permanently delete data older than ${form.data_retention_days || 90} days? This cannot be undone.`
              )
            ) {
              return;
            }
            setPurgeBusy(true);
            setError(null);
            setMessage(null);
            try {
              const out = await api.efficiencyRetentionPurge();
              const d = out.deleted || {};
              setMessage(
                `Purged older than ${out.retention_days}d: chats ${d.chat_turns || 0}, standup ${d.standup_messages || 0}, runs ${d.workflow_runs || 0}`
              );
            } catch (err) {
              setError(err.message);
            } finally {
              setPurgeBusy(false);
            }
          }}
          style={{
            alignSelf: 'flex-start',
            padding: '0.45rem 0.85rem',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
            cursor: purgeBusy ? 'not-allowed' : 'pointer',
          }}
        >
          {purgeBusy ? 'Purging…' : 'Purge aged data now'}
        </button>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Industry</span>
          <select
            value={form.industry || 'personal'}
            onChange={(e) => set('industry', e.target.value)}
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            {(industries.length
              ? industries
              : [
                  { id: 'personal', label: 'Personal' },
                  { id: 'others', label: 'Others' },
                ]
            ).map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
        {form.industry === 'others' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Industry (describe)</span>
            <input
              value={form.industry_other}
              onChange={(e) => set('industry_other', e.target.value)}
              required
              style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
            />
          </label>
        )}
        {form.industry && form.industry !== 'personal' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Business name</span>
            <input
              value={form.business_name}
              onChange={(e) => set('business_name', e.target.value)}
              required
              style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
            />
          </label>
        )}

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
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
          LLM provider — Platform default / free models need no key. OpenAI/OpenRouter require vault key{' '}
          <code>Platform_BYOK</code> under <Link to="/api-keys">Management → API Keys</Link>.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Provider</span>
          <select
            value={form.llm_provider}
            onChange={(e) => set('llm_provider', e.target.value)}
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            <option value="platform_decided">Platform decided (use .env)</option>
            <option value="openai">OpenAI (BYOK via Platform_BYOK)</option>
            <option value="openrouter">OpenRouter (BYOK via Platform_BYOK)</option>
            <option value="ollama_free">Ollama Free (local)</option>
            <option value="deepseek">DeepSeek V3 (Ollama local)</option>
          </select>
        </label>
        {(form.llm_provider === 'openai' || form.llm_provider === 'openrouter') && (
          <p style={{ margin: 0, fontSize: '0.85rem', color: llmHint ? 'var(--muted)' : '#b45309' }}>
            {llmHint
              ? `Platform_BYOK on file (${llmHint}). Manage under `
              : 'Platform_BYOK is required before this provider will work. Create it under '}
            <Link to="/api-keys">API Keys</Link>.
          </p>
        )}

        {form.llm_provider === 'deepseek' && (
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
            Uses local Ollama <code>deepseek-v3</code> — no API key. Requires optional-ollama and{' '}
            <code>ollama pull deepseek-v3</code>.
          </p>
        )}

        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0.5rem 0' }} />
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
          OpenConnector link — paste a runtime token or select a vault key from{' '}
          <Link to="/api-keys">API Keys</Link>.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Runtime token source</span>
          <select
            value={oc.runtime_token_ref ? 'vault' : 'literal'}
            onChange={(e) => {
              if (e.target.value === 'literal') setOc((v) => ({ ...v, runtime_token_ref: '' }));
              else setOc((v) => ({ ...v, runtime_token: '', runtime_token_ref: vaultKeys[0]?.key_name || '' }));
            }}
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            <option value="literal">Literal token</option>
            <option value="vault">Vault key</option>
          </select>
        </label>
        {oc.runtime_token_ref ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
              Vault key {oc.runtime_token_hint ? `(${oc.runtime_token_hint})` : ''}
            </span>
            <select
              value={oc.runtime_token_ref}
              onChange={(e) => setOc((v) => ({ ...v, runtime_token_ref: e.target.value, runtime_token: '' }))}
              style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
            >
              <option value="">Select…</option>
              {vaultKeys.map((k) => (
                <option key={k.id} value={k.key_name}>
                  {k.key_name} {k.key_hint ? `(${k.key_hint})` : ''}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
              Runtime token {oc.runtime_token_hint ? `(saved: ${oc.runtime_token_hint})` : ''}
            </span>
            <input
              type="password"
              value={oc.runtime_token}
              onChange={(e) => setOc((v) => ({ ...v, runtime_token: e.target.value }))}
              placeholder={oc.runtime_token_set ? 'Leave blank to keep current token' : 'Paste oct_... token'}
              autoComplete="off"
              style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
            />
          </label>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Default connection name</span>
          <input
            value={oc.connection_name}
            onChange={(e) => setOc((v) => ({ ...v, connection_name: e.target.value }))}
            placeholder="ceo-yourid"
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          />
        </label>
        {oc.runtime_token_set && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: 'var(--muted)' }}>
            <input
              type="checkbox"
              checked={oc.clear_runtime_token}
              onChange={(e) => setOc((v) => ({ ...v, clear_runtime_token: e.target.checked }))}
            />
            Clear saved OpenConnector token
          </label>
        )}
        {oc.last_error && <p style={{ margin: 0, fontSize: '0.82rem', color: '#f87171' }}>{oc.last_error}</p>}
        {(message || error) && (
          <p style={{ margin: 0, fontSize: '0.85rem', color: error ? '#f87171' : '#16a34a' }}>
            {error || message}
          </p>
        )}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={busy}
            onClick={provisionOpenConnector}
            style={{ padding: '0.65rem 1rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            {busy ? 'Working…' : 'Auto provision token'}
          </button>
        </div>
        {oc.runtime_token_set && (
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)' }}>
            Linked{oc.runtime_token_hint ? ` (${oc.runtime_token_hint})` : ''}. Connection alias:{' '}
            <code>{oc.connection_name || '—'}</code>
          </p>
        )}
        {!!ocConnections.length && (
          <div style={{ marginTop: '0.5rem' }}>
            <p style={{ margin: '0 0 0.35rem', fontSize: '0.85rem', color: 'var(--muted)' }}>Connected apps</p>
            <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.9rem' }}>
              {ocConnections.map((c) => (
                <li key={c.app_id}>{c.app_name || c.app_id}</li>
              ))}
            </ul>
          </div>
        )}
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
          <Link to="/connectors">Manage connectors (Gmail, Drive, GitHub…)</Link>
        </p>

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
