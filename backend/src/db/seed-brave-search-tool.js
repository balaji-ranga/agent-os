/**
 * Seed brave_web_search content tool + grant to default research/ops agents.
 */
import { getDb } from './schema.js';

const BRAVE_TOOL = {
  name: 'brave_web_search',
  display_name: 'Brave Web Search',
  endpoint: '/api/tools/brave-web-search',
  method: 'POST',
  purpose:
    'API tool: web search via Brave Search. Pass query (required) and optional count (1–20, default 5). Returns titles, URLs, snippets. Key: Platform default Profile uses platform BRAVE_API_KEY; any other Profile LLM uses vault BRAVE_SEARCH_BYOK only. Do not use exec.',
  model_used: 'Brave Search API',
  enabled: 1,
  is_builtin: 1,
};

const DEFAULT_BRAVE_TOOL_AGENT_BASE_IDS = [
  'balserve',
  'workflowbuilder',
  'platformhelp',
  'techresearcher',
];

export function seedBraveSearchToolIfMissing() {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    BRAVE_TOOL.name,
    BRAVE_TOOL.display_name,
    BRAVE_TOOL.endpoint,
    BRAVE_TOOL.method,
    BRAVE_TOOL.purpose,
    BRAVE_TOOL.model_used,
    BRAVE_TOOL.enabled,
    BRAVE_TOOL.is_builtin
  );
  db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ?, model_used = ? WHERE name = ?'
  ).run(
    BRAVE_TOOL.purpose,
    BRAVE_TOOL.display_name,
    BRAVE_TOOL.endpoint,
    BRAVE_TOOL.method,
    BRAVE_TOOL.model_used,
    BRAVE_TOOL.name
  );
  console.info('[startup] brave_web_search tool seeded');
}

export function grantBraveSearchToolToDefaultAgents() {
  const db = getDb();
  const agents = db.prepare('SELECT id FROM agents').all();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)'
  );
  let n = 0;
  for (const a of agents) {
    const id = String(a.id || '');
    const base = id.includes('--') ? id.split('--').pop() : id;
    if (!DEFAULT_BRAVE_TOOL_AGENT_BASE_IDS.includes(base)) continue;
    const info = insert.run(a.id, BRAVE_TOOL.name);
    n += info.changes || 0;
  }
  if (n > 0) {
    console.info('[startup] granted brave_web_search to %s default agent(s)', n);
  }
  return n;
}

export const BRAVE_SEARCH_TOOL_NAME = BRAVE_TOOL.name;
