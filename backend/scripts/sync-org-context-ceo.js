/** Sync ORG.md + COO AGENTS.md for one CEO. Usage: node scripts/sync-org-context-ceo.js [ceoUserId] */
import { initDb } from '../src/db/schema.js';
import { syncOrgContextForCeo } from '../src/services/org-context.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';

initDb();
const ceoId = process.argv[2] || getBalaCeoAuthId();
const n = await syncOrgContextForCeo(ceoId);
console.log('synced', n, 'workspace(s) for', ceoId);
