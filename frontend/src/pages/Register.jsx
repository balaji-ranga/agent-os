import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { LEGAL_PATHS, FALLBACK_LEGAL_VERSIONS, PUBLIC_BLOG_PATH, PUBLIC_DOCS_PATH, PUBLIC_FORUM_PATH } from '../utils/legalLinks';
import TotpEnrollmentDetails from '../components/TotpEnrollmentDetails';
import { resolveTotpEnrollment } from '../utils/totpEnrollment';
import IsoCountryRegionSelect from '../components/IsoCountryRegionSelect.jsx';

const FALLBACK_LLM_PROVIDERS = [
  { id: 'platform_decided', label: 'Platform decided (use .env)', needs_vault_key: false, models: [], default_model: null },
  {
    id: 'openai',
    label: 'OpenAI',
    needs_vault_key: true,
    allow_custom_model: true,
    default_model: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'gpt-4o', label: 'GPT-4o' },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    needs_vault_key: true,
    allow_custom_model: true,
    default_model: 'openai/gpt-4o-mini',
    models: [{ id: 'openai/gpt-4o-mini', label: 'OpenAI GPT-4o mini' }],
  },
  {
    id: 'ollama_free',
    label: 'Ollama Free (local)',
    needs_vault_key: false,
    allow_custom_model: true,
    default_model: 'llama3.2',
    models: [{ id: 'llama3.2', label: 'Llama 3.2' }],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek V3 (Ollama local)',
    needs_vault_key: false,
    default_model: 'deepseek-v3',
    models: [{ id: 'deepseek-v3', label: 'DeepSeek V3 (local)' }],
  },
];

