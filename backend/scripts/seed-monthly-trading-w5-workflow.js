/**
 * Seed Monthly Trading W5 — weekly review (Saturday cron).
 * Usage: node scripts/seed-monthly-trading-w5-workflow.js
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

export const WORKFLOW_ID = 'monthly-trading-w5-weekly';
export const WEEKLY_SCRIPT_ID = 'script-monthly-trading-weekly-digest';

const backendBase = (process.env.AGENT_OS_API_URL || process.env.BACKEND_URL || 'http://127.0.0.1:3001').replace(
  /\/$/,
  ''
);
const INTERNAL_HEADERS = JSON.stringify({
  'Content-Type': 'application/json',
  'x-internal-test': '1',
});

export function buildMonthlyTradingW5Graph({ weeklyScriptId = WEEKLY_SCRIPT_ID } = {}) {
  const cron = MONTHLY_TRADING_VARIABLES.cron_weekly_review || '0 10 * * 6';
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 180 },
        data: {
          label: 'Saturday weekly review',
          triggerModes: ['schedule', 'manual'],
          chatPhrase: '',
          scheduleCron: cron,
        },
      },
      {
        id: 'tool-journal',
        type: 'tool',
        position: { x: 260, y: 180 },
        data: {
          label: 'Journal stats',
          toolName: 'trading_journal',
          toolPayload: { days: 7 },
          inputBindings: [],
        },
      },
      {
        id: 'tool-guardrail',
        type: 'tool',
        position: { x: 480, y: 180 },
        data: {
          label: 'Monthly guardrail',
          toolName: 'ibkr_monthly_guardrail',
          toolPayload: { drawdown_stop_pct: '{{var.monthly_drawdown_stop_pct}}' },
          inputBindings: [],
        },
      },
      {
        id: 'api-analytics',
        type: 'api',
        position: { x: 700, y: 180 },
        data: {
          label: 'Portfolio analytics',
          inputBindings: [
            {
              id: 'url',
              mode: 'static',
              value: `${backendBase}/api/ibkr-trading/analytics/summary`,
            },
            { id: 'body', mode: 'static', value: '{}' },
            { id: 'headers', mode: 'static', value: INTERNAL_HEADERS },
          ],
          taskConfig: { method: 'POST', authType: 'none', timeoutMs: 90000 },
        },
      },
      {
        id: 'weekly-compose',
        type: 'custom_script',
        position: { x: 920, y: 180 },
        data: {
          label: 'Compose weekly (+ monthly if DOM<=7)',
          inputBindings: [
            {
              id: 'journal',
              mode: 'dynamic',
              sourceNodeId: 'tool-journal',
              sourceOutputKey: 'text',
            },
            {
              id: 'guardrail',
              mode: 'dynamic',
              sourceNodeId: 'tool-guardrail',
              sourceOutputKey: 'text',
            },
            {
              id: 'analytics',
              mode: 'dynamic',
              sourceNodeId: 'api-analytics',
              sourceOutputKey: 'bodyText',
            },
          ],
          taskConfig: {
            customScriptId: weeklyScriptId,
            customScriptName: 'Monthly Trading Weekly Digest',
          },
        },
      },
      {
        id: 'email-weekly',
        type: 'email',
        position: { x: 1140, y: 180 },
        data: {
          label: 'Weekly summary email',
          inputBindings: [
            { id: 'to', mode: 'static', value: '{{var.digest_email_to}}' },
            { id: 'subject', mode: 'static', value: 'Monthly trading — weekly review' },
            {
              id: 'body',
              mode: 'dynamic',
              sourceNodeId: 'weekly-compose',
              sourceOutputKey: 'text',
            },
          ],
          taskConfig: {
            useEnvSmtp: true,
            smtpHost: process.env.WORKFLOW_SMTP_HOST || '',
            smtpPort: Number(process.env.WORKFLOW_SMTP_PORT || 587),
            smtpSecure: false,
            smtpUser: process.env.WORKFLOW_SMTP_USER || '',
            smtpPass: process.env.WORKFLOW_SMTP_PASS || '',
            fromAddress: process.env.WORKFLOW_SMTP_FROM || 'agent-os@localhost',
          },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'tool-journal' },
      { id: 'e2', source: 'tool-journal', target: 'tool-guardrail' },
      { id: 'e3', source: 'tool-guardrail', target: 'api-analytics' },
      { id: 'e4', source: 'api-analytics', target: 'weekly-compose' },
      { id: 'e5', source: 'weekly-compose', target: 'email-weekly' },
    ],
    viewport: { x: 0, y: 0, zoom: 0.75 },
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
      patch.schedule_cron || '',
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

export async function seedMonthlyTradingW5(ownerUserId, { publish = true } = {}) {
  initDb();
  ensureIbkrMonthlyTables();
  const authUser = { id: ownerUserId, role: 'ceo' };
  const actor = { id: 'seed-monthly-trading', name: 'Seed Monthly Trading' };
  const weeklyScript = await upsertScript(authUser, {
    id: WEEKLY_SCRIPT_ID,
    name: 'Monthly Trading Weekly Digest',
    description: 'Compose weekly journal email; include monthly metrics when day-of-month <= 7',
    sourcePath: join(__dirname, 'samples', 'monthly-trading-weekly-digest.js'),
  });
  const graph = buildMonthlyTradingW5Graph({ weeklyScriptId: weeklyScript.id });
  const cron = MONTHLY_TRADING_VARIABLES.cron_weekly_review || '0 10 * * 6';
  const patch = {
    name: 'Monthly Trading W5 — Weekly Review',
    description:
      'Saturday cron: journal stats + guardrail + analytics → email summary; monthly metrics section when day-of-month <= 7',
    graph,
    trigger_modes: ['schedule', 'manual'],
    schedule_cron: cron,
    chat_trigger_phrase: '',
    variables: { ...MONTHLY_TRADING_VARIABLES },
  };
  upsertWorkflow(ownerUserId, actor, patch);
  let def;
  if (publish) {
    try {
      def = store.publishDefinition(WORKFLOW_ID, ownerUserId, actor);
    } catch (e) {
      console.warn('[seed-monthly-w5] Publish deferred:', e.message);
      def = store.getDefinition(WORKFLOW_ID, ownerUserId);
    }
  } else {
    def = store.getDefinition(WORKFLOW_ID, ownerUserId);
  }
  notifySchedulerConfigurationChanged();
  return { def, weeklyScript };
}

async function main() {
  const owner = getBalaCeoAuthId();
  const { def } = await seedMonthlyTradingW5(owner, { publish: true });
  console.log('Workflow:', def?.id, def?.name, def?.status);
}

const isCli =
  process.argv[1] &&
  (process.argv[1].includes('seed-monthly-trading-w5-workflow') ||
    import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')));
if (isCli) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}