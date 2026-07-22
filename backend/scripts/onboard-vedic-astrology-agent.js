/**
 * Onboard "Vedic Astrology" custom agent for Balaji Ranganathan (ceo-bala).
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

initDb();
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
  });
  console.log('Created agent:', agent.id, agent.name);
}

const grants = listUserAgents(CEO.id);
const granted = grants.find((g) => g.agent_id === AGENT_ID || g.id === AGENT_ID);
console.log('Granted to CEO:', !!granted || grants.some((g) => String(g.agent_id || g.id) === AGENT_ID));
console.log(
  'CEO agent grants:',
  grants.map((g) => g.agent_id || g.id).join(', ')
);
console.log('PASS: Vedic Astrology agent onboarded for', CEO.name);
