import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api';

/**
 * Shared platform SoR iframe shell (CRM Twenty / ERPNext).
 * Menus + routes gated by company business profile (platform provider only).
 */
export function BusinessEmbedPage({ kind }) {
  const isCrm = kind === 'crm';
  const title = isCrm ? 'CRM' : 'ERP';
  const providerLabel = isCrm ? 'Twenty' : 'ERPNext';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setForbidden(false);
    const load = isCrm ? api.businessCoreEmbedCrm : api.businessCoreEmbedErp;
    load()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e.message || String(e);
        if (e.status === 403 || /only available when platform/i.test(msg)) {
          setForbidden(true);
        }
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isCrm]);

  async function onSyncOrg() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await api.businessCoreSyncOrg({ targets: [isCrm ? 'crm' : 'erp'] });
      setSyncResult(r);
    } catch (e) {
      setSyncResult({ ok: false, error: e.message || String(e) });
    } finally {
      setSyncing(false);
    }
  }

  if (forbidden) {
    return <Navigate to="/profile" replace />;
  }

  if (loading) {
    return (
      <div className="page">
        <p className="page-muted">Loading {title}…</p>
      </div>
    );
  }

  const src = data?.iframe_url || data?.open_url;
  const dbNote = data?.stack?.database;

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 6rem)' }}>
      <header className="page-hero" style={{ marginBottom: '0.75rem' }}>
        <div className="page-hero-top">
          <div className="page-hero-titles">
            <p className="page-hero-kicker">Business Core · Platform {providerLabel}</p>
            <h1 style={{ margin: 0 }}>{title}</h1>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn-primary" onClick={onSyncOrg} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync Flolah org'}
            </button>
            {data?.open_url && (
              <a className="btn-ghost" href={data.open_url} target="_blank" rel="noopener noreferrer">
                Open in new tab
              </a>
            )}
            <Link className="btn-ghost" to="/work">
              Workspace
            </Link>
            <Link className="btn-ghost" to="/profile">
              Profile
            </Link>
          </div>
        </div>
        <p className="page-hero-sub" style={{ marginBottom: 0 }}>
          {data?.login_hint ||
            `Signed-in Flolah company only. Use your ${providerLabel} login for this company workspace.`}
        </p>
        {isCrm && data?.workspace_id && (
          <p className="page-muted" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
            Twenty workspace: {data.workspace_name || data.workspace_id}
            {data.bound ? '' : ' (binding pending)'}
          </p>
        )}
        {!isCrm && data?.company_id && (
          <p className="page-muted" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
            ERPNext company: {data.company_name || data.company_id}
            {data.bound ? '' : ' (binding pending)'}
          </p>
        )}
        {dbNote && (
          <p className="page-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>
            SoR database: {dbNote}
            {data?.stack?.api_configured === false ? ' · API not configured yet' : ''}
          </p>
        )}
        {data?.stack_status && (
          <p className="page-muted" style={{ margin: '0.35rem 0 0', fontSize: '0.8rem' }}>
            App process:{' '}
            {data.stack_status.internal_ok ? 'reachable on platform network' : 'not reachable internally'}
            {data.stack_status.public_ok === false
              ? ' · public embed URL may be firewalled (open TCP 8443/8444 on the VPS host panel, or use crm./erp. subdomains on :443)'
              : data.stack_status.public_ok
                ? ' · public URL OK'
                : ''}
            {!isCrm && data.stack_status.stack_running === false
              ? ' · ERPNext app is not running on this VPS yet (no erpnext containers / site)'
              : ''}
          </p>
        )}
        {data?.wiring?.flolah_owner_user_id && (
          <p className="page-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>
            Bound Flolah company owner: <code>{data.wiring.flolah_owner_user_id}</code>
            {isCrm && data.workspace_id ? (
              <>
                {' '}
                → Twenty workspace <code>{data.workspace_id}</code>
              </>
            ) : null}
            {!isCrm && data.company_id ? (
              <>
                {' '}
                → ERPNext company <code>{data.company_id}</code>
              </>
            ) : null}
            . Use <strong>Sync Flolah org</strong> to push departments + AI employees into CRM/ERP when API keys are set.
          </p>
        )}
      </header>

      {error && (
        <div className="page-banner page-banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      {syncResult && (
        <div
          className={syncResult.ok === false ? 'page-banner page-banner-error' : 'page-banner'}
          role="status"
          style={{ marginBottom: '0.75rem' }}
        >
          {syncResult.error ? (
            <span>{syncResult.error}</span>
          ) : (
            <span>
              Org sync finished
              {syncResult.snapshot
                ? ` — ${syncResult.snapshot.department_count || 0} department(s), ${syncResult.snapshot.agent_count || 0} AI employee(s)`
                : ''}
              . Makers can also run content tools{' '}
              <code>{isCrm ? 'crm_sync_org' : 'erp_sync_org'}</code> or MCP{' '}
              <code>{isCrm ? 'mcp-flolah-crm' : 'mcp-flolah-erp'}</code>.
            </span>
          )}
        </div>
      )}

      {!data?.available && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '1rem',
            marginBottom: '0.75rem',
          }}
        >
          <p style={{ margin: 0 }}>
            {data?.reason ||
              `${providerLabel} public URL is not configured. Ask ops to set the embed URL on the platform.`}
          </p>
          <p className="page-muted" style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
            Env:{' '}
            {isCrm
              ? 'TWENTY_EMBED_URL or TWENTY_SERVER_URL (or TWENTY_PUBLIC_HTTPS_PORT=8443 with nginx CRM proxy)'
              : 'ERPNEXT_EMBED_URL or ERPNEXT_PUBLIC_URL (or ERPNEXT_PUBLIC_HTTPS_PORT=8444 with nginx ERP proxy)'}
            . URL must be HTTPS and reachable in the browser (not Docker-internal).
          </p>
        </div>
      )}

      {src ? (
        <iframe
          title={`${title} — ${providerLabel}`}
          src={src}
          style={{
            flex: 1,
            width: '100%',
            minHeight: '70vh',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: '#fff',
          }}
          allow="clipboard-read; clipboard-write"
          referrerPolicy="no-referrer-when-downgrade"
        />
      ) : (
        !error && (
          <p className="page-muted">
            No embed URL. Configure platform {providerLabel} URLs, start the stack, then refresh. You can still{' '}
            <strong>Sync Flolah org</strong> when API credentials are set.
          </p>
        )
      )}
    </div>
  );
}

export function CrmPage() {
  return <BusinessEmbedPage kind="crm" />;
}

export function ErpPage() {
  return <BusinessEmbedPage kind="erp" />;
}
