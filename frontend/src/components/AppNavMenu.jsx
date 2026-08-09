import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../api';

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

function sectionStorageKey(title) {
  return `agent-os-nav-section:${title}`;
}

function NavSection({ title, collapsed, children, defaultOpen = true }) {
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

export function CeoNavMenu({ collapsed }) {
  const [menus, setMenus] = useState({ show_crm_menu: false, show_erp_menu: false });

  useEffect(() => {
    let cancelled = false;
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
    const onFocus = () => {
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
        .catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return (
    <>
      <NavSection title="Run & Operate" collapsed={collapsed}>
        <NavItem to="/org" end title="My Org" collapsed={collapsed} label="My Org" short="⌂" />
        <NavItem to="/kanban" title="Kanban" collapsed={collapsed} label="Kanban" short="K" />
        {menus.show_crm_menu && (
          <NavItem
            to="/crm"
            title="CRM — platform Twenty for this company"
            collapsed={collapsed}
            label="CRM"
            short="Cr"
          />
        )}
        {menus.show_erp_menu && (
          <NavItem
            to="/erp"
            title="ERP — platform ERPNext for this company"
            collapsed={collapsed}
            label="ERP"
            short="Er"
          />
        )}
        <NavItem
          to="/scheduled-goals"
          title="Scheduled goals — recurring prompts for AI employees"
          collapsed={collapsed}
          label="Scheduled goals"
          short="Sg"
        />
        <NavItem to="/broadcast" title="Broadcast" collapsed={collapsed} label="Broadcast" short="Bc" />
        <NavItem
          to="/master-data"
          title="Company knowledge (Master Data)"
          collapsed={collapsed}
          label="Knowledge"
          short="Kn"
        />
        <NavItem
          to="/content-explorer"
          title="Content Explorer"
          collapsed={collapsed}
          label="Content Explorer"
          short="CE"
        />
        <NavItem to="/api-keys" title="API Keys" collapsed={collapsed} label="API Keys" short="Key" />
        <NavItem to="/policies" title="Policies & guardrails" collapsed={collapsed} label="Policies" short="Po" />
        <NavItem to="/ai-snipper" title="AI Snipper" collapsed={collapsed} label="AI Snipper" short="AI" />
        <NavItem to="/efficiency" title="Efficiency View" collapsed={collapsed} label="Efficiency View" short="Ef" />
      </NavSection>

      <NavSection title="Prebuilt Workflows" collapsed={collapsed}>
        <NavItem to="/job-profiles" title="Job profiles" collapsed={collapsed} label="Job profiles" short="JP" />
        <NavItem to="/browser-session" title="Browser Session" collapsed={collapsed} label="Browser Session" short="Br" />
        <NavItem to="/job-workflows" title="Job workflows" collapsed={collapsed} label="Job workflows" short="JW" />
        <NavItem to="/ibkr-summary" title="IBKR Summary — portfolio and day plans" collapsed={collapsed} label="IBKR Summary" short="IB" />
      </NavSection>

      <NavSection title="Company Tools" collapsed={collapsed}>
        <NavItem to="/workflows" title="Workflows" collapsed={collapsed} label="Workflows" short="Wf" />
        <NavItem to="/avatars" title="3D Avatars" collapsed={collapsed} label="3D Avatars" short="3D" />
        <NavItem
          to="/published-scenes"
          title="Published Scenes — public Virtual Rooms"
          collapsed={collapsed}
          label="Published Scenes"
          short="PS"
        />
        <NavItem
          to="/workspace"
          title="AI Employees — hire and equip digital workers"
          collapsed={collapsed}
          label="AI Employees"
          short="AE"
        />
        <NavItem to="/content-tools" title="Tools your AI employees can use" collapsed={collapsed} label="Tools" short="Tl" />
        <NavItem to="/connectors" title="Connectors" collapsed={collapsed} label="Connectors" short="Cn" />
        <NavItem to="/integrations/mcp" title="MCP integrations" collapsed={collapsed} label="MCP" short="Mcp" />
        <NavItem
          to="/integrations/custom-scripts"
          title="Custom scripts"
          collapsed={collapsed}
          label="Custom scripts"
          short="Py"
        />
        <NavItem
          to="/agent-exchange"
          title="AgentExchange — published A2A services"
          collapsed={collapsed}
          label="AgentExchange"
          short="AX"
        />
        <NavItem
          to="/integrations/external-agents"
          title="External AI (A2A partners)"
          collapsed={collapsed}
          label="External AI"
          short="A2A"
        />
      </NavSection>
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
        to="/admin/a2a-invocations"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="A2A invocation logs"
      >
        {collapsed ? 'AL' : 'A2A logs'}
      </NavLink>
      <NavLink
        to="/admin/crons"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="Platform crons — pause, resume, run now"
      >
        {collapsed ? 'CR' : 'Crons'}
      </NavLink>
      <NavLink
        to="/admin/documents-rag"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="Platform Documents RAG (OpenSearch)"
      >
        {collapsed ? 'DR' : 'Documents RAG'}
      </NavLink>
      <NavLink
        to="/admin/tool-onboarding"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="Tools Onboarding — Docker content tools"
      >
        {collapsed ? 'TO' : 'Tools Onboarding'}
      </NavLink>
      <NavLink
        to="/admin/tls-certs"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="TLS / Let's Encrypt certs — SANs and refresh"
      >
        {collapsed ? 'TLS' : 'TLS certs'}
      </NavLink>
      <NavLink
        to="/admin/platform-feedback"
        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        title="Platform bugs, feedback, and enhancements"
      >
        {collapsed ? 'FB' : 'Platform feedback'}
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
          title="AgentExchange — published A2A services"
          collapsed={collapsed}
          label="AgentExchange"
          short="AX"
        />
        <NavItem
          to="/integrations/external-agents"
          title="External AI (A2A partners)"
          collapsed={collapsed}
          label="External AI"
          short="A2A"
        />
      </NavSection>
    </>
  );
}