export default function Register() {
  const { register, completeMfa, resendMfa } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    country: '',
    region: '',
    mobile: '',
    db_mode: 'tenant',
    industry: 'personal',
    industry_other: '',
    business_name: '',
    mfa_policy: 'inherit',
    mfa_mode: 'inherit',
    llm_provider: 'platform_decided',
    llm_model: '',
    llm_api_key: '',
  });
  const [industries, setIndustries] = useState([]);
  const [llmCatalog, setLlmCatalog] = useState({ providers: [] });
  const [llmModelCustom, setLlmModelCustom] = useState(false);
  const [platform, setPlatform] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [mfa, setMfa] = useState(null);
  const [otp, setOtp] = useState('');
  const [totpSecret, setTotpSecret] = useState(null);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [legalVersions, setLegalVersions] = useState(FALLBACK_LEGAL_VERSIONS);

  useEffect(() => {
    api.authMfaDefaults()
      .then(setPlatform)
      .catch(() => setPlatform(null));
    api.authIndustries()
      .then((d) => setIndustries(d.industries || []))
      .catch(() => setIndustries([]));
    api.authLlmCatalog()
      .then((d) => setLlmCatalog(d || { providers: [] }))
      .catch(() => setLlmCatalog({ providers: [] }));
    api.authLegalVersions()
      .then((d) =>
        setLegalVersions({
          terms_version: d.terms_version || FALLBACK_LEGAL_VERSIONS.terms_version,
          privacy_version: d.privacy_version || FALLBACK_LEGAL_VERSIONS.privacy_version,
        })
      )
      .catch(() => setLegalVersions(FALLBACK_LEGAL_VERSIONS));
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const goHome = () => navigate('/job-profiles');

  const llmProviders =
    (llmCatalog.providers || []).length > 0 ? llmCatalog.providers : FALLBACK_LLM_PROVIDERS;
  const selectedLlmProvider = llmProviders.find((p) => p.id === form.llm_provider) || null;
  const curatedModels = selectedLlmProvider?.models || [];
  const modelInCatalog = curatedModels.some((m) => m.id === form.llm_model);
  const showCustomModel =
    !!selectedLlmProvider?.allow_custom_model && (llmModelCustom || (form.llm_model && !modelInCatalog));

  const onLlmProviderChange = (next) => {
    const meta = llmProviders.find((p) => p.id === next);
    setLlmModelCustom(false);
    setForm((f) => ({
      ...f,
      llm_provider: next,
      llm_model: next === 'platform_decided' ? '' : meta?.default_model || '',
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!acceptTerms) {
      setError('You must accept the Terms of Service and Privacy Policy to register');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        ...form,
        mfa_mode: form.mfa_mode === 'inherit' ? null : form.mfa_mode,
        llm_model:
          form.llm_provider === 'platform_decided'
            ? null
            : form.llm_model || selectedLlmProvider?.default_model || undefined,
        accept_terms: true,
        terms_version: legalVersions.terms_version,
        privacy_version: legalVersions.privacy_version,
      };
      delete body.llm_api_key;
      const result = await register(body);
      if (result?.mfa_required) {
        setMfa(result);
        setOtp('');
        return;
      }
      if (result?.mfa_setup_required) {
        const setup = await resolveTotpEnrollment(result, api.authMfaSetupChallenge);
        setMfa(setup);
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
      <div className="auth-page" style={{ maxWidth: 480, margin: '2rem auto', padding: '0 1rem' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>Verification code</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
          {isEmail
            ? `Account created. We sent a 6-digit code to ${mfa.email_hint || 'your email'}.`
            : mfa.mfa_setup_required
              ? 'Add this account to your authenticator app, then enter the 6-digit code.'
              : 'Enter the 6-digit code from your authenticator app.'}
        </p>
        {!isEmail && mfa.mfa_setup_required && (
          <TotpEnrollmentDetails secret={totpSecret || mfa.secret} otpauthUrl={mfa.otpauth_url} />
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
  const needsVaultLater =
    selectedLlmProvider?.needs_vault_key === true ||
    form.llm_provider === 'openai' ||
    form.llm_provider === 'openrouter';

  return (
    <div className="auth-page" style={{ maxWidth: 480, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Start your AI company</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        Hire digital employees under your supervision. You get a COO, Workflow Builder, and Platform Help in{' '}
        <strong>your</strong> workspace (isolated — not shared with other CEOs).
      </p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {field('Full name', 'name', 'text', true)}
        {field('Email', 'email', 'email', true)}
        {field('Password', 'password', 'password', true)}
        <IsoCountryRegionSelect
          country={form.country}
          region={form.region}
          onChange={({ country, region }) => setForm((f) => ({ ...f, country, region }))}
          countryLabel="Country"
          regionLabel="Region"
          selectStyle={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
        />
        {field('Mobile', 'mobile', 'tel')}
        <label>
          <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Industry</span>
          <select
            value={form.industry}
            onChange={(e) => set('industry', e.target.value)}
            required
            style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
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
        {form.industry === 'others' && field('Industry (describe)', 'industry_other', 'text', true)}
        {form.industry && form.industry !== 'personal' && field('Business name', 'business_name', 'text', true)}
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
          LLM provider and default chat model — same options as Profile. Platform default and local Ollama/DeepSeek
          need no key. For OpenAI/OpenRouter, pick provider + model now; after login set vault key{' '}
          <code>Platform_BYOK</code> under Settings → API Keys (keys are never collected at registration).
          Non-platform choices seed vault slots (<code>Platform_BYOK</code>, <code>Replicate_BYOK</code>,{' '}
          <code>BRAVE_SEARCH_BYOK</code>, <code>elevenlabs-key</code>) as unset.
        </p>
        <label>
          <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Provider</span>
          <select
            value={form.llm_provider}
            onChange={(e) => onLlmProviderChange(e.target.value)}
            style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
          >
            {llmProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.needs_vault_key ? ' (BYOK via Platform_BYOK)' : ''}
              </option>
            ))}
          </select>
        </label>

        {form.llm_provider !== 'platform_decided' && curatedModels.length > 0 && (
          <label>
            <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Default chat model</span>
            <select
              value={showCustomModel ? '__custom__' : form.llm_model || selectedLlmProvider?.default_model || ''}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setLlmModelCustom(true);
                  set('llm_model', form.llm_model && !modelInCatalog ? form.llm_model : '');
                  return;
                }
                setLlmModelCustom(false);
                set('llm_model', e.target.value);
              }}
              style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
              required={needsVaultLater}
            >
              <option value="" disabled>
                Select a model…
              </option>
              {curatedModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {selectedLlmProvider?.allow_custom_model && (
                <option value="__custom__">Other (custom model id)…</option>
              )}
            </select>
          </label>
        )}
        {showCustomModel && (
          <label>
            <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Custom model id</span>
            <input
              value={form.llm_model}
              onChange={(e) => set('llm_model', e.target.value)}
              placeholder={selectedLlmProvider?.default_model || 'model-id'}
              style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
              required={needsVaultLater}
            />
          </label>
        )}
        {selectedLlmProvider?.base_url && form.llm_provider !== 'platform_decided' && (
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
            Endpoint: <code>{selectedLlmProvider.base_url}</code>
          </p>
        )}
        {needsVaultLater && (
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#b45309' }}>
            After you sign in, open <strong>API Keys</strong> and set <code>Platform_BYOK</code> before using this
            provider. You can change provider/model anytime on Profile.
          </p>
        )}
        {form.llm_provider === 'deepseek' && (
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
            Uses local Ollama model <code>{form.llm_model || 'deepseek-v3'}</code> — no API key. Start the optional-ollama
            profile and pull the model first.
          </p>
        )}

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

        <label
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            fontSize: '0.9rem',
            lineHeight: 1.45,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
            required
            style={{ marginTop: 3 }}
          />
          <span>
            I agree to the{' '}
            <a href={LEGAL_PATHS.terms} target="_blank" rel="noopener noreferrer">
              Terms of Service
            </a>{' '}
            and acknowledge the{' '}
            <a href={LEGAL_PATHS.privacy} target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </a>
            . I am responsible for validating AI outputs and applying human gates and policies before acting on them
            (version {legalVersions.terms_version}).
          </span>
        </label>

        {error && <div style={{ color: '#f87171' }}>{error}</div>}
        <button
          type="submit"
          disabled={submitting || !acceptTerms}
          style={{ padding: '0.65rem', borderRadius: 6, background: 'var(--accent)', color: '#fff', border: 'none' }}
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
        Already registered? <Link to="/login">Sign in</Link>
      </p>
      <footer
        style={{
          marginTop: '2rem',
          paddingTop: '1rem',
          borderTop: '1px solid var(--border)',
          textAlign: 'center',
          fontSize: '0.8rem',
          color: 'var(--muted)',
        }}
      >
        <a href={PUBLIC_DOCS_PATH} target="_blank" rel="noopener noreferrer">
          Docs
        </a>
        {' · '}
        <a href={PUBLIC_BLOG_PATH} target="_blank" rel="noopener noreferrer">
          Blog
        </a>
        {' · '}
        <a href={PUBLIC_FORUM_PATH} target="_blank" rel="noopener noreferrer">
          Forum
        </a>
        {' · '}
        <a href={LEGAL_PATHS.terms} target="_blank" rel="noopener noreferrer">
          Terms
        </a>
        {' · '}
        <a href={LEGAL_PATHS.privacy} target="_blank" rel="noopener noreferrer">
          Privacy
        </a>
        {' · '}
        <a href={LEGAL_PATHS.cookies} target="_blank" rel="noopener noreferrer">
          Cookies
        </a>
        {' · '}
        <a href={LEGAL_PATHS.openSource} target="_blank" rel="noopener noreferrer">
          Open source
        </a>
      </footer>
    </div>
  );
}
