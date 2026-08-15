/**
 * Seed a tiny Instagram scrape workflow (Web Scrape node → Crawlee sidecar).
 * Run: node backend/scripts/seed-web-scrape-instagram-workflow.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '../../deploy/.env') });

import { initDb, getDb } from '../src/db/schema.js';
import * as store from '../src/services/agent-workflow-store.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';

initDb();

export const WORKFLOW_ID = 'wf-web-scrape-instagram';

export function buildInstagramScrapeGraph() {
  const startUrl = String(process.env.WEB_SCRAPE_TEST_URL || 'https://www.instagram.com/p/C5bj13LJSQd/').trim();
  const phrases = String(process.env.WEB_SCRAPE_TEST_PHRASES || 'nasa, jupiter, eclipse').trim();
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 140 },
        data: {
          label: 'Start',
          triggerModes: ['manual'],
          scheduleCron: '',
          chatPhrase: '',
        },
      },
      {
        id: 'scrape-ig',
        type: 'web_scrape',
        position: { x: 320, y: 140 },
        data: {
          label: 'Scrape Instagram',
          taskConfig: {
            render: 'playwright',
            maxPages: 2,
            maxDepth: 0,
            sameOriginOnly: true,
            respectRobotsTxt: false,
            timeoutMs: 180000,
            timeoutAction: 'fail',
          },
          inputBindings: [
            {
              id: 'startUrl',
              label: 'Start URL / domain',
              mode: 'static',
              value: startUrl,
            },
            {
              id: 'phrases',
              label: 'Search phrases',
              mode: 'static',
              value: phrases,
            },
            {
              id: 'cookie',
              label: 'Cookie header (optional)',
              mode: 'static',
              value: '',
            },
          ],
          outputs: [
            { id: 'ok', label: 'Success' },
            { id: 'text', label: 'Summary text' },
            { id: 'matches', label: 'Matching pages JSON' },
            { id: 'pages', label: 'Visited pages JSON' },
            { id: 'stats', label: 'Crawl stats JSON' },
            { id: 'result', label: 'Full result JSON' },
          ],
        },
      },
    ],
    edges: [{ id: 'e-trigger-scrape', source: 'trigger-1', target: 'scrape-ig' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function seedWebScrapeInstagramWorkflow(ownerUserId) {
  const actor = { id: ownerUserId, name: 'seed-web-scrape-instagram' };
  const graph = buildInstagramScrapeGraph();
  const existing = store.getDefinition(WORKFLOW_ID, ownerUserId);
  if (!existing) {
    store.createDefinition({
      id: WORKFLOW_ID,
      name: 'Web scrape Instagram (sidecar)',
      description:
        'Generic Web Scrape node against instagram.com via the Crawlee sidecar. Session cookie from vault INSTAGRAM_SESSIONID when present.',
      ownerUserId,
      actor,
      graph,
      trigger_modes: ['manual'],
    });
  } else {
    store.updateDraft(WORKFLOW_ID, ownerUserId, { graph, trigger_modes: ['manual'] }, actor);
  }
  store.publishDefinition(WORKFLOW_ID, ownerUserId, actor);
  return store.getDefinition(WORKFLOW_ID, ownerUserId);
}

if (process.argv[1]?.includes('seed-web-scrape-instagram-workflow')) {
  let owner;
  try {
    owner = process.env.CEO_USER_ID || getBalaCeoAuthId();
  } catch {
    owner = getDb().prepare(`SELECT id FROM platform_users WHERE role='ceo' AND enabled=1 LIMIT 1`).get()?.id;
  }
  if (!owner) {
    console.error('No CEO owner');
    process.exit(1);
  }
  const def = seedWebScrapeInstagramWorkflow(owner);
  console.info('[seed-web-scrape-instagram] published', { id: def?.id, owner, status: def?.status });
}
