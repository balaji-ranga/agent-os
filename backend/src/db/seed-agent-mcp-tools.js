import { getDb } from './schema.js';

const TOOLS = [
  {
    name: 'mcp_bound_tools_list',
    display: 'List bound MCP tools',
    endpoint: '/api/tools/mcp-bound-tools-list',
    purpose: 'List only the registered MCP tools the signed-in company has explicitly bound to the calling agent, including schemas and Action Control risk labels.',
    risk: 'R0',
    family: 'read',
  },
  {
    name: 'mcp_bound_tool_call',
    display: 'Call a bound MCP tool',
    endpoint: '/api/tools/mcp-bound-tool-call',
    purpose: 'Invoke one exact company-and-agent-bound MCP tool. Requires server_id, mcp_tool_name and arguments. Tenant scope, server health, stored OAuth/auth and Action Control are enforced by Flolah.',
    risk: 'R2',
    family: 'communicate_external',
  },
];

export function seedAgentMcpBridgeToolsIfMissing() {
  const db = getDb();
  const columns = db.prepare('PRAGMA table_info(content_tools_meta)').all().map((column) => column.name);
  if (!columns.includes('risk_tier')) db.exec(`ALTER TABLE content_tools_meta ADD COLUMN risk_tier TEXT DEFAULT ''`);
  if (!columns.includes('action_family')) db.exec(`ALTER TABLE content_tools_meta ADD COLUMN action_family TEXT DEFAULT ''`);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta
     (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin, risk_tier, action_family)
     VALUES (?, ?, ?, 'POST', ?, '', 1, 1, ?, ?)`
  );
  const update = db.prepare(
    `UPDATE content_tools_meta SET display_name = ?, endpoint = ?, method = 'POST', purpose = ?,
     enabled = 1, is_builtin = 1, risk_tier = ?, action_family = ? WHERE name = ?`
  );
  for (const tool of TOOLS) {
    insert.run(tool.name, tool.display, tool.endpoint, tool.purpose, tool.risk, tool.family);
    update.run(tool.display, tool.endpoint, tool.purpose, tool.risk, tool.family, tool.name);
  }
  return TOOLS.length;
}
