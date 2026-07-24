/**
 * Force refresh Platform Help docs (esp. dynamic values) into Master Data RAG.
 * Run: node backend/scripts/reupload-platform-help-docs.js
 * Or this force script after deleting stale titles.
 */
import { initDb, getDb } from '../src/db/schema.js';
import { listDocuments, deleteDocument, ragDocuments } from '../src/services/master-data.js';
import {
  ensureCeoDefaultMasterDataForAllCeos,
  PLATFORM_HELP_TITLE_PREFIX,
} from '../src/services/ceo-default-master-data.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';

initDb();

const FORCE_TITLES = [
  `${PLATFORM_HELP_TITLE_PREFIX}Workflow Dynamic Values`,
  `${PLATFORM_HELP_TITLE_PREFIX}Workflows Building`,
  `${PLATFORM_HELP_TITLE_PREFIX}Workflow Nodes Reference`,
  `${PLATFORM_HELP_TITLE_PREFIX}Index`,
];

const owner = getBalaCeoAuthId();
for (const d of listDocuments(owner)) {
  const title = String(d.title || '');
  if (FORCE_TITLES.some((t) => title === t) || /Dynamic Values/i.test(title)) {
    console.log('delete', title);
    try {
      deleteDocument(owner, d.id);
    } catch (e) {
      console.warn(e.message);
    }
  }
}

const ceos = getDb()
  .prepare(`SELECT id FROM platform_users WHERE role = 'ceo'`)
  .all()
  .map((c) => c.id);
const result = await ensureCeoDefaultMasterDataForAllCeos(ceos, { refresh: true });
console.log('reupload', {
  helpCreated: result.helpCreated,
  helpUpdated: result.helpUpdated,
  guidesUpdated: result.guidesUpdated,
  ceos: result.ceos,
});

const help = listDocuments(owner).filter((d) => String(d.title || '').startsWith(PLATFORM_HELP_TITLE_PREFIX));
console.log(
  'bala help docs',
  help.length,
  help.map((d) => d.title).filter((t) => /Dynamic|Building|Index/i.test(t))
);

const rag = await ragDocuments(owner, {
  query:
    'how to pass bearer token from previous step {{api-login.body.accessToken}} and workflow variables {{var.key}}',
  topK: 5,
  summarize: false,
});
const chunks = rag.chunks || rag.hits || [];
console.log('rag_hits', chunks.length);
for (const c of chunks.slice(0, 4)) {
  console.log('-', c.title || c.document_title, '::', String(c.content || '').slice(0, 110).replace(/\n/g, ' '));
}
console.log('FORCE_HELP_REFRESH_OK');
