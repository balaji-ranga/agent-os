import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { buildCeoNavCatalog, CEO_NAV_ALWAYS } from '../utils/ceoNavCatalog.js';

/**
 * Manage which sidebar menus are shown. Cannot hide always-visible entries.
 * Prefs are owner-scoped; not a security control for routes/APIs.
 */
export default function NavMenuManager() {
  const { user, reload } = useAuth();
  const [showCrm, setShowCrm] = useState(false);
  const [showErp, setShowErp] = useState(false);
  const [hidden, setHidden] = useState([]);
  const [always, setAlways] = useState([...CEO_NAV_ALWAYS]);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.uiNavPrefs().catch(() => ({ hidden: user?.ui_nav_hidden || [] })),
      api.businessCoreMenus().catch(() => ({ show_crm_menu: false, show_erp_menu: false })),
    ])
      .then(([prefs, menus]) => {
        if (cancelled) return;
        setHidden(Array.isArray(prefs?.hidden) ? prefs.hidden : []);
        if (Array.isArray(prefs?.always_visible)) setAlways(prefs.always_visible);
        setShowCrm(!!menus?.show_crm_menu);
        setShowErp(!!menus?.show_erp_menu);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.ui_nav_hidden]);

  const catalog = useMemo(
    () => buildCeoNavCatalog({ showCrm, showErp }),
    [showCrm, showErp]
  );

  const toggle = (id) => {
    if (always.includes(id) || CEO_NAV_ALWAYS.has(id)) return;
    setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.uiNavPrefsSave({ hidden });
      setHidden(res?.hidden || hidden);
      setSaved(true);
      if (typeof reload === 'function') await reload();
      window.dispatchEvent(new CustomEvent('agent-os-nav-prefs-changed'));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const byGroup = catalog.reduce((acc, item) => {
    const g = item.group || 'Other';
    if (!acc[g]) acc[g] = [];
    acc[g].push(item);
    return acc;
  }, {});

  return (
    <div className="nav-menus-page">
      <header className="this-week-header">
        <div>
          <h1>Menu visibility</h1>
          <p className="this-week-sub">
            Hide menus you rarely use. Home, This week, design tools, and Profile stay available.
            CRM/ERP only appear when enabled for your company.
          </p>
        </div>
        <div className="this-week-header-actions">
          <Link className="btn secondary" to="/this-week">
            This week
          </Link>
          <button type="button" className="btn" onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      {loading && <p>Loading…</p>}
      {error && <p className="error-text">{error}</p>}
      {saved && <p className="success-text">Saved. Sidebar will refresh on next navigation focus.</p>}

      {!loading &&
        Object.entries(byGroup).map(([group, items]) => (
          <section key={group} className="this-week-card">
            <h3 className="this-week-card-title">{group === 'top' ? 'Primary' : group}</h3>
            <ul className="nav-menus-list">
              {items.map((it) => {
                const locked = it.always || always.includes(it.id) || CEO_NAV_ALWAYS.has(it.id);
                const isHidden = hidden.includes(it.id);
                return (
                  <li key={it.id}>
                    <label className="nav-menus-row">
                      <input
                        type="checkbox"
                        checked={!isHidden}
                        disabled={locked}
                        onChange={() => toggle(it.id)}
                      />
                      <span>
                        {it.label}
                        {locked ? <span className="this-week-muted"> (always on)</span> : null}
                        {it.entitlement ? (
                          <span className="this-week-muted"> · {it.entitlement}</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
    </div>
  );
}
