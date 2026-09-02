import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { buildCeoNavCatalog, filterNavByHidden } from '../utils/ceoNavCatalog.js';
import { filterCatalogByPermissions, isTenantFullAccess } from '../utils/orgAccess.js';

function NavItem({ to, end, title, collapsed, label, short, nested = true }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `nav-link${nested && !collapsed ? ' nav-link-nested' : ''}${isActive ? ' active' : ''}`
      }
      title={title}
    >
      {collapsed ? short : label}
    </NavLink>
  );
}

/** v2: product default is all sections collapsed (v1 keys were mostly opened). */
function sectionStorageKey(title) {
  return `agent-os-nav-section-v2:${title}`;
}

function NavSection({ title, collapsed, children, defaultOpen = false }) {
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(sectionStorageKey(title));
      if (stored === '0') return false;
      if (stored === '1') return true;
    } catch {
      /* ignore */
    }
    return defaultOpen;
  });

  useEffect(() => {
    try {
      localStorage.setItem(sectionStorageKey(title), open ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [open, title]);

  if (collapsed) return children;

  return (
    <div className={`nav-section${open ? '' : ' collapsed-section'}`}>
      <button
        type="button"
        className="nav-section-title"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
      >
        <span>{title}</span>
        <span className="nav-section-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open && <div className="nav-section-links">{children}</div>}
    </div>
  );
}

function shortLabel(label) {
  const s = String(label || '');
  if (s.length <= 2) return s;
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2);
}

export function CeoNavMenu({ collapsed }) {
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
      api
        .businessCoreMenus()
        .then((m) => {
          if (!cancelled) {
            setMenus({
              show_crm_menu: !!m?.show_crm_menu,
              show_erp_menu: !!m?.show_erp_menu,
            });
          }
        })
        .catch(() => {
          if (!cancelled) setMenus({ show_crm_menu: false, show_erp_menu: false });
        });
      api
        .uiNavPrefs()
        .then((p) => {
          if (!cancelled && Array.isArray(p?.hidden)) setHidden(p.hidden);
        })
        .catch(() => {});
    };
    load();
    const onFocus = () => load();
    const onPrefs = () => load();
    window.addEventListener('focus', onFocus);
    window.addEventListener('agent-os-nav-prefs-changed', onPrefs);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('agent-os-nav-prefs-changed', onPrefs);
    };
  }, []);

  const catalog = useMemo(
    () => {
      const hiddenFiltered = filterNavByHidden(
        buildCeoNavCatalog({
          showCrm: menus.show_crm_menu,
          showErp: menus.show_erp_menu,
        }),
        isTenantFullAccess(user) ? hidden : []
      );
      return filterCatalogByPermissions(hiddenFiltered, user);
    },
    [menus.show_crm_menu, menus.show_erp_menu, hidden, user]
  );

  const byGroup = useMemo(() => {
    const map = {};
    for (const it of catalog) {
      if (it.group === 'top') continue;
      if (!map[it.group]) map[it.group] = [];
      map[it.group].push(it);
    }
    return map;
  }, [catalog]);

  const topExtras = useMemo(
    () => catalog.filter((it) => it.group === 'top' && !['home', 'this-week', 'work'].includes(it.id)),
    [catalog]
  );

  return (
    <>
      {topExtras.map((it) => (
        <NavItem
          key={it.id}
          to={it.to}
          title={it.label}
          collapsed={collapsed}
          label={it.label}
          short={shortLabel(it.label)}
          nested={false}
        />
      ))}
      {Object.entries(byGroup).map(([group, items]) => (
        <NavSection key={group} title={group} collapsed={collapsed}>
          {items.map((it) => (
            Array.isArray(it.children) ? (
              <NavSection key={it.id} title={it.label} collapsed={collapsed}>
                {it.children.map((child) => <NavItem key={child.id} to={child.to} title={`${it.label} · ${child.label}`} collapsed={collapsed} label={child.label} short={shortLabel(child.label)} />)}
              </NavSection>
            ) : (
              <NavItem key={it.id} to={it.to} end={it.to === '/org'} title={it.label} collapsed={collapsed} label={it.label} short={shortLabel(it.label)} />
            )
          ))}
        </NavSection>
      ))}
    </>
  );
}

export function AdminNavMenu({ collapsed }) {
  return (
    <>
      <NavLink
        to="/admin"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="Admin"
      >
        {collapsed ? 'A' : 'Admin'}
      </NavLink>
      <NavLink
        to="/admin/user-insights"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="User Insights"
      >
        {collapsed ? 'UI' : 'User Insights'}
      </NavLink>
      <NavLink
        to="/admin/a2a-invocations"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="A2A invocation logs"
      >
        {collapsed ? 'AL' : 'A2A logs'}
      </NavLink>
      <NavLink
        to="/admin/crons"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="Platform crons"
      >
        {collapsed ? 'CR' : 'Crons'}
      </NavLink>
      <NavLink
        to="/admin/models"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="Models and routing"
      >
        {collapsed ? 'MR' : 'Models & routing'}
      </NavLink>
      <NavLink
        to="/admin/documents-rag"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="Platform Documents RAG"
      >
        {collapsed ? 'DR' : 'Documents RAG'}
      </NavLink>
      <NavLink
        to="/admin/tool-onboarding"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="Tools Onboarding"
      >
        {collapsed ? 'TO' : 'Tools Onboarding'}
      </NavLink>
      <NavLink
        to="/admin/tls-certs"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="TLS certs"
      >
        {collapsed ? 'TLS' : 'TLS certs'}
      </NavLink>
      <NavLink
        to="/admin/openclaw-recovery"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="AgentSystem recovery"
      >
        {collapsed ? 'AS' : 'AgentSystem recovery'}
      </NavLink>
      <NavLink
        to="/admin/platform-feedback"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="Platform feedback"
      >
        {collapsed ? 'FB' : 'Platform feedback'}
      </NavLink>
      <NavLink
        to="/admin/promotions"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="Internal promotions"
      >
        {collapsed ? 'PR' : 'Promotions'}
      </NavLink>
      <NavLink
        to="/admin/mcp-universe"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="MCP Universe"
      >
        {collapsed ? 'MU' : 'MCP Universe'}
      </NavLink>

      <NavSection title="Company Tools" collapsed={collapsed}>
        <NavItem to="/connectors" title="Connectors" collapsed={collapsed} label="Connectors" short="Cn" />
        <NavItem to="/integrations/mcp" title="MCP" collapsed={collapsed} label="MCP" short="M" />
        <NavItem
          to="/integrations/custom-scripts"
          title="Custom scripts"
          collapsed={collapsed}
          label="Custom scripts"
          short="Py"
        />
        <NavItem
          to="/agent-exchange"
          title="AgentExchange"
          collapsed={collapsed}
          label="AgentExchange"
          short="AX"
        />
        <NavItem
          to="/integrations/external-agents"
          title="External AI"
          collapsed={collapsed}
          label="External AI"
          short="A2A"
        />
      </NavSection>
    </>
  );
}
