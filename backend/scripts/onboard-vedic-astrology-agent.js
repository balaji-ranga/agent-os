/**
 * Onboard / refresh Vedic Astrology agent: template MD, tool grants, Master Data tables.
 * Usage: node scripts/onboard-vedic-astrology-agent.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { createFullAgent } from '../src/services/create-full-agent.js';
import { grantUserAgent, listUserAgents } from '../src/services/users.js';
import { ensureTenantOpenClawAgent, forcePushTemplateDocs } from '../src/services/openclaw-tenant.js';
import { setAgentToolGrants, syncAllowlistsFile, writeAgentToolsMd } from '../src/services/openclaw-agent-tools.js';
import { VEDIC_ASTROLOGY_TOOLS } from '../src/services/vedic-astrology-tools.js';
import { ensureVedicMasterData } from '../src/services/vedic-master-data.js';
import { seedVedicChartToolIfMissing } from '../src/db/seed-content-tools-meta.js';
import { writeOpenClawToolsList } from '../src/services/content-tools-meta.js';

initDb();
seedVedicChartToolIfMissing();
writeOpenClawToolsList();

const db = getDb();

const CEO =
  db.prepare(`SELECT id, name, email FROM platform_users WHERE name = ?`).get('Balaji Ranganathan') ||
  db.prepare(`SELECT id, name, email FROM platform_users WHERE id = ?`).get(getBalaCeoAuthId()) ||
  db.prepare(`SELECT id, name, email FROM platform_users WHERE id = 'ceo-bala'`).get();

if (!CEO) {
  console.error('FAIL: Balaji Ranganathan / ceo-bala not found');
  process.exit(1);
}

console.log('CEO:', CEO.id, CEO.name, CEO.email);

const AGENT_ID = 'vedic-astrology';
const existing = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(AGENT_ID);

let agent;
if (existing) {
  console.log('Agent already exists:', existing.id, existing.name);
  grantUserAgent(CEO.id, AGENT_ID);
  agent = existing;
} else {
  agent = await createFullAgent({
    id: AGENT_ID,
    name: 'Vedic Astrology',
    role: 'Vedic / Jyotish astrology specialist — charts, dashas, muhurta, and remedial guidance',
    department: 'Operations',
    ownerUserId: CEO.id,
    tools: VEDIC_ASTROLOGY_TOOLS,
  });
  console.log('Created agent:', agent.id, agent.name);
}

const ensured = ensureTenantOpenClawAgent(agent, CEO.id);
forcePushTemplateDocs(AGENT_ID, ensured.workspacePath, { forceIdentity: true });
setAgentToolGrants(agent, VEDIC_ASTROLOGY_TOOLS);
syncAllowlistsFile();
await writeAgentToolsMd({ ...agent, workspace_path: ensured.workspacePath }, VEDIC_ASTROLOGY_TOOLS);

const md = ensureVedicMasterData(CEO.id);
console.log('Master Data:', md);

const { syncOrgContextForCeo } = await import('../src/services/org-context.js');
await syncOrgContextForCeo(CEO.id);

const grants = listUserAgents(CEO.id);
console.log(
  'Granted tools:',
  VEDIC_ASTROLOGY_TOOLS.join(', ')
);
console.log('CEO has agent grant:', grants.some((g) => String(g.agent_id || g.id) === AGENT_ID));
console.log('PASS: Vedic Astrology agent onboarded/refreshed for', CEO.name);
