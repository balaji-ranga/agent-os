import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth, RequireAuth } from '../context/AuthContext';

const STARTERS = [
  { id: 'hackernews', name: 'Hacker News' },
  { id: 'github', name: 'GitHub' },
  { id: 'gmail', name: 'Gmail' },
  { id: 'google_drive', name: 'Google Drive' },
];

function ConnectorsPanel() {
  const { user } = useAuth();
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

  const refresh = useCallback(async () => {
    try {
      const s = await api.openconnectorStatus().catch(() => null);
      setStatus(s);
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
    try {
      const data = await api.openconnectorProvider(appId);
      setProvider(data.provider || data);
    } catch (e) {
      setProvider({ error: e.message });
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

  const authTypes = (() => {
    const auth = provider?.auth || provider?.authentications || [];
    if (Array.isArray(auth) && auth.length) {
      return auth.map((a) => String(a.type || a.authType || '').toLowerCase()).filter(Boolean);
    }
    return [];
  })();

  return (
    <div style={{ padding: '1.5rem', maxWidth: 820, margin: '0 auto' }}>
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

      {error && <div style={{ color: '#dc2626', marginTop: '1rem' }}>{error}</div>}
      {message && <div style={{ color: '#16a34a', marginTop: '1rem' }}>{message}</div>}
      {oauthPolling && (
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Waiting for {oauthPolling} OAuth…</p>
      )}

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
            Paste Google/GitHub OAuth client credentials once. Callback URL must match{' '}
            <code>{status?.public_origin || 'OPENCONNECTOR_PUBLIC_ORIGIN'}/oauth/callback</code>.
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
