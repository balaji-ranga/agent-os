const API_BASE = import.meta.env.VITE_API_URL || '/api';

let _authToken = null;

export function setAuthToken(token) {
  _authToken = token || null;
}

export function getAuthToken() {
  return _authToken;
}

async function request(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (_authToken) headers.Authorization = `Bearer ${_authToken}`;
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(err.error || res.statusText);
    error.status = res.status;
    error.data = err;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

async function get(path) {
  return request(path, { method: 'GET' });
}

async function post(path, body, options = {}) {
  return request(path, { ...options, method: 'POST', body: JSON.stringify(body) });
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

/** POST multipart/form-data (do not set Content-Type — browser sets boundary). */
async function postForm(path, formData) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const headers = {};
  if (_authToken) headers.Authorization = `Bearer ${_authToken}`;
  const res = await fetch(url, { method: 'POST', headers, body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(err.error || res.statusText);
    error.status = res.status;
    error.data = err;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Resolve a path for authenticated fetch without doubling /api.
 * `/api/media/...` stays `/api/media/...` when VITE_API_URL is `/api`.
 */
export function resolveFetchUrl(path) {
  if (!path || typeof path !== 'string') return path;
  if (path.startsWith('http')) return path;
  const base = String(API_BASE || '/api').replace(/\/$/, '');
  if (base.startsWith('http')) {
    if (path.startsWith('/api/') && /\/api$/i.test(base)) {
      return `${base.slice(0, -4)}${path}`;
    }
    return path.startsWith('/api/')
      ? `${base}${path.slice(4)}`
      : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }
  return path.startsWith('/api/')
    ? path
    : `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Fetch authenticated binary (PDF, image) and return a blob object URL. Caller should revoke when done. */
async function fetchBlobUrl(path) {
  const url = resolveFetchUrl(path);
  const headers = {};
  if (_authToken) headers.Authorization = `Bearer ${_authToken}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  // Preserve Content-Type so <audio>/<video> can play blob URLs (octet-stream often fails).
  const ct = String(res.headers.get('content-type') || '')
    .split(';')[0]
    .trim();
  const buf = await res.arrayBuffer();
  const blob = ct ? new Blob([buf], { type: ct }) : new Blob([buf]);
  return URL.createObjectURL(blob);
}

export const api = {
  fetchBlobUrl,
  health: () => get('/health'),
  // Workspace (OpenClaw MD files) — legacy single-workspace (optional)
  workspaceFiles: () => get('/workspace/files'),
  workspaceRead: (name) => get(`/workspace/files/${encodeURIComponent(name)}`),
  workspaceWrite: (name, text) => put(`/workspace/files/${encodeURIComponent(name)}`, { text }),
  // Per-agent workspace (MD files)
  agentWorkspaceFiles: (agentId) => get(`/agents/${encodeURIComponent(agentId)}/workspace/files`),
  agentWorkspaceRead: (agentId, name) => get(`/agents/${encodeURIComponent(agentId)}/workspace/files/${encodeURIComponent(name)}`),
  agentWorkspaceWrite: (agentId, name, text) => put(`/agents/${encodeURIComponent(agentId)}/workspace/files/${encodeURIComponent(name)}`, { text }),
  agentToolsGet: (agentId) => get(`/agents/${encodeURIComponent(agentId)}/tools`),
  agentToolsSet: (agentId, tools, opts = {}) =>
    put(`/agents/${encodeURIComponent(agentId)}/tools`, { tools, ...opts }),
  agentToolsSyncTemplateMd: (agentId, templateId) =>
    post(`/agents/${encodeURIComponent(agentId)}/tools/sync-template-md`, templateId ? { template_id: templateId } : {}),
  agentWorkspaceTemplates: () => get('/agents/workspace-templates'),
  agentWorkspaceTemplateGet: (templateId) => get(`/agents/workspace-templates/${encodeURIComponent(templateId)}`),
  agentWorkspaceApplyTemplate: (agentId, templateId) =>
    post(`/agents/${encodeURIComponent(agentId)}/workspace/apply-template`, { template_id: templateId }),
  agentWorkspacePublishTemplate: (agentId, body) =>
    post(`/agents/${encodeURIComponent(agentId)}/workspace/publish-template`, body || {}),
  adminWorkspaceTemplates: () => get('/admin/workspace-templates'),
  adminWorkspaceTemplateGet: (id) => get(`/admin/workspace-templates/${encodeURIComponent(id)}`),
  adminWorkspaceTemplateCreate: (body) => post('/admin/workspace-templates', body),
  adminWorkspaceTemplateUpdate: (id, body) => put(`/admin/workspace-templates/${encodeURIComponent(id)}`, body),
  adminWorkspaceTemplatePublish: (id) => post(`/admin/workspace-templates/${encodeURIComponent(id)}/publish`, {}),
  adminWorkspaceTemplateUnpublish: (id) => post(`/admin/workspace-templates/${encodeURIComponent(id)}/unpublish`, {}),
  adminWorkspaceTemplateDelete: (id) => del(`/admin/workspace-templates/${encodeURIComponent(id)}`),
  // Agents
  agentsList: () => get('/agents'),
  /** Rebuild ORG.md + COO AGENTS.md from DB for the signed-in CEO (admin: owner_user_id). */
  orgSyncAgentDocs: (body) => post('/agents/org/sync', body || {}),
  agentGet: (id) => get(`/agents/${id}`),
  agentCreate: (body) => post('/agents', body),
  agentUpdate: (id, body) => patch(`/agents/${id}`, body),
  agentDelete: (id) => del(`/agents/${id}`),
  agentChatHistory: async (id, params = {}) => {
    const tz =
      typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        : 'UTC';
    const sp = new URLSearchParams({ tz });
    if (params.limit != null) sp.set('limit', String(params.limit));
    if (params.offset != null) sp.set('offset', String(params.offset));
    const data = await get(`/agents/${id}/chat?${sp.toString()}`);
    if (Array.isArray(data)) return { turns: data, session: null, rolled_over: false };
    return {
      turns: Array.isArray(data?.turns) ? data.turns : [],
      session: data?.session || null,
      rolled_over: !!data?.rolled_over,
      total: data?.total,
      limit: data?.limit,
      offset: data?.offset,
      has_more: !!data?.has_more,
    };
  },
  agentChatSessions: (id, params = {}) => {
    const sp = new URLSearchParams();
    if (params.limit != null) sp.set('limit', String(params.limit));
    if (params.offset != null) sp.set('offset', String(params.offset));
    if (params.days != null) sp.set('days', String(params.days));
    const q = sp.toString();
    return get(q ? `/agents/${encodeURIComponent(id)}/chat/history?${q}` : `/agents/${encodeURIComponent(id)}/chat/history`);
  },
  agentChatRestore: (id, sessionId, mode = 'as_is') =>
    post(`/agents/${encodeURIComponent(id)}/chat/history/${encodeURIComponent(sessionId)}/restore`, {
      mode,
    }),
  agentChatSend: (id, message, userId = 'default', profileId = null, options = {}) => {
    const tz =
      typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        : 'UTC';
    return post(
      `/agents/${id}/chat`,
      {
        message,
        user_id: userId,
        tz,
        ...(profileId ? { profile_id: profileId } : {}),
      },
      options
    );
  },
  agentChatFromAgent: (toAgentId, fromAgentId, message) =>
    post(`/agents/${toAgentId}/chat/from-agent`, { from_agent_id: fromAgentId, message }),
  agentActivities: (id) => get(`/agents/${id}/activities`),
  // Standups
  standupsList: async (limit = 50, offset = 0) => {
    const sp = new URLSearchParams();
    if (limit != null) sp.set('limit', String(limit));
    if (offset != null) sp.set('offset', String(offset));
    const q = sp.toString();
    const data = await get(q ? `/standups?${q}` : '/standups');
    // Legacy array response still supported; server now returns { standups, total, … }
    if (Array.isArray(data)) return data;
    return data?.standups || [];
  },
  standupsListPage: (params = {}) => {
    const sp = new URLSearchParams();
    if (params.limit != null) sp.set('limit', String(params.limit));
    if (params.offset != null) sp.set('offset', String(params.offset));
    const q = sp.toString();
    return get(q ? `/standups?${q}` : '/standups');
  },
  standupGet: (id) => get(`/standups/${id}`),
  standupCreate: (body) => post('/standups', body),
  standupNotifications: (limit) => get(limit ? `/standups/notifications?limit=${limit}` : '/standups/notifications'),
  standupNotificationsDismiss: (ids) => post('/standups/notifications/dismiss', { ids }),
  standupNotificationsDismissAll: () => post('/standups/notifications/dismiss-all', {}),
  platformNotifications: (limit) =>
    get(limit ? `/platform-notifications?limit=${limit}` : '/platform-notifications'),
  platformNotificationsRead: (ids) => post('/platform-notifications/read', { ids }),
  platformNotificationsReadAll: () => post('/platform-notifications/read-all', {}),
  standupUpdate: (id, body) => patch(`/standups/${id}`, body),
  standupResponses: (id) => get(`/standups/${id}/responses`),
  standupAddResponse: (id, agentId, content) => post(`/standups/${id}/responses`, { agent_id: agentId, content }),
  standupRunCoo: (id, includeActivities = false) =>
    post(`/standups/${id}/run-coo${includeActivities ? '?include_activities=1' : ''}`, {}),
  standupMessages: async (id, params = {}) => {
    const sp = new URLSearchParams();
    if (params.limit != null) sp.set('limit', String(params.limit));
    if (params.offset != null) sp.set('offset', String(params.offset));
    const q = sp.toString();
    const data = await get(q ? `/standups/${id}/messages?${q}` : `/standups/${id}/messages`);
    if (Array.isArray(data)) return data;
    return data?.messages || [];
  },
  standupMessagesPage: (id, params = {}) => {
    const sp = new URLSearchParams();
    if (params.limit != null) sp.set('limit', String(params.limit));
    if (params.offset != null) sp.set('offset', String(params.offset));
    const q = sp.toString();
    return get(q ? `/standups/${id}/messages?${q}` : `/standups/${id}/messages`);
  },
  standupSendMessage: (id, body) => post(`/standups/${id}/messages`, body),
  standupApprove: (id) => post(`/standups/${id}/approve`, {}),
  standupDelete: (id) => del(`/standups/${id}`),
  standupDeleteAll: () => del('/standups/all'),
  // Cron: trigger standup collection + COO (agent-to-agent)
  cronRunStandup: () => post('/cron/run-standup', {}),
  cronProcessDelegations: () => post('/cron/process-delegations', {}),
  /** COO status checker: reconcile Kanban/A2A, post standup digest, email CEO. */
  cronRunStatusChecker: (body = {}) => post('/cron/run-status-checker', body),
  /** Permanently purge aged chats / standup / workflow runs per retention days. */
  cronRunDataRetention: (body = {}) => post('/cron/run-data-retention', body),
  // OpenClaw: list agents from config and sync to DB
  openclawAgents: () => get('/openclaw/agents'),
  openclawSync: (agentId) => post('/openclaw/sync', agentId ? { agent_id: agentId } : {}),
  // Content tools: metadata (list, update, create, test)
  contentToolsMeta: () => get('/tools/meta'),
  contentToolsMetaUpdate: (name, patch) => patch(`/tools/meta/${encodeURIComponent(name)}`, patch),
  contentToolsMetaCreate: (body) => post('/tools/meta', body),
  contentToolsTest: (name, body = {}) => post(`/tools/test/${encodeURIComponent(name)}`, body),
  /** CEO Tools → model mapping (BYOK tools; excludes embeddings / custom-script review). */
  contentToolsModelMappings: () => get('/tools/model-mappings'),
  contentToolsModelMappingsSave: (mappings) => put('/tools/model-mappings', { mappings }),
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
    if (params.offset != null) sp.set('offset', params.offset);
    const q = sp.toString();
    return get(q ? `/kanban/tasks?${q}` : '/kanban/tasks');
  },
  /** Unfiltered status counts (matches status_checker — all ages). */
  kanbanCounts: () => get('/kanban/counts'),
  kanbanSummary: (days = 1) => get(`/kanban/summary?days=${days}`),
  kanbanTaskGet: (id, params = {}) => {
    const sp = new URLSearchParams();
    if (params.messages_limit != null) sp.set('messages_limit', params.messages_limit);
    if (params.messages_offset != null) sp.set('messages_offset', params.messages_offset);
    const q = sp.toString();
    return get(q ? `/kanban/tasks/${id}?${q}` : `/kanban/tasks/${id}`);
  },
  kanbanTaskCreate: (body) => post('/kanban/tasks', body),
  kanbanTaskUpdate: (id, body) => patch(`/kanban/tasks/${id}`, body),
  kanbanTaskReopen: (id) => post(`/kanban/tasks/${id}/reopen`, {}),
  kanbanTaskDelete: (id) => del(`/kanban/tasks/${id}`),
  kanbanTasksDeleteBulk: (taskIds) => request('/kanban/tasks', { method: 'DELETE', body: JSON.stringify({ task_ids: taskIds }) }),
  kanbanTaskMessages: async (id, params = {}) => {
    const sp = new URLSearchParams();
    if (params.limit != null) sp.set('limit', params.limit);
    if (params.offset != null) sp.set('offset', params.offset);
    const q = sp.toString();
    const data = await get(q ? `/kanban/tasks/${id}/messages?${q}` : `/kanban/tasks/${id}/messages`);
    if (Array.isArray(data)) return data;
    return data?.messages || [];
  },
  kanbanTaskMessagesPage: (id, params = {}) => {
    const sp = new URLSearchParams();
    if (params.limit != null) sp.set('limit', params.limit);
    if (params.offset != null) sp.set('offset', params.offset);
    const q = sp.toString();
    return get(q ? `/kanban/tasks/${id}/messages?${q}` : `/kanban/tasks/${id}/messages`);
  },
  kanbanTaskAddMessage: (id, role, content) => post(`/kanban/tasks/${id}/messages`, { role, content }),
  jobCeoReviewConfirm: (body) => post('/tools/job-ceo-review-confirm', body),
  jobCeoReviewInclude: (body) => post('/tools/job-ceo-review-include', body),
  jobApplicantReviewQueue: (profileId, ceoUserId = 'default') =>
    get(`/job-applicant/profiles/${encodeURIComponent(profileId)}/review-queue?ceo_user_id=${encodeURIComponent(ceoUserId)}`),
  jobApplicantCeoReviewInclude: (profileId, body) =>
    post(`/job-applicant/profiles/${encodeURIComponent(profileId)}/ceo-review/include`, body),

  browserSessionStatus: () => get('/browser-session/status'),
  browserSessionUrlPolicy: () => get('/browser-session/url-policy'),
  browserSessionSetUrlPolicy: (body) => put('/browser-session/url-policy', body),
  browserSessionOptIn: (body = {}) => post('/browser-session/opt-in', body),
  browserSessionOptOut: (body = {}) => post('/browser-session/opt-out', body),
  browserSessionMarkReady: (body = {}) => post('/browser-session/mark-ready', body),
  browserSessionOpenLogin: (body = {}) => post('/browser-session/open-login-browser', body),
  browserSessionSaveSession: (body = {}) => post('/browser-session/save-session', body),
  browserSessionTasks: (params = {}) => {
    const q = new URLSearchParams();
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    if (params.days != null) q.set('days', String(params.days));
    const qs = q.toString();
    return get(`/browser-session/tasks${qs ? `?${qs}` : ''}`);
  },
  browserSessionTasksClear: () => del('/browser-session/tasks'),
  browserSessionTaskGet: (id) => get(`/browser-session/tasks/${encodeURIComponent(id)}`),
  browserSessionStartTask: (body) => post('/browser-session/tasks', body),
  browserSessionResumeTask: (id, body = {}) => post(`/browser-session/tasks/${encodeURIComponent(id)}/resume`, body),
  browserSessionCapture: (id, body = {}) => post(`/browser-session/tasks/${encodeURIComponent(id)}/capture`, body),
  browserSessionStopRecorder: (id, body = {}) => post(`/browser-session/tasks/${encodeURIComponent(id)}/stop-recorder`, body),
  browserSessionRecipes: (params = {}) => {
    const q = new URLSearchParams();
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    const qs = q.toString();
    return get(`/browser-session/recipes${qs ? `?${qs}` : ''}`);
  },
  browserSessionRecipeGet: (id) => get(`/browser-session/recipes/${encodeURIComponent(id)}`),
  browserSessionRecipeDelete: (id) => del(`/browser-session/recipes/${encodeURIComponent(id)}`),
  browserSessionRecipeRename: (id, name) =>
    patch(`/browser-session/recipes/${encodeURIComponent(id)}`, { name }),
  /** Download OpenClaw chrome-extension zip for Load unpacked. */
  browserSessionChromeExtensionDownload: async () => {
    const objectUrl = await fetchBlobUrl('/browser-session/chrome-extension.zip');
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = 'openclaw-chrome-extension.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  },
  jobApplicantBrowserAuth: () => get('/job-applicant/browser-auth/status'),
  jobApplicantBrowserStartLogin: (body = {}) => post('/job-applicant/browser-auth/start-login', body),
  jobApplicantBrowserCompleteLogin: (body = {}) => post('/job-applicant/browser-auth/complete-login', body),
  jobApplicantBrowserVerifyPortals: (body = {}) => post('/job-applicant/browser-auth/verify-portals', body),
  jobApplicantBrowserSpawnLoginScript: () => post('/job-applicant/browser-auth/spawn-login-script', {}),
  jobRunWorkflowNow: (body) => post('/tools/job-run-workflow-now', body),
  jobApplicantWorkflowRun: (body) => post('/job-applicant/workflow/run', body),
  jobApplicantPipelineStart: (body = {}) => post('/job-applicant/pipeline/start', body),
  jobApplicantPipelineStatus: () => get('/job-applicant/pipeline/status'),
  jobApplicantProfiles: () => get('/job-applicant/profiles'),
  jobApplicantProfileGet: (profileId) => get(`/job-applicant/profiles/${encodeURIComponent(profileId)}`),
  jobApplicantProfileCreate: (body) => post('/job-applicant/profiles', body),
  jobApplicantProfileUpdate: (profileId, body) => patch(`/job-applicant/profiles/${encodeURIComponent(profileId)}`, body),
  jobApplicantProfileConfirm: (profileId, body = {}) =>
    post(`/job-applicant/profiles/${encodeURIComponent(profileId)}/confirm`, body),
  jobApplicantProfileRename: (profileId, body) =>
    post(`/job-applicant/profiles/${encodeURIComponent(profileId)}/rename`, body),
  jobApplicantProfileDelete: (profileId, confirm = true) =>
    post(`/job-applicant/profiles/${encodeURIComponent(profileId)}/delete`, { confirm }),
  jobApplicantProfileDeactivate: (profileId) =>
    post(`/job-applicant/profiles/${encodeURIComponent(profileId)}/deactivate`, {}),
  jobApplicantWorkflowList: (profileId, limit = 20) =>
    get(`/job-applicant/workflows?profile_id=${encodeURIComponent(profileId)}&limit=${limit}`),
  jobApplicantWorkflowGet: (workflowId) => get(`/job-applicant/workflows/${workflowId}`),
  jobApplicantPortalAuth: (profileId) => get(`/job-applicant/profiles/${encodeURIComponent(profileId)}/portal-auth`),
  jobApplicantConnectPortals: (profileId, body = {}) =>
    post(`/job-applicant/profiles/${encodeURIComponent(profileId)}/connect-portals`, body),
  jobApplicantHarvestListings: (profileId, body = {}) =>
    post(`/job-applicant/profiles/${encodeURIComponent(profileId)}/harvest-listings`, body),
  jobApplicantMarkPortalsLoggedIn: (profileId, body = {}) =>
    post(`/job-applicant/profiles/${encodeURIComponent(profileId)}/portals/mark-logged-in`, body),
  authRegister: (body) => post('/auth/register', body),
  authLogin: (body) => post('/auth/login', body),
  authAdminLogin: (body) => post('/auth/admin/login', body),
  forgotPassword: (body) => post('/auth/forgot-password', body),
  resetPassword: (body) => post('/auth/reset-password', body),
  authMfaDefaults: () => get('/auth/mfa/defaults'),
  authMfaVerify: (body) => post('/auth/mfa/verify', body),
  authMfaResend: (body) => post('/auth/mfa/resend', body),
  authMfaSetupChallenge: (body) => post('/auth/mfa/setup-challenge', body),
  authLogout: () => post('/auth/logout', {}),
  authMe: () => get('/auth/me'),
  authUpdateProfile: (body) => patch('/auth/me', body),
  authIndustries: () => get('/auth/industries'),
  authLlmCatalog: () => get('/auth/llm-catalog'),
  ceoGuardrailsGet: () => get('/ceo-guardrails'),
  ceoGuardrailsSave: (body) => put('/ceo-guardrails', body),
  ceoGuardrailsEnrich: (body) => post('/ceo-guardrails/enrich', body),
  submitFeedback: (body) => post('/feedback', body),
  listFeedback: (params = {}) => {
    const q = new URLSearchParams();
    if (params.agent_id) q.set('agent_id', params.agent_id);
    if (params.days != null) q.set('days', String(params.days));
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.rating) q.set('rating', params.rating);
    const qs = q.toString();
    return get(`/feedback${qs ? `?${qs}` : ''}`);
  },
  masterDataTables: () => get('/master-data/tables'),
  masterDataTableCreate: (body) => post('/master-data/tables', body),
  masterDataTableUpdate: (id, body) => patch(`/master-data/tables/${encodeURIComponent(id)}`, body),
  masterDataTableGet: (id, params = {}) => {
    const q = new URLSearchParams();
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    const qs = q.toString();
    return get(`/master-data/tables/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`);
  },
  masterDataTableDelete: (id) => del(`/master-data/tables/${encodeURIComponent(id)}`),
  masterDataImportCsv: (body) => post('/master-data/tables/import-csv', body),
  masterDataTableQuery: (id, body) => post(`/master-data/tables/${encodeURIComponent(id)}/query`, body),
  masterDataRowInsert: (tableId, data) =>
    post(`/master-data/tables/${encodeURIComponent(tableId)}/rows`, { data }),
  masterDataRowUpdate: (tableId, rowId, data) =>
    patch(`/master-data/tables/${encodeURIComponent(tableId)}/rows/${encodeURIComponent(rowId)}`, { data }),
  masterDataRowDelete: (tableId, rowId) =>
    del(`/master-data/tables/${encodeURIComponent(tableId)}/rows/${encodeURIComponent(rowId)}`),
  contentExplorerList: (params = {}) => {
    const q = new URLSearchParams();
    if (params.source) q.set('source', params.source);
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    const qs = q.toString();
    return get(`/workspace/content-explorer${qs ? `?${qs}` : ''}`);
  },
  contentExplorerDownloadBlob: (item) => {
    const path =
      item?.download_url ||
      `/api/workspace/content-explorer/download?kind=${encodeURIComponent(item?.source === 'generated' ? 'generated' : 'uploaded')}&path=${encodeURIComponent(item?.relative_path || '')}`;
    return fetchBlobUrl(path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`);
  },
  /** Hard-delete selected items or all (body.all). Permanent disk delete. */
  contentExplorerDelete: (body) => post('/workspace/content-explorer/delete', body),
  inboundAttachmentsList: (params = {}) => {
    const q = new URLSearchParams();
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    const qs = q.toString();
    return get(`/workspace/inbound-attachments${qs ? `?${qs}` : ''}`);
  },
  inboundAttachmentUpload: (body) => post('/workspace/inbound-attachments', body),
  masterDataDocuments: (params = {}) => {
    const q = new URLSearchParams();
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    const qs = q.toString();
    return get(`/master-data/documents${qs ? `?${qs}` : ''}`);
  },
  masterDataDocumentUpload: (body) => post('/master-data/documents', body),
  masterDataDocumentReindex: (id) => post(`/master-data/documents/${encodeURIComponent(id)}/reindex`, {}),
  masterDataDocumentsReindexAll: () => post('/master-data/documents/reindex-all', {}),
  masterDataDocumentsPurgeAll: () => post('/master-data/documents/purge-all', {}),
  masterDataDocumentDelete: (id) => del(`/master-data/documents/${encodeURIComponent(id)}`),
  masterDataDocumentFromInbound: (body) => post('/master-data/documents/from-inbound', body),
  onboardingHelperGet: () => get('/onboarding/helper'),
  onboardingHelperSaveDraft: (body) => put('/onboarding/helper/draft', body),
  onboardingHelperChat: (message) => post('/onboarding/helper/chat', { message }),
  onboardingHelperConfirmStep: () => post('/onboarding/helper/confirm-step', {}),
  onboardingHelperGoStep: (step_index) => post('/onboarding/helper/go-step', { step_index }),
  onboardingHelperApply: (selected) => post('/onboarding/helper/apply', { confirm_override: true, selected }),
  onboardingHelperUpdateSelection: (selected_apply) => put('/onboarding/helper/selected-apply', { selected_apply }),
  onboardingHelperReset: () => post('/onboarding/helper/reset', {}),
  companySetupGate: () => get('/company-setup/gate'),
  companySetupSkip: () => post('/company-setup/skip', {}),
  companySetupBegin: () => post('/company-setup/begin', {}),
  companySetupFunnel: () => get('/company-setup/funnel'),
  companySetupSaveFunnel: (body) => put('/company-setup/funnel', body),
  companySetupApply: (selected) => post('/company-setup/apply', { confirm_override: true, selected }),
  companySetupDesign: () => post('/company-setup/design', {}),
  companySetupDesignChat: (message) => post('/company-setup/design-chat', { message }),
  companySetupConnectorSearch: (q) => get(`/company-setup/connectors/search?q=${encodeURIComponent(q || '')}`),
  companySetupIndustryBlueprints: (industry) =>
    get(`/company-setup/blueprints?industry=${encodeURIComponent(industry || '')}`),
  adminCompanyBlueprints: () => get('/admin/company-blueprints'),
  adminCompanyBlueprintCandidates: (limit = 40) =>
    get(`/admin/company-blueprints/candidates?limit=${encodeURIComponent(limit)}`),
  adminCompanyBlueprintGet: (id) => get(`/admin/company-blueprints/${encodeURIComponent(id)}`),
  adminCompanyBlueprintSnapshot: (ownerUserId) =>
    get(`/admin/company-blueprints/snapshot/${encodeURIComponent(ownerUserId)}`),
  adminPublishCompanyBlueprint: (body) => post('/admin/company-blueprints/publish', body),
  adminUnpublishCompanyBlueprint: (id) =>
    post(`/admin/company-blueprints/${encodeURIComponent(id)}/unpublish`, {}),
  adminSetDefaultCompanyBlueprint: (body) => post('/admin/company-blueprints/set-default', body),
  /** Download company industry blueprint zip (admin). */
  adminCompanyBlueprintDownloadZip: async (id, filenameHint) => {
    const path = `/admin/company-blueprints/${encodeURIComponent(id)}/export.zip`;
    const objectUrl = await fetchBlobUrl(path);
    const a = document.createElement('a');
    a.href = objectUrl;
    const base =
      String(filenameHint || id)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'blueprint';
    a.download = base.endsWith('.zip') ? base : `${base}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  },
  companyOperateGate: () => get('/company-operate/gate'),
  companyOperateSkip: () => post('/company-operate/skip', {}),
  companyOperateBegin: () => post('/company-operate/begin', {}),
  companyOperateState: () => get('/company-operate/state'),
  companyOperateSaveDraft: (body) => put('/company-operate/draft', body),
  companyOperateDesign: (body = {}) => post('/company-operate/design', body),
  companyOperateConfirm: (body = {}) => post('/company-operate/confirm', body),
  companyOperateApplyDay1: () => post('/company-operate/apply-day1', {}),
  videoToursList: () => get('/video-tours'),
  videoToursGet: (stem) => get(`/video-tours/${encodeURIComponent(stem)}`),
  videoToursVideoUrl: (stem) => `${API_BASE}/video-tours/${encodeURIComponent(stem)}/video`,
  videoToursCaptionsUrl: (stem) => `${API_BASE}/video-tours/${encodeURIComponent(stem)}/captions`,
  inboundAttachmentDownload: async (relativePath) => {
    const path = `/workspace/inbound-attachments/download?relative_path=${encodeURIComponent(relativePath)}`;
    const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = {};
    if (_authToken) headers.Authorization = `Bearer ${_authToken}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const j = await res.json();
        msg = j.error || msg;
      } catch (_) {}
      throw Object.assign(new Error(msg), { status: res.status });
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const m = /filename="([^"]+)"/i.exec(cd);
    return { blob, filename: m?.[1] || 'download.bin' };
  },
  masterDataRag: (body) => post('/master-data/rag', body),
  masterDataQuery: (body) => post('/master-data/query', body),
  aiSnipperSummary: (days = 7) => get(`/ai-snipper/summary?days=${days}`),
  efficiencySummary: (days = 14) => get(`/efficiency/summary?days=${encodeURIComponent(days)}`),
  efficiencyDepartments: () => get('/efficiency/departments'),
  efficiencyAgents: () => get('/efficiency/agents'),
  efficiencyAgent: (memberKey, days = 30) =>
    get(`/efficiency/agents/${encodeURIComponent(memberKey)}?days=${encodeURIComponent(days)}`),
  efficiencyAgentBudgetSet: (memberKey, body) =>
    put(`/efficiency/agents/${encodeURIComponent(memberKey)}/budget`, body),
  /** Zero month-to-date token usage. Pass memberKey for one agent, or omit/null for all. */
  efficiencyUsageReset: (memberKey = null) =>
    post('/efficiency/usage/reset', memberKey ? { member_key: memberKey } : {}),
  efficiencyStorage: () => get('/efficiency/storage'),
  efficiencyRetentionGet: () => get('/efficiency/retention'),
  efficiencyRetentionSet: (data_retention_days) => put('/efficiency/retention', { data_retention_days }),
  efficiencyRetentionPurge: (days = null) =>
    post('/efficiency/retention/purge', days != null ? { days } : {}),
  orgMembers: () => get('/org-members'),
  orgMemberUpsert: (body) => post('/org-members', body),
  orgMemberDelete: (id) => del(`/org-members/${encodeURIComponent(id)}`),
  adminUsers: (params = {}) => {
    const q = new URLSearchParams();
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    const qs = q.toString();
    return get(`/admin/users${qs ? `?${qs}` : ''}`);
  },
  adminUserGet: (userId) => get(`/admin/users/${encodeURIComponent(userId)}`),
  adminUserSetEnabled: (userId, enabled) => patch(`/admin/users/${encodeURIComponent(userId)}/enabled`, { enabled }),
  adminUserOffboard: (userId, body) => post(`/admin/users/${encodeURIComponent(userId)}/offboard`, body),
  adminUserResetPassword: (userId, body = {}) =>
    post(`/admin/users/${encodeURIComponent(userId)}/reset-password`, body),
  adminPlatformFeedbackList: (params = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.category) q.set("category", params.category);
    if (params.q) q.set("q", params.q);
    if (params.id) q.set("id", params.id);
    if (params.limit != null) q.set("limit", String(params.limit));
    const qs = q.toString();
    return get(`/admin/platform-feedback${qs ? `?${qs}` : ""}`);
  },
  adminPlatformFeedbackUpdate: (id, body) =>
    patch(`/admin/platform-feedback/${encodeURIComponent(id)}`, body),
  adminRegisterUser: (body) => post('/admin/users', body),
  adminGrantStandardAgents: (userId) => post(`/admin/users/${encodeURIComponent(userId)}/agents/grant-standard`, {}),
  adminEnableAgent: (userId, agentId) => post(`/admin/users/${encodeURIComponent(userId)}/agents/${encodeURIComponent(agentId)}/enable`, {}),
  adminDisableAgent: (userId, agentId) => post(`/admin/users/${encodeURIComponent(userId)}/agents/${encodeURIComponent(agentId)}/disable`, {}),
  adminAgentsGrouped: () => get('/admin/agents'),
  adminSendNotifications: (body) => post('/admin/notifications', body),
  adminRefreshDefaultAgents: (body) => post('/admin/default-agents/refresh', body),
  adminPlatformLlmGet: () => get('/admin/platform-llm'),
  adminPlatformLlmSet: (llm_active_endpoint) =>
    put('/admin/platform-llm', { llm_active_endpoint }),
  adminA2AInvocations: (params = {}) => {
    const q = new URLSearchParams();
    if (params.outcome) q.set('outcome', params.outcome);
    if (params.endpoint) q.set('endpoint', params.endpoint);
    if (params.source) q.set('source', params.source);
    if (params.q) q.set('q', params.q);
    if (params.client_ip) q.set('client_ip', params.client_ip);
    if (params.publish_id) q.set('publish_id', params.publish_id);
    if (params.owner_user_id) q.set('owner_user_id', params.owner_user_id);
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    const qs = q.toString();
    return get(`/admin/a2a-invocations${qs ? `?${qs}` : ''}`);
  },
  adminCrons: () => get('/admin/crons'),
  adminCronPause: (id) => post(`/admin/crons/${encodeURIComponent(id)}/pause`, {}),
  adminCronResume: (id) => post(`/admin/crons/${encodeURIComponent(id)}/resume`, {}),
  adminCronRun: (id) => post(`/admin/crons/${encodeURIComponent(id)}/run`, {}),
  adminImpersonateUser: (userId) => post(`/admin/users/${encodeURIComponent(userId)}/impersonate`, {}),
  authExitImpersonation: () => post('/auth/exit-impersonation', {}),
  // Agent workflows (custom, separate from job workflows)
  agentWorkflowList: (params = {}) => {
    const q = new URLSearchParams();
    if (params.q) q.set('q', params.q);
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    const qs = q.toString();
    return get(`/agent-workflows${qs ? `?${qs}` : ''}`);
  },
  agentWorkflowTemplates: () => get('/agent-workflows/meta/templates'),
  agentWorkflowTemplateGet: (templateId) => get(`/agent-workflows/meta/templates/${encodeURIComponent(templateId)}`),
  agentWorkflowTaskTypes: () => get('/agent-workflows/meta/task-types'),
  agentWorkflowGet: (id) => get(`/agent-workflows/${encodeURIComponent(id)}`),
  agentWorkflowHookInfo: (id) => get(`/agent-workflows/${encodeURIComponent(id)}/hook`),
  agentWorkflowHookRegister: (id, body = {}) =>
    post(`/agent-workflows/${encodeURIComponent(id)}/hooks/register`, body),
  agentWorkflowHookRegenerateSecret: (id, body = {}) =>
    post(`/agent-workflows/${encodeURIComponent(id)}/hooks/regenerate-secret`, body),
  openconnectorStatus: () => get('/integrations/openconnector/status'),
  openconnectorLink: () => get('/integrations/openconnector/link'),
  openconnectorLinkUpdate: (body) => post('/integrations/openconnector/link', body),
  openconnectorProvision: (body = {}) => post('/integrations/openconnector/provision', body),
  openconnectorApps: () => get('/integrations/openconnector/apps'),
  openconnectorAppsSearch: (q = '') =>
    get(`/integrations/openconnector/apps/search?q=${encodeURIComponent(q)}`),
  openconnectorActions: (appId, q = '') =>
    get(
      `/integrations/openconnector/apps/${encodeURIComponent(appId)}/actions${
        q ? `?q=${encodeURIComponent(q)}` : ''
      }`
    ),
  openconnectorActionGuide: (actionId) =>
    get(`/integrations/openconnector/actions/${encodeURIComponent(actionId)}/guide`),
  openconnectorExecute: (actionId, body = {}) =>
    post(`/integrations/openconnector/actions/${encodeURIComponent(actionId)}/execute`, body),
  openconnectorConnections: () => get('/integrations/openconnector/connections'),
  openconnectorConnectApp: (appId, body = {}) =>
    post(`/integrations/openconnector/connections/${encodeURIComponent(appId)}/connect`, body),
  openconnectorProvider: (appId) =>
    get(`/integrations/openconnector/providers/${encodeURIComponent(appId)}`),
  openconnectorOAuthStart: (appId, body = {}) =>
    post(`/integrations/openconnector/connections/${encodeURIComponent(appId)}/oauth/start`, body),
  openconnectorConnectionUpsert: (appId, body = {}) =>
    put(`/integrations/openconnector/connections/${encodeURIComponent(appId)}`, body),
  openconnectorConnectionDelete: (appId) =>
    del(`/integrations/openconnector/connections/${encodeURIComponent(appId)}`),
  openconnectorOAuthConfigs: () => get('/integrations/openconnector/oauth/configs'),
  openconnectorOAuthConfigUpsert: (appId, body = {}) =>
    put(`/integrations/openconnector/oauth/configs/${encodeURIComponent(appId)}`, body),
  openconnectorConsoleLaunch: () => post('/integrations/openconnector/console-launch', {}),
  opensearchConsoleLaunch: () => post('/integrations/opensearch/console-launch', {}),
  adminPlatformDocuments: () => get('/admin/platform-documents'),
  adminPlatformDocumentUpload: (body) => post('/admin/platform-documents', body),
  adminPlatformDocumentDelete: (id) => del(`/admin/platform-documents/${encodeURIComponent(id)}`),
  adminPlatformDocumentsReindexAll: () => post('/admin/platform-documents/reindex-all', {}),
  adminPlatformDocumentsRag: (body) => post('/admin/platform-documents/rag', body),
  adminPlatformDocumentsSeedHelp: () => post('/admin/platform-documents/seed-help', {}),
  adminToolOnboardingStatus: () => get('/admin/tool-onboarding/status'),
  adminToolOnboardingList: () => get('/admin/tool-onboarding'),
  adminToolOnboardingDiscover: () => get('/admin/tool-onboarding/discover'),
  adminToolOnboardingGet: (name) => get(`/admin/tool-onboarding/${encodeURIComponent(name)}`),
  adminToolOnboardingHealth: (name) => get(`/admin/tool-onboarding/${encodeURIComponent(name)}/health`),
  adminToolOnboardingStepup: (code) => post('/admin/tool-onboarding/stepup', { code }),
  adminToolOnboardingDeclare: (body, stepupToken) =>
    post('/admin/tool-onboarding', { ...body, stepup_token: stepupToken }),
  adminToolOnboardingPull: (name, stepupToken) =>
    post(`/admin/tool-onboarding/${encodeURIComponent(name)}/pull`, { stepup_token: stepupToken }),
  adminToolOnboardingDeploy: (name, stepupToken) =>
    post(`/admin/tool-onboarding/${encodeURIComponent(name)}/deploy`, { stepup_token: stepupToken }),
  adminToolOnboardingStop: (name, stepupToken) =>
    post(`/admin/tool-onboarding/${encodeURIComponent(name)}/stop`, { stepup_token: stepupToken }),
  adminToolOnboardingRestart: (name, stepupToken) =>
    post(`/admin/tool-onboarding/${encodeURIComponent(name)}/restart`, { stepup_token: stepupToken }),
  adminToolOnboardingDelete: (name, stepupToken, removeContentTool = false) =>
    del(
      `/admin/tool-onboarding/${encodeURIComponent(name)}?remove_content_tool=${removeContentTool ? '1' : '0'}&stepup_token=${encodeURIComponent(stepupToken || '')}`
    ),
  agentWorkflowCreate: (body) => post('/agent-workflows', body),
  agentWorkflowUpdate: (id, body) => patch(`/agent-workflows/${encodeURIComponent(id)}`, body),
  agentWorkflowPublish: (id) => post(`/agent-workflows/${encodeURIComponent(id)}/publish`, {}),
  agentWorkflowUnpublish: (id) => post(`/agent-workflows/${encodeURIComponent(id)}/unpublish`, {}),
  agentWorkflowDelete: (id) => del(`/agent-workflows/${encodeURIComponent(id)}`),
  agentWorkflowAudit: (id, limit = 50) => get(`/agent-workflows/${encodeURIComponent(id)}/audit?limit=${limit}`),
  agentWorkflowRuns: ({ page = 1, limit = 20, q = '' } = {}) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q) params.set('q', q);
    return get(`/agent-workflows/runs?${params}`);
  },
  agentWorkflowRunGet: (runId, params = {}) => {
    const sp = new URLSearchParams();
    if (params.steps_limit != null) sp.set('steps_limit', String(params.steps_limit));
    if (params.steps_offset != null) sp.set('steps_offset', String(params.steps_offset));
    if (params.limit != null) sp.set('limit', String(params.limit));
    if (params.offset != null) sp.set('offset', String(params.offset));
    const q = sp.toString();
    return get(q ? `/agent-workflows/runs/${runId}?${q}` : `/agent-workflows/runs/${runId}`);
  },
  agentWorkflowStopListen: (runId, nodeId) =>
    post(`/agent-workflows/runs/${runId}/listen/${encodeURIComponent(nodeId)}/stop`, {}),
  agentWorkflowRunsForDef: (id, limit = 30) => get(`/agent-workflows/${encodeURIComponent(id)}/runs?limit=${limit}`),
  agentWorkflowRun: (id, body = {}) => post(`/agent-workflows/${encodeURIComponent(id)}/run`, body),

  avatarsList: () => get('/avatars'),
  avatarsGet: (id) => get(`/avatars/${encodeURIComponent(id)}`),
  avatarsByAgent: (agentId) => get(`/avatars/by-agent/${encodeURIComponent(agentId)}`),
  avatarsUpload: (body) => post('/avatars', body),
  avatarsGenerate: (body) => post('/avatars/generate', body),
  avatarsAssignAgent: (id, agentId) => post(`/avatars/${encodeURIComponent(id)}/assign-agent`, { agentId }),
  avatarsUnassignAgent: (id) => post(`/avatars/${encodeURIComponent(id)}/unassign-agent`, {}),
  avatarsUpdate: (id, body) => patch(`/avatars/${encodeURIComponent(id)}`, body),
  avatarsDelete: (id) => del(`/avatars/${encodeURIComponent(id)}`),
  avatarsHunyuanStatus: () => get('/avatars/hunyuan/status'),

  vrScenesList: () => get('/vr-scenes'),
  vrScenesGet: (id) => get(`/vr-scenes/${encodeURIComponent(id)}`),
  vrScenesUpload: (body) => post('/vr-scenes', body),
  vrScenesUpdate: (id, body) => patch(`/vr-scenes/${encodeURIComponent(id)}`, body),
  vrScenesDelete: (id) => del(`/vr-scenes/${encodeURIComponent(id)}`),

  vrRoomsList: () => get('/vr-rooms'),
  vrRoomsGet: (id) => get(`/vr-rooms/${encodeURIComponent(id)}`),
  vrRoomsByAgent: (agentId) => get(`/vr-rooms/by-agent/${encodeURIComponent(agentId)}`),
  vrRoomsCreate: (body) => post('/vr-rooms', body),
  vrRoomsUpdate: (id, body) => patch(`/vr-rooms/${encodeURIComponent(id)}`, body),
  vrRoomsDelete: (id) => del(`/vr-rooms/${encodeURIComponent(id)}`),
  vrRoomsPatchLayout: (id, layout) => patch(`/vr-rooms/${encodeURIComponent(id)}/layout`, { layout }),
  vrRoomsPatchScene: (id, sceneId) => patch(`/vr-rooms/${encodeURIComponent(id)}/scene`, { sceneId }),
  vrRoomsAddMember: (id, avatarId) => post(`/vr-rooms/${encodeURIComponent(id)}/members`, { avatarId }),
  vrRoomsRemoveMember: (id, avatarId) =>
    del(`/vr-rooms/${encodeURIComponent(id)}/members/${encodeURIComponent(avatarId)}`),
  vrRoomsRoute: (id, text) => post(`/vr-rooms/${encodeURIComponent(id)}/route`, { text }),
  vrRoomsPublished: () => get('/vr-rooms/published'),
  vrRoomsPublish: (id, body = {}) => post(`/vr-rooms/${encodeURIComponent(id)}/publish`, body),
  vrRoomsUnpublish: (id) => post(`/vr-rooms/${encodeURIComponent(id)}/unpublish`, {}),
  publicVrGet: (slug) => get(`/public/vr/${encodeURIComponent(slug)}`),
  publicVrChat: (slug, body) => post(`/public/vr/${encodeURIComponent(slug)}/chat`, body || {}),

  speechStt: (formOrBody) =>
    formOrBody instanceof FormData
      ? postForm('/speech/stt', formOrBody)
      : post('/speech/stt', formOrBody || {}),
  speechTts: (body) => post('/speech/tts', body || {}),

  agentChannelsList: (params = {}) => {
    const q = new URLSearchParams();
    if (params.agentId) q.set('agentId', params.agentId);
    const qs = q.toString();
    return get(`/agent-channels${qs ? `?${qs}` : ''}`);
  },
  agentChannelsGet: (id) => get(`/agent-channels/${encodeURIComponent(id)}`),
  agentChannelsCreate: (body) => post('/agent-channels', body),
  agentChannelsUpdate: (id, body) => patch(`/agent-channels/${encodeURIComponent(id)}`, body),
  agentChannelsDelete: (id) => del(`/agent-channels/${encodeURIComponent(id)}`),
  agentChannelsApply: (id) => post(`/agent-channels/${encodeURIComponent(id)}/apply`, {}),
  agentChannelsDisable: (id) => post(`/agent-channels/${encodeURIComponent(id)}/disable`, {}),
  agentChannelsTest: (id) => post(`/agent-channels/${encodeURIComponent(id)}/test`, {}),
  agentChannelsWhatsAppQr: (id) => get(`/agent-channels/${encodeURIComponent(id)}/whatsapp-qr`),
  agentChannelsWhatsAppQrStart: (id, body = {}) =>
    post(`/agent-channels/${encodeURIComponent(id)}/whatsapp-qr/start`, body),
  agentChannelsWhatsAppQrWait: (id, body = {}) =>
    post(`/agent-channels/${encodeURIComponent(id)}/whatsapp-qr/wait`, body),

  mediaArtifactsUpload: (body) => post('/media/artifacts', body),
  mediaArtifactsList: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return get(`/media/artifacts${q ? `?${q}` : ''}`);
  },

  agentWorkflowApprovalRespond: (body) => post('/agent-workflows/approval/respond', body),
  agentWorkflowPause: (id) => post(`/agent-workflows/${encodeURIComponent(id)}/pause`, {}),
  agentWorkflowResume: (id) => post(`/agent-workflows/${encodeURIComponent(id)}/resume`, {}),
  agentWorkflowUpdateTriggers: (id, body) => patch(`/agent-workflows/${encodeURIComponent(id)}/triggers`, body),
  agentWorkflowRunPause: (runId) => post(`/agent-workflows/runs/${runId}/pause`, {}),
  agentWorkflowRunRetry: (runId, body = {}) => post(`/agent-workflows/runs/${runId}/retry`, body),
  agentWorkflowRunDelete: (runId) => del(`/agent-workflows/runs/${runId}`),
  agentWorkflowRunsPauseAll: (definitionId = null) =>
    post('/agent-workflows/runs/pause-all', definitionId ? { definition_id: definitionId } : {}),
  agentWorkflowRunsDeleteAll: (definitionId = null) => {
    const q = definitionId ? `?definition_id=${encodeURIComponent(definitionId)}` : '';
    return del(`/agent-workflows/runs/all${q}`);
  },
  agentWorkflowAgentChat: (body) => post('/agent-workflows/agent-chat', body),
  agentWorkflowAgentChatHistory: (workflowId = null, limit = 100) => {
    const q = new URLSearchParams();
    if (workflowId) q.set('workflow_id', workflowId);
    q.set('limit', String(limit));
    return get(`/agent-workflows/agent-chat/history?${q}`);
  },
  agentWorkflowDraftGet: (id) => get(`/agent-workflows/draft/${encodeURIComponent(id)}`),
  agentWorkflowMutate: (body) => post('/agent-workflows/mutate', body),
  // Clear OpenClaw sessions for an agent (workspace UI)
  agentSessionsClear: (agentId) => post(`/agents/${encodeURIComponent(agentId)}/sessions/clear`, {}),
  agentSessionsNew: (agentId) => post(`/agents/${encodeURIComponent(agentId)}/sessions/new`, {}),
  userApiKeysList: () => get('/user-api-keys'),
  userApiKeysCreate: (body) => post('/user-api-keys', body),
  userApiKeysUpdate: (id, body) => patch(`/user-api-keys/${encodeURIComponent(id)}`, body),
  userApiKeysDelete: (id, force = false) =>
    del(`/user-api-keys/${encodeURIComponent(id)}${force ? '?force=1' : ''}`),
  userApiKeysDependencies: (id) => get(`/user-api-keys/${encodeURIComponent(id)}/dependencies`),
  userApiKeysReseed: () => post('/user-api-keys/reseed', {}),
  homeSnapshot: () => get('/home/snapshot'),
  homeSearch: (q) => get(`/home/search?q=${encodeURIComponent(q || '')}`),
  // MCP integrations
  mcpServersList: (opts = {}) => {
    const q = opts.forWorkflow ? '?for_workflow=1' : '';
    return get(`/integrations/mcp${q}`);
  },
  mcpServerGet: (id) => get(`/integrations/mcp/${encodeURIComponent(id)}`),
  mcpServerCreate: (body) => post('/integrations/mcp', body),
  mcpServerUpdate: (id, body) => patch(`/integrations/mcp/${encodeURIComponent(id)}`, body),
  mcpServerDelete: (id) => del(`/integrations/mcp/${encodeURIComponent(id)}`),
  mcpServerConnect: (id, body = {}) => post(`/integrations/mcp/${encodeURIComponent(id)}/connect`, body),
  mcpServerCallTool: (id, toolName, args, body = {}) =>
    post(`/integrations/mcp/${encodeURIComponent(id)}/tools/${encodeURIComponent(toolName)}/call`, {
      arguments: args,
      ...body,
    }),
  mcpServerLogs: (id, limit = 20) => get(`/integrations/mcp/${encodeURIComponent(id)}/logs?limit=${limit}`),
  // MCP OAuth (Connectors → MCPs tab; any registry MCP with OAuth client config)
  mcpOauthConnectors: () => get('/integrations/mcp/oauth/connectors'),
  mcpOauthConfigs: () => get('/integrations/mcp/oauth/configs'),
  mcpOauthInclude: (body) => post('/integrations/mcp/oauth/include', body),
  mcpOauthExclude: (serverId) => post('/integrations/mcp/oauth/exclude', { server_id: serverId }),
  mcpOauthConfigUpsert: (serverId, body) =>
    put(`/integrations/mcp/${encodeURIComponent(serverId)}/oauth/config`, body),
  mcpOauthOverrideSave: (serverId, body) =>
    put(`/integrations/mcp/${encodeURIComponent(serverId)}/oauth/override`, body),
  mcpOauthOverrideClear: (serverId) =>
    del(`/integrations/mcp/${encodeURIComponent(serverId)}/oauth/override`),
  mcpOauthStart: (serverId) =>
    post(`/integrations/mcp/${encodeURIComponent(serverId)}/oauth/start`, {}),
  mcpOauthDisconnect: (serverId) =>
    del(`/integrations/mcp/${encodeURIComponent(serverId)}/oauth/connection`),

  externalAgentsList: (opts = {}) => {
    const q = opts.forWorkflow ? '?for_workflow=1' : '';
    return get(`/integrations/external-agents${q}`);
  },
  externalAgentGet: (id) => get(`/integrations/external-agents/${encodeURIComponent(id)}`),
  externalAgentCreate: (body) => post('/integrations/external-agents', body),
  externalAgentUpdate: (id, body) => patch(`/integrations/external-agents/${encodeURIComponent(id)}`, body),
  externalAgentDelete: (id) => del(`/integrations/external-agents/${encodeURIComponent(id)}`),
  externalAgentDiscover: (id) => post(`/integrations/external-agents/${encodeURIComponent(id)}/discover`, {}),
  externalAgentInvoke: (id, body) => post(`/integrations/external-agents/${encodeURIComponent(id)}/invoke`, body),

  agentExchangeList: (params = {}) => {
    const sp = new URLSearchParams();
    if (params.limit != null) sp.set('limit', String(params.limit));
    if (params.offset != null) sp.set('offset', String(params.offset));
    const q = sp.toString();
    return get(q ? `/agent-exchange?${q}` : '/agent-exchange');
  },
  agentExchangeAccessGet: (publishId) =>
    get(`/agent-exchange/${encodeURIComponent(publishId)}/access`),
  agentExchangeAccessSet: (publishId, accessPolicy) =>
    put(`/agent-exchange/${encodeURIComponent(publishId)}/access`, {
      access_policy: accessPolicy,
    }),
  agentExchangeVisibilitySet: (publishId, visibility) =>
    put(`/agent-exchange/${encodeURIComponent(publishId)}/visibility`, {
      visibility,
    }),
  agentExchangeIpAdd: (publishId, body) =>
    post(`/agent-exchange/${encodeURIComponent(publishId)}/ip-whitelist`, body),
  agentExchangeIpRemove: (publishId, entryId) =>
    del(
      `/agent-exchange/${encodeURIComponent(publishId)}/ip-whitelist/${encodeURIComponent(entryId)}`
    ),
  agentExchangeUnpublish: (publishId) =>
    del(`/agent-exchange/${encodeURIComponent(publishId)}`),
  agentExchangeTestSample: (publishId) =>
    get(`/agent-exchange/${encodeURIComponent(publishId)}/test-sample`),
  agentExchangeTest: (publishId, body) =>
    post(`/agent-exchange/${encodeURIComponent(publishId)}/test`, body),
  agentWorkflowA2APublication: (workflowId) =>
    get(`/agent-workflows/${encodeURIComponent(workflowId)}/a2a-publication`),
  agentWorkflowA2APublications: (workflowId) =>
    get(`/agent-workflows/${encodeURIComponent(workflowId)}/a2a-publications`),
  agentWorkflowPublishA2A: (workflowId, body) =>
    post(`/agent-workflows/${encodeURIComponent(workflowId)}/publish-a2a`, body),
  agentWorkflowUnpublishA2A: (workflowId, opts = {}) => {
    const q = opts.publishId
      ? `?publish_id=${encodeURIComponent(opts.publishId)}`
      : '';
    return del(`/agent-workflows/${encodeURIComponent(workflowId)}/a2a-publication${q}`);
  },

  agentWorkflowDesktopTokens: (id) =>
    get(`/agent-workflows/${encodeURIComponent(id)}/desktop-tokens`),
  agentWorkflowDesktopTokenRevoke: (id, tokenId) =>
    del(`/agent-workflows/${encodeURIComponent(id)}/desktop-tokens/${encodeURIComponent(tokenId)}`),
  agentWorkflowDesktopIpWhitelist: (id) =>
    get(`/agent-workflows/${encodeURIComponent(id)}/desktop-ip-whitelist`),
  agentWorkflowDesktopIpWhitelistAdd: (id, body) =>
    post(`/agent-workflows/${encodeURIComponent(id)}/desktop-ip-whitelist`, body),
  agentWorkflowDesktopIpWhitelistRemove: (id, entryId) =>
    del(
      `/agent-workflows/${encodeURIComponent(id)}/desktop-ip-whitelist/${encodeURIComponent(entryId)}`
    ),
  /** Download Windows desktop zip (mints token into package).
   * @param {{ includeRuntime?: boolean }} [opts]
   */
  agentWorkflowDesktopPackageDownload: async (id, filenameHint, opts = {}) => {
    const includeRuntime = opts.includeRuntime !== false;
    const q = `include_runtime=${includeRuntime ? '1' : '0'}`;
    const path = `/agent-workflows/${encodeURIComponent(id)}/desktop-package?${q}`;
    const objectUrl = await fetchBlobUrl(path);
    const a = document.createElement('a');
    a.href = objectUrl;
    const base = `${String(filenameHint || id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'workflow'}`;
    a.download = `${base}-${includeRuntime ? 'desktop' : 'desktop-lite'}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  },

  /** Download local IBKR bridge Windows zip (mints LOCAL_BRIDGE_TOKEN into .env).
   * @param {{ includeRuntime?: boolean }} [opts]
   */
  ibkrBridgePackageDownload: async (opts = {}) => {
    const includeRuntime = opts.includeRuntime !== false;
    const path = `/integrations/ibkr-bridge/package?include_runtime=${includeRuntime ? '1' : '0'}`;
    const objectUrl = await fetchBlobUrl(path);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = includeRuntime ? 'local-ibkr-bridge-desktop.zip' : 'local-ibkr-bridge-lite.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  },

  customScriptsList: (opts = {}) => {
    const q = opts.forWorkflow ? '?for_workflow=1' : '';
    return get(`/integrations/custom-scripts${q}`);
  },
  customScriptGet: (id, opts = {}) => {
    const q = opts.includeSource ? '?include_source=1' : '';
    return get(`/integrations/custom-scripts/${encodeURIComponent(id)}${q}`);
  },
  customScriptScan: (body) => post('/integrations/custom-scripts/scan', body),
  customScriptCreate: (body) => post('/integrations/custom-scripts', body),
  customScriptUpdate: (id, body) => patch(`/integrations/custom-scripts/${encodeURIComponent(id)}`, body),
  customScriptDelete: (id) => del(`/integrations/custom-scripts/${encodeURIComponent(id)}`),
  customScriptExecute: (id, body = {}) =>
    post(`/integrations/custom-scripts/${encodeURIComponent(id)}/execute`, body),

  // Scheduled goals (recurring CEO prompts → agents)
  scheduledGoalsList: (params = {}) => {
    const sp = new URLSearchParams();
    if (params.status) sp.set('status', params.status);
    const q = sp.toString();
    return get(q ? `/scheduled-goals?${q}` : '/scheduled-goals');
  },
  scheduledGoalsGet: (id) => get(`/scheduled-goals/${encodeURIComponent(id)}`),
  scheduledGoalsCreate: (body) => post('/scheduled-goals', body),
  scheduledGoalsEnrich: (body) => post('/scheduled-goals/enrich', body),
  scheduledGoalsUpdate: (id, body) => patch(`/scheduled-goals/${encodeURIComponent(id)}`, body),
  scheduledGoalsPause: (id) => post(`/scheduled-goals/${encodeURIComponent(id)}/pause`, {}),
  scheduledGoalsResume: (id) => post(`/scheduled-goals/${encodeURIComponent(id)}/resume`, {}),
  scheduledGoalsRunNow: (id) => post(`/scheduled-goals/${encodeURIComponent(id)}/run-now`, {}),
  scheduledGoalsDelete: (id) => del(`/scheduled-goals/${encodeURIComponent(id)}`),
};
