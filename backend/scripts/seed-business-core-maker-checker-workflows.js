/**
 * CLI: seed ERP + CRM Maker/Checker protocol workflows for CEO(s).
 * Implementation: backend/src/services/business-core-maker-checker-workflows.js
 * Templates: company-blueprints/standard/business-core/workflow-*-maker-checker.json
 *
 * Usage:
 *   node backend/scripts/seed-business-core-maker-checker-workflows.js
 *   WORKFLOW_SEED_OWNER_ID=ceo-bala node backend/scripts/seed-business-core-maker-checker-workflows.js
 */
import { config } from 'dotenv';
import { dirname, join, resolve as pathResolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

import { getDb } from '../src/db/schema.js';
export {
  seedMakerCheckerWorkflowsForOwner,
  seedMakerCheckerWorkflowsForBusinessProfile,
  resolveMakerCheckerPair,
} from '../src/services/business-core-maker-checker-workflows.js';

function listTargetCeos() {
  const db = getDb();
  const only = String(process.env.WORKFLOW_SEED_OWNER_ID || '').trim();
  if (only) return db.prepare(`SELECT id, name FROM platform_users WHERE id = ?`).all(only);
  return db
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
  const { initDb } = await import('../src/db/schema.js');
  const { seedMakerCheckerWorkflowsForOwner } = await import(
    '../src/services/business-core-maker-checker-workflows.js'
  );
  initDb();
  const ceos = listTargetCeos();
  let seeded = 0;
  for (const ceo of ceos) {
    const r = seedMakerCheckerWorkflowsForOwner(ceo.id);
    if (r.results?.length) {
      seeded += r.results.length;
      console.log(ceo.id, JSON.stringify(r.results));
    } else {
      console.log(ceo.id, 'skip', JSON.stringify(r.skipped || []));
    }
  }
  console.log(JSON.stringify({ ok: true, ceos: ceos.length, workflows: seeded }));
}