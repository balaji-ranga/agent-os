import { getDb } from './schema.js';
import { PRODUCTIVITY_OPERATIONS } from '../services/event-productivity.js';
import { writeOpenClawToolsList } from '../services/content-tools-meta.js';
import { getAgentToolGrants, syncAllowlistsFile, syncOpenClawJsonForAgent, writeAgentToolsMd } from '../services/openclaw-agent-tools.js';

const eventTools = [
  { name: 'event_inbox_list', label: 'Event inbox list', purpose: 'List owner-scoped normalized productivity events. Body: optional status and limit.', tier: 'R0', family: 'read' },
  { name: 'event_inbox_get', label: 'Event inbox get', purpose: 'Read one owner-scoped normalized productivity event by event_id.', tier: 'R0', family: 'read' },
];

export const EVENT_PRODUCTIVITY_TOOLS = [
  ...eventTools,
  ...Object.entries(PRODUCTIVITY_OPERATIONS).map(([name, spec]) => ({
    name,
    label: name.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' '),
    purpose: name === 'productivity_capabilities'
      ? 'List supported calendar, files, documents, spreadsheets, Slack, and Teams capabilities and provider requirements.'
      : `Run the configured owner-scoped ${name} connector binding. Body: { provider, input, idempotency_key? }. Exact provider action binding is required; no fuzzy or keyword action selection.`,
    tier: spec.tier,
    family: spec.family,
  })),
];

export function seedEventProductivityToolsIfMissing() {
  const db = getDb();
  try {
    const cols = db.prepare('PRAGMA table_info(content_tools_meta)').all().map((c) => c.name);
    if (!cols.includes('risk_tier')) db.exec(`ALTER TABLE content_tools_meta ADD COLUMN risk_tier TEXT DEFAULT ''`);
    if (!cols.includes('action_family')) db.exec(`ALTER TABLE content_tools_meta ADD COLUMN action_family TEXT DEFAULT ''`);
  } catch (_) {}
  const insert = db.prepare(`INSERT OR IGNORE INTO content_tools_meta
    (name,display_name,endpoint,method,purpose,model_used,enabled,is_builtin,risk_tier,action_family)
    VALUES (?,?,?,?,?,'',1,1,?,?)`);
  const update = db.prepare(`UPDATE content_tools_meta SET display_name=?,endpoint=?,method='POST',purpose=?,enabled=1,risk_tier=?,action_family=? WHERE name=?`);
  for (const tool of EVENT_PRODUCTIVITY_TOOLS) {
    const endpoint = `/api/tools/${tool.name.replaceAll('_', '-')}`;
    insert.run(tool.name, tool.label, endpoint, 'POST', tool.purpose, tool.tier, tool.family);
    update.run(tool.label, endpoint, tool.purpose, tool.tier, tool.family, tool.name);
  }
  const agents = db.prepare(`SELECT * FROM agents WHERE id IN ('balserve','workflowbuilder') OR openclaw_agent_id IN ('balserve','workflowbuilder')`).all();
  const grant = db.prepare(`INSERT OR IGNORE INTO agent_tool_grants(agent_id,tool_name) VALUES (?,?)`);
  let added = 0;
  for (const agent of agents) {
    for (const tool of EVENT_PRODUCTIVITY_TOOLS) added += grant.run(agent.id, tool.name).changes || 0;
    try {
      syncOpenClawJsonForAgent(agent);
      writeAgentToolsMd(agent, getAgentToolGrants(agent.id)).catch(() => {});
    } catch (error) { console.warn('[event-productivity] agent tool sync:', error.message); }
  }
  writeOpenClawToolsList();
  if (added) syncAllowlistsFile();
  return { tools: EVENT_PRODUCTIVITY_TOOLS.length, grants_added: added };
}
