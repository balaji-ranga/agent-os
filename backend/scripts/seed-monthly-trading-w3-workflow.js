/**
 * Seed Monthly Trading W3 — IBKR event handler (VPS webhook).
 * Usage: node scripts/seed-monthly-trading-w3-workflow.js
 *
 * eod_snapshot → sub_workflow targeting W1 (waitForCompletion: false).
 * Fallback note: consumers can also chat-phrase "run monthly trading review" or rely on W1 schedule.
 */
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import {
  createCustomScript,
  deleteCustomScript,
  getCustomScript,
} from '../src/services/custom-scripts.js';
import * as store from '../src/services/agent-workflow-store.js';
import { notifySchedulerConfigurationChanged } from '../src/services/agent-workflow-scheduler.js';
import { ensureIbkrMonthlyTables } from '../src/services/ibkr-monthly-guardrail.js';
import { MONTHLY_TRADING_VARIABLES } from './monthly-trading-seed-variables.js';
import { WORKFLOW_ID as W1_ID } from './seed-monthly-trading-w1-workflow.js';

export const WORKFLOW_ID = 'monthly-trading-w3-events';
export const EVENT_PARSE_SCRIPT_ID = 'script-monthly-trading-event-parse';

const backendBase = (process.env.AGENT_OS_API_URL || process.env.BACKEND_URL || 'http://127.0.0.1:3001').replace(
  /\/$/,
  ''
);
const INTERNAL_HEADERS = JSON.stringify({
  'Content-Type': 'application/json',
  'x-internal-test': '1',
});

