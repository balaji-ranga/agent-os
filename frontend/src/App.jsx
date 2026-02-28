import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Workspace from './pages/Workspace';
import AgentWorkspace from './pages/AgentWorkspace';
import AgentChat from './pages/AgentChat';
import ContentToolsLogs from './pages/ContentToolsLogs';
import Broadcast from './pages/Broadcast';
import Kanban from './pages/Kanban';
import NotificationBell from './components/NotificationBell';

function App() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{
        width: 200,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        padding: '1rem 0',
      }}>
        <div style={{ padding: '0 1rem', marginBottom: '0.75rem', fontWeight: 600, fontSize: '1.1rem' }}>
          Agent OS
        </div>
        <div style={{ padding: '0 1rem', marginBottom: '1rem' }}>
          <NotificationBell />
        </div>
        <NavLink
          to="/"
          end
          style={({ isActive }) => ({
            display: 'block',
            padding: '0.5rem 1rem',
            color: isActive ? 'var(--accent)' : 'var(--muted)',
          })}
        >
          Dashboard
        </NavLink>
        <NavLink
          to="/workspace"
          style={({ isActive }) => ({
            display: 'block',
            padding: '0.5rem 1rem',
            color: isActive ? 'var(--accent)' : 'var(--muted)',
          })}
        >
          Workspace (MD)
        </NavLink>
        <NavLink
          to="/content-tools"
          style={({ isActive }) => ({
            display: 'block',
            padding: '0.5rem 1rem',
            color: isActive ? 'var(--accent)' : 'var(--muted)',
          })}
        >
          Content tools
        </NavLink>
        <NavLink
          to="/broadcast"
          style={({ isActive }) => ({
            display: 'block',
            padding: '0.5rem 1rem',
            color: isActive ? 'var(--accent)' : 'var(--muted)',
          })}
        >
          Broadcast
        </NavLink>
        <NavLink
          to="/kanban"
          style={({ isActive }) => ({
            display: 'block',
            padding: '0.5rem 1rem',
            color: isActive ? 'var(--accent)' : 'var(--muted)',
          })}
        >
          Kanban
        </NavLink>
      </nav>
      <main style={{ flex: 1, overflow: 'auto' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/workspace" element={<Workspace />} />
          <Route path="/content-tools" element={<ContentToolsLogs />} />
          <Route path="/broadcast" element={<Broadcast />} />
          <Route path="/kanban" element={<Kanban />} />
          <Route path="/agents/:agentId/workspace" element={<AgentWorkspace />} />
          <Route path="/agents/:agentId/chat" element={<AgentChat />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
