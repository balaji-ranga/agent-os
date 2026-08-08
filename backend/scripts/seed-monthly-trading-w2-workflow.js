/**
 * Seed Monthly Trading W2 — laptop execution (desktop package / Task Scheduler).
 * No ceo_approval, brain, or agent nodes (desktop unsupported).
 * Usage: node scripts/seed-monthly-trading-w2-workflow.js
 *
 * Action → order mapping is done on the bridge via POST /execute-day-plan
 * (trading-plan-bridge-map.js), not by piping raw plan-list JSON into place-bracket.
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import * as store from '../src/services/agent-workflow-store.js';
import { notifySchedulerConfigurationChanged } from '../src/services/agent-workflow-scheduler.js';
import { ensureIbkrMonthlyTables } from '../src/services/ibkr-monthly-guardrail.js';
import { MONTHLY_TRADING_VARIABLES } from './monthly-trading-seed-variables.js';

export const WORKFLOW_ID = 'monthly-trading-w2-execute';

const backendBase = (process.env.AGENT_OS_API_URL || process.env.BACKEND_URL || 'http://127.0.0.1:3001').replace(
  /\/$/,
  ''
);

const INTERNAL_HEADERS = JSON.stringify({
  'Content-Type': 'application/json',
  'x-internal-test': '1',
});

export function buildMonthlyTradingW2Graph() {
  const bridgeBase = '{{var.local_bridge_base_url}}';
  const bridgeAuth = JSON.stringify({
    'Content-Type': 'application/json',
    Authorization: 'Bearer {{var.local_bridge_token}}',
  });

  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 200 },
        data: {
          label: 'Manual / desktop execute',
          triggerModes: ['manual'],
          chatPhrase: '',
          scheduleCron: '',
        },
      },
      {
        id: 'tool-fetch-plan',
        type: 'tool',
        position: { x: 240, y: 200 },
        data: {
          label: 'Fetch trading plan (remote)',
          toolName: 'trading_plan_fetch',
          toolPayload: {},
          inputBindings: [
            {
              id: 'payload',
              mode: 'static',
              value: '{"open":true,"limit":5}',
            },
          ],
        },
      },
      {
        id: 'api-open-plans',
        type: 'api',
        position: { x: 460, y: 200 },
        data: {
          label: 'Open plans detail',
          inputBindings: [
            {
              id: 'url',
              mode: 'static',
              value: `${backendBase}/api/ibkr-trading/day-plan?open=true&limit=5`,
            },
            { id: 'headers', mode: 'static', value: INTERNAL_HEADERS },
          ],
          taskConfig: { method: 'GET', authType: 'none', timeoutMs: 60000, executeOn: 'server' },
        },
      },
      {
        id: 'if-has-plan',
        type: 'if',
        position: { x: 680, y: 200 },
        data: {
          label: 'Has open plan?',
          taskConfig: {
            sourceNodeId: 'api-open-plans',
            sourceOutputKey: 'bodyText',
            operator: 'contains',
            compareValue: 'plan_date',
          },
        },
      },
      {
        id: 'api-mark-executing',
        type: 'api',
        position: { x: 900, y: 100 },
        data: {
          label: 'Mark executing',
          inputBindings: [
            { id: 'url', mode: 'static', value: `${backendBase}/api/ibkr-trading/day-plan/execution` },
            {
              id: 'body',
              mode: 'static',
              value: '{"status":"executing","execution_report":{"source":"w2","phase":"start"}}',
            },
            { id: 'headers', mode: 'static', value: INTERNAL_HEADERS },
          ],
          taskConfig: { method: 'POST', authType: 'none', timeoutMs: 60000, executeOn: 'server' },
        },
      },
      {
        id: 'api-execute-plan',
        type: 'api',
        position: { x: 1120, y: 100 },
        data: {
          label: 'Local execute-day-plan (map actions → orders)',
          inputBindings: [
            { id: 'url', mode: 'static', value: `${bridgeBase}/execute-day-plan` },
            {
              id: 'body',
              mode: 'dynamic',
              sourceNodeId: 'api-open-plans',
              sourceOutputKey: 'bodyText',
            },
            { id: 'headers', mode: 'static', value: bridgeAuth },
          ],
          taskConfig: { method: 'POST', authType: 'none', timeoutMs: 180000 },
        },
      },
      {
        id: 'api-report',
        type: 'api',
        position: { x: 1340, y: 100 },
        data: {
          label: 'Report execution status',
          inputBindings: [
            { id: 'url', mode: 'static', value: `${backendBase}/api/ibkr-trading/day-plan/execution` },
            {
              id: 'body',
              mode: 'static',
              value:
                '{"status":"{{api-execute-plan.body.suggested_status}}","plan_date":"{{api-execute-plan.body.plan_date}}","execution_report":{"source":"w2","phase":"execute-day-plan","execute":{{api-execute-plan.bodyText}}}}',
            },
            { id: 'headers', mode: 'static', value: INTERNAL_HEADERS },
          ],
          taskConfig: { method: 'POST', authType: 'none', timeoutMs: 60000, executeOn: 'server' },
        },
      },
      {
        id: 'tool-notify',
        type: 'tool',
        position: { x: 1560, y: 100 },
        data: {
          label: 'Notify CEO (optional)',
          toolName: 'notify_ceo',
          toolPayload: {
            title: 'W2 execution reported',
            body: 'Laptop execution workflow mapped plan actions and reported status.',
            link_url: '/workflows',
            source_key: 'monthly-trading-w2',
          },
          inputBindings: [],
        },
      },
      {
        id: 'api-skip',
        type: 'api',
        position: { x: 900, y: 320 },
        data: {
          label: 'No open plan — noop log',
          inputBindings: [
            {
              id: 'url',
              mode: 'static',
              value: `${backendBase}/api/ibkr-trading/day-plan?open=true&limit=1`,
            },
            { id: 'headers', mode: 'static', value: INTERNAL_HEADERS },
          ],
          taskConfig: { method: 'GET', authType: 'none', timeoutMs: 30000, executeOn: 'server' },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'tool-fetch-plan' },
      { id: 'e2', source: 'tool-fetch-plan', target: 'api-open-plans' },
      { id: 'e3', source: 'api-open-plans', target: 'if-has-plan' },
      { id: 'e4', source: 'if-has-plan', target: 'api-mark-executing', sourceHandle: 'true' },
      { id: 'e5', source: 'if-has-plan', target: 'api-skip', sourceHandle: 'false' },
      { id: 'e6', source: 'api-mark-executing', target: 'api-execute-plan' },
      { id: 'e7', source: 'api-execute-plan', target: 'api-report' },
      { id: 'e8', source: 'api-report', target: 'tool-notify' },
    ],
    viewport: { x: 0, y: 0, zoom: 0.55 },
  };
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
      (patch.trigger_modes || ['manual']).join(','),
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

export async function seedMonthlyTradingW2(ownerUserId, { publish = true } = {}) {
  initDb();
  ensureIbkrMonthlyTables();
  const actor = { id: 'seed-monthly-trading', name: 'Seed Monthly Trading' };
  const graph = buildMonthlyTradingW2Graph();
  const patch = {
    name: 'Monthly Trading W2 — Execute (Laptop)',
    description:
      'Desktop/manual: fetch open plan → map Maker actions via local bridge /execute-day-plan → report status. No brain/ceo_approval/agent.',
    graph,
    trigger_modes: ['manual'],
    schedule_cron: '',
    chat_trigger_phrase: '',
    variables: {
      ...MONTHLY_TRADING_VARIABLES,
      local_bridge_base_url: MONTHLY_TRADING_VARIABLES.local_bridge_base_url,
      local_bridge_token: MONTHLY_TRADING_VARIABLES.local_bridge_token || '',
    },
  };
  upsertWorkflow(ownerUserId, actor, patch);
  let def;
  if (publish) {
    try {
      def = store.publishDefinition(WORKFLOW_ID, ownerUserId, actor);
    } catch (e) {
      console.warn('[seed-monthly-w2] Publish deferred:', e.message);
      def = store.getDefinition(WORKFLOW_ID, ownerUserId);
    }
  } else {
    def = store.getDefinition(WORKFLOW_ID, ownerUserId);
  }
  notifySchedulerConfigurationChanged();
  return { def };
}

async function main() {
  const owner = getBalaCeoAuthId();
  const { def } = await seedMonthlyTradingW2(owner, { publish: true });
  console.log('Workflow:', def?.id, def?.name, def?.status);
}

const isCli =
  process.argv[1] &&
  (process.argv[1].includes('seed-monthly-trading-w2-workflow') ||
    import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')));
if (isCli) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}