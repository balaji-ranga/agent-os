import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, NavLink, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Workspace from './pages/Workspace';
import OperatingWorkspace from './pages/OperatingWorkspace';
import ThisWeek from './pages/ThisWeek';
import GoalPlans from './pages/GoalPlans';
import GoalPlanDetail from './pages/GoalPlanDetail';
import { MeasurementRegistryAdmin, ObjectiveDetail, ObjectivesList, ObjectiveStudio } from './pages/Objectives';
import AgentActions from './pages/AgentActions';
import CompanyReviews from './pages/CompanyReviews';
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
import AdminUserInsights from './pages/AdminUserInsights';
import Register from './pages/Register';
import Admin from './pages/Admin';
import AdminA2AInvocations from './pages/AdminA2AInvocations';
import AdminCrons from './pages/AdminCrons';
import AdminPlatformDocuments from './pages/AdminPlatformDocuments';
import AdminToolOnboarding from './pages/AdminToolOnboarding';
import AdminTlsCerts from './pages/AdminTlsCerts';
import AdminOpenclawRecovery from './pages/AdminOpenclawRecovery';
import AdminPromotions from './pages/AdminPromotions';
import AdminMcpUniverse from './pages/AdminMcpUniverse';
import AdminModels from './pages/AdminModels';
import McpIntegrations from './pages/McpIntegrations';
import CustomScripts from './pages/CustomScripts';
import ExternalAgents from './pages/ExternalAgents';
import AgentExchange from './pages/AgentExchange';
import MasterData from './pages/MasterData';
import ContentExplorer from './pages/ContentExplorer';
import Onboarding from './pages/Onboarding';
import CompanySetup from './pages/CompanySetup';
import UpdateCompanySetup from './pages/UpdateCompanySetup';
import CompanyOperate from './pages/CompanyOperate';
import VideoTours from './pages/VideoTours';
import ApiKeys from './pages/ApiKeys';
import Policies from './pages/Policies';
import ScheduledGoals from './pages/ScheduledGoals';
import AiSnipper from './pages/AiSnipper';
import EfficiencyView from './pages/EfficiencyView';
import IbkrSummary from './pages/IbkrSummary';
import IBKRNewStrategy from './pages/IBKRNewStrategy';
import IBKRNewSummary from './pages/IBKRNewSummary';
import IBKRNewLiveOperations from './pages/IBKRNewLiveOperations';
import Avatars from './pages/Avatars';
import VirtualRoom from './pages/VirtualRoom';
import PublishedScenes from './pages/PublishedScenes';
import PublicVirtualRoom from './pages/PublicVirtualRoom';
import PublicVoiceCall from './pages/PublicVoiceCall';
import PublicHumanCall from './pages/PublicHumanCall';
import HumanChat from './pages/HumanChat';
import AgentChannels from './pages/AgentChannels';
import NotificationBell from './components/NotificationBell';
import ProfileMenu from './components/ProfileMenu';
import ThemeToggle from './components/ThemeToggle';
import GlobalSearch from './components/GlobalSearch';
import CooAssistantWidget from './components/CooAssistantWidget';
import HumanIncomingCall from './components/HumanIncomingCall';
import { AdminNavMenu, CeoNavMenu } from './components/AppNavMenu';
import ImpersonationBanner from './components/ImpersonationBanner';
import PromotionPopup from './components/PromotionPopup';
import { useAuth } from './context/AuthContext';
import { api } from './api';
import { NotificationProvider } from './context/NotificationContext';
import { userRoleTitle } from './utils/userRoleTitle.js';
import { isCompanyUser, isTenantFullAccess, hasPermission } from './utils/orgAccess.js';

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

function Perm({ user, k, children }) {
  if (!hasPermission(user, k)) return <Navigate to="/" replace />;
  return children;
}

