/**
 * VPS: onboard Vedic Astrology + Weather Forecasting custom agents for Balaji (ceo-bala)
 * via the same createFullAgent path used by UI POST /api/agents (service-level, after deploy).
 * Usage (in backend container): node scripts/vps-onboard-specialty-agents-bala.js
 */
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
import { syncOrgContextForCeo } from '../src/services/org-context.js';

initDb();
seedVedicChartToolIfMissing();
writeOpenClawToolsList();

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
    tools: VEDIC_ASTROLOGY_TOOLS,
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
      tools: spec.tools,
    });
    console.log('created', agent.id, agent.openclaw_runtime_id || agent.openclaw_agent_id);
  }
  const ensured = ensureTenantOpenClawAgent(agent, CEO.id);
  console.log('runtime', ensured.openclawAgentId, 'ws', ensured.workspacePath);

  if (spec.id === 'vedic-astrology') {
    forcePushTemplateDocs(spec.id, ensured.workspacePath, { forceIdentity: true });
    setAgentToolGrants(agent, VEDIC_ASTROLOGY_TOOLS);
    syncAllowlistsFile();
    await writeAgentToolsMd(
      { ...agent, workspace_path: ensured.workspacePath },
      VEDIC_ASTROLOGY_TOOLS
    );
    const md = ensureVedicMasterData(CEO.id);
    console.log('vedic master data', md);
  } else {
    try {
      forcePushTemplateDocs(spec.id, ensured.workspacePath, { forceIdentity: true });
    } catch (e) {
      console.warn('template push skipped for', spec.id, e?.message || e);
    }
  }
}

await syncOrgContextForCeo(CEO.id);

const grants = listUserAgents(CEO.id).map((g) => g.agent_id);
for (const spec of SPECS) {
  if (!grants.includes(spec.id)) {
    console.error('FAIL: missing grant', spec.id);
    process.exit(1);
  }
  console.log('OK granted', spec.id);
}

console.log('PASS: specialty agents onboarded for', CEO.name);
