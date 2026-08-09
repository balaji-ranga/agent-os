import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, NavLink, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Workspace from './pages/Workspace';
import OperatingWorkspace from './pages/OperatingWorkspace';
import ThisWeek from './pages/ThisWeek';
import WorkspaceDesigner from './pages/WorkspaceDesigner';
import NavMenuManager from './pages/NavMenuManager';
import IpWhitelists from './pages/IpWhitelists';
import TokensManagement from './pages/TokensManagement';
import { CrmPage, ErpPage } from './pages/BusinessEmbed';
import AgentWorkspace from './pages/AgentWorkspace';
import AgentChat from './pages/AgentChat';
import ContentToolsLogs from './pages/ContentToolsLogs';
import Broadcast from './pages/Broadcast';
import Kanban from './pages/Kanban';
import JobWorkflows from './pages/JobWorkflows';
import AgentWorkflows from './pages/AgentWorkflows';
import AgentWorkflowEditor from './pages/AgentWorkflowEditor';
import WorkflowRunAudit from './pages/WorkflowRunAudit';
import JobProfiles from './pages/JobProfiles';
import BrowserSession from './pages/BrowserSession';
import UserProfile from './pages/UserProfile';
import Connectors from './pages/Connectors';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import AdminPlatformFeedback from './pages/AdminPlatformFeedback';
import Register from './pages/Register';
import Admin from './pages/Admin';
import AdminA2AInvocations from './pages/AdminA2AInvocations';
import AdminCrons from './pages/AdminCrons';
import AdminPlatformDocuments from './pages/AdminPlatformDocuments';
import AdminToolOnboarding from './pages/AdminToolOnboarding';
import AdminTlsCerts from './pages/AdminTlsCerts';
import McpIntegrations from './pages/McpIntegrations';
import CustomScripts from './pages/CustomScripts';
import ExternalAgents from './pages/ExternalAgents';
import AgentExchange from './pages/AgentExchange';
import MasterData from './pages/MasterData';
import ContentExplorer from './pages/ContentExplorer';
import Onboarding from './pages/Onboarding';
import CompanySetup from './pages/CompanySetup';
import CompanyOperate from './pages/CompanyOperate';
import VideoTours from './pages/VideoTours';
import ApiKeys from './pages/ApiKeys';
import Policies from './pages/Policies';
import ScheduledGoals from './pages/ScheduledGoals';
import AiSnipper from './pages/AiSnipper';
import EfficiencyView from './pages/EfficiencyView';
import IbkrSummary from './pages/IbkrSummary';
import Avatars from './pages/Avatars';
import VirtualRoom from './pages/VirtualRoom';
import PublishedScenes from './pages/PublishedScenes';
import PublicVirtualRoom from './pages/PublicVirtualRoom';
import AgentChannels from './pages/AgentChannels';
import NotificationBell from './components/NotificationBell';
import ProfileMenu from './components/ProfileMenu';
import ThemeToggle from './components/ThemeToggle';
import GlobalSearch from './components/GlobalSearch';
import { AdminNavMenu, CeoNavMenu } from './components/AppNavMenu';
import ImpersonationBanner from './components/ImpersonationBanner';
import { useAuth } from './context/AuthContext';
import { api } from './api';
import { NotificationProvider } from './context/NotificationContext';
import { userRoleTitle } from './utils/userRoleTitle.js';

