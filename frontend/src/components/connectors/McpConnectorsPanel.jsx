import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../context/AuthContext';

/**
 * Connectors → MCPs: OAuth sessions for any registry MCP included via mcp_oauth_configs.
 * Admin (and CEO for own MCPs): pick servers from Integrations → MCP and enable OAuth.
 * CEO: optional App ID/secret/scopes override (stored per user; falls back to platform admin);
 * Connect / Disconnect per-account tokens.
 */
export default function McpConnectorsPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [connectors, setConnectors] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [presets, setPresets] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [oauthPolling, setOauthPolling] = useState(null);
  const [overrideOpen, setOverrideOpen] = useState({});
  const [overrides, setOverrides] = useState({});
  const [form, setForm] = useState({
    serverId: '',
    provider: 'facebook',
    displayName: '',
    clientId: '',
    clientSecret: '',
    scopes: '',
    authorizationUrl: '',
    tokenUrl: '',
  });
  const pollRef = useRef(null);

  const applyPreset = (provider, serverName) => {
    const p = presets.find((x) => x.id === provider);
    setForm((f) => ({
      ...f,
      provider,
      displayName: f.displayName || p?.label || serverName || '',
      scopes: p?.scopes || f.scopes,
      authorizationUrl: p?.authorization_url || (provider === 'oauth2' ? f.authorizationUrl : p?.authorization_url || ''),
      tokenUrl: p?.token_url || (provider === 'oauth2' ? f.tokenUrl : p?.token_url || ''),
    }));
  };

  const refresh = useCallback(async () => {
    try {
      const data = await api.mcpOauthConnectors();
      setConnectors(data.connectors || []);
      setCandidates(data.candidates || []);
      setPresets(data.provider_presets || []);
      setConfigs(data.configs || []);
      setCallbackUrl(data.callback_url || '');
      setError(null);
      setOverrides((prev) => {
        const next = { ...prev };
        for (const c of data.connectors || []) {
          if (!next[c.server_id]) {
            next[c.server_id] = {
              clientId: '',
              clientSecret: '',
              scopes: c.override_scopes || c.scopes || '',
            };
          }
        }
        return next;
      });
      // Prefer incomplete Facebook / Meta Graph so admin can paste App ID/Secret immediately
      const incomplete =
        (data.connectors || []).find((c) => !c.oauth_client_ready) ||
        (data.candidates || []).find((c) => c.oauth_included && !c.oauth_client_ready);
      const notIn = (data.candidates || []).find((c) => !c.oauth_included);
      const pick = incomplete || notIn;
      if (pick) {
        const serverId = pick.server_id;
        const provider =
          pick.provider ||
          pick.oauth_provider ||
          (String(serverId).includes('meta') || String(serverId).includes('facebook')
            ? 'facebook'
            : 'oauth2');
        setForm((f) =>
          f.serverId && f.clientId
            ? f
            : {
                ...f,
                serverId,
                provider,
                displayName: pick.name || pick.oauth_display_name || f.displayName,
              }
        );
      }
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const saveOverride = async (serverId, name) => {
    const o = overrides[serverId] || {};
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.mcpOauthOverrideSave(serverId, {
        client_id: o.clientId || undefined,
        client_secret: o.clientSecret || undefined,
        scopes: o.scopes || undefined,
        user_override: true,
      });
      setMessage(
        `Saved App ID/secret override for ${name || serverId}. Secret is encrypted at rest. Connect OAuth next.`
      );
      setOverrides((prev) => ({
        ...prev,
        [serverId]: { ...prev[serverId], clientSecret: '' },
      }));
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const clearOverride = async (serverId, name) => {
    if (!window.confirm(`Clear your App ID/secret override for ${name}? Platform admin credentials will be used.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.mcpOauthOverrideClear(serverId);
      setMessage(`Cleared override for ${name || serverId} — using platform defaults`);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refresh();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh]);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setOauthPolling(null);
  };

  const connectOAuth = async (serverId, name) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    stopPoll();
    try {
      const data = await api.mcpOauthStart(serverId);
      const url = data.authorization_url;
      if (!url) throw new Error('No authorization URL returned');
      const popup = window.open(url, 'mcp-oauth', 'width=640,height=720');
      setMessage(`Complete OAuth in the popup for ${name || serverId}. Waiting…`);
      setOauthPolling(serverId);
      const started = Date.now();
      pollRef.current = setInterval(async () => {
        if (Date.now() - started > 5 * 60 * 1000) {
          stopPoll();
          setMessage((m) => m || 'OAuth timed out — click Refresh.');
          return;
        }
        try {
          const c = await api.mcpOauthConnectors();
          setConnectors(c.connectors || []);
          const hit = (c.connectors || []).find(
            (x) => x.server_id === serverId && x.connection?.connected
          );
          if (hit || (popup && popup.closed)) {
            if (hit) {
              stopPoll();
              setMessage(
                `${hit.name} connected${hit.connection?.account_label ? ' as ' + hit.connection.account_label : ''}.`
              );
              if (popup && !popup.closed) popup.close();
            } else if (popup && popup.closed) {
              stopPoll();
              setMessage('OAuth popup closed. Click Refresh if the connection does not appear yet.');
            }
          }
        } catch {
          /* keep polling */
        }
      }, 2000);
    } catch (e) {
      setError(e.message);
      stopPoll();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (serverId, name) => {
    setBusy(true);
    setError(null);
    try {
      await api.mcpOauthDisconnect(serverId);
      setMessage(`Disconnected ${name || serverId}.`);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const includeFromRegistry = async (e) => {
    e.preventDefault();
    if (!form.serverId) {
      setError('Select an MCP from the registry first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        server_id: form.serverId,
        provider: form.provider,
        display_name: form.displayName || undefined,
        client_id: form.clientId || undefined,
        client_secret: form.clientSecret || undefined,
        scopes: form.scopes || undefined,
        enabled: true,
      };
      if (form.provider === 'oauth2' || form.authorizationUrl) {
        body.authorization_url = form.authorizationUrl || undefined;
        body.token_url = form.tokenUrl || undefined;
      }
      await api.mcpOauthInclude(body);
      setMessage(
        `Included ${form.serverId} on Connectors → MCPs. CEOs can Connect with OAuth once the client id/secret is set.`
      );
      setForm((f) => ({ ...f, clientSecret: '' }));
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const exclude = async (serverId, name) => {
    setBusy(true);
    setError(null);
    try {
      await api.mcpOauthExclude(serverId);
      setMessage(`Removed ${name || serverId} from the MCPs OAuth tab (disabled; not deleted from registry).`);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const included = candidates.filter((c) => c.oauth_included);
  // Always show "Include…" — platform OAuth is admin; CEOs can include own registry MCPs.
  const pickable = isAdmin
    ? candidates
    : candidates.filter((c) => !c.is_platform);
  const canSubmitInclude = isAdmin || pickable.length > 0;

  const onSelectServer = (serverId) => {
    const c = candidates.find((x) => x.server_id === serverId);
    setForm((f) => {
      let provider = f.provider;
      // Heuristic defaults
      const n = `${c?.name || ''} ${serverId}`.toLowerCase();
      if (n.includes('meta') || n.includes('facebook')) provider = 'facebook';
      else if (n.includes('linkedin')) provider = 'linkedin';
      else if (n.includes('github')) provider = 'github';
      else if (n.includes('google')) provider = 'google';
      const p = presets.find((x) => x.id === provider);
      return {
        ...f,
        serverId,
        displayName: c?.oauth_display_name || c?.name || f.displayName,
        provider,
        scopes: p?.scopes || f.scopes,
        authorizationUrl: p?.authorization_url || f.authorizationUrl,
        tokenUrl: p?.token_url || f.tokenUrl,
      };
    });
  };

  return (
    <div>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        OAuth for MCP tool servers used in Workflows (<code>mcp_tool</code> nodes). Tokens are per CEO account.
        Only MCPs <strong>included</strong> from the{' '}
        <Link to="/integrations/mcp">MCP registry</Link> appear here — not every onboarded server by default
        (e.g. Brave Search stays header/BYOK).
      </p>
      {error && <div style={{ color: '#dc2626', marginTop: '0.75rem' }}>{error}</div>}
      {message && <div style={{ color: '#16a34a', marginTop: '0.75rem' }}>{message}</div>}
      {oauthPolling && (
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Waiting for OAuth…</p>
      )}

      <section style={{ marginTop: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Your MCP OAuth connections</h2>
          <button type="button" className="wf-btn" disabled={busy} onClick={() => refresh()}>
            Refresh
          </button>
        </div>
        {!connectors.length && (
          <p style={{ margin: '0.75rem 0 0', color: 'var(--muted)' }}>
            No OAuth-enabled MCPs yet. Scroll to <strong>Include from MCP registry</strong> below
            {isAdmin ? ' (platform admin can add Facebook, LinkedIn, …).' : ' or ask a platform admin for shared OAuth MCPs.'}
          </p>
        )}
        <ul style={{ margin: '0.75rem 0 0', paddingLeft: 0, listStyle: 'none' }}>
          {connectors.map((c) => (
            <li
              key={c.server_id}
              style={{
                marginBottom: 12,
                padding: '0.75rem',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <strong>{c.name}</strong>
                <code style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{c.server_id}</code>
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                  {c.provider} · MCP {c.server_status || '—'}
                </span>
                {c.credentials_source === 'user' ? (
                  <span style={{ fontSize: '0.75rem', color: '#0d9488' }}>your App credentials</span>
                ) : (
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>platform App credentials</span>
                )}
              </div>
              {c.description && (
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
                  {c.description}
                </p>
              )}
              {!isAdmin && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '0.65rem',
                    borderRadius: 6,
                    border: '1px dashed var(--border)',
                    background: 'color-mix(in srgb, var(--muted) 8%, transparent)',
                  }}
                >
                  <button
                    type="button"
                    className="wf-btn"
                    style={{ fontSize: '0.85rem' }}
                    onClick={() =>
                      setOverrideOpen((o) => ({ ...o, [c.server_id]: !o[c.server_id] }))
                    }
                  >
                    {overrideOpen[c.server_id] ? 'Hide' : 'App ID / secret override'}…
                  </button>
                  <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
                    Optional. Leave empty to use the platform admin Meta app. Your secret is encrypted with the
                    platform key. After saving, click <strong>Connect with OAuth</strong>.
                  </p>
                  {overrideOpen[c.server_id] && (
                    <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                      <input
                        value={overrides[c.server_id]?.clientId || ''}
                        onChange={(e) =>
                          setOverrides((prev) => ({
                            ...prev,
                            [c.server_id]: { ...prev[c.server_id], clientId: e.target.value },
                          }))
                        }
                        placeholder={
                          c.override_client_id_hint
                            ? `App ID (saved ${c.override_client_id_hint})`
                            : 'App ID / Client ID'
                        }
                      />
                      <input
                        type="password"
                        value={overrides[c.server_id]?.clientSecret || ''}
                        onChange={(e) =>
                          setOverrides((prev) => ({
                            ...prev,
                            [c.server_id]: { ...prev[c.server_id], clientSecret: e.target.value },
                          }))
                        }
                        placeholder={
                          c.override_secret_set
                            ? 'App secret (leave blank to keep saved)'
                            : 'App secret'
                        }
                      />
                      <input
                        value={overrides[c.server_id]?.scopes ?? c.override_scopes ?? c.scopes ?? ''}
                        onChange={(e) =>
                          setOverrides((prev) => ({
                            ...prev,
                            [c.server_id]: { ...prev[c.server_id], scopes: e.target.value },
                          }))
                        }
                        placeholder="scopes (override platform defaults)"
                      />
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        <button
                          type="button"
                          className="wf-btn-primary"
                          disabled={busy}
                          onClick={() => saveOverride(c.server_id, c.name)}
                        >
                          Save override
                        </button>
                        {c.has_user_override && (
                          <button
                            type="button"
                            className="wf-btn"
                            disabled={busy}
                            onClick={() => clearOverride(c.server_id, c.name)}
                          >
                            Use platform defaults
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {c.connection?.connected ? (
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
                  Connected
                  {c.connection.account_label ? ` as ${c.connection.account_label}` : ''}
                  {c.connection.access_token_hint ? (
                    <span style={{ color: 'var(--muted)' }}> ({c.connection.access_token_hint})</span>
                  ) : null}
                  <button
                    type="button"
                    className="wf-btn"
                    disabled={busy || isAdmin}
                    onClick={() => disconnect(c.server_id, c.name)}
                    style={{ marginLeft: 8 }}
                    title={isAdmin ? 'Sign in as CEO (or impersonate) to manage your personal token' : ''}
                  >
                    Disconnect
                  </button>
                </p>
              ) : (
                <div style={{ marginTop: 8 }}>
                  {!c.oauth_client_ready && (
                    <div style={{ color: '#b45309', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
                      <p style={{ margin: '0 0 0.35rem' }}>
                        OAuth <strong>app</strong> client not ready — no usable App ID/Secret
                        (platform default or your override).
                      </p>
                      <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                        {!isAdmin && (
                          <li>
                            Expand <strong>App ID / secret override</strong> above and save your Meta app credentials,
                            or ask platform admin to set defaults
                          </li>
                        )}
                        <li>
                          Admin: fill Client ID + Secret in <a href="#mcp-oauth-include">Include from MCP registry</a>{' '}
                          for <code>{c.server_id}</code>
                        </li>
                        <li>
                          Or set <code>FACEBOOK_APP_ID</code> / <code>FACEBOOK_APP_SECRET</code> in{' '}
                          <code>deploy/.env</code> (platform default)
                        </li>
                      </ul>
                    </div>
                  )}
                  {isAdmin ? (
                    <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                      {c.oauth_client_ready
                        ? 'Sign in as a CEO (or impersonate) to Connect a personal OAuth session.'
                        : 'After app credentials are saved, CEOs can Connect with Facebook under their account.'}
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="wf-btn-primary"
                      disabled={busy || !!oauthPolling || !c.oauth_client_ready}
                      onClick={() => connectOAuth(c.server_id, c.name)}
                    >
                      Connect with OAuth
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        <p style={{ margin: '1rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
          After connecting, use the server id in Workflow <code>mcp_tool</code> nodes. Registry:{' '}
          <Link to="/integrations/mcp">MCP Integrations</Link>.
        </p>
      </section>

      <section
        id="mcp-oauth-include"
        style={{
          marginTop: '1.25rem',
          padding: '1rem',
          border: '2px solid var(--accent, #2563eb)',
          borderRadius: 8,
          background: 'color-mix(in srgb, var(--accent, #2563eb) 6%, transparent)',
        }}
      >
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>Include from MCP registry</h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
            Select any MCP already onboarded under{' '}
            <Link to="/integrations/mcp">Integrations → MCP</Link>. Choose a provider preset (Facebook, LinkedIn,
            GitHub, Google, or custom OAuth 2.0), set client id/secret (or env), then{' '}
            <strong>Include MCP for OAuth</strong>. That adds it above for CEOs to Connect.
          </p>
          {!isAdmin && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: '#b45309' }}>
              You are signed in as CEO. You can include <strong>your own</strong> MCP servers.
              Platform servers (e.g. Facebook / Meta Graph) need <strong>Admin login</strong> → Connectors → MCPs
              to configure the OAuth app client.
            </p>
          )}
          {isAdmin && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
              Platform admin: pick any registry server (including platform). CEOs use Connect after you save credentials.
            </p>
          )}
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
            OAuth redirect URI (must match the provider app settings):
          </p>
          <code style={{ display: 'block', marginTop: 4, fontSize: '0.8rem', wordBreak: 'break-all' }}>
            {callbackUrl || '…/api/integrations/mcp/oauth/callback'}
          </code>

          {!!included.length && (
            <>
              <h3 style={{ margin: '1rem 0 0.35rem', fontSize: '0.95rem' }}>On this tab</h3>
              <ul style={{ margin: '0.35rem 0 0', paddingLeft: 0, listStyle: 'none', fontSize: '0.9rem' }}>
                {included.map((c) => (
                  <li
                    key={c.server_id}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      alignItems: 'center',
                      marginBottom: 8,
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                    }}
                  >
                    <strong>{c.oauth_display_name || c.name}</strong>
                    <code style={{ fontSize: '0.75rem' }}>{c.server_id}</code>
                    <span style={{ color: 'var(--muted)' }}>{c.oauth_provider || '—'}</span>
                    {!c.oauth_client_ready && (
                      <span style={{ color: '#b45309', fontSize: '0.8rem' }}>client incomplete</span>
                    )}
                    {(isAdmin || !c.is_platform) && (
                      <button
                        type="button"
                        className="wf-btn"
                        disabled={busy}
                        onClick={() => exclude(c.server_id, c.name)}
                      >
                        Remove from tab
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {canSubmitInclude ? (
            <form onSubmit={includeFromRegistry} style={{ marginTop: '1rem', display: 'grid', gap: 8 }}>
              <label style={{ fontSize: '0.85rem' }}>
                MCP server (from registry)
                <select
                  value={form.serverId}
                  onChange={(e) => onSelectServer(e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: 4 }}
                  required
                >
                  <option value="">— select —</option>
                  {pickable.map((c) => (
                    <option key={c.server_id} value={c.server_id}>
                      {c.name} ({c.server_id})
                      {c.oauth_included ? ' · included' : ''}
                      {c.is_platform ? ' · platform' : ''}
                      {c.status ? ` · ${c.status}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {!pickable.length && (
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
                  No pickable servers. Register an MCP at{' '}
                  <Link to="/integrations/mcp">MCP Integrations</Link>
                  {isAdmin ? ' first, then refresh this page.' : '.'}
                </p>
              )}
              <label style={{ fontSize: '0.85rem' }}>
                OAuth provider
                <select
                  value={form.provider}
                  onChange={(e) => applyPreset(e.target.value, form.displayName)}
                  style={{ display: 'block', width: '100%', marginTop: 4 }}
                >
                  {(presets.length
                    ? presets
                    : [
                        { id: 'facebook', label: 'Facebook / Meta Graph' },
                        { id: 'linkedin', label: 'LinkedIn' },
                        { id: 'github', label: 'GitHub' },
                        { id: 'google', label: 'Google' },
                        { id: 'oauth2', label: 'Custom OAuth 2.0' },
                      ]
                  ).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <input
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                placeholder="Display name on Connectors tab"
              />
              {(form.provider === 'oauth2' ||
                !presets.find((p) => p.id === form.provider)?.authorization_url) && (
                <>
                  <input
                    value={form.authorizationUrl}
                    onChange={(e) => setForm((f) => ({ ...f, authorizationUrl: e.target.value }))}
                    placeholder="authorization_url (required for custom OAuth)"
                  />
                  <input
                    value={form.tokenUrl}
                    onChange={(e) => setForm((f) => ({ ...f, tokenUrl: e.target.value }))}
                    placeholder="token_url"
                  />
                </>
              )}
              <input
                value={form.scopes}
                onChange={(e) => setForm((f) => ({ ...f, scopes: e.target.value }))}
                placeholder="scopes (space or comma separated)"
              />
              <input
                value={form.clientId}
                onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
                placeholder="Client ID (or leave blank if set via env for this provider)"
              />
              <input
                type="password"
                value={form.clientSecret}
                onChange={(e) => setForm((f) => ({ ...f, clientSecret: e.target.value }))}
                placeholder="Client secret (leave blank to keep existing / env)"
              />
              <button
                type="submit"
                className="wf-btn-primary"
                disabled={busy || !form.serverId}
                style={{ padding: '0.65rem 1rem', fontWeight: 600 }}
              >
                Include MCP for OAuth
              </button>
            </form>
          ) : (
            <p style={{ margin: '1rem 0 0', fontSize: '0.9rem' }}>
              No owned MCP servers to include. Register one under{' '}
              <Link to="/integrations/mcp">MCP Integrations</Link>, or sign in as{' '}
              <strong>Admin</strong> (login page → Admin login) to include platform MCPs such as Facebook / LinkedIn.
            </p>
          )}

          {isAdmin && !!configs.length && (
            <p style={{ margin: '1rem 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
              Admin configs: {configs.map((c) => c.server_id).join(', ')}.
            </p>
          )}
      </section>
    </div>
  );
}