function TenantFull({ user, children }) {
  if (!isTenantFullAccess(user)) return <Navigate to="/" replace />;
  return children;
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

  // Admin tables are rendered by several independent pages. Attach semantic
  // mobile labels from their own headers so all current and future Admin data
  // tables can collapse into readable cards without duplicating markup logic.
  useEffect(() => {
    if (user?.role !== 'admin') return undefined;
    const root = document.getElementById('main-content');
    if (!root) return undefined;
    const labelTables = () => {
      root.querySelectorAll('table').forEach((table) => {
        const labels = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
        if (!labels.length) return;
        table.classList.add('admin-responsive-table');
        table.querySelectorAll('tbody tr').forEach((row) => {
          [...row.children].forEach((cell, index) => {
            if (cell.tagName === 'TD' && !cell.hasAttribute('colspan')) {
              cell.dataset.label = labels[index] || `Field ${index + 1}`;
            }
          });
        });
      });
    };
    labelTables();
    const observer = new MutationObserver(labelTables);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [user?.role, location.pathname]);

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
    !location.pathname.startsWith('/update-company-details') &&
    !location.pathname.startsWith('/update-company-setup') &&
    location.pathname !== '/profile' &&
    location.pathname !== '/login'
  ) {
    return <Navigate to="/company-setup" replace />;
  }

  const closeMobileNav = () => setMobileNavOpen(false);
  const homePath = user.role === 'admin' ? '/admin' : '/';
  const isHomeRoute =
    isCompanyUser(user) &&
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
    <div className={`app-shell ${user.role === 'admin' ? 'role-admin' : 'role-company'} ${navCollapsed && !isNarrow ? 'nav-collapsed' : ''} ${mobileNavOpen ? 'mobile-nav-open' : ''} ${focusMode ? 'shell-focus-mode' : ''}`}>
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
          {isCompanyUser(user) && (
            <>
              <NavLink
                to="/"
                end
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                title="Home"
              >
                {menuCollapsed ? '⌂' : 'Home'}
              </NavLink>
              {hasPermission(user, 'this-week') && (
              <NavLink
                to="/this-week"
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                title="This Week Digest"
              >
                {menuCollapsed ? 'D' : 'Digest'}
              </NavLink>
              )}
              {hasPermission(user, 'work') && (
              <NavLink
                to="/work"
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                title="Workspace — daily operating system"
              >
                {menuCollapsed ? 'W' : 'Workspace'}
              </NavLink>
              )}
              <CeoNavMenu collapsed={menuCollapsed} />
            </>
          )}
        </div>
        {isCompanyUser(user) && !menuCollapsed && (
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
              {isCompanyUser(user) && <GlobalSearch />}
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
                <Route path="/admin/openclaw-recovery" element={<AdminOpenclawRecovery />} />
                <Route path="/admin/platform-feedback" element={<AdminPlatformFeedback />} />
                <Route path="/admin/user-insights" element={<AdminUserInsights />} />
                <Route path="/admin/promotions" element={<AdminPromotions />} />
                <Route path="/admin/mcp-universe" element={<AdminMcpUniverse />} />
                <Route path="/admin/models" element={<AdminModels />} />
                <Route path="/integrations/mcp/*" element={<McpIntegrations />} />
                <Route path="/integrations/custom-scripts" element={<CustomScripts />} />
                <Route path="/integrations/external-agents" element={<ExternalAgents />} />
                <Route path="/agent-exchange" element={<AgentExchange />} />
                <Route path="/connectors" element={<Connectors />} />
                <Route path="/profile" element={<UserProfile />} />
                <Route path="*" element={<Navigate to="/admin" replace />} />
              </>
            )}
            {isCompanyUser(user) && (
              <>
                <Route path="/" element={<AgentChat />} />
                <Route path="/this-week" element={<Perm user={user} k="this-week"><ThisWeek /></Perm>} />
                <Route path="/goal-plans/:goalRunId" element={<Perm user={user} k="this-week"><GoalPlanDetail /></Perm>} />
                <Route path="/goal-plans" element={<Perm user={user} k="this-week"><GoalPlans /></Perm>} />
                <Route path="/objectives" element={<Perm user={user} k="this-week"><ObjectivesList /></Perm>} />
                <Route path="/objectives/new" element={<Perm user={user} k="this-week"><ObjectiveStudio /></Perm>} />
                <Route path="/objectives/measurement-registry" element={<Perm user={user} k="this-week"><MeasurementRegistryAdmin /></Perm>} />
                <Route path="/objectives/:objectiveId" element={<Perm user={user} k="this-week"><ObjectiveDetail /></Perm>} />
                <Route path="/agent-actions" element={<TenantFull user={user}><AgentActions /></TenantFull>} />
                <Route path="/reviews" element={<TenantFull user={user}><CompanyReviews /></TenantFull>} />
                <Route path="/workspace-designer" element={<Perm user={user} k="workspace-designer"><WorkspaceDesigner /></Perm>} />
                <Route path="/nav-menus" element={<Perm user={user} k="nav-menus"><NavMenuManager /></Perm>} />
                <Route path="/settings/ip-whitelists" element={<Perm user={user} k="ip-whitelists"><IpWhitelists /></Perm>} />
                <Route path="/settings/tokens" element={<Perm user={user} k="tokens-management"><TokensManagement /></Perm>} />
                <Route path="/work" element={<Perm user={user} k="work"><OperatingWorkspace /></Perm>} />
                <Route path="/crm" element={<Perm user={user} k="crm"><CrmPage /></Perm>} />
                <Route path="/erp" element={<Perm user={user} k="erp"><ErpPage /></Perm>} />
                <Route path="/org" element={<Perm user={user} k="org"><Dashboard /></Perm>} />
                <Route path="/profile" element={<UserProfile />} />
                <Route path="/connectors" element={<Perm user={user} k="connectors"><Connectors /></Perm>} />
                <Route path="/job-profiles" element={<Perm user={user} k="job-profiles"><JobProfiles /></Perm>} />
                <Route path="/browser-session" element={<Perm user={user} k="browser-session"><BrowserSession /></Perm>} />
                <Route path="/workspace" element={<Perm user={user} k="ai-employees"><Workspace /></Perm>} />
                <Route path="/content-tools" element={<Perm user={user} k="content-tools"><ContentToolsLogs /></Perm>} />
                <Route path="/integrations/mcp/*" element={<Perm user={user} k="mcp"><McpIntegrations /></Perm>} />
                <Route path="/integrations/custom-scripts" element={<Perm user={user} k="custom-scripts"><CustomScripts /></Perm>} />
                <Route path="/integrations/external-agents" element={<Perm user={user} k="external-ai"><ExternalAgents /></Perm>} />
                <Route path="/agent-exchange" element={<Perm user={user} k="agent-exchange"><AgentExchange /></Perm>} />
                <Route path="/broadcast" element={<Perm user={user} k="broadcast"><Broadcast /></Perm>} />
                <Route path="/kanban" element={<Kanban />} />
                <Route path="/master-data" element={<Perm user={user} k="master-data"><MasterData /></Perm>} />
                <Route path="/content-explorer" element={<Perm user={user} k="content-explorer"><ContentExplorer /></Perm>} />
                <Route path="/company-setup" element={<TenantFull user={user}><CompanySetup /></TenantFull>} />
                <Route path="/update-company-details" element={<TenantFull user={user}><UpdateCompanySetup /></TenantFull>} />
                <Route path="/update-company-setup" element={<Navigate to="/update-company-details" replace />} />
                <Route path="/company-operate" element={<TenantFull user={user}><CompanyOperate /></TenantFull>} />
                <Route path="/onboarding" element={<TenantFull user={user}><Onboarding /></TenantFull>} />
                <Route path="/video-tours" element={<VideoTours />} />
                <Route path="/api-keys" element={<Perm user={user} k="api-keys"><ApiKeys /></Perm>} />
                <Route path="/policies" element={<Perm user={user} k="policies"><Policies /></Perm>} />
                <Route path="/scheduled-goals" element={<Perm user={user} k="scheduled-goals"><ScheduledGoals /></Perm>} />
                <Route path="/ai-snipper" element={<Perm user={user} k="ai-snipper"><AiSnipper /></Perm>} />
                <Route path="/efficiency" element={<Perm user={user} k="efficiency"><EfficiencyView /></Perm>} />
                <Route path="/ibkr-summary" element={<Perm user={user} k="ibkr-summary"><IbkrSummary /></Perm>} />
                <Route path="/ibkrnew-event-trader" element={<Navigate to="/ibkrnew0/live-operations" replace />} />
                <Route path="/ibkrnew0/strategy" element={<Perm user={user} k="ibkrnew-event-trader"><IBKRNewStrategy /></Perm>} />
                <Route path="/ibkrnew0/summary" element={<Perm user={user} k="ibkrnew-event-trader"><IBKRNewSummary /></Perm>} />
                <Route path="/ibkrnew0/live-operations" element={<Perm user={user} k="ibkrnew-event-trader"><IBKRNewLiveOperations /></Perm>} />
                <Route path="/job-workflows" element={<Perm user={user} k="job-workflows"><JobWorkflows /></Perm>} />
                <Route path="/workflows" element={<Perm user={user} k="workflows"><AgentWorkflows /></Perm>} />
                <Route path="/workflows/runs/:runId" element={<Perm user={user} k="workflows"><WorkflowRunAudit /></Perm>} />
                <Route path="/workflows/:workflowId/edit" element={<Perm user={user} k="workflows"><AgentWorkflowEditor /></Perm>} />
                <Route path="/avatars" element={<Perm user={user} k="avatars"><Avatars /></Perm>} />
                <Route path="/published-scenes" element={<Perm user={user} k="published-scenes"><PublishedScenes /></Perm>} />
                <Route path="/avatars/:avatarId/room" element={<Perm user={user} k="avatars"><VirtualRoom /></Perm>} />
                <Route path="/vr-rooms/:roomId" element={<Perm user={user} k="avatars"><VirtualRoom /></Perm>} />
                <Route path="/agents/:agentId/workspace" element={<Perm user={user} k="ai-employees"><AgentWorkspace /></Perm>} />
                <Route path="/agents/:agentId/chat" element={<AgentChat />} />
                <Route path="/agents/:agentId/channels" element={<Perm user={user} k="ai-employees"><AgentChannels /></Perm>} />
                <Route path="/people/:userId/chat" element={<HumanChat />} />
                <Route path="/agents/:agentId/virtual-room" element={<Perm user={user} k="avatars"><VirtualRoom /></Perm>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            )}
          </Routes>
        </main>
      </div>
      <PromotionPopup enabled={isCompanyUser(user)} />
      {isCompanyUser(user) && <CooAssistantWidget />}
      {isCompanyUser(user) && <HumanIncomingCall />}
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
      <Route
        path="/p/voice/:slug"
        element={
          <AuthLayout>
            <PublicVoiceCall />
          </AuthLayout>
        }
      />
      <Route path="/p/voice-invite/:token" element={<PublicVoiceCall invite />} />
      <Route path="/call/user/:token" element={<PublicHumanCall />} />
      <Route path="/*" element={<Shell />} />
    </Routes>
  );
}