/** Login/Register are top-level routes (outside Shell) — enable document scroll here. */
function AuthLayout({ children }) {
  useEffect(() => {
    document.documentElement.classList.add('auth-route');
    return () => document.documentElement.classList.remove('auth-route');
  }, []);
  return (
    <div
      className="auth-scroll"
      style={{
        minHeight: '100dvh',
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {children}
    </div>
  );
}

function Shell() {
  const { user, logout, loading } = useAuth();
  const location = useLocation();
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem('agent-os-nav-collapsed') === '1');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)').matches : false
  );
  const [setupGatePending, setSetupGatePending] = useState(null);

  /** Workflow editor / run audit / VR use the full viewport — hide platform nav/topbar. */
  const focusMode =
    location.pathname.startsWith('/company-setup') ||
    location.pathname.startsWith('/company-operate') ||
    /^\/workflows\/[^/]+\/edit\/?$/.test(location.pathname) ||
    /^\/workflows\/runs\/[^/]+\/?$/.test(location.pathname) ||
    /^\/agents\/[^/]+\/virtual-room\/?$/.test(location.pathname) ||
    /^\/avatars\/[^/]+\/room\/?$/.test(location.pathname) ||
    /^\/vr-rooms\/[^/]+\/?$/.test(location.pathname);

  useEffect(() => {
    localStorage.setItem('agent-os-nav-collapsed', navCollapsed ? '1' : '0');
  }, [navCollapsed]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const onChange = () => {
      setIsNarrow(mq.matches);
      if (!mq.matches) setMobileNavOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!user || user.role !== 'ceo') {
      setSetupGatePending(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const gate = await api.companySetupGate();
        if (!cancelled) setSetupGatePending(!!gate?.needs_gate);
      } catch (e) {
        console.warn('[App] company setup gate', e?.message || e);
        if (!cancelled) setSetupGatePending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.role, location.pathname]);

  const menuCollapsed = isNarrow ? false : navCollapsed;
  if (loading) {
    return <div style={{ padding: '2rem' }}>Loading…</div>;
  }

  if (!user) {
    return (
      <AuthLayout>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthLayout>
    );
  }

  if (
    user.role === 'ceo' &&
    setupGatePending === true &&
    !location.pathname.startsWith('/company-setup') &&
    location.pathname !== '/profile' &&
    location.pathname !== '/login'
  ) {
    return <Navigate to="/company-setup" replace />;
  }

  const closeMobileNav = () => setMobileNavOpen(false);
  const homePath = user.role === 'admin' ? '/admin' : '/';
  const isHomeRoute =
    user.role === 'ceo' &&
    (location.pathname === '/' || location.pathname === '');
  const firstName = String(user.name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0] || 'there';
  const hour = new Date().getHours();
  const greet =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <NotificationProvider>
    <div className={`app-shell ${navCollapsed && !isNarrow ? 'nav-collapsed' : ''} ${mobileNavOpen ? 'mobile-nav-open' : ''} ${focusMode ? 'shell-focus-mode' : ''}`}>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      {!focusMode && mobileNavOpen && (
        <button
          type="button"
          className="app-nav-backdrop"
          aria-label="Close menu"
          onClick={closeMobileNav}
        />
      )}
      {!focusMode && isNarrow && (
        <header className="app-mobile-topbar">
          <button
            type="button"
            className="nav-toggle mobile-menu-btn"
            onClick={() => setMobileNavOpen((o) => !o)}
            aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileNavOpen}
          >
            {mobileNavOpen ? '✕' : '☰'}
          </button>
          <Link to={homePath} className="app-mobile-brand" onClick={closeMobileNav}>
            <span className="app-nav-brand-mark" aria-hidden>F</span>
            <span className="app-mobile-brand-text">Flolah</span>
          </Link>
          <div className="app-mobile-topbar-actions">
            <GlobalSearch compact />
            <ThemeToggle />
            <NotificationBell compact />
            <ProfileMenu user={user} logout={logout} />
          </div>
        </header>
      )}
      {!focusMode && (
      <nav className={`app-nav ${menuCollapsed ? 'collapsed' : ''} ${mobileNavOpen ? 'mobile-open' : ''}`}>
        <div className="app-nav-header">
          <Link to={homePath} className="app-nav-brand" onClick={closeMobileNav}>
            <span className="app-nav-brand-mark" aria-hidden>F</span>
            {!menuCollapsed && <span className="app-nav-brand-name">Flolah</span>}
          </Link>
          <button
            type="button"
            className="nav-toggle desktop-nav-toggle"
            onClick={() => setNavCollapsed((c) => !c)}
            title={navCollapsed ? 'Expand menu' : 'Collapse menu'}
            aria-label={navCollapsed ? 'Expand menu' : 'Collapse menu'}
          >
            {navCollapsed ? '»' : '«'}
          </button>
          <button
            type="button"
            className="nav-toggle mobile-nav-close"
            onClick={closeMobileNav}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
        <div className="app-nav-links" onClick={closeMobileNav}>
          {user.role === 'admin' && <AdminNavMenu collapsed={menuCollapsed} />}
          {user.role === 'ceo' && (
            <>
              <NavLink
                to="/"
                end
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                title="Home"
              >
                {menuCollapsed ? '⌂' : 'Home'}
              </NavLink>
              <NavLink
                to="/this-week"
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                title="This Week Digest"
              >
                {menuCollapsed ? 'D' : 'Digest'}
              </NavLink>
              <NavLink
                to="/work"
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                title="Workspace — daily operating system"
              >
                {menuCollapsed ? 'W' : 'Workspace'}
              </NavLink>
              <CeoNavMenu collapsed={menuCollapsed} />
            </>
          )}
        </div>
        {user.role === 'ceo' && !menuCollapsed && (
          <div className="app-nav-footer-user">
            <ProfileMenu user={user} logout={logout} />
            <div className="app-nav-footer-meta">
              <div className="app-nav-footer-name">{user.name || 'User'}</div>
              <div className="app-nav-footer-role">{userRoleTitle(user)}</div>
            </div>
          </div>
        )}
      </nav>
      )}
      <div className="app-content">
        {!focusMode && !isNarrow && (
          <header className="app-topbar">
            <div className="app-topbar-left">
              {isHomeRoute && (
                <div className="app-topbar-greet">
                  <div className="app-topbar-greet-title">
                    {greet}, {firstName}! <span aria-hidden>👋</span>
                  </div>
                  <div className="app-topbar-greet-sub">
                    Here&apos;s what&apos;s happening with your AI company today.
                  </div>
                </div>
              )}
            </div>
            <div className="app-topbar-center">
              {user.role === 'ceo' && <GlobalSearch />}
            </div>
            <div className="app-topbar-actions">
              <ThemeToggle />
              <NotificationBell compact />
              <ProfileMenu user={user} logout={logout} />
            </div>
          </header>
        )}
        <main id="main-content" className="app-main" tabIndex={-1}>
          {!focusMode && <ImpersonationBanner />}
          <Routes>
            {user.role === 'admin' && (
              <>
                <Route path="/admin" element={<Admin />} />
                <Route path="/admin/a2a-invocations" element={<AdminA2AInvocations />} />
                <Route path="/admin/crons" element={<AdminCrons />} />
                <Route path="/admin/documents-rag" element={<AdminPlatformDocuments />} />
                <Route path="/admin/tool-onboarding" element={<AdminToolOnboarding />} />
                <Route path="/admin/tls-certs" element={<AdminTlsCerts />} />
                <Route path="/admin/platform-feedback" element={<AdminPlatformFeedback />} />
                <Route path="/integrations/mcp/*" element={<McpIntegrations />} />
                <Route path="/integrations/custom-scripts" element={<CustomScripts />} />
                <Route path="/integrations/external-agents" element={<ExternalAgents />} />
                <Route path="/agent-exchange" element={<AgentExchange />} />
                <Route path="/connectors" element={<Connectors />} />
                <Route path="/profile" element={<UserProfile />} />
                <Route path="*" element={<Navigate to="/admin" replace />} />
              </>
            )}
            {user.role === 'ceo' && (
              <>
                <Route path="/" element={<AgentChat />} />
                <Route path="/this-week" element={<ThisWeek />} />
                <Route path="/workspace-designer" element={<WorkspaceDesigner />} />
                <Route path="/nav-menus" element={<NavMenuManager />} />
                <Route path="/settings/ip-whitelists" element={<IpWhitelists />} />
                <Route path="/settings/tokens" element={<TokensManagement />} />
                <Route path="/work" element={<OperatingWorkspace />} />
                <Route path="/crm" element={<CrmPage />} />
                <Route path="/erp" element={<ErpPage />} />
                <Route path="/org" element={<Dashboard />} />
                <Route path="/profile" element={<UserProfile />} />
                <Route path="/connectors" element={<Connectors />} />
                <Route path="/job-profiles" element={<JobProfiles />} />
                <Route path="/browser-session" element={<BrowserSession />} />
                <Route path="/workspace" element={<Workspace />} />
                <Route path="/content-tools" element={<ContentToolsLogs />} />
                <Route path="/integrations/mcp/*" element={<McpIntegrations />} />
                <Route path="/integrations/custom-scripts" element={<CustomScripts />} />
                <Route path="/integrations/external-agents" element={<ExternalAgents />} />
                <Route path="/agent-exchange" element={<AgentExchange />} />
                <Route path="/broadcast" element={<Broadcast />} />
                <Route path="/kanban" element={<Kanban />} />
                <Route path="/master-data" element={<MasterData />} />
                <Route path="/content-explorer" element={<ContentExplorer />} />
                <Route path="/company-setup" element={<CompanySetup />} />
                <Route path="/company-operate" element={<CompanyOperate />} />
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/video-tours" element={<VideoTours />} />
                <Route path="/api-keys" element={<ApiKeys />} />
                <Route path="/policies" element={<Policies />} />
                <Route path="/scheduled-goals" element={<ScheduledGoals />} />
                <Route path="/ai-snipper" element={<AiSnipper />} />
                <Route path="/efficiency" element={<EfficiencyView />} />
                <Route path="/ibkr-summary" element={<IbkrSummary />} />
                <Route path="/job-workflows" element={<JobWorkflows />} />
                <Route path="/workflows" element={<AgentWorkflows />} />
                <Route path="/workflows/runs/:runId" element={<WorkflowRunAudit />} />
                <Route path="/workflows/:workflowId/edit" element={<AgentWorkflowEditor />} />
                <Route path="/avatars" element={<Avatars />} />
                <Route path="/published-scenes" element={<PublishedScenes />} />
                <Route path="/avatars/:avatarId/room" element={<VirtualRoom />} />
                <Route path="/vr-rooms/:roomId" element={<VirtualRoom />} />
                <Route path="/agents/:agentId/workspace" element={<AgentWorkspace />} />
                <Route path="/agents/:agentId/chat" element={<AgentChat />} />
                <Route path="/agents/:agentId/channels" element={<AgentChannels />} />
                <Route path="/agents/:agentId/virtual-room" element={<VirtualRoom />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            )}
          </Routes>
        </main>
      </div>
    </div>
    </NotificationProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <AuthLayout>
            <Login />
          </AuthLayout>
        }
      />
      <Route
        path="/reset-password"
        element={
          <AuthLayout>
            <ResetPassword />
          </AuthLayout>
        }
      />
      <Route
        path="/register"
        element={
          <AuthLayout>
            <Register />
          </AuthLayout>
        }
      />
      <Route
        path="/p/vr/:slug"
        element={
          <AuthLayout>
            <PublicVirtualRoom />
          </AuthLayout>
        }
      />
      <Route path="/*" element={<Shell />} />
    </Routes>
  );
}
