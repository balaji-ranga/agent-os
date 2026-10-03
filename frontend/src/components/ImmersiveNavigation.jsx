import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { buildCeoNavCatalog, filterNavByHidden } from '../utils/ceoNavCatalog.js';
import { filterCatalogByPermissions, isTenantFullAccess } from '../utils/orgAccess.js';

const PRIMARY_IDS = new Set([
  'home',
  'this-week',
  'work',
  'objectives',
  'agent-actions',
  'company-reviews',
]);
const PRIMARY_ORDER = ['home', 'this-week', 'work', 'objectives', 'agent-actions', 'company-reviews'];

const ICONS = {
  home: '⌂',
  'this-week': '▤',
  work: '▣',
  objectives: '◎',
  'agent-actions': '≋',
  'company-reviews': '☑',
};

function useVisibleCatalog() {
  const { user } = useAuth();
  const [menus, setMenus] = useState({ show_crm_menu: false, show_erp_menu: false });
  const [hidden, setHidden] = useState(() =>
    Array.isArray(user?.ui_nav_hidden) ? user.ui_nav_hidden : []
  );

  useEffect(() => {
    if (Array.isArray(user?.ui_nav_hidden)) setHidden(user.ui_nav_hidden);
  }, [user?.ui_nav_hidden]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.businessCoreMenus().then((value) => {
        if (!cancelled) {
          setMenus({
            show_crm_menu: Boolean(value?.show_crm_menu),
            show_erp_menu: Boolean(value?.show_erp_menu),
          });
        }
      }).catch(() => {
        if (!cancelled) setMenus({ show_crm_menu: false, show_erp_menu: false });
      });
      api.uiNavPrefs().then((value) => {
        if (!cancelled && Array.isArray(value?.hidden)) setHidden(value.hidden);
      }).catch(() => {});
    };
    load();
    window.addEventListener('focus', load);
    window.addEventListener('agent-os-nav-prefs-changed', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
      window.removeEventListener('agent-os-nav-prefs-changed', load);
    };
  }, []);

  return useMemo(() => {
    const visible = filterNavByHidden(
      buildCeoNavCatalog({
        showCrm: menus.show_crm_menu,
        showErp: menus.show_erp_menu,
      }),
      isTenantFullAccess(user) ? hidden : []
    );
    return filterCatalogByPermissions(visible, user);
  }, [hidden, menus.show_crm_menu, menus.show_erp_menu, user]);
}

export function ImmersivePrimaryNavigation({ onNavigate }) {
  const catalog = useVisibleCatalog();
  const primary = catalog
    .filter((item) => PRIMARY_IDS.has(item.id))
    .sort((left, right) => PRIMARY_ORDER.indexOf(left.id) - PRIMARY_ORDER.indexOf(right.id));

  return (
    <div className="immersive-primary-navigation" aria-label="Primary company spaces">
      {primary.map((item) => (
        <NavLink
          key={item.id}
          to={item.to}
          end={item.id === 'home'}
          className={({ isActive }) => `immersive-primary-link${isActive ? ' active' : ''}`}
          title={item.label}
          onClick={onNavigate}
        >
          <span className="immersive-primary-icon" aria-hidden>{ICONS[item.id] || '◇'}</span>
          <span>{item.id === 'this-week' ? 'Daily Digest' : item.label}</span>
        </NavLink>
      ))}
    </div>
  );
}

function flattenCatalog(catalog) {
  return catalog.flatMap((item) => {
    if (!Array.isArray(item.children)) return [item];
    return item.children.map((child) => ({ ...child, group: item.label }));
  });
}

export function ImmersiveCapabilityLauncher({ open, onClose }) {
  const { user } = useAuth();
  const catalog = useVisibleCatalog();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const groups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const visible = flattenCatalog(catalog).filter((item) => {
      if (!normalizedQuery) return true;
      return `${item.label} ${item.group || ''}`.toLowerCase().includes(normalizedQuery);
    });
    return visible.reduce((result, item) => {
      const group = item.group === 'top' ? 'Company spaces' : item.group || 'Company capabilities';
      if (!result[group]) result[group] = [];
      result[group].push(item);
      return result;
    }, {});
  }, [catalog, query]);

  if (!open) return null;

  return (
    <div className="immersive-capability-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="immersive-capability-launcher" role="dialog" aria-modal="true" aria-labelledby="immersive-launcher-title">
        <header className="immersive-launcher-head">
          <label>
            <span aria-hidden>⌕</span>
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search goals, CRM, agents, connectors, settings…"
              aria-label="Search all capabilities"
            />
          </label>
          <button type="button" onClick={onClose} aria-label="Close capabilities">×</button>
        </header>
        <div className="immersive-launcher-intro">
          <div>
            <span className="immersive-launcher-eyebrow">Flolah capability map</span>
            <h2 id="immersive-launcher-title">Every company capability</h2>
            <p>Grouped by intent and filtered by your role, permissions and company entitlements.</p>
          </div>
          <span className="immersive-role-badge">{user?.role === 'ceo' ? 'CEO view' : 'Employee view'}</span>
        </div>
        <div className="immersive-capability-groups">
          {Object.entries(groups).map(([group, items]) => (
            <section className="immersive-capability-group" key={group}>
              <h3>{group}</h3>
              <div>
                {items.map((item) => (
                  <NavLink key={item.id} to={item.to} onClick={onClose}>
                    <span>{item.label}</span>
                    <small>Open →</small>
                  </NavLink>
                ))}
              </div>
            </section>
          ))}
          {!Object.keys(groups).length ? (
            <p className="immersive-launcher-empty">No matching capabilities.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
