import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth, RequireAuth } from '../context/AuthContext';
import WizardReturnBanner from '../components/WizardReturnBanner.jsx';
import McpConnectorsPanel from '../components/connectors/McpConnectorsPanel.jsx';

const STARTERS = [
  { id: 'hackernews', name: 'Hacker News' },
  { id: 'github', name: 'GitHub' },
  { id: 'gmail', name: 'Gmail' },
  { id: 'google_drive', name: 'Google Drive' },
];

function ConnectorsPanel() {
  const { user } = useAuth();
  // Deep-link: /connectors?tab=mcps or #mcps
  const [mainTab, setMainTab] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('tab');
      if (q === 'mcps' || q === 'mcp') return 'mcps';
      if (window.location.hash === '#mcps' || window.location.hash === '#mcp') return 'mcps';
    } catch {
      /* ignore */
    }
    return 'openconnector';
  }); // openconnector | mcps
  const isAdmin = user?.role === 'admin';
  const [link, setLink] = useState(null);
  const [connections, setConnections] = useState([]);
  const [oauthConfigs, setOauthConfigs] = useState([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedApp, setSelectedApp] = useState(null);
  const [provider, setProvider] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [oauthCfg, setOauthCfg] = useState({ appId: 'github', clientId: '', clientSecret: '' });
  const [status, setStatus] = useState(null);
  const [oauthPolling, setOauthPolling] = useState(null);
  const pollRef = useRef(null);
  const [bwStatus, setBwStatus] = useState(null);
  const [bwIpRule, setBwIpRule] = useState('');
  const [bwIpLabel, setBwIpLabel] = useState('');
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideInfo, setOverrideInfo] = useState(null);
  const [overrideForm, setOverrideForm] = useState({ clientId: '', clientSecret: '', scopes: '' });

  const refresh = useCallback(async () => {
    try {
      const s = await api.openconnectorStatus().catch(() => null);
      setStatus(s);
      const bw = await api.browserWorkerStatus().catch(() => null);
      setBwStatus(bw);
      if (isAdmin) {
        setLink(null);
        setConnections([]);
        const cfg = await api.openconnectorOAuthConfigs().catch(() => ({ configured: [] }));
        setOauthConfigs(cfg.configured || cfg.configs?.filter((c) => c.configured) || []);
        setError(null);
        return;
      }
      const [l, c] = await Promise.all([api.openconnectorLink(), api.openconnectorConnections()]);
      setLink(l);
      setConnections(c.connections || []);
    } catch (e) {
      setError(e.message);
    }
  }, [isAdmin]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const ensureProvisioned = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = await api.openconnectorProvision({ ensure_connections: false });
      setLink(data);
      setMessage(
        data.created_token
          ? 'OpenConnector runtime token created (used by workflows to call connected apps).'
          : 'OpenConnector runtime token is ready.'
      );
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const runSearch = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.openconnectorAppsSearch(search.trim());
      setSearchResults(data.apps || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const loadProvider = async (appId) => {
    setSelectedApp(appId);
    setProvider(null);
    setApiKey('');
    setError(null);
    setMessage(null);
    setOverrideOpen(false);
    setOverrideInfo(null);
    setOverrideForm({ clientId: '', clientSecret: '', scopes: '' });
    try {
      const data = await api.openconnectorProvider(appId);
      setProvider(data.provider || data);
    } catch (e) {
      setProvider({ error: e.message });
    }
    if (!isAdmin) {
      try {
        const ov = await api.openconnectorOauthOverride(appId);
        setOverrideInfo(ov);
        setOverrideForm({
          clientId: '',
          clientSecret: '',
          scopes: ov.scopes || '',
        });
      } catch {
        setOverrideInfo(null);
      }
    }
  };

  const saveAppOverride = async (appId) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body = {};
      const cid = overrideForm.clientId.trim();
      const secret = overrideForm.clientSecret.trim();
      if (cid) body.client_id = cid;
      else if (!overrideInfo?.has_user_override) throw new Error('Client ID required');
      if (secret) body.client_secret = secret;
      else if (!overrideInfo?.secret_set) throw new Error('Client secret required for a new override');
      body.scopes = overrideForm.scopes || '';
      const ov = await api.openconnectorOauthOverrideSave(appId, body);
      setOverrideInfo(ov);
      setOverrideForm((f) => ({ ...f, clientSecret: '' }));
      setMessage(
        `Saved App ID/secret override for ${appId}. Secret is encrypted at rest. Connect with OAuth next (uses your app for this connection + refresh).`
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const clearAppOverride = async (appId) => {
    if (
      !window.confirm(
        `Clear your App ID/secret override for ${appId}? Platform admin OAuth client will be used on next Connect.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.openconnectorOauthOverrideClear(appId);
      const ov = await api.openconnectorOauthOverride(appId).catch(() => null);
      setOverrideInfo(ov);
      setOverrideForm({ clientId: '', clientSecret: '', scopes: '' });
      setMessage(`Cleared override for ${appId} — using platform OAuth client defaults`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const stopOauthPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setOauthPolling(null);
  };

  const connectOAuth = async (appId) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    stopOauthPoll();
    try {
      if (!link?.runtime_token_set) await api.openconnectorProvision({ ensure_connections: false });
      const data = await api.openconnectorOAuthStart(appId);
      const url = data.authorization_url;
      if (!url) throw new Error('No authorization URL returned');
      const popup = window.open(url, 'oc-oauth', 'width=640,height=720');
      setMessage(`Complete OAuth in the popup for ${appId}. Waiting for connection…`);
      setOauthPolling(appId);
      const started = Date.now();
      pollRef.current = setInterval(async () => {
        if (Date.now() - started > 5 * 60 * 1000) {
          stopOauthPoll();
          setMessage((m) => m || 'OAuth timed out — click Refresh connections.');
          return;
        }
        try {
          const c = await api.openconnectorConnections();
          const list = c.connections || [];
          const hit = list.find(
            (x) =>
              String(x.app_id || '').toLowerCase() === String(appId).toLowerCase() ||
              String(x.app_name || '').toLowerCase() === String(appId).toLowerCase()
          );
          if (hit || (popup && popup.closed)) {
            setConnections(list);
            if (hit) {
              stopOauthPoll();
              setMessage(`${hit.app_name || hit.app_id} connected.`);
              if (popup && !popup.closed) popup.close();
              await refresh();
            } else if (popup && popup.closed) {
              // Popup closed — one more refresh then stop
              const again = await api.openconnectorConnections();
              setConnections(again.connections || []);
              stopOauthPoll();
              if ((again.connections || []).some((x) => String(x.app_id).toLowerCase() === String(appId).toLowerCase())) {
                setMessage(`${appId} connected.`);
              } else {
                setMessage('OAuth popup closed. Click Refresh connections if the app does not appear yet.');
              }
            }
          }
        } catch {
          /* keep polling */
        }
      }, 2000);
    } catch (e) {
      setError(e.message);
      stopOauthPoll();
    } finally {
      setBusy(false);
    }
  };

  const connectApiKey = async (appId) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (!apiKey.trim()) throw new Error('API key required');
      await api.openconnectorConnectionUpsert(appId, {
        authType: 'api_key',
        values: { apiKey: apiKey.trim() },
      });
      setMessage(`${appId} connected with API key.`);
      setApiKey('');
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const enableNoAuth = async (appId) => {
    setBusy(true);
    setError(null);
    try {
      await api.openconnectorConnectionUpsert(appId, { authType: 'no_auth' });
      setMessage(`${appId} is ready (no credentials required). Use it in Workflows → Connectors.`);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (appId) => {
    setBusy(true);
    setError(null);
    try {
      await api.openconnectorConnectionDelete(appId);
      setMessage(`Disconnected ${appId}.`);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveOauthClient = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.openconnectorOAuthConfigUpsert(oauthCfg.appId, {
        clientId: oauthCfg.clientId,
        clientSecret: oauthCfg.clientSecret,
      });
      setMessage(`OAuth client saved for ${oauthCfg.appId}. CEOs can now Connect from this page.`);
      setOauthCfg((c) => ({ ...c, clientSecret: '' }));
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadIbkrBridge = async (includeRuntime = true) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.ibkrBridgePackageDownload({ includeRuntime });
      setMessage(
        'Zip downloaded. Keep LOCAL_BRIDGE_TOKEN private; paste the same token into W2 workflow variable local_bridge_token.'
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadIbkrNewBridge = async (includeRuntime = true) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.ibkrNewBridgePackageDownload({ includeRuntime });
      setMessage(
        'IBKRNewBridge downloaded with fresh owner-scoped credentials. Keep .env private, add the paper account only on this desktop, test offline, and explicitly enable paper execution when ready.'
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadBrowserWorker = async (includeRuntime = true) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.browserWorkerPackageDownload({ includeRuntime });
      setMessage(
        'Browser Session package downloaded. Keep .env BROWSER_WORKER_TOKEN private — it is minted for your account only. Start scripts\\Start-BrowserWorker.ps1 and leave it running.'
      );
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const revokeBwToken = async (tokenId) => {
    setBusy(true);
    setError(null);
    try {
      await api.browserWorkerTokenRevoke(tokenId);
      setMessage('Browser worker token revoked.');
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addBwIp = async () => {
    const rule = bwIpRule.trim();
    if (!rule) return;
    setBusy(true);
    setError(null);
    try {
      await api.browserWorkerIpWhitelistAdd({ cidr_or_ip: rule, label: bwIpLabel.trim() });
      setBwIpRule('');
      setBwIpLabel('');
      setMessage('IP whitelist entry added (applies to worker → cloud connections).');
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const removeBwIp = async (entryId) => {
    setBusy(true);
    setError(null);
    try {
      await api.browserWorkerIpWhitelistRemove(entryId);
      setMessage('IP whitelist entry removed.');
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const authTypes = (() => {
    const auth = provider?.auth || provider?.authentications || [];
    if (Array.isArray(auth) && auth.length) {
      return auth.map((a) => String(a.type || a.authType || '').toLowerCase()).filter(Boolean);
    }
    return [];
  })();

  return (
    <div style={{ padding: '1.5rem', maxWidth: 820, margin: '0 auto' }}>
      <WizardReturnBanner />
      <Link to={isAdmin ? '/admin' : '/'} style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
        ← {isAdmin ? 'Admin' : 'Dashboard'}
      </Link>
      <h1 style={{ margin: '0.5rem 0 0' }}>Connectors</h1>
      <p style={{ color: 'var(--muted)', marginTop: '0.35rem' }}>
        {isAdmin
          ? 'Configure platform OAuth apps once. CEOs connect their own accounts from this page when signed in as CEO.'
          : (
            <>
              Connect SaaS apps for your account only (alias{' '}
              <code>{link?.connection_name || 'ceo-…'}</code>). Workflows and agents use these connections —
              you never share credentials with other CEOs.
            </>
          )}
      </p>

      {error && mainTab === 'openconnector' && (
        <div style={{ color: '#dc2626', marginTop: '1rem' }}>{error}</div>
      )}
      {message && mainTab === 'openconnector' && (
        <div style={{ color: '#16a34a', marginTop: '1rem' }}>{message}</div>
      )}
      {oauthPolling && mainTab === 'openconnector' && (
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Waiting for {oauthPolling} OAuth…</p>
      )}

      <div style={{ display: 'flex', gap: 0, marginTop: '1.25rem', borderBottom: '1px solid var(--border)' }}>
        {[
          { id: 'openconnector', label: 'OpenConnector' },
          { id: 'mcps', label: 'MCPs (OAuth)' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setMainTab(t.id);
              try {
                const url = new URL(window.location.href);
                if (t.id === 'mcps') url.searchParams.set('tab', 'mcps');
                else url.searchParams.delete('tab');
                window.history.replaceState({}, '', url.pathname + url.search);
              } catch {
                /* ignore */
              }
            }}
            style={{
              padding: '0.55rem 1rem',
              border: 'none',
              borderBottom: mainTab === t.id ? '2px solid var(--accent, #2563eb)' : '2px solid transparent',
              background: 'transparent',
              cursor: 'pointer',
              fontWeight: mainTab === t.id ? 600 : 400,
              color: mainTab === t.id ? 'var(--text)' : 'var(--muted)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {mainTab === 'openconnector' && (
        <p style={{ margin: '0.65rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
          Looking for Facebook / LinkedIn MCP OAuth? Open the{' '}
          <button
            type="button"
            onClick={() => setMainTab('mcps')}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'var(--accent)',
              cursor: 'pointer',
              textDecoration: 'underline',
              font: 'inherit',
            }}
          >
            MCPs (OAuth)
          </button>{' '}
          tab — not OpenConnector.
        </p>
      )}

      {mainTab === 'mcps' && (
        <div style={{ marginTop: '1rem' }}>
          <McpConnectorsPanel />
        </div>
      )}

      {mainTab === 'openconnector' && (
      <>

      <section style={{ marginTop: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>IBKRNew Event Bridge</h2>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
          Dedicated outbound-only Windows runtime for <Link to="/ibkrnew0/live-operations">IBKRNew0</Link> event-driven paper trading.
          The download mints a separate bridge identity and token; it never reuses or changes the Monthly Trading bridge.
        </p>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
          The real IBKR account number is not requested or stored by Flolah. Add it only to the downloaded desktop <code>.env</code>.
          Paper execution remains disabled until you explicitly enable it after running the offline test.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: '0.75rem' }}>
          <button type="button" className="wf-btn-primary" disabled={busy} onClick={() => downloadIbkrNewBridge(true)}>
            {busy ? 'Working…' : 'Download IBKRNewBridge'}
          </button>
          <button type="button" className="wf-btn" disabled={busy} onClick={() => downloadIbkrNewBridge(false)}>
            Download lite (without Node or dependencies)
          </button>
        </div>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
          Full package includes portable Node, locked production dependencies, startup/test scripts, and fresh credentials. Lite requires Node 18+ and <code>npm ci</code>.
        </p>
      </section>

      <section style={{ marginTop: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>Local IBKR bridge</h2>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
          Laptop HTTP adapter for IB Gateway (port 4002). Used by the Monthly Trading{' '}
          <Link to="/workflows">W2</Link> execution workflow on your trading machine. Binds loopback only;
          a bearer token is minted into the zip <code>.env</code>.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: '0.75rem' }}>
          <button
            type="button"
            className="wf-btn-primary"
            disabled={busy}
            onClick={() => downloadIbkrBridge(true)}
          >
            {busy ? 'Working…' : 'Download local IBKR bridge'}
          </button>
          <button
            type="button"
            className="wf-btn"
            disabled={busy}
            onClick={() => downloadIbkrBridge(false)}
          >
            Download lite (without Node)
          </button>
        </div>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
          Full package includes portable Node 18 (same pattern as workflow Download for Windows). See{' '}
          knowledgebase <code>IBKR-LOCAL-BRIDGE.md</code>.
        </p>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
          Optional: restrict laptop → cloud webhooks by client IP under{' '}
          <Link to="/settings/ip-whitelists">Settings → IP Whitelists</Link> (enable{' '}
          <strong>IBKR bridge</strong>). Empty list still allows any IP; secret required always.
        </p>
      </section>

      <section style={{ marginTop: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>Browser Session package (local worker)</h2>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
          Long-lived Windows worker for multi-user Client Chrome. Playwright runs <strong>headed</strong> by default with a
          <strong>persistent profile</strong> (cookies/logins under browser-profile on your PC). Agents and recipes for{' '}
          <strong>your</strong> account route there while Online. Token is minted per download — never share the zip.
        </p>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
          Status:{' '}
          <strong style={{ color: bwStatus?.worker?.online ? '#16a34a' : 'var(--muted)' }}>
            {bwStatus?.worker?.online ? 'Online' : 'Offline'}
          </strong>
          {bwStatus?.worker?.last_heartbeat_at
            ? ` · last heartbeat ${bwStatus.worker.last_heartbeat_at}`
            : ''}
          {bwStatus?.worker?.worker_version
            ? ` · v${bwStatus.worker.worker_version}`
            : ''}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: '0.75rem' }}>
          <button
            type="button"
            className="wf-btn-primary"
            disabled={busy}
            onClick={() => downloadBrowserWorker(true)}
          >
            {busy ? 'Working…' : 'Download Browser Session package'}
          </button>
          <button
            type="button"
            className="wf-btn"
            disabled={busy}
            onClick={() => downloadBrowserWorker(false)}
          >
            Download lite (without Node)
          </button>
          <button type="button" className="wf-btn" disabled={busy} onClick={() => refresh()}>
            Refresh status
          </button>
        </div>
        <ol style={{ margin: '0.75rem 0 0', paddingLeft: '1.2rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
          <li>Download the full package (includes portable Node).</li>
          <li>Unzip privately · keep <code>.env</code> secret (<code>bwk_…</code> token).</li>
          <li>
            Run <code>.\scripts\Start-BrowserWorker.ps1</code> (first run installs Playwright Chromium). A headed window opens — log into sites you need; sessions stay in <code>browser-profile</code>.
          </li>
          <li>Leave the process running (or register Task Scheduler script for logon).</li>
          <li>
            Optional: below, whitelist your public client IP so only your network may use that token.
          </li>
          <li>
            Confirm <strong>Online</strong> here, then use <Link to="/browser-session">Browser Session</Link> /
            agents (<code>browse_*</code>).
          </li>
        </ol>

        <h3 style={{ margin: '1rem 0 0.35rem', fontSize: '0.95rem' }}>Your worker tokens</h3>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
          Prefix only (secret lives in the zip). Revoke if compromised or when re-installing.
        </p>
        <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
          {(bwStatus?.tokens || []).length === 0 && (
            <li style={{ color: 'var(--muted)' }}>No tokens yet — download a package to mint one.</li>
          )}
          {(bwStatus?.tokens || []).map((t) => (
            <li key={t.id} style={{ marginBottom: 4 }}>
              <code>{t.token_prefix}…</code>
              {t.revoked_at ? ' (revoked)' : ''}
              {t.last_used_at ? ` · used ${t.last_used_at}` : ''}
              {!t.revoked_at && (
                <button
                  type="button"
                  className="wf-btn"
                  style={{ marginLeft: 8, padding: '0.15rem 0.5rem', fontSize: '0.8rem' }}
                  disabled={busy}
                  onClick={() => revokeBwToken(t.id)}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>

        <h3 style={{ margin: '1rem 0 0.35rem', fontSize: '0.95rem' }}>Client IP whitelist</h3>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
          Empty list = any IP allowed (token still required). When you add IPs/CIDRs, worker
          register/heartbeat/jobs must come from a listed client IP. Same store as{' '}
          <Link to="/settings/ip-whitelists">Settings → IP Whitelists</Link> (Browser Session
          flag).
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: '0.5rem' }}>
          <input
            value={bwIpRule}
            onChange={(e) => setBwIpRule(e.target.value)}
            placeholder="e.g. 203.0.113.10 or 203.0.113.0/24"
            style={{ minWidth: 220, flex: 1 }}
          />
          <input
            value={bwIpLabel}
            onChange={(e) => setBwIpLabel(e.target.value)}
            placeholder="Label (optional)"
            style={{ minWidth: 120 }}
          />
          <button type="button" className="wf-btn" disabled={busy || !bwIpRule.trim()} onClick={addBwIp}>
            Add IP
          </button>
        </div>
        <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
          {(bwStatus?.ip_whitelist || []).length === 0 && (
            <li style={{ color: 'var(--muted)' }}>No IP rules (any client IP + valid token).</li>
          )}
          {(bwStatus?.ip_whitelist || []).map((e) => (
            <li key={e.id} style={{ marginBottom: 4 }}>
              <code>{e.cidr_or_ip}</code>
              {e.label ? ` — ${e.label}` : ''}
              <button
                type="button"
                className="wf-btn"
                style={{ marginLeft: 8, padding: '0.15rem 0.5rem', fontSize: '0.8rem' }}
                disabled={busy}
                onClick={() => removeBwIp(e.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      {!isAdmin && (
      <section style={{ marginTop: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>Account link</h2>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
          {link?.runtime_token_set
            ? `Linked${link.runtime_token_hint ? ` (${link.runtime_token_hint})` : ''}`
            : 'Not linked yet — create a runtime token so workflows can call your connected apps.'}
        </p>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
          This is your OpenConnector <strong>runtime token</strong> (not the OAuth refresh token). Workflows and
          agents use it to execute connector actions as you. Click below to create one or rotate it if execute fails.
        </p>
        <button
          type="button"
          className="wf-btn"
          disabled={busy}
          onClick={ensureProvisioned}
          style={{ marginTop: '0.75rem' }}
        >
          {busy ? 'Working…' : link?.runtime_token_set ? 'Re-provision runtime token' : 'Create runtime token'}
        </button>
        {status?.public_origin && (
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
            OAuth origin: <code>{status.public_origin}</code>
          </p>
        )}
      </section>
      )}

      {!isAdmin && (
      <>
      <section style={{ marginTop: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Connected</h2>
          <button type="button" className="wf-btn" disabled={busy} onClick={() => refresh()}>
            Refresh connections
          </button>
        </div>
        {!connections.length && <p style={{ margin: '0.5rem 0 0', color: 'var(--muted)' }}>None yet.</p>}
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem' }}>
          {connections.map((c) => (
            <li key={c.app_id} style={{ marginBottom: 6 }}>
              <strong>{c.provider_name || c.app_name || c.app_id}</strong>
              {c.account_name ? (
                <span style={{ color: 'var(--muted)' }}> — {c.account_name}</span>
              ) : c.provider_name && c.app_name && c.app_name !== c.provider_name ? (
                <span style={{ color: 'var(--muted)' }}> — {c.app_name}</span>
              ) : null}{' '}
              <code style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{c.app_id}</code>{' '}
              <button type="button" className="wf-btn" disabled={busy} onClick={() => disconnect(c.app_id)} style={{ marginLeft: 8 }}>
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>Enable an app</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '0.75rem' }}>
          {STARTERS.map((a) => (
            <button key={a.id} type="button" className="wf-btn" disabled={busy} onClick={() => loadProvider(a.id)}>
              {a.name}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search catalog (e.g. slack)"
            style={{ flex: 1, minWidth: 180, padding: '0.5rem' }}
          />
          <button type="button" className="wf-btn" disabled={busy || !search.trim()} onClick={runSearch}>
            Search
          </button>
        </div>
        {!!searchResults.length && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {searchResults.slice(0, 24).map((a) => (
              <button key={a.id} type="button" className="wf-btn" onClick={() => loadProvider(a.id)}>
                {a.name || a.id}
              </button>
            ))}
          </div>
        )}

        {selectedApp && (
          <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>{selectedApp}</h3>
            {provider?.error && <p style={{ color: '#dc2626' }}>{provider.error}</p>}
            {!provider?.error && (
              <>
                <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                  Auth: {authTypes.length ? authTypes.join(', ') : 'unknown (try OAuth or API key)'}
                </p>
                {(authTypes.includes('oauth2') || authTypes.includes('oauth') || !authTypes.length) &&
                  selectedApp !== 'hackernews' &&
                  !isAdmin && (
                    <div style={{ marginBottom: 10 }}>
                      <button
                        type="button"
                        className="wf-btn"
                        disabled={busy}
                        onClick={() => setOverrideOpen((v) => !v)}
                      >
                        {overrideOpen ? 'Hide' : 'App ID / secret override'}…
                      </button>
                      {overrideInfo?.has_user_override && (
                        <span style={{ marginLeft: 8, fontSize: '0.8rem', color: 'var(--muted)' }}>
                          Using your app {overrideInfo.client_id_hint || ''}
                          {overrideInfo.secret_set ? ' (secret set)' : ''}
                        </span>
                      )}
                      {overrideOpen && (
                        <div
                          style={{
                            marginTop: 8,
                            display: 'grid',
                            gap: 8,
                            maxWidth: 420,
                            padding: '0.75rem',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                          }}
                        >
                          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
                            Optional bring-your-own OAuth app (e.g. LinkedIn/Facebook page mapping). Register callback{' '}
                            <code style={{ fontSize: '0.75rem' }}>
                              {overrideInfo?.expected_redirect_uri ||
                                `${status?.public_origin || 'OPENCONNECTOR_PUBLIC_ORIGIN'}/oauth/callback`}
                            </code>
                            . Stored per CEO; passed to OpenConnector only for your connection (and refresh). Leave empty
                            to use the platform admin client.
                          </p>
                          {!status?.custom_oauth_enabled && (
                            <p style={{ margin: 0, fontSize: '0.8rem', color: '#b45309' }}>
                              Platform status: connection-scoped custom OAuth may be off — ask admin to set{' '}
                              <code>OOMOL_CONNECT_ALLOWED_CUSTOM_OAUTH</code> on OpenConnector.
                            </p>
                          )}
                          <input
                            value={overrideForm.clientId}
                            onChange={(e) => setOverrideForm((f) => ({ ...f, clientId: e.target.value }))}
                            placeholder={
                              overrideInfo?.client_id_hint
                                ? `Client ID (saved ${overrideInfo.client_id_hint})`
                                : 'Client ID'
                            }
                            style={{ padding: '0.5rem' }}
                          />
                          <input
                            type="password"
                            value={overrideForm.clientSecret}
                            onChange={(e) => setOverrideForm((f) => ({ ...f, clientSecret: e.target.value }))}
                            placeholder={
                              overrideInfo?.secret_set ? 'Client secret (leave blank to keep)' : 'Client secret'
                            }
                            style={{ padding: '0.5rem' }}
                          />
                          <input
                            value={overrideForm.scopes}
                            onChange={(e) => setOverrideForm((f) => ({ ...f, scopes: e.target.value }))}
                            placeholder="scopes (optional subset)"
                            style={{ padding: '0.5rem' }}
                          />
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="wf-btn-primary"
                              disabled={busy}
                              onClick={() => saveAppOverride(selectedApp)}
                            >
                              Save override
                            </button>
                            {overrideInfo?.has_user_override && (
                              <button
                                type="button"
                                className="wf-btn"
                                disabled={busy}
                                onClick={() => clearAppOverride(selectedApp)}
                              >
                                Use platform defaults
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                {(authTypes.includes('no_auth') || selectedApp === 'hackernews') && (
                  <button type="button" className="wf-btn" disabled={busy} onClick={() => enableNoAuth(selectedApp)}>
                    Enable (no login)
                  </button>
                )}
                {(authTypes.includes('oauth2') || authTypes.includes('oauth') || !authTypes.length) && (
                  <button
                    type="button"
                    className="wf-btn-primary"
                    disabled={busy || !!oauthPolling}
                    onClick={() => connectOAuth(selectedApp)}
                    style={{ marginLeft: 8 }}
                  >
                    Connect with OAuth
                  </button>
                )}
                {(authTypes.includes('api_key') || authTypes.includes('apikey')) && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="API key"
                      style={{ flex: 1, minWidth: 160, padding: '0.5rem' }}
                    />
                    <button type="button" className="wf-btn" disabled={busy} onClick={() => connectApiKey(selectedApp)}>
                      Save API key
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>
      </>
      )}

      {isAdmin && (
        <section style={{ marginTop: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>Provider OAuth apps</h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
            Paste Google/GitHub OAuth client credentials once (platform default). Callback URL must match{' '}
            <code>{status?.public_origin || 'OPENCONNECTOR_PUBLIC_ORIGIN'}/oauth/callback</code>. CEOs may optionally
            set a personal App ID/secret override on each app (connection-scoped BYOA; requires{' '}
            <code>OOMOL_CONNECT_ALLOWED_CUSTOM_OAUTH</code> on OpenConnector).
          </p>

          <h3 style={{ margin: '1rem 0 0.35rem', fontSize: '0.95rem' }}>Saved OAuth clients</h3>
          {!oauthConfigs.length && (
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>None configured yet.</p>
          )}
          {!!oauthConfigs.length && (
            <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem', fontSize: '0.9rem' }}>
              {oauthConfigs.map((c) => (
                <li key={c.service} style={{ marginBottom: 4 }}>
                  <strong>{c.service}</strong>
                  {c.client_id_hint ? <> — client {c.client_id_hint}</> : null}
                  {c.expected_redirect_uri ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{c.expected_redirect_uri}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="wf-btn" style={{ marginTop: 8 }} disabled={busy} onClick={() => refresh()}>
            Refresh list
          </button>

          <form onSubmit={saveOauthClient} style={{ marginTop: '1rem', display: 'grid', gap: 8 }}>
            <input
              value={oauthCfg.appId}
              onChange={(e) => setOauthCfg((c) => ({ ...c, appId: e.target.value }))}
              placeholder="Provider id (github, gmail, google_drive)"
            />
            <input
              value={oauthCfg.clientId}
              onChange={(e) => setOauthCfg((c) => ({ ...c, clientId: e.target.value }))}
              placeholder="Client ID"
            />
            <input
              type="password"
              value={oauthCfg.clientSecret}
              onChange={(e) => setOauthCfg((c) => ({ ...c, clientSecret: e.target.value }))}
              placeholder="Client secret"
            />
            <button type="submit" className="wf-btn-primary" disabled={busy}>
              Save OAuth client
            </button>
          </form>
        </section>
      )}
      </>
      )}
    </div>
  );
}

export default function Connectors() {
  return (
    <RequireAuth>
      <ConnectorsPanel />
    </RequireAuth>
  );
}
