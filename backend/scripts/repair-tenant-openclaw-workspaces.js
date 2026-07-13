/**
 * Repair tenant workspaces + docs for all standard agents × CEOs.
 * Usage: node scripts/repair-tenant-openclaw-workspaces.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { ensureTenantOpenClawAgent } from '../src/services/openclaw-tenant.js';
import { syncAllowlistsFile } from '../src/services/openclaw-agent-tools.js';

initDb();
const db = getDb();

const agents = db
  .prepare(
    `SELECT * FROM agents
     WHERE agent_type = 'standard' OR agent_type IS NULL OR agent_type = ''
     ORDER BY name`
  )
  .all();

const grants = db
  .prepare(
    `SELECT ua.user_id, ua.agent_id, u.email
     FROM user_agents ua
     JOIN platform_users u ON u.id = ua.user_id
     WHERE ua.enabled = 1 AND u.role = 'ceo'`
  )
  .all();

let n = 0;
for (const g of grants) {
  const agent = agents.find((a) => a.id === g.agent_id);
  if (!agent) continue;
  const ensured = ensureTenantOpenClawAgent(agent, g.user_id);
  const soul = join(ensured.workspacePath, 'SOUL.md');
  const tools = join(ensured.workspacePath, 'TOOLS.md');
  const soulTxt = existsSync(soul) ? readFileSync(soul, 'utf8') : '';
  const toolsTxt = existsSync(tools) ? readFileSync(tools, 'utf8') : '';
  const okSoul =
    agent.id !== 'balserve' || /BalServe|COO/i.test(soulTxt);
  const okTools =
    agent.id !== 'balserve' || /agent_workflow_list/i.test(toolsTxt);
  console.log(
    g.user_id,
    ensured.openclawAgentId,
    'soulOk=',
    okSoul,
    'toolsOk=',
    okTools
  );
  n += 1;
}

syncAllowlistsFile();
console.log(`repaired ${n} tenant agent workspaces`);
