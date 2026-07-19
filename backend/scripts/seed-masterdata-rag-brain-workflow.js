/**
 * Seed sample master-data (table + document) and a simple workflow:
 *   trigger → Master Data (table) → Master Data (RAG docs) → Brain
 *
 * Usage: node scripts/seed-masterdata-rag-brain-workflow.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import * as store from '../src/services/agent-workflow-store.js';
import { notifySchedulerConfigurationChanged } from '../src/services/agent-workflow-scheduler.js';
import {
  listTables,
  listDocuments,
  importCsv,
  uploadDocument,
} from '../src/services/master-data.js';
import { defaultBrainConfig } from '../src/services/agent-workflow-agent-runtime-context.js';
import { normalizeWorkflowGraph } from '../src/services/agent-workflow-builder.js';

initDb();

export const WORKFLOW_ID = 'masterdata-rag-brain-demo';
export const CHAT_PHRASE = 'run masterdata rag brain';
export const TABLE_NAME = 'Demo Products (RAG test)';
export const DOC_TITLE = 'Demo Refund Policy (RAG test)';

const SAMPLE_CSV = `sku,name,category,price_usd,stock
WID-100,Widget Classic,hardware,29.99,120
WID-200,Widget Pro,hardware,79.99,45
SVC-10,Priority Support,service,199.00,999
DOC-1,Policy Handbook,document,0,1
`;

const SAMPLE_DOC = `Agent OS Demo Refund Policy

Widgets (WID-*):
- Customers may return unused widgets within 30 days of purchase for a full refund.
- Opened Widget Pro units may be exchanged within 14 days if defective.

Services (SVC-*):
- Priority Support is non-refundable after activation.
- Unused prepaid support hours expire after 90 days.

Contact support@agent-os.local for RMA numbers.
`;

export function ensureDemoMasterData(ownerUserId) {
  let table = listTables(ownerUserId).find((t) => t.name === TABLE_NAME);
  if (!table) {
    const imported = importCsv(ownerUserId, {
      name: TABLE_NAME,
      description: 'Sample product table for masterdata → brain workflow demo',
      csvText: SAMPLE_CSV,
    });
    table = imported.table;
  }

  let doc = listDocuments(ownerUserId).find((d) => d.title === DOC_TITLE);
  if (!doc) {
    doc = uploadDocument(ownerUserId, {
      title: DOC_TITLE,
      filename: 'demo-refund-policy.txt',
      mimeType: 'text/plain',
      contentText: SAMPLE_DOC,
    });
  }

  return { table, document: doc };
}

export function buildMasterdataRagBrainGraph({ tableId, documentId }) {
  const brain = defaultBrainConfig();
  return normalizeWorkflowGraph({
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 160 },
        data: {
          label: 'Start',
          triggerModes: ['manual', 'chat'],
          scheduleCron: '',
          chatPhrase: CHAT_PHRASE,
        },
      },
      {
        id: 'md-table-1',
        type: 'masterdata',
        position: { x: 280, y: 80 },
        data: {
          label: 'Query products table',
          taskConfig: {
            mode: 'table',
            tableId,
            summarize: false,
            topK: 5,
          },
          inputBindings: [
            {
              id: 'query',
              label: 'Query',
              mode: 'dynamic',
              value: '{{input}}',
              sourceNodeId: 'trigger-1',
              sourceOutputKey: 'text',
            },
          ],
        },
      },
      {
        id: 'md-rag-1',
        type: 'masterdata',
        position: { x: 280, y: 260 },
        data: {
          label: 'RAG policy documents',
          taskConfig: {
            mode: 'rag',
            documentId,
            topK: 4,
            summarize: true,
          },
          inputBindings: [
            {
              id: 'query',
              label: 'Query',
              mode: 'dynamic',
              value: '{{input}}',
              sourceNodeId: 'trigger-1',
              sourceOutputKey: 'text',
            },
          ],
        },
      },
      {
        id: 'brain-1',
        type: 'brain',
        position: { x: 560, y: 160 },
        data: {
          label: 'Brain — answer from table + RAG',
          taskConfig: {
            ...brain,
            maxTokens: 700,
            systemPrompt: `You answer using ONLY the master-data context below (product table hits + document RAG).
Be concise. Cite whether a fact came from the table or the policy document.
If the context is insufficient, say what is missing.

=== PRODUCT TABLE RESULTS ===
{{md-table-1.text}}

=== DOCUMENT RAG RESULTS ===
{{md-rag-1.text}}

=== USER QUESTION ===
{{input}}`,
          },
          inputBindings: [
            {
              id: 'prompt',
              label: 'User question',
              mode: 'dynamic',
              value: '{{input}}',
              sourceNodeId: 'trigger-1',
              sourceOutputKey: 'text',
            },
          ],
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'md-table-1' },
      { id: 'e2', source: 'trigger-1', target: 'md-rag-1' },
      { id: 'e3', source: 'md-table-1', target: 'brain-1' },
      { id: 'e4', source: 'md-rag-1', target: 'brain-1' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
}

export async function seedMasterdataRagBrainWorkflow(ownerUserId = getBalaCeoAuthId(), { publish = true } = {}) {
  const { table, document } = ensureDemoMasterData(ownerUserId);
  const graph = buildMasterdataRagBrainGraph({
    tableId: table.id,
    documentId: document.id,
  });

  const actor = { id: 'seed', name: 'seed-masterdata-rag-brain', type: 'system' };
  const existing = store.getDefinition(WORKFLOW_ID, ownerUserId);
  let def;
  if (existing) {
    if (existing.status === 'published') {
      store.unpublishDefinition(WORKFLOW_ID, ownerUserId, actor);
    }
    def = store.updateDraft(
      WORKFLOW_ID,
      ownerUserId,
      {
        name: 'Master Data Table + RAG → Brain',
        description:
          'Demo: query Demo Products table and RAG Demo Refund Policy, then pass both into a Brain answer. Chat: run masterdata rag brain',
        graph,
        trigger_modes: ['manual', 'chat'],
        chat_trigger_phrase: CHAT_PHRASE,
        schedule_cron: '',
      },
      actor
    );
  } else {
    def = store.createDefinition({
      id: WORKFLOW_ID,
      name: 'Master Data Table + RAG → Brain',
      description:
        'Demo: query Demo Products table and RAG Demo Refund Policy, then pass both into a Brain answer. Chat: run masterdata rag brain',
      ownerUserId,
      actor,
      graph,
      trigger_modes: ['manual', 'chat'],
      chat_trigger_phrase: CHAT_PHRASE,
    });
  }

  if (publish) {
    def = store.publishDefinition(WORKFLOW_ID, ownerUserId, actor);
    notifySchedulerConfigurationChanged();
  }

  return { def, table, document, chat_phrase: CHAT_PHRASE };
}

async function main() {
  const owner = getBalaCeoAuthId();
  const { def, table, document } = await seedMasterdataRagBrainWorkflow(owner, { publish: true });
  console.log('Seeded workflow:', def.id, def.name, `[${def.status}]`);
  console.log('  table:', table.id, table.name);
  console.log('  document:', document.id, document.title);
  console.log('  chat:', CHAT_PHRASE);
  console.log('  UI: /workflows/' + def.id + '/edit');
  console.log('  Try run input: "What is the Widget Pro price and refund window?"');
}

if (process.argv[1]?.includes('seed-masterdata-rag-brain-workflow')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