export function buildMonthlyTradingW3Graph({ parseScriptId = EVENT_PARSE_SCRIPT_ID } = {}) {
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 240 },
        data: {
          label: 'IBKR bridge webhook',
          triggerModes: ['event', 'manual'],
          chatPhrase: '',
          scheduleCron: '',
        },
      },
      {
        id: 'parse-event',
        type: 'custom_script',
        position: { x: 260, y: 240 },
        data: {
          label: 'Parse event type',
          inputBindings: [
            {
              id: 'payload',
              mode: 'dynamic',
              sourceNodeId: 'trigger-1',
              sourceOutputKey: 'text',
            },
          ],
          taskConfig: {
            customScriptId: parseScriptId,
            customScriptName: 'Monthly Trading Event Parse',
          },
        },
      },
      {
        id: 'if-equity',
        type: 'if',
        position: { x: 480, y: 80 },
        data: {
          label: 'Equity mark?',
          taskConfig: {
            sourceNodeId: 'parse-event',
            sourceOutputKey: 'is_equity_mark',
            operator: 'eq',
            compareValue: 'true',
          },
        },
      },
      {
        id: 'tool-equity-mark',
        type: 'tool',
        position: { x: 700, y: 40 },
        data: {
          label: 'Record equity mark',
          toolName: 'ibkr_equity_mark',
          toolPayload: {},
          inputBindings: [
            {
              id: 'payload',
              mode: 'dynamic',
              sourceNodeId: 'parse-event',
              sourceOutputKey: 'payload_json',
            },
          ],
        },
      },
      {
        id: 'tool-guardrail',
        type: 'tool',
        position: { x: 920, y: 40 },
        data: {
          label: 'Recompute guardrail',
          toolName: 'ibkr_monthly_guardrail',
          toolPayload: { drawdown_stop_pct: '{{var.monthly_drawdown_stop_pct}}' },
          inputBindings: [],
        },
      },
      {
        id: 'if-fill',
        type: 'if',
        position: { x: 480, y: 240 },
        data: {
          label: 'Fill / stop-out?',
          taskConfig: {
            sourceNodeId: 'parse-event',
            sourceOutputKey: 'is_fill_or_stop',
            operator: 'eq',
            compareValue: 'true',
          },
        },
      },
      {
        id: 'if-order-event',
        type: 'if',
        position: { x: 480, y: 320 },
        data: {
          label: 'Order event (fill/cancel/reject/status)?',
          taskConfig: {
            sourceNodeId: 'parse-event',
            sourceOutputKey: 'is_order_event',
            operator: 'eq',
            compareValue: 'true',
          },
        },
      },
      {
        id: 'api-ingest-order-event',
        type: 'api',
        position: { x: 700, y: 300 },
        data: {
          label: 'Ingest → order_events (learnings)',
          inputBindings: [
            {
              id: 'url',
              mode: 'static',
              value: `${backendBase}/api/ibkr-trading/bridge-order-events`,
            },
            {
              id: 'body',
              mode: 'dynamic',
              sourceNodeId: 'parse-event',
              sourceOutputKey: 'envelope_json',
            },
            { id: 'headers', mode: 'static', value: INTERNAL_HEADERS },
          ],
          taskConfig: { method: 'POST', authType: 'none', timeoutMs: 30000 },
        },
      },
      {
        id: 'tool-journal',
        type: 'tool',
        position: { x: 920, y: 240 },
        data: {
          label: 'Trading journal',
          toolName: 'trading_journal',
          toolPayload: { days: 7 },
          inputBindings: [],
        },
      },
      {
        id: 'tool-notify-fill',
        type: 'tool',
        position: { x: 1140, y: 240 },
        data: {
          label: 'Notify CEO milestone',
          toolName: 'notify_ceo',
          toolPayload: {
            title: 'IBKR fill / stop-out',
            body: 'Bridge reported a fill or stop-out milestone. Check journal and positions.',
            link_url: '/workflows',
            source_key: 'monthly-trading-w3-fill',
          },
          inputBindings: [],
        },
      },
      {
        id: 'tool-notify-cancel',
        type: 'tool',
        position: { x: 920, y: 340 },
        data: {
          label: 'Notify cancel/reject',
          toolName: 'notify_ceo',
          toolPayload: {
            title: 'IBKR cancel / reject',
            body: 'Bridge reported a cancel or reject — recorded for order learnings.',
            link_url: '/workflows',
            source_key: 'monthly-trading-w3-cancel',
          },
          inputBindings: [],
        },
      },
      {
        id: 'if-cancel-notify',
        type: 'if',
        position: { x: 700, y: 360 },
        data: {
          label: 'Cancel / reject notify?',
          taskConfig: {
            sourceNodeId: 'parse-event',
            sourceOutputKey: 'is_cancel_or_reject',
            operator: 'eq',
            compareValue: 'true',
          },
        },
      },
      {
        id: 'if-eod',
        type: 'if',
        position: { x: 480, y: 480 },
        data: {
          label: 'EOD snapshot?',
          taskConfig: {
            sourceNodeId: 'parse-event',
            sourceOutputKey: 'is_eod_snapshot',
            operator: 'eq',
            compareValue: 'true',
          },
        },
      },
      {
        id: 'sub-w1',
        type: 'sub_workflow',
        position: { x: 700, y: 480 },
        data: {
          label: 'Trigger W1 post-close',
          taskConfig: {
            targetWorkflowId: W1_ID,
            triggerMode: 'event',
            inputTemplate: '{{parse-event.payload_json}}',
            waitForCompletion: false,
          },
        },
      },
      {
        id: 'api-noop',
        type: 'api',
        position: { x: 700, y: 600 },
        data: {
          label: 'Unhandled event ack',
          inputBindings: [
            {
              id: 'url',
              mode: 'static',
              value: `${backendBase}/api/ibkr-trading/monthly-guardrail`,
            },
            {
              id: 'body',
              mode: 'static',
              value: '{"drawdown_stop_pct":{{var.monthly_drawdown_stop_pct}}}',
            },
            { id: 'headers', mode: 'static', value: INTERNAL_HEADERS },
          ],
          taskConfig: { method: 'POST', authType: 'none', timeoutMs: 30000 },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'parse-event' },
      { id: 'e2', source: 'parse-event', target: 'if-equity' },
      { id: 'e3', source: 'if-equity', target: 'tool-equity-mark', sourceHandle: 'true' },
      { id: 'e4', source: 'if-equity', target: 'if-order-event', sourceHandle: 'false' },
      { id: 'e5', source: 'tool-equity-mark', target: 'tool-guardrail' },
      { id: 'e6', source: 'if-order-event', target: 'api-ingest-order-event', sourceHandle: 'true' },
      { id: 'e7', source: 'if-order-event', target: 'if-eod', sourceHandle: 'false' },
      { id: 'e8', source: 'api-ingest-order-event', target: 'if-fill' },
      { id: 'e9', source: 'if-fill', target: 'tool-journal', sourceHandle: 'true' },
      { id: 'e10', source: 'if-fill', target: 'if-cancel-notify', sourceHandle: 'false' },
      { id: 'e11', source: 'tool-journal', target: 'tool-notify-fill' },
      { id: 'e12', source: 'if-cancel-notify', target: 'tool-notify-cancel', sourceHandle: 'true' },
      { id: 'e13', source: 'if-eod', target: 'sub-w1', sourceHandle: 'true' },
      { id: 'e14', source: 'if-eod', target: 'api-noop', sourceHandle: 'false' },
    ],
    viewport: { x: 0, y: 0, zoom: 0.7 },
  };
}

