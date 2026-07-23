import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';

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
  return (
    <>
      <NavSection title="Management" collapsed={collapsed}>
        <NavItem to="/" end title="Dashboard" collapsed={collapsed} label="Dashboard" short="⌂" />
        <NavItem to="/kanban" title="Kanban" collapsed={collapsed} label="Kanban" short="K" />
        <NavItem to="/broadcast" title="Broadcast" collapsed={collapsed} label="Broadcast" short="Bc" />
        <NavItem to="/master-data" title="Master Data" collapsed={collapsed} label="Master Data" short="MD" />
        <NavItem to="/policies" title="Policies & guardrails" collapsed={collapsed} label="Policies" short="Po" />
        <NavItem to="/ai-snipper" title="AI Snipper" collapsed={collapsed} label="AI Snipper" short="AI" />
      </NavSection>

      <NavSection title="Prebuilt Workflows" collapsed={collapsed}>
        <NavItem to="/job-profiles" title="Job profiles" collapsed={collapsed} label="Job profiles" short="JP" />
        <NavItem to="/job-workflows" title="Job workflows" collapsed={collapsed} label="Job workflows" short="JW" />
      </NavSection>

      <NavSection title="Agentic Workflows" collapsed={collapsed}>
        <NavItem to="/workflows" title="Workflows" collapsed={collapsed} label="Workflows" short="Wf" />
        <NavItem
          to="/workspace"
          title="Agent Workspaces"
          collapsed={collapsed}
          label="Agent Workspaces"
          short="AW"
        />
        <NavItem to="/content-tools" title="Content tools" collapsed={collapsed} label="Content tools" short="Ct" />
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
          title="AgentExchange — published A2A agents"
          collapsed={collapsed}
          label="AgentExchange"
          short="AX"
        />
        <NavItem
          to="/integrations/external-agents"
          title="External agents (A2A)"
          collapsed={collapsed}
          label="External agents"
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

      <NavSection title="Agentic Workflows" collapsed={collapsed}>
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
          title="AgentExchange — published A2A agents"
          collapsed={collapsed}
          label="AgentExchange"
          short="AX"
        />
        <NavItem
          to="/integrations/external-agents"
          title="External agents (A2A)"
          collapsed={collapsed}
          label="External agents"
          short="A2A"
        />
      </NavSection>
    </>
  );
}
