import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api';

/**
 * Compact platform CRM/ERP iframe shell (no long briefing copy).
 * CRM uses /flolah-handoff so switching Flolah company clears prior Twenty session.
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
        <p className="page-muted">Loading {title}…</p>
      </div>
    );
  }

  const companyLabel =
    (isCrm ? data?.workspace_name : data?.company_name) ||
    data?.company_display_name ||
    null;

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
          padding: '0.5rem 0.85rem',
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
          {syncing ? 'Syncing…' : 'Sync org'}
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
      {isCrm && data?.public_base
        ? (() => {
            try {
              const host = new URL(data.public_base).hostname;
              if (host === 'crm.flolah.cloud' || !host.endsWith('.crm.flolah.cloud')) return null;
              return (
                <div className="page-banner" role="status" style={{ margin: '0 0.85rem 0.5rem', fontSize: '0.85rem' }}>
                  CRM workspace host is <code>{host}</code>. If the frame fails with DNS / server-not-found,
                  add Hostinger DNS A record <code>*.crm</code> → VPS IP (or <code>{host.split('.')[0]}.crm</code>), then run{" "}
                  <code>vps-ensure-crm-workspace-dns-cert.sh</code> on the VPS.
                </div>
              );
            } catch {
              return null;
            }
          })()
        : null}

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
