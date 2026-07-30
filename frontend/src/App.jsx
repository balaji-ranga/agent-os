import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Workspace from './pages/Workspace';
import AgentWorkspace from './pages/AgentWorkspace';
import AgentChat from './pages/AgentChat';
import ContentToolsLogs from './pages/ContentToolsLogs';
import Broadcast from './pages/Broadcast';
import Kanban from './pages/Kanban';
import JobWorkflows from './pages/JobWorkflows';
import AgentWorkflows from './pages/AgentWorkflows';
import AgentWorkflowEditor from './pages/AgentWorkflowEditor';
import JobProfiles from './pages/JobProfiles';
import BrowserSession from './pages/BrowserSession';
import UserProfile from './pages/UserProfile';
import Connectors from './pages/Connectors';
import Login from './pages/Login';
import Register from './pages/Register';
import Admin from './pages/Admin';
import AdminA2AInvocations from './pages/AdminA2AInvocations';
import AdminCrons from './pages/AdminCrons';
import AdminPlatformDocuments from './pages/AdminPlatformDocuments';
import AdminToolOnboarding from './pages/AdminToolOnboarding';
import McpIntegrations from './pages/McpIntegrations';
import CustomScripts from './pages/CustomScripts';
import ExternalAgents from './pages/ExternalAgents';
import AgentExchange from './pages/AgentExchange';
import MasterData from './pages/MasterData';
import ApiKeys from './pages/ApiKeys';
import Policies from './pages/Policies';
import AiSnipper from './pages/AiSnipper';
import EfficiencyView from './pages/EfficiencyView';
import Avatars from './pages/Avatars';
import VirtualRoom from './pages/VirtualRoom';
import NotificationBell from './components/NotificationBell';
import ProfileMenu from './components/ProfileMenu';
import ThemeToggle from './components/ThemeToggle';
import { AdminNavMenu, CeoNavMenu } from './components/AppNavMenu';
import ImpersonationBanner from './components/ImpersonationBanner';
import { useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';

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

  /** Workflow editor uses the full viewport — hide platform nav/topbar. */
  const focusMode =
    /^\/workflows\/[^/]+\/edit\/?$/.test(location.pathname) ||
    /^\/agents\/[^/]+\/virtual-room\/?$/.test(location.pathname) ||
    /^\/avatars\/[^/]+\/room\/?$/.test(location.pathname);

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

  const menuCollapsed = isNarrow ? false : navCollapsed;
  if (loading) {
    return <div style={{ padding: '2rem' }}>Loading…</div>;
  }

  if (!user) {
    return (
      <AuthLayout>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthLayout>
    );
  }

  const closeMobileNav = () => setMobileNavOpen(false);
  const homePath = user.role === 'admin' ? '/admin' : '/';

  return (
    <NotificationProvider>
    <div className={`app-shell ${navCollapsed && !isNarrow ? 'nav-collapsed' : ''} ${mobileNavOpen ? 'mobile-nav-open' : ''} ${focusMode ? 'shell-focus-mode' : ''}`}>
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
          <div className="app-mobile-brand">
            <span className="app-nav-brand-mark" aria-hidden>F</span>
            <span className="app-mobile-brand-text">Flolah</span>
          </div>
          <div className="app-mobile-topbar-actions">
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
          {user.role === 'ceo' && <CeoNavMenu collapsed={menuCollapsed} />}
        </div>
      </nav>
      )}
      <div className="app-content">
        {!focusMode && !isNarrow && (
          <header className="app-topbar">
            <div className="app-topbar-actions">
              <ThemeToggle />
              <NotificationBell compact />
              <ProfileMenu user={user} logout={logout} />
            </div>
          </header>
        )}
        <main className="app-main">
          {!focusMode && <ImpersonationBanner />}
          <Routes>
            {user.role === 'admin' && (
              <>
                <Route path="/admin" element={<Admin />} />
                <Route path="/admin/a2a-invocations" element={<AdminA2AInvocations />} />
                <Route path="/admin/crons" element={<AdminCrons />} />
                <Route path="/admin/documents-rag" element={<AdminPlatformDocuments />} />
                <Route path="/admin/tool-onboarding" element={<AdminToolOnboarding />} />
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
                <Route path="/" element={<Dashboard />} />
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
                <Route path="/api-keys" element={<ApiKeys />} />
                <Route path="/policies" element={<Policies />} />
                <Route path="/ai-snipper" element={<AiSnipper />} />
                <Route path="/efficiency" element={<EfficiencyView />} />
                <Route path="/job-workflows" element={<JobWorkflows />} />
                <Route path="/workflows" element={<AgentWorkflows />} />
                <Route path="/workflows/:workflowId/edit" element={<AgentWorkflowEditor />} />
                <Route path="/avatars" element={<Avatars />} />
                <Route path="/avatars/:avatarId/room" element={<VirtualRoom />} />
                <Route path="/agents/:agentId/workspace" element={<AgentWorkspace />} />
                <Route path="/agents/:agentId/chat" element={<AgentChat />} />
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
        path="/register"
        element={
          <AuthLayout>
            <Register />
          </AuthLayout>
        }
      />
      <Route path="/*" element={<Shell />} />
    </Routes>
  );
}
