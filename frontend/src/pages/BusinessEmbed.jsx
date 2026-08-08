import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api';
import { rememberCrmSessionOrigin } from '../lib/crmSessionCleanup';

/**
 * Compact platform CRM/ERP iframe shell (no long briefing copy).
 * CRM uses /flolah-handoff so switching Flolah company clears prior Twenty session.
 * Passwordless SSO loads in the in-app iframe (workspace origin handoff + loginToken).
 */
export function BusinessEmbedPage({ kind }) {
  const isCrm = kind === 'crm';
  const title = isCrm ? 'CRM' : 'ERP';
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

  // Remember CRM hosts so Flolah logout can wipe Twenty storage on those origins.
  useEffect(() => {
    if (!isCrm || !data) return;
    const openUrl = data.open_url || data.iframe_url || '';
    const publicBase = data.public_base || data.sso?.public_base || '';
    if (openUrl) rememberCrmSessionOrigin(openUrl);
    if (publicBase) rememberCrmSessionOrigin(publicBase);
  }, [isCrm, data]);

  async function onSyncOrg() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await api.businessCoreSyncOrg({
        targets: [isCrm ? 'crm' : 'erp'],
      });
      setSyncResult(r);
    } catch (e) {
      setSyncResult({ ok: false, error: e.message || String(e) });
    } finally {
      setSyncing(false);
    }
  }

  const iframeSrc = useMemo(() => {
    if (!data) return null;
    return data.iframe_url || data.open_url || null;
  }, [data]);

  if (forbidden) {
    return <Navigate to="/profile" replace />;
  }

  if (loading) {
    return (
      <div className="page" style={{ padding: '1rem' }}>
        <p className="page-muted">Loading {title}...</p>
      </div>
    );
  }

  const companyLabel =
    (isCrm ? data?.workspace_name || data?.company_name : data?.company_display_name) ||
    data?.company_display_name ||
    null;

  const ssoOk = isCrm && data?.sso?.mode === 'login_token_sso' && data?.sso?.ok !== false;

  return (
    <div
      className="page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 'calc(100vh - 4rem)',
        padding: 0,
        margin: 0,
        maxWidth: 'none',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
          padding: '0.65rem 0.85rem',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <strong style={{ fontSize: '1rem' }}>{title}</strong>
        {companyLabel ? (
          <span className="page-muted" style={{ fontSize: '0.85rem' }}>
            {companyLabel}
          </span>
        ) : null}
        <div style={{ flex: 1 }} />
        <button type="button" className="btn-primary" onClick={onSyncOrg} disabled={syncing}>
          {syncing ? 'Syncing...' : 'Sync org'}
        </button>
        {data?.open_url ? (
          <a className="btn-ghost" href={data.open_url} target="_blank" rel="noopener noreferrer">
            Open
          </a>
        ) : null}
        {data?.switch_account_url ? (
          <a
            className="btn-ghost"
            href={data.switch_account_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Switch CRM account
          </a>
        ) : null}
        <Link className="btn-ghost" to="/work">
          Workspace
        </Link>
      </header>

      {error ? (
        <div
          className="page-banner page-banner-error"
          role="alert"
          style={{ margin: '0.5rem 0.85rem' }}
        >
          <span>{error}</span>
        </div>
      ) : null}

      {isCrm && data?.sso ? (
        <div
          className={ssoOk ? 'page-banner' : 'page-banner page-banner-error'}
          role="status"
          style={{ margin: '0.35rem 0.85rem', fontSize: '0.85rem' }}
        >
          {ssoOk ? (
            <span>
              Passwordless CRM SSO for this company workspace
              {data.sso.via_impersonation ? ' (admin viewing as user)' : ''}.
              If Twenty still shows a password form, use Switch CRM account once, then retry.
            </span>
          ) : (
            <span>
              CRM SSO unavailable ({data.sso.reason || data.sso.mode || 'handoff only'}).
              Prefer Open after TWENTY_APP_SECRET / TWENTY_SSO_ENABLED /
              TWENTY_DATABASE_URL / TWENTY_FRONT_AUTO_BASE_URL are set and the company
              user is provisioned in the workspace schema.
            </span>
          )}
        </div>
      ) : null}

      {syncResult ? (
        <div
          className={syncResult.ok === false ? 'page-banner page-banner-error' : 'page-banner'}
          role="status"
          style={{ margin: '0.35rem 0.85rem', fontSize: '0.85rem' }}
        >
          {syncResult.error ? <span>{syncResult.error}</span> : <span>Org sync finished.</span>}
        </div>
      ) : null}

      {iframeSrc ? (
        <iframe
          title={title}
          src={iframeSrc}
          style={{
            flex: 1,
            width: '100%',
            minHeight: '70vh',
            border: 'none',
            background: '#fff',
          }}
          allow="clipboard-read; clipboard-write"
          referrerPolicy="no-referrer-when-downgrade"
        />
      ) : (
        !error && (
          <p className="page-muted" style={{ padding: '1rem' }}>
            Public URL not configured.
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