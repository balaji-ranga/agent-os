/**
 * E2E: Master Data â€” create table, CSV import, document upload, RAG, tenancy, workflow node.
 * Usage: node scripts/test-master-data-e2e.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb } from '../src/db/schema.js';
import { masterDataDocsDir } from '../src/services/master-data.js';
import * as store from '../src/services/agent-workflow-store.js';
import { startAgentWorkflowRun } from '../src/services/agent-workflow-runner.js';
import { getTaskTypeDef } from '../src/services/agent-workflow-task-catalog.js';

const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const stamp = Date.now().toString(36);
const password = `MdTest!${stamp}`;

let failed = 0;
let passed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else {
    passed += 1;
    console.log('OK:', msg);
  }
}

async function api(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

initDb();

console.log('\n=== 0) Health + catalog ===');
const health = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
assert(!!health?.ok, 'backend up');
assert(!!getTaskTypeDef('masterdata'), 'masterdata in task catalog');

console.log('\n=== 1) Register two CEOs (tenancy) ===');
const emailA = `md.a.${stamp}@example.com`;
const emailB = `md.b.${stamp}@example.com`;
const regA = await api('POST', '/api/auth/register', {
  accept_terms: true,
  email: emailA,
  password,
  name: `MD A ${stamp}`,
  db_mode: 'tenant',
  mfa_policy: 'off',
});
const regB = await api('POST', '/api/auth/register', {
  accept_terms: true,
  email: emailB,
  password,
  name: `MD B ${stamp}`,
  db_mode: 'tenant',
  mfa_policy: 'off',
});
assert(regA.status === 201, `reg A ${regA.status}`);
assert(regB.status === 201, `reg B ${regB.status}`);
const tokenA = regA.data.session?.token || regA.data.token;
const tokenB = regB.data.session?.token || regB.data.token;
const userA = regA.data.user?.id || regA.data.session?.user?.id;
const userB = regB.data.user?.id || regB.data.session?.user?.id;
assert(!!tokenA && !!userA, `userA=${userA}`);
assert(!!tokenB && !!userB, `userB=${userB}`);

console.log('\n=== 2) Create table + CSV (user A) ===');
const createT = await api(
  'POST',
  '/api/master-data/tables',
  { name: `Products ${stamp}`, columns: ['sku', 'name', 'price'] },
  tokenA
);
assert(createT.status === 201, `create table ${createT.status} ${createT.data.error || ''}`);
assert(createT.data.table?.owner_user_id === userA, 'table owner A');
const tableId = createT.data.table.id;

const csv = `sku,name,price\nA1,Widget,9.99\nA2,Gadget,19.50\nB9,Secret,1\n`;
const imp = await api(
  'POST',
  '/api/master-data/tables/import-csv',
  { name: `Import ${stamp}`, csvText: csv },
  tokenA
);
assert(imp.status === 201, `import csv ${imp.status}`);
assert(imp.data.imported === 3, `imported=${imp.data.imported}`);
const csvTableId = imp.data.table.id;

const q = await api('POST', `/api/master-data/tables/${csvTableId}/query`, { query: 'Widget' }, tokenA);
assert(q.status === 200 && q.data.count >= 1, `query count=${q.data.count}`);
assert(q.data.limit === 50, `query page size=${q.data.limit}`);
assert(typeof q.data.total === 'number', `query total=${q.data.total}`);

console.log('\n=== 2b) Insert / amend rows + pagination ===');
const ins = await api(
  'POST',
  `/api/master-data/tables/${csvTableId}/rows`,
  { data: { sku: 'Z9', name: 'Widget Pro', price: '29.00' } },
  tokenA
);
assert(ins.status === 201, `insert ${ins.status} ${ins.data.error || ''}`);
assert(ins.data.row?.data?.name === 'Widget Pro', 'inserted name');
const rowId = ins.data.row.id;

const upd = await api(
  'PATCH',
  `/api/master-data/tables/${csvTableId}/rows/${rowId}`,
  { data: { sku: 'Z9', name: 'Widget Pro+', price: '31.00' } },
  tokenA
);
assert(upd.status === 200, `update ${upd.status}`);
assert(upd.data.row?.data?.name === 'Widget Pro+', 'amended name');
assert(upd.data.row?.data?.price === '31.00', 'amended price');

// Build enough rows to exercise pagination (page size 50)
for (let i = 0; i < 52; i++) {
  const r = await api(
    'POST',
    `/api/master-data/tables/${csvTableId}/rows`,
    { data: { sku: `P${i}`, name: `Pad ${i}`, price: String(i) } },
    tokenA
  );
  if (r.status !== 201) {
    assert(false, `bulk insert ${i} failed ${r.status}`);
    break;
  }
}
const page0 = await api('GET', `/api/master-data/tables/${csvTableId}?limit=50&offset=0`, null, tokenA);
assert(page0.status === 200, 'browse page0');
assert(page0.data.rows.length === 50, `page0 len=${page0.data.rows.length}`);
assert(page0.data.total > 50, `total=${page0.data.total}`);
assert(page0.data.limit === 50, 'browse limit 50');
const page1 = await api('GET', `/api/master-data/tables/${csvTableId}?limit=50&offset=50`, null, tokenA);
assert(page1.data.rows.length >= 1, `page1 len=${page1.data.rows.length}`);
const qPage = await api(
  'POST',
  `/api/master-data/tables/${csvTableId}/query`,
  { query: 'Pad', limit: 50, offset: 0 },
  tokenA
);
assert(qPage.data.total >= 50, `query pad total=${qPage.data.total}`);
assert(qPage.data.rows.length === 50, `query pad page=${qPage.data.rows.length}`);
const qPage2 = await api(
  'POST',
  `/api/master-data/tables/${csvTableId}/query`,
  { query: 'Pad', limit: 50, offset: 50 },
  tokenA
);
assert(qPage2.data.offset === 50, 'query offset 50');
assert(qPage2.data.rows.length >= 1, `query pad page2=${qPage2.data.rows.length}`);

console.log('\n=== 3) Tenancy â€” B cannot see A tables ===');
const listB = await api('GET', '/api/master-data/tables', null, tokenB);
assert(listB.status === 200, 'list B');
assert(!(listB.data.tables || []).some((t) => t.id === tableId || t.id === csvTableId), 'B cannot see A tables');
const steal = await api('GET', `/api/master-data/tables/${csvTableId}`, null, tokenB);
assert(steal.status === 404 || steal.data.error, 'B cannot open A table');

console.log('\n=== 4) Document upload + filesystem + RAG ===');
const docBody = {
  title: `Policy ${stamp}`,
  filename: 'policy.txt',
  mimeType: 'text/plain',
  contentText: `Refund policy for Widgets: customers may return within 30 days. Gadget warranty is 1 year. Contact support@example.com.`,
};
const up = await api('POST', '/api/master-data/documents', docBody, tokenA);
assert(up.status === 201, `upload doc ${up.status} ${up.data.error || ''}`);
const docId = up.data.document?.id;
assert(!!docId, 'doc id');
assert(up.data.document.owner_user_id === userA, 'doc owner A');
assert(up.data.document.chunk_count >= 1, `chunks=${up.data.document.chunk_count}`);

const docsDir = masterDataDocsDir(userA, docId);
assert(existsSync(docsDir), `docs dir exists ${docsDir}`);

const rag = await api(
  'POST',
  '/api/master-data/rag',
  { query: 'What is the refund window for widgets?', topK: 3, summarize: true },
  tokenA
);
assert(rag.status === 200, `rag ${rag.status} ${rag.data.error || ''}`);
assert((rag.data.hit_count || 0) >= 1 || (rag.data.summary || '').length > 10, 'rag has hits/summary');

const docsB = await api('GET', '/api/master-data/documents', null, tokenB);
assert(!(docsB.data.documents || []).some((d) => d.id === docId), 'B cannot see A docs');

console.log('\n=== 5) Workflow masterdata node (table mode) ===');
const graph = {
  nodes: [
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { label: 'Start', triggerModes: ['manual'] },
    },
    {
      id: 'md-1',
      type: 'masterdata',
      position: { x: 220, y: 0 },
      data: {
        label: 'Query products',
        taskConfig: { mode: 'table', tableId: csvTableId, summarize: false },
        inputBindings: [{ id: 'query', label: 'Query', mode: 'static', value: 'Widget' }],
      },
    },
  ],
  edges: [{ id: 'e1', source: 'trigger-1', target: 'md-1' }],
};

const def = store.createDefinition({
  name: `MD WF ${stamp}`,
  description: 'masterdata e2e',
  ownerUserId: userA,
  graph,
  trigger_modes: ['manual'],
  actor: { id: userA, name: 'e2e' },
});
store.publishDefinition(def.id, userA, { id: userA, name: 'e2e' });

const run = await startAgentWorkflowRun(def.id, userA, { trigger: 'manual', input: 'Widget' });
assert(!!run?.id, `run started ${run?.id}`);

// Poll briefly for completion
let final = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500));
  final = store.getRun(run.id, userA);
  if (final && ['completed', 'failed', 'cancelled'].includes(final.status)) break;
}
assert(final?.status === 'completed', `run status=${final?.status} err=${final?.error_message || ''}`);

const steps = final?.steps || [];
const mdStep = steps.find((s) => s.node_id === 'md-1' || s.node_type === 'masterdata');
assert(!!mdStep, 'masterdata step exists');
assert(mdStep.status === 'completed', `md step status=${mdStep.status}`);

console.log('\n=== 6) Workflow masterdata node (RAG mode) ===');
const graphRag = {
  nodes: [
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { label: 'Start', triggerModes: ['manual'] },
    },
    {
      id: 'md-rag-1',
      type: 'masterdata',
      position: { x: 220, y: 0 },
      data: {
        label: 'RAG policy docs',
        taskConfig: {
          mode: 'rag',
          documentId: docId,
          topK: 3,
          summarize: true,
        },
        inputBindings: [
          {
            id: 'query',
            label: 'Query',
            mode: 'static',
            value: 'What is the refund window for widgets?',
          },
        ],
      },
    },
  ],
  edges: [{ id: 'e1', source: 'trigger-1', target: 'md-rag-1' }],
};

const defRag = store.createDefinition({
  name: `MD RAG WF ${stamp}`,
  description: 'masterdata RAG e2e',
  ownerUserId: userA,
  graph: graphRag,
  trigger_modes: ['manual'],
  actor: { id: userA, name: 'e2e' },
});
store.publishDefinition(defRag.id, userA, { id: userA, name: 'e2e' });

const runRag = await startAgentWorkflowRun(defRag.id, userA, {
  trigger: 'manual',
  input: 'What is the refund window for widgets?',
});
assert(!!runRag?.id, `RAG run started ${runRag?.id}`);

let finalRag = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  finalRag = store.getRun(runRag.id, userA);
  if (finalRag && ['completed', 'failed', 'cancelled'].includes(finalRag.status)) break;
}
assert(
  finalRag?.status === 'completed',
  `RAG run status=${finalRag?.status} err=${finalRag?.error_message || ''}`
);

const ragSteps = finalRag?.steps || [];
const ragStep = ragSteps.find((s) => s.node_id === 'md-rag-1' || s.node_type === 'masterdata');
assert(!!ragStep, 'RAG masterdata step exists');
assert(ragStep.status === 'completed', `RAG step status=${ragStep.status}`);
const ragOut = ragStep.output || {};
assert(ragOut.mode === 'rag' || ragOut.result?.mode === 'rag', `RAG mode=${ragOut.mode}`);
const hitCount = ragOut.count ?? ragOut.result?.hit_count ?? 0;
const ragText = String(ragOut.text || ragOut.result?.text || '');
assert(hitCount >= 1 || ragText.length > 10, `RAG hits/text hits=${hitCount} textLen=${ragText.length}`);
assert(/refund|30|widget/i.test(ragText), `RAG text mentions refund/window: ${ragText.slice(0, 120)}`);

console.log(`\n=== Done: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
