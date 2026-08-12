/**
 * CLI: install video_content agents + W-Reasoning from golden standard templates.
 *
 * Usage:
 *   WORKFLOW_SEED_OWNER_ID=ceo-bala node backend/scripts/seed-video-content-workflows.js
 *   WORKFLOW_SEED_OWNER_ID=ceo-bala INCLUDE_STUB_WORKFLOWS=1 node backend/scripts/seed-video-content-workflows.js
 */
import { config } from 'dotenv';
import { dirname, join, resolve as pathResolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export { seedVideoContentWorkflowsForOwner } from '../src/services/video-content-workflows.js';
export { installVideoContentForOwner, ensurePrefabVideoAgents } from '../src/services/prefab-video-agents.js';

function listTargetCeos(getDb) {
  const only = String(process.env.WORKFLOW_SEED_OWNER_ID || '').trim();
  if (only) return getDb().prepare(`SELECT id, name FROM platform_users WHERE id = ?`).all(only);
  return getDb()
    .prepare(`SELECT id, name FROM platform_users WHERE role = 'ceo' AND enabled = 1`)
    .all()
    .filter((c) => {
      const id = String(c.id || '');
      return !/^ceo-oc-connector-/i.test(id) && !/^ceo-os-rag-/i.test(id) && !/^ceo-md-[ab]-/i.test(id);
    });
}

function isDirectRun() {
  try {
    const entry = process.argv[1] ? pathResolve(process.argv[1]) : '';
    return entry && entry === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  config({ path: join(__dirname, '..', '.env') });
  config({ path: join(__dirname, '../../deploy/.env') });
  const { initDb, getDb } = await import('../src/db/schema.js');
  const { seedVideoStoryboardToolsIfMissing } = await import('../src/db/seed-content-tools-meta.js');
  const { installVideoContentForOwner } = await import('../src/services/prefab-video-agents.js');
  initDb();
  try {
    seedVideoStoryboardToolsIfMissing();
  } catch (e) {
    console.warn('[seed-video] tool meta', e?.message || e);
  }
  const includeStubs = String(process.env.INCLUDE_STUB_WORKFLOWS || '').trim() === '1';
  const ceos = listTargetCeos(getDb);
  if (!ceos.length) {
    console.error('[seed-video] no CEO targets (set WORKFLOW_SEED_OWNER_ID)');
    process.exit(1);
  }
  for (const ceo of ceos) {
    const out = await installVideoContentForOwner(ceo.id, { includeStubWorkflows: includeStubs });
    console.log(
      JSON.stringify({
        owner: ceo.id,
        name: ceo.name,
        agents: out.agents,
        created: out.created,
        workflows: out.workflows,
        knowledge: out.knowledge,
      })
    );
  }
}
