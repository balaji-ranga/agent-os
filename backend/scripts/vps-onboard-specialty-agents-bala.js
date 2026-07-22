/**
 * VPS: onboard Vedic Astrology + Weather Forecasting custom agents for Balaji (ceo-bala)
 * via the same createFullAgent path used by UI POST /api/agents (service-level, after deploy).
 * Usage (in backend container): node scripts/vps-onboard-specialty-agents-bala.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { createFullAgent } from '../src/services/create-full-agent.js';
import { grantUserAgent, listUserAgents } from '../src/services/users.js';
import { ensureTenantOpenClawAgent } from '../src/services/openclaw-tenant.js';

initDb();
const db = getDb();

const CEO =
  db.prepare(`SELECT id, name, email FROM platform_users WHERE name = ?`).get('Balaji Ranganathan') ||
  db.prepare(`SELECT id, name, email FROM platform_users WHERE id = ?`).get(getBalaCeoAuthId()) ||
  db.prepare(`SELECT id, name, email FROM platform_users WHERE id = 'ceo-bala'`).get();

if (!CEO) {
  console.error('FAIL: Balaji / ceo-bala not found');
  process.exit(1);
}

console.log('CEO:', CEO.id, CEO.name);

const SPECS = [
  {
    id: 'vedic-astrology',
    name: 'Vedic Astrology',
    role: 'Vedic / Jyotish astrology specialist — charts, dashas, muhurta, and remedial guidance',
    department: 'Operations',
  },
  {
    id: 'weather-forecasting',
    name: 'Weather Forecasting',
    role: 'Weather forecasting specialist — outlooks, alerts, and plain-language forecasts',
    department: 'Operations',
  },
];

for (const spec of SPECS) {
  const existing = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(spec.id);
  let agent;
  if (existing) {
    console.log('exists', existing.id, '— ensuring grant + tenant runtime');
    grantUserAgent(CEO.id, spec.id);
    agent = existing;
    if (existing.agent_type === 'custom' && !existing.owner_user_id) {
      db.prepare(`UPDATE agents SET owner_user_id = ? WHERE id = ?`).run(CEO.id, spec.id);
      agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(spec.id);
    }
  } else {
    agent = await createFullAgent({
      id: spec.id,
      name: spec.name,
      role: spec.role,
      department: spec.department,
      ownerUserId: CEO.id,
    });
    console.log('created', agent.id, agent.openclaw_runtime_id || agent.openclaw_agent_id);
  }
  const ensured = ensureTenantOpenClawAgent(agent, CEO.id);
  console.log('runtime', ensured.openclawAgentId, 'ws', ensured.workspacePath);
}

const grants = listUserAgents(CEO.id).map((g) => g.agent_id);
for (const spec of SPECS) {
  if (!grants.includes(spec.id)) {
    console.error('FAIL: missing grant', spec.id);
    process.exit(1);
  }
  console.log('OK granted', spec.id);
}

console.log('PASS: specialty agents onboarded for', CEO.name);