async function upsertScript(authUser, { id, name, description, sourcePath }) {
  const source = readFileSync(sourcePath, 'utf8');
  const existing = getCustomScript(id, authUser, { includeSource: true });
  if (existing) deleteCustomScript(id, authUser);
  return createCustomScript(authUser, {
    id,
    name,
    description,
    language: 'javascript',
    source,
  });
}

function upsertWorkflow(ownerUserId, actor, patch) {
  const existing = store.getDefinition(WORKFLOW_ID, ownerUserId);
  if (existing) return store.updateDraft(WORKFLOW_ID, ownerUserId, patch, actor);
  getDb()
    .prepare(
      `INSERT INTO agent_workflow_definitions (id, name, description, owner_user_id, draft_graph_json, status, schedule_cron, chat_trigger_phrase, trigger_modes, variables_json)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
    )
    .run(
      WORKFLOW_ID,
      patch.name,
      patch.description,
      ownerUserId,
      JSON.stringify(patch.graph),
      '',
      '',
      (patch.trigger_modes || []).join(','),
      JSON.stringify(patch.variables || {})
    );
  store.appendAudit(WORKFLOW_ID, {
    action: 'created',
    summary: `Created workflow "${patch.name}"`,
    changedBy: actor.id,
    changedByName: actor.name,
  });
  return store.getDefinition(WORKFLOW_ID, ownerUserId);
}

export async function seedMonthlyTradingW3(ownerUserId, { publish = true } = {}) {
  initDb();
  ensureIbkrMonthlyTables();
  const authUser = { id: ownerUserId, role: 'ceo' };
  const actor = { id: 'seed-monthly-trading', name: 'Seed Monthly Trading' };
  const parseScript = await upsertScript(authUser, {
    id: EVENT_PARSE_SCRIPT_ID,
    name: 'Monthly Trading Event Parse',
    description: 'Route equity_mark / fill / cancel / reject / order_status / eod_snapshot webhook events',
    sourcePath: join(__dirname, 'samples', 'monthly-trading-event-parse.js'),
  });
  const graph = buildMonthlyTradingW3Graph({ parseScriptId: parseScript.id });
  const patch = {
    name: 'Monthly Trading W3 — IBKR Events',
    description:
      'Webhook: equity_mark → mark+guardrail; fill/cancel/reject/order_status → ibkr_order_events (learnings); fill/stop_out → journal+notify; eod_snapshot → sub_workflow W1 (async). Fallback: W1 chat phrase / schedule.',
    graph,
    trigger_modes: ['event', 'manual'],
    schedule_cron: '',
    chat_trigger_phrase: '',
    variables: { ...MONTHLY_TRADING_VARIABLES },
  };
  upsertWorkflow(ownerUserId, actor, patch);
  let def;
  if (publish) {
    try {
      def = store.publishDefinition(WORKFLOW_ID, ownerUserId, actor);
      try {
        store.ensureWebhookSecret(WORKFLOW_ID);
      } catch {
        /* optional */
      }
    } catch (e) {
      console.warn('[seed-monthly-w3] Publish deferred:', e.message);
      def = store.getDefinition(WORKFLOW_ID, ownerUserId);
    }
  } else {
    def = store.getDefinition(WORKFLOW_ID, ownerUserId);
  }
  notifySchedulerConfigurationChanged();
  return { def, parseScript };
}

async function main() {
  const owner = getBalaCeoAuthId();
  const { def, parseScript } = await seedMonthlyTradingW3(owner, { publish: true });
  console.log('Parse script:', parseScript.id);
  console.log('Workflow:', def?.id, def?.name, def?.status);
  console.log('Note: eod_snapshot chains to', W1_ID, 'via sub_workflow (wait=false)');
}

const isCli =
  process.argv[1] &&
  (process.argv[1].includes('seed-monthly-trading-w3-workflow') ||
    import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')));
if (isCli) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}