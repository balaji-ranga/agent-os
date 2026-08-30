import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth, RequireAuth } from '../context/AuthContext';
import { ROLE_TITLE_PRESETS, userRoleTitle } from '../utils/userRoleTitle.js';
import { COMMON_DISPLAY_TIMEZONES } from '../utils/commonTimezones.js';
import { formatLocalDateTime } from '../utils/formatDateTime.js';
import RobotAvatar, { fileToDataUrl } from '../components/RobotAvatar.jsx';
import ThemePicker from '../components/ThemePicker.jsx';
import IsoCountryRegionSelect from '../components/IsoCountryRegionSelect.jsx';

function UserProfilePanel() {
  const { user, reload, platformTimezone, displayTimezone } = useAuth();
  const [form, setForm] = useState({
    name: '',
    email: '',
    country: '',
    region: '',
    mobile: '',
    role_title: 'CEO',
    display_timezone: '',
    industry: 'personal',
    industry_other: '',
    business_name: '',
    current_password: '',
    new_password: '',
    confirm_password: '',
    mfa_policy: 'inherit',
    mfa_mode: 'inherit',
    llm_provider: 'platform_decided',
    llm_model: '',
    llm_api_key: '',
    clear_llm_api_key: false,
    llm_efficiency_mode: false,
    data_retention_days: 90,
  });
  const [roleTitleCustom, setRoleTitleCustom] = useState(false);
  const [industries, setIndustries] = useState([]);
  const [llmCatalog, setLlmCatalog] = useState({ providers: [] });
  const [llmModelCustom, setLlmModelCustom] = useState(false);
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
  const [profileImage, setProfileImage] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [biz, setBiz] = useState({ crm_provider: 'none', erp_provider: 'none' });
  const [bizMeta, setBizMeta] = useState(null);
  const [bizBusy, setBizBusy] = useState(false);
  const [promotionPrefs, setPromotionPrefs] = useState({ whatsapp_consent: false });
  const [promotionPrefsBusy, setPromotionPrefsBusy] = useState(false);

  const loadOcConnections = () => {
    api
      .openconnectorConnections()
      .then((data) => setOcConnections(data.connections || []))
      .catch(() => setOcConnections([]));
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#appearance') return;
    const el = document.getElementById('appearance');
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }, []);

  useEffect(() => {
    if (!user || user.role !== 'ceo') return;
    api
      .businessCoreProfile()
      .then((data) => {
        setBizMeta(data);
        setBiz({
          crm_provider: data?.profile?.crm_provider || 'none',
          erp_provider: data?.profile?.erp_provider || 'none',
        });
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user || user.role !== 'ceo') return;
    api.promotionPreferences().then(setPromotionPrefs).catch(() => {});
  }, [user]);

  const saveBusinessCore = () => {
    setBizBusy(true);
    setError(null);
    setMessage(null);
    api
      .businessCoreUpdateProfile({
        crm_provider: biz.crm_provider,
        erp_provider: biz.erp_provider,
        provision: true,
      })
      .then((data) => {
        setBizMeta((m) => ({ ...(m || {}), profile: data.profile }));
        setBiz({
          crm_provider: data.profile?.crm_provider || 'none',
          erp_provider: data.profile?.erp_provider || 'none',
        });
        const prefabCrm =
          data.prefab?.agents?.length
            ? ` Prefab CRM agents: ${data.prefab.agents.join(', ')}.`
            : data.prefab?.revoked?.length
              ? ' Platform CRM agents removed from org (CRM is not Twenty/ERPNext).'
              : '';
        const prefabErp =
          data.prefab_erp?.agents?.length
            ? ` Prefab ERP agents: ${data.prefab_erp.agents.join(', ')}.`
            : data.prefab_erp?.revoked?.length
              ? ' Platform ERP agents removed from org (ERP is not ERPNext).'
              : '';
        setMessage(`Business Core saved.${prefabCrm}${prefabErp}`);
      })
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setBizBusy(false));
  };

  useEffect(() => {
    if (!user) return;
    setForm((f) => ({
      ...f,
      name: user.name || '',
      email: user.email || '',
      country: user.country || '',
      region: user.region || '',
      mobile: user.mobile || '',
      role_title: userRoleTitle(user),
      display_timezone: user.display_timezone || '',
      industry: user.industry || 'personal',
      industry_other: user.industry_other || '',
      business_name: user.business_name || '',
      mfa_policy: user.mfa_policy || 'inherit',
      mfa_mode: user.mfa_mode || 'inherit',
      llm_provider: user.llm_provider || 'platform_decided',
      llm_model: user.llm_model || '',
      llm_api_key: '',
      clear_llm_api_key: false,
      llm_efficiency_mode: !!user.llm_efficiency_mode,
      data_retention_days: user.data_retention_days || 90,
    }));
    const title = userRoleTitle(user);
    setRoleTitleCustom(!!user.role_title && !ROLE_TITLE_PRESETS.includes(title));
    setLastLoginAt(user.last_login_at || null);
    setLlmHint(user.llm_api_key_hint || null);
    setProfileImage(user.profile_image || '');
    api
      .authIndustries()
      .then((d) => setIndustries(d.industries || []))
      .catch(() => setIndustries([]));
    api
      .authLlmCatalog()
      .then((d) => setLlmCatalog(d || { providers: [] }))
      .catch(() => setLlmCatalog({ providers: [] }));
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
        const nextProvider = data.user?.llm_provider || 'platform_decided';
        const nextModel = data.user?.llm_model || '';
        setForm((f) => ({
          ...f,
          mfa_policy: data.user?.mfa_policy || m.policy || 'inherit',
          mfa_mode: data.user?.mfa_mode || m.user_mfa_mode || 'inherit',
          llm_provider: nextProvider,
          llm_model: nextModel,
          llm_efficiency_mode: !!data.user?.llm_efficiency_mode,
          industry: data.user?.industry || f.industry || 'personal',
          industry_other: data.user?.industry_other || '',
          business_name: data.user?.business_name || '',
          role_title: userRoleTitle(data.user || user),
          display_timezone: data.user?.display_timezone || '',
          data_retention_days: data.user?.data_retention_days || f.data_retention_days || 90,
        }));
        const nextTitle = userRoleTitle(data.user || user);
        setRoleTitleCustom(!!data.user?.role_title && !ROLE_TITLE_PRESETS.includes(nextTitle));
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
    if (form.new_password && form.new_password.length < 12) {
      setError('New password must be at least 12 characters');
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name,
        email: form.email,
        country: form.country,
        region: form.region,
        mobile: form.mobile,
        role_title: String(form.role_title || '').trim() || 'CEO',
        display_timezone: form.display_timezone || '',
        industry: form.industry,
        industry_other: form.industry_other,
        business_name: form.business_name,
        mfa_policy: form.mfa_policy,
        mfa_mode: form.mfa_mode === 'inherit' ? 'inherit' : form.mfa_mode,
        llm_provider: form.llm_provider,
        llm_model:
          form.llm_provider === 'platform_decided'
            ? null
            : form.llm_model || undefined,
        llm_efficiency_mode: !!form.llm_efficiency_mode,
      };
      if (user?.role === 'ceo') body.data_retention_days = Number(form.data_retention_days) || 90;
      if (form.new_password) {
        body.current_password = form.current_password;
        body.new_password = form.new_password;
      }
      if (form.clear_llm_api_key) {
        body.clear_llm_api_key = true;
      }
      // llm_api_key no longer accepted — use Settings → API Keys (Platform_BYOK)
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
        llm_model: data.user?.llm_model || f.llm_model,
        llm_efficiency_mode: !!data.user?.llm_efficiency_mode,
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const platRequire = mfaInfo?.platform_require_mfa;
  const platMode = mfaInfo?.platform_mfa_mode || 'EMAIL';
  const selectedLlmProvider =
    (llmCatalog.providers || []).find((p) => p.id === form.llm_provider) || null;
  const curatedModels = selectedLlmProvider?.models || [];
  const modelInCatalog = curatedModels.some((m) => m.id === form.llm_model);
  const showCustomModel =
    !!selectedLlmProvider?.allow_custom_model && (llmModelCustom || (form.llm_model && !modelInCatalog));

  const onLlmProviderChange = (next) => {
    const meta = (llmCatalog.providers || []).find((p) => p.id === next);
    setLlmModelCustom(false);
    setForm((f) => ({
      ...f,
      llm_provider: next,
      llm_model: next === 'platform_decided' ? '' : meta?.default_model || '',
    }));
  };

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
    <div style={{ padding: '1.5rem', maxWidth: 640, margin: '0 auto' }}>
      <Link to="/org" style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>← My Org</Link>
      <h1 style={{ margin: '0.5rem 0 0' }}>My profile</h1>
      <p style={{ color: 'var(--muted)', marginTop: '0.25rem' }}>
        Account: {user?.id} · Title: {userRoleTitle(user)}
      </p>
      <p style={{ color: 'var(--muted)', marginTop: '0.25rem', fontSize: '0.9rem' }}>
        Last login: {lastLoginAt ? formatLocalDateTime(lastLoginAt) : '—'}
        {displayTimezone ? (
          <span title="Your profile display timezone"> · showing {displayTimezone}</span>
        ) : null}
      </p>

      {error && <div style={{ color: '#f87171', marginTop: '1rem' }}>{error}</div>}
      {message && <div style={{ color: '#22c55e', marginTop: '1rem' }}>{message}</div>}

      <div id="appearance" style={{ marginTop: '1.25rem' }}>
        <ThemePicker />
      </div>

      {user?.role === 'ceo' && <section className="card" style={{ marginTop: '1.25rem' }}>
        <h2 style={{ marginTop: 0 }}>Announcement channels</h2>
        <p style={{ color: 'var(--muted)' }}>In-app announcements may appear after login. WhatsApp promotions are sent only with your explicit consent and a paired channel.</p>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}><input type="checkbox" checked={promotionPrefs.whatsapp_consent} onChange={async(e)=>{const whatsapp_consent=e.target.checked;setPromotionPrefsBusy(true);try{setPromotionPrefs(await api.promotionPreferencesSave({whatsapp_consent}));setMessage('Announcement preference saved.')}catch(err){setError(err.message)}finally{setPromotionPrefsBusy(false)}}} disabled={promotionPrefsBusy}/> Allow clearly labelled Flolah announcements on my paired WhatsApp channel</label>
      </section>}

      <form onSubmit={save} style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <RobotAvatar src={profileImage || user?.profile_image} name={form.name || user?.name} size={72} variant="user" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Profile photo</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={avatarBusy || busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setAvatarBusy(true);
                setError(null);
                setMessage(null);
                try {
                  const dataUrl = await fileToDataUrl(file);
                  const data = await api.authUpdateProfile({ profile_image: dataUrl });
                  setProfileImage(data.user?.profile_image || dataUrl);
                  await reload();
                  setMessage('Profile photo updated.');
                } catch (err) {
                  setError(err.message || 'Failed to update photo');
                } finally {
                  setAvatarBusy(false);
                }
              }}
            />
            {(profileImage || user?.profile_image) && (
              <button
                type="button"
                disabled={avatarBusy || busy}
                onClick={async () => {
                  setAvatarBusy(true);
                  setError(null);
                  try {
                    await api.authUpdateProfile({ clear_profile_image: true });
                    setProfileImage('');
                    await reload();
                    setMessage('Profile photo removed.');
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setAvatarBusy(false);
                  }
                }}
                style={{ alignSelf: 'flex-start', fontSize: '0.85rem' }}
              >
                Remove photo
              </button>
            )}
          </div>
        </div>
        {user?.role === 'ceo' && <>
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
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Your title</span>
          <select
            value={roleTitleCustom ? '__custom__' : ROLE_TITLE_PRESETS.includes(form.role_title) ? form.role_title : '__custom__'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__custom__') {
                setRoleTitleCustom(true);
                if (ROLE_TITLE_PRESETS.includes(form.role_title)) set('role_title', '');
              } else {
                setRoleTitleCustom(false);
                set('role_title', v);
              }
            }}
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            {ROLE_TITLE_PRESETS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value="__custom__">Custom…</option>
          </select>
          {(roleTitleCustom || !ROLE_TITLE_PRESETS.includes(form.role_title)) && (
            <input
              value={form.role_title}
              onChange={(e) => set('role_title', e.target.value)}
              placeholder="e.g. Founder & CEO"
              maxLength={64}
              style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', marginTop: 4 }}
            />
          )}
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            Shown in My Org, profile menu, and org chart. Does not change account permissions.
          </span>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Display timezone</span>
          <select
            value={
              COMMON_DISPLAY_TIMEZONES.some((z) => z.value === (form.display_timezone || ''))
                ? form.display_timezone || ''
                : form.display_timezone
                  ? '__custom__'
                  : ''
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__custom__') return;
              set('display_timezone', v);
            }}
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            {COMMON_DISPLAY_TIMEZONES.map((z) => (
              <option key={z.value || 'platform'} value={z.value}>
                {z.label}
                {z.value === '' && platformTimezone ? ` (${platformTimezone})` : ''}
              </option>
            ))}
            {form.display_timezone &&
              !COMMON_DISPLAY_TIMEZONES.some((z) => z.value === form.display_timezone) && (
                <option value="__custom__">{form.display_timezone} (custom)</option>
              )}
          </select>
          <input
            type="text"
            placeholder="Or IANA zone e.g. Asia/Singapore"
            value={form.display_timezone}
            onChange={(e) => set('display_timezone', e.target.value.trim())}
            style={{
              marginTop: 4,
              padding: '0.5rem 0.75rem',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '0.9rem',
            }}
          />
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            All times in the app (Kanban, Workspace, chat, logs) use this zone. DB keeps UTC. Leave
            empty for platform default
            {platformTimezone ? ` (${platformTimezone})` : ''}.
          </span>
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
        <IsoCountryRegionSelect
          country={form.country}
          region={form.region}
          onChange={({ country, region }) => setForm((f) => ({ ...f, country, region }))}
          countryLabel="Country"
          regionLabel="Region"
          selectStyle={{
            padding: '0.6rem 0.75rem',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
          }}
        />
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
            Company-wide for you and all employees. After this period, chats, call history/transcripts, workflow runs, uploaded/generated content, and tenant RAG documents are permanently deleted (daily job + manual purge).
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
        </>}
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

        {user?.role === 'ceo' && (
          <>
            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0.5rem 0' }} />
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
              Business Core (optional) — platform CRM: Twenty or ERPNext (Sales/CRM modules); ERP: ERPNext.
              Save provisions workspace/company + prefab Maker/Checker agents for the selected platforms.
            </p>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>CRM</span>
              <select
                value={biz.crm_provider}
                onChange={(e) => setBiz((b) => ({ ...b, crm_provider: e.target.value }))}
                style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
              >
                <option value="none">None</option>
                <option value="twenty">Twenty (platform CRM)</option>
                <option value="erpnext">ERPNext (Sales/CRM modules)</option>
                <option value="hubspot">HubSpot (connect)</option>
                <option value="zoho">Zoho (connect)</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>ERP</span>
              <select
                value={biz.erp_provider}
                onChange={(e) => setBiz((b) => ({ ...b, erp_provider: e.target.value }))}
                style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
              >
                <option value="none">None</option>
                <option value="erpnext">ERPNext (platform)</option>
                <option value="xero">Xero (connect)</option>
              </select>
            </label>
            {bizMeta?.profile?.twenty?.bound && (
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
                Twenty workspace: {bizMeta.profile.twenty.workspace_name || bizMeta.profile.twenty.workspace_id}
              </p>
            )}
            {bizMeta?.profile?.erpnext?.bound && (
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
                ERPNext company: {bizMeta.profile.erpnext.company_name || bizMeta.profile.erpnext.company_id}
              </p>
            )}
            <button
              type="button"
              className="btn-primary"
              disabled={bizBusy}
              onClick={saveBusinessCore}
              style={{ alignSelf: 'flex-start' }}
            >
              {bizBusy ? 'Saving Business Core…' : 'Save CRM / ERP'}
            </button>
          </>
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
          <code>Platform_BYOK</code> under <Link to="/api-keys">Settings → API Keys</Link>.
          Video (<code>generate_video</code>) on a non-platform provider also needs{' '}
          <code>Replicate_BYOK</code>. Brave Search (<code>brave_web_search</code>) on a non-platform
          provider needs <code>BRAVE_SEARCH_BYOK</code>; Platform default uses ops{' '}
          <code>BRAVE_API_KEY</code>. Non-platform Profiles auto-seed these vault slots (plus{' '}
          <code>elevenlabs-key</code>) as unset under API Keys.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Provider</span>
          <select
            value={form.llm_provider}
            onChange={(e) => onLlmProviderChange(e.target.value)}
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            {(llmCatalog.providers || []).length > 0 ? (
              (llmCatalog.providers || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.needs_vault_key ? ' (BYOK via Platform_BYOK)' : ''}
                </option>
              ))
            ) : (
              <>
                <option value="platform_decided">Platform decided (use .env)</option>
                <option value="openai">OpenAI (BYOK via Platform_BYOK)</option>
                <option value="openrouter">OpenRouter (BYOK via Platform_BYOK)</option>
                <option value="ollama_free">Ollama Free (local)</option>
                <option value="deepseek">DeepSeek V3 (Ollama local)</option>
              </>
            )}
          </select>
        </label>
        {form.llm_provider !== 'platform_decided' && curatedModels.length > 0 && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Chat model</span>
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
              style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
              required={form.llm_provider === 'openai' || form.llm_provider === 'openrouter'}
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
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Custom model id</span>
            <input
              value={form.llm_model}
              onChange={(e) => set('llm_model', e.target.value)}
              placeholder={selectedLlmProvider?.default_model || 'model-id'}
              style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
              required={form.llm_provider === 'openai' || form.llm_provider === 'openrouter'}
            />
          </label>
        )}
        {selectedLlmProvider?.base_url && form.llm_provider !== 'platform_decided' && (
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
            Endpoint: <code>{selectedLlmProvider.base_url}</code>
          </p>
        )}
        {(form.llm_provider === 'openai' || form.llm_provider === 'openrouter') && (
          <p style={{ margin: 0, fontSize: '0.85rem', color: llmHint && llmHint !== 'unset' ? 'var(--muted)' : '#b45309' }}>
            {llmHint && llmHint !== 'unset'
              ? `Platform_BYOK on file (${llmHint}). Manage under `
              : 'Platform_BYOK is required before this provider will work. Set it under '}
            <Link to="/api-keys">API Keys</Link>.
          </p>
        )}

        {form.llm_provider === 'deepseek' && (
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
            Uses local Ollama <code>{form.llm_model || 'deepseek-v3'}</code> — no API key. Requires optional-ollama and{' '}
            <code>ollama pull {form.llm_model || 'deepseek-v3'}</code>.
          </p>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Efficiency mode</span>
          <select
            value={form.llm_efficiency_mode ? 'yes' : 'no'}
            onChange={(e) => set('llm_efficiency_mode', e.target.value === 'yes')}
            style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </label>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
          Yes: short jobs (learnings summary, chat archive titles, Brain / IBKR recaps, broadcast/COO classify,
          leftover goal-plan args, policy/goal text enrich) use local Ollama instead of Platform_BYOK.
          Agent Chat, Workflow Builder, certify, browser, vision, and image/video stay on your Profile provider.
          Needs a running Ollama service. No = existing paid / platform model (no change).
        </p>

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
            minLength={12}
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
            minLength={12}
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
