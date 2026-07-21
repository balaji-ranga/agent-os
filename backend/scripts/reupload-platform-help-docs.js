/**
 * Force re-upload Flolah User Guide + all Platform Help docs for every CEO.
 * Usage: node scripts/reupload-platform-help-docs.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import {
  ensureCeoDefaultMasterDataForAllCeos,
  PLATFORM_HELP_TITLE_PREFIX,
  FLOLAH_GUIDE_TITLE,
} from '../src/services/ceo-default-master-data.js';
import { listDocuments } from '../src/services/master-data.js';

initDb();
const ceos = getDb().prepare(`SELECT id FROM platform_users WHERE role = 'ceo'`).all();
const result = ensureCeoDefaultMasterDataForAllCeos(
  ceos.map((c) => c.id),
  { refresh: true }
);
console.log('reupload result', result);

for (const { id } of ceos.slice(0, 3)) {
  const docs = listDocuments(id);
  const help = docs.filter((d) => String(d.title || '').startsWith(PLATFORM_HELP_TITLE_PREFIX));
  const guide = docs.find((d) => d.title === FLOLAH_GUIDE_TITLE);
  const legacy = docs.filter((d) => /Flowlah/i.test(String(d.title || '')));
  console.log(id, {
    helpDocs: help.length,
    guide: !!guide,
    legacyFlowlahTitles: legacy.length,
  });
}
console.log('PASS: platform help reupload');
