const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function request(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function get(path) {
  return request(path, { method: 'GET' });
}

async function post(path, body) {
  return request(path, { method: 'POST', body: JSON.stringify(body) });
}

async function put(path, body) {
  return request(path, { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) });
}

async function patch(path, body) {
  return request(path, { method: 'PATCH', body: JSON.stringify(body) });
}

async function del(path) {
  return request(path, { method: 'DELETE' });
}

export const api = {
  health: () => get('/health'),
  // Workspace (OpenClaw MD files) — legacy single-workspace (optional)
  workspaceFiles: () => get('/workspace/files'),
  workspaceRead: (name) => get(`/workspace/files/${encodeURIComponent(name)}`),
  workspaceWrite: (name, text) => put(`/workspace/files/${encodeURIComponent(name)}`, { text }),
  // Per-agent workspace (MD files)
  agentWorkspaceFiles: (agentId) => get(`/agents/${encodeURIComponent(agentId)}/workspace/files`),
  agentWorkspaceRead: (agentId, name) => get(`/agents/${encodeURIComponent(agentId)}/workspace/files/${encodeURIComponent(name)}`),
  agentWorkspaceWrite: (agentId, name, text) => put(`/agents/${encodeURIComponent(agentId)}/workspace/files/${encodeURIComponent(name)}`, { text }),
  // Agents
  agentsList: () => get('/agents'),
  agentGet: (id) => get(`/agents/${id}`),
  agentCreate: (body) => post('/agents', body),
  agentUpdate: (id, body) => patch(`/agents/${id}`, body),
  agentDelete: (id) => del(`/agents/${id}`),
  agentChatHistory: (id) => get(`/agents/${id}/chat`),
  agentChatSend: (id, message, userId = 'default') => post(`/agents/${id}/chat`, { message, user_id: userId }),
  agentChatFromAgent: (toAgentId, fromAgentId, message) =>
    post(`/agents/${toAgentId}/chat/from-agent`, { from_agent_id: fromAgentId, message }),
  agentActivities: (id) => get(`/agents/${id}/activities`),
  // Standups
  standupsList: (limit) => get(limit ? `/standups?limit=${limit}` : '/standups'),
  standupGet: (id) => get(`/standups/${id}`),
  standupCreate: (body) => post('/standups', body),
  standupNotifications: (limit) => get(limit ? `/standups/notifications?limit=${limit}` : '/standups/notifications'),
  standupUpdate: (id, body) => patch(`/standups/${id}`, body),
  standupResponses: (id) => get(`/standups/${id}/responses`),
  standupAddResponse: (id, agentId, content) => post(`/standups/${id}/responses`, { agent_id: agentId, content }),
  standupRunCoo: (id, includeActivities = false) =>
    post(`/standups/${id}/run-coo${includeActivities ? '?include_activities=1' : ''}`, {}),
  standupMessages: (id) => get(`/standups/${id}/messages`),
  standupSendMessage: (id, body) => post(`/standups/${id}/messages`, body),
  standupApprove: (id) => post(`/standups/${id}/approve`, {}),
  standupDelete: (id) => del(`/standups/${id}`),
  standupDeleteAll: () => del('/standups/all'),
  // Cron: trigger standup collection + COO (agent-to-agent)
  cronRunStandup: () => post('/cron/run-standup', {}),
  cronProcessDelegations: () => post('/cron/process-delegations', {}),
  // OpenClaw: list agents from config and sync to DB
  openclawAgents: () => get('/openclaw/agents'),
  openclawSync: (agentId) => post('/openclaw/sync', agentId ? { agent_id: agentId } : {}),
  // Content tools: metadata (list, update, create, test)
  contentToolsMeta: () => get('/tools/meta'),
  contentToolsMetaUpdate: (name, patch) => patch(`/tools/meta/${encodeURIComponent(name)}`, patch),
  contentToolsMetaCreate: (body) => post('/tools/meta', body),
  contentToolsTest: (name, body = {}) => post(`/tools/test/${encodeURIComponent(name)}`, body),
  // Content tools: monitor logs
  contentToolsLogs: (params = {}) => {
    const sp = new URLSearchParams();
    if (params.limit != null) sp.set('limit', params.limit);
    if (params.offset != null) sp.set('offset', params.offset);
    if (params.tool) sp.set('tool', params.tool);
    const q = sp.toString();
    return get(q ? `/tools/logs?${q}` : '/tools/logs');
  },
  contentToolsLogsCleanup: (params = {}) => {
    const sp = new URLSearchParams();
    if (params.older_than_days != null) sp.set('older_than_days', params.older_than_days);
    if (params.all === true || params.all === '1') sp.set('all', '1');
    const q = sp.toString();
    return del(q ? `/tools/logs?${q}` : '/tools/logs');
  },
  // Broadcast: send message to all or selected agents, collect replies
  broadcastSend: (message, agentIds = null) =>
    post('/broadcast', { message, agent_ids: agentIds && agentIds.length > 0 ? agentIds : undefined }),
  // Kanban
  kanbanTasks: (params = {}) => {
    const sp = new URLSearchParams();
    if (params.view) sp.set('view', params.view);
    if (params.from) sp.set('from', params.from);
    if (params.to) sp.set('to', params.to);
    if (params.limit != null) sp.set('limit', params.limit);
    const q = sp.toString();
    return get(q ? `/kanban/tasks?${q}` : '/kanban/tasks');
  },
  kanbanSummary: (days = 1) => get(`/kanban/summary?days=${days}`),
  kanbanTaskGet: (id) => get(`/kanban/tasks/${id}`),
  kanbanTaskCreate: (body) => post('/kanban/tasks', body),
  kanbanTaskUpdate: (id, body) => patch(`/kanban/tasks/${id}`, body),
  kanbanTaskReopen: (id) => post(`/kanban/tasks/${id}/reopen`, {}),
  kanbanTaskDelete: (id) => del(`/kanban/tasks/${id}`),
  kanbanTasksDeleteBulk: (taskIds) => request('/kanban/tasks', { method: 'DELETE', body: JSON.stringify({ task_ids: taskIds }) }),
  kanbanTaskMessages: (id) => get(`/kanban/tasks/${id}/messages`),
  kanbanTaskAddMessage: (id, role, content) => post(`/kanban/tasks/${id}/messages`, { role, content }),
  // Clear OpenClaw sessions for an agent (workspace UI)
  agentSessionsClear: (agentId) => post(`/agents/${encodeURIComponent(agentId)}/sessions/clear`, {}),
};
