/**
 * Canonical CEO sidebar menu catalog (ids used by nav hide prefs).
 * Server entitlements (CRM/ERP) still gate items separately.
 */
export const CEO_NAV_ALWAYS = new Set([
  'home',
  'this-week',
  'profile',
  'nav-menus',
  'workspace-designer',
  'ip-whitelists',
  'tokens-management',
  'api-keys',
]);

/** Top-level + section items — id is stable for hide prefs. */
export function buildCeoNavCatalog({ showCrm = false, showErp = false } = {}) {
  const top = [
    { id: 'home', label: 'Home', to: '/', always: true, group: 'top' },
    { id: 'this-week', label: 'Digest', to: '/this-week', always: true, group: 'top' },
    { id: 'objectives', label: 'Objectives Key Results (OKR)', to: '/objectives', group: 'top', permission: 'this-week' },
    { id: 'work', label: 'Workspace', to: '/work', group: 'top' },
    { id: 'agent-actions', label: 'Live Operations', to: '/agent-actions', group: 'top' },
    { id: 'company-reviews', label: 'Reviews', to: '/reviews', group: 'top' },
  ];
  const run = [
    { id: 'org', label: 'My Org', to: '/org', group: 'Run & Operate' },
    { id: 'kanban', label: 'Kanban', to: '/kanban', group: 'Run & Operate' },
  ];
  if (showCrm) {
    run.push({ id: 'crm', label: 'CRM', to: '/crm', group: 'Run & Operate', entitlement: 'crm' });
  }
  if (showErp) {
    run.push({ id: 'erp', label: 'ERP', to: '/erp', group: 'Run & Operate', entitlement: 'erp' });
  }
  run.push(
    { id: 'scheduled-goals', label: 'Scheduled goals', to: '/scheduled-goals', group: 'Run & Operate' },
    {
      id: 'goal-plans',
      label: 'Goal plans',
      to: '/goal-plans',
      group: 'Run & Operate',
      permission: 'this-week',
    },
    { id: 'broadcast', label: 'Broadcast', to: '/broadcast', group: 'Run & Operate' },
    { id: 'master-data', label: 'Knowledge', to: '/master-data', group: 'Run & Operate' },
    { id: 'content-explorer', label: 'Content Explorer', to: '/content-explorer', group: 'Run & Operate' },
    { id: 'policies', label: 'Policies', to: '/policies', group: 'Run & Operate' },
    { id: 'ai-snipper', label: 'AI Snipper', to: '/ai-snipper', group: 'Run & Operate' },
    { id: 'efficiency', label: 'Efficiency View', to: '/efficiency', group: 'Run & Operate' }
  );
  const prebuilt = [
    { id: 'job-profiles', label: 'Job profiles', to: '/job-profiles', group: 'Prebuilt Workflows' },
    { id: 'browser-session', label: 'Browser Session', to: '/browser-session', group: 'Prebuilt Workflows' },
    { id: 'job-workflows', label: 'Job workflows', to: '/job-workflows', group: 'Prebuilt Workflows' },
    { id: 'ibkr-summary', label: 'IBKR Summary', to: '/ibkr-summary', group: 'Prebuilt Workflows' },
    {
      id: 'ibkrnew0', label: 'IBKRNew0', group: 'Prebuilt Workflows', permission: 'ibkrnew-event-trader',
      children: [
        { id: 'ibkrnew0-strategy', label: 'Strategy', to: '/ibkrnew0/strategy' },
        { id: 'ibkrnew0-summary', label: 'Summary', to: '/ibkrnew0/summary' },
        { id: 'ibkrnew0-live', label: 'Live Operations', to: '/ibkrnew0/live-operations' },
      ],
    },
  ];
  const tools = [
    { id: 'workflows', label: 'Workflows', to: '/workflows', group: 'Company Tools' },
    { id: 'avatars', label: '3D Avatars', to: '/avatars', group: 'Company Tools' },
    { id: 'published-scenes', label: 'Published Scenes', to: '/published-scenes', group: 'Company Tools' },
    { id: 'ai-employees', label: 'AI Employees', to: '/workspace', group: 'Company Tools' },
    { id: 'content-tools', label: 'Tools', to: '/content-tools', group: 'Company Tools' },
    { id: 'connectors', label: 'Connectors', to: '/connectors', group: 'Company Tools' },
    { id: 'mcp', label: 'MCP', to: '/integrations/mcp', group: 'Company Tools' },
    { id: 'custom-scripts', label: 'Custom scripts', to: '/integrations/custom-scripts', group: 'Company Tools' },
    { id: 'agent-exchange', label: 'AgentExchange', to: '/agent-exchange', group: 'Company Tools' },
    { id: 'external-ai', label: 'External AI', to: '/integrations/external-agents', group: 'Company Tools' },
  ];
  const settings = [
    {
      id: 'workspace-designer',
      label: 'Workspace Builder',
      to: '/workspace-designer',
      always: true,
      group: 'Settings',
    },
    { id: 'nav-menus', label: 'Menu visibility', to: '/nav-menus', always: true, group: 'Settings' },
    {
      id: 'ip-whitelists',
      label: 'IP Whitelists',
      to: '/settings/ip-whitelists',
      always: true,
      group: 'Settings',
    },
    {
      id: 'tokens-management',
      label: 'Tokens management',
      to: '/settings/tokens',
      always: true,
      group: 'Settings',
    },
    { id: 'api-keys', label: 'API Keys', to: '/api-keys', always: true, group: 'Settings' },
  ];
  return [...top, ...run, ...prebuilt, ...tools, ...settings];
}

export function filterNavByHidden(items, hidden = []) {
  const hide = new Set((hidden || []).map(String));
  return items.filter((it) => {
    if (it.always || CEO_NAV_ALWAYS.has(it.id)) return true;
    return !hide.has(it.id);
  });
}
