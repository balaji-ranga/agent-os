/**
 * Verify every CEO's COO AGENTS.md is the org-generated one (not a stale workspace template copy).
 *
 * The intent classifier picks delegation targets from this file, so a template copy silently drops
 * external/A2A leaf members and the COO starts answering specialist work itself.
 *
 * Usage: node backend/scripts/verify-coo-agents-md.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import {
  readCooAgentsMdForCeo,
  isGeneratedCooAgentsMd,
  buildOrgContextForCeo,
} from '../src/services/org-context.js';

initDb();

let failures = 0;
const ceos = getDb().prepare("SELECT id, name FROM platform_users WHERE role = 'ceo' ORDER BY rowid").all();
console.log(`Checking COO AGENTS.md for ${ceos.length} CEO(s)`);

for (const ceo of ceos) {
  const md = await readCooAgentsMdForCeo(ceo.id);
  const generated = isGeneratedCooAgentsMd(md);
  let expectedLeaves = 0;
  try {
    expectedLeaves = (buildOrgContextForCeo(ceo.id).leaf_members || []).length;
  } catch (e) {
    console.warn('  org context lookup failed', ceo.id, e?.message || e);
  }
  const listedLeaves = (md.match(/^\| `(?:ext|a2a):/gm) || []).length;
  const leavesOk = expectedLeaves === 0 || listedLeaves > 0;
  if (!generated || !leavesOk) failures += 1;
  console.log(
    `${generated && leavesOk ? '  OK  ' : ' FAIL '} ${ceo.id} — ${md.length} bytes, generated=${generated}, leaf members listed=${listedLeaves}/${expectedLeaves}`
  );
}

console.log(failures === 0 ? '\nAll COO AGENTS.md files are org-generated.' : `\n${failures} CEO(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
