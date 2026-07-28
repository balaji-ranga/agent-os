/**
 * Seed Monthly Trading W1 — post-close review and plan (VPS).
 * Usage: node scripts/seed-monthly-trading-w1-workflow.js
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
import { MAKER_STRATEGY_SYSTEM_PROMPT } from './lib/trading-strategy-prompt.js';
import { CHECKER_STRATEGY_SYSTEM_PROMPT } from './lib/trading-checker-prompt.js';

export const WORKFLOW_ID = 'monthly-trading-w1-post-close';
export const CHAT_PHRASE = 'run monthly trading review';
export const PARSE_SCRIPT_ID = 'script-monthly-trading-parse-checker';
export const HARD_GATES_SCRIPT_ID = 'script-monthly-trading-hard-gates';

const backendBase = (process.env.AGENT_OS_API_URL || process.env.BACKEND_URL || 'http://127.0.0.1:3001').replace(
  /\/$/,
  ''
);

const INTERNAL_HEADERS = JSON.stringify({
  'Content-Type': 'application/json',
  'x-internal-test': '1',
});

function makerModel() {
  return (
    process.env.MONTHLY_TRADING_MAKER_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    'claude-opus-4-20250514'
  );
}

function checkerModel() {
  return process.env.MONTHLY_TRADING_CHECKER_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
}

export function buildMonthlyTradingW1Graph({
  parseScriptId = PARSE_SCRIPT_ID,
  hardGatesScriptId = HARD_GATES_SCRIPT_ID,
} = {}) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
  const deepseekKey =
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_SECONDARY_API_KEY ||
    process.env.OPENAI_API_KEY ||
    '';
  const maxLoops = Number(MONTHLY_TRADING_VARIABLES.checker_max_loops) || 3;
  const cronFallback = MONTHLY_TRADING_VARIABLES.cron_post_close_fallback || '5 21 * * 1-5';

  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 220 },
        data: {
          label: 'Post-close / event / chat',
          // event: eod_snapshot webhook; schedule: US post-close fallback (server local TZ)
          triggerModes: ['manual', 'chat', 'event', 'schedule'],
          chatPhrase: CHAT_PHRASE,
          scheduleCron: cronFallback,
        },
      },
      {
        id: 'tool-regime',
        type: 'tool',
        position: { x: 240, y: 80 },
        data: {
          label: 'Market regime',
          toolName: 'market_regime',
          toolPayload: { indexSymbol: '{{var.index_symbol}}', force: false },
          inputBindings: [],
        },
      },
      {
        id: 'tool-guardrail',
        type: 'tool',
        position: { x: 440, y: 80 },
        data: {
          label: 'Monthly guardrail',
          toolName: 'ibkr_monthly_guardrail',
          toolPayload: { drawdown_stop_pct: '{{var.monthly_drawdown_stop_pct}}' },
          inputBindings: [],
        },
      },
      {
        id: 'api-open-plans',
        type: 'api',
        position: { x: 640, y: 80 },
        data: {
          label: 'Open day plans',
          inputBindings: [
            {
              id: 'url',
              mode: 'static',
              value: `${backendBase}/api/ibkr-trading/day-plan?open=true&limit={{var.open_plans_limit}}`,
            },
            { id: 'headers', mode: 'static', value: INTERNAL_HEADERS },
          ],
          taskConfig: { method: 'GET', authType: 'none', timeoutMs: 60000 },
        },
      },
      {
        id: 'api-snapshot',
        type: 'api',
        position: { x: 840, y: 80 },
        data: {
          label: 'Account snapshot (optional)',
          inputBindings: [
            { id: 'url', mode: 'static', value: `${backendBase}/api/ibkr-trading/account-snapshot` },
            { id: 'body', mode: 'static', value: '{}' },
            { id: 'headers', mode: 'static', value: INTERNAL_HEADERS },
          ],
          taskConfig: { method: 'POST', authType: 'none', timeoutMs: 90000 },
        },
      },
      {
        id: 'tool-screener',
        type: 'tool',
        position: { x: 1040, y: 80 },
        data: {
          label: 'Market screener',
          toolName: 'market_screener',
          toolPayload: {
            minMarketCap: '{{var.min_market_cap_usd}}',
            limit: '{{var.screener_limit}}',
            country: 'US',
            force: false,
          },
          inputBindings: [],
        },
      },
      {
        id: 'tool-learnings',
        type: 'tool',
        position: { x: 1240, y: 80 },
        data: {
          label: 'Order learnings',
          toolName: 'ibkr_order_learnings',
          toolPayload: {
            days: '{{var.order_history_days}}',
            response_type: 'summarized',
            limit: 40,
            purpose: 'Monthly trading Maker learnings from prior order cancels/fills',
          },
          inputBindings: [],
        },
      },
      {
        id: 'api-brain-history',
        type: 'api',
        position: { x: 1440, y: 80 },
        data: {
          label: 'Brain history',
          inputBindings: [
            { id: 'url', mode: 'static', value: `${backendBase}/api/agent-workflows/brain-history` },
            {
              id: 'body',
              mode: 'static',
              value: JSON.stringify({
                workflow_id: [WORKFLOW_ID],
                node_id: ['maker-1', 'checker-1'],
                days: '{{var.brain_history_days}}',
                response_type: 'summarized',
                limit: 40,
                purpose: 'Monthly trading Maker learning from prior maker/checker audits',
              }).replace('"{{var.brain_history_days}}"', '{{var.brain_history_days}}'),
            },
            { id: 'headers', mode: 'static', value: INTERNAL_HEADERS },
          ],
          taskConfig: { method: 'POST', authType: 'none', timeoutMs: 120000 },
        },
      },
      {
        id: 'while-checker',
        type: 'while',
        position: { x: 1640, y: 200 },
        data: {
          label: 'Maker<->Checker loop',
          taskConfig: {
            sourceNodeId: 'parse-checker',
            sourceOutputKey: 'decision',
            operator: 'ne',
            compareValue: 'approved',
            maxIterations: maxLoops,
          },
        },
      },
      {
        id: 'maker-1',
        type: 'brain',
        position: { x: 1860, y: 80 },
        data: {
          label: 'Maker (Claude Opus)',
          inputBindings: [
            {
              id: 'userMessage',
              mode: 'static',
              value:
                '=== CHECKER FEEDBACK ===\n{{parse-checker.adjustments}}\n\n=== MARKET REGIME ===\n{{tool-regime.text}}\n\n=== MONTHLY GUARDRAIL ===\n{{tool-guardrail.text}}\n\n=== OPEN DAY PLANS (recovery) ===\n{{api-open-plans.bodyText}}\n\n=== ACCOUNT SNAPSHOT / EQUITY ===\n{{api-snapshot.bodyText}}\n\n=== SCREENER ===\n{{tool-screener.text}}\n\n=== ORDER LEARNINGS ===\n{{tool-learnings.text}}\n\n=== BRAIN HISTORY ===\n{{api-brain-history.body.context_text}}\n\n=== RUN / EVENT INPUT ===\n{{input}}',
            },
          ],
          taskConfig: {
            modelSource: 'anthropic',
            apiEndpoint: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',
            apiKey: anthropicKey,
            model: makerModel(),
            maxTokens: 8192,
            systemPrompt: MAKER_STRATEGY_SYSTEM_PROMPT,
            mcpToolCalling: false,
            mcpServerIds: [],
            mcpToolAllowlist: [],
            mcpMaxToolRounds: 4,
            httpHeadersJson: '{}',
          },
        },
      },
      {
        id: 'checker-1',
        type: 'brain',
        position: { x: 2080, y: 80 },
        data: {
          label: 'Checker (DeepSeek)',
          inputBindings: [
            {
              id: 'userMessage',
              mode: 'static',
              value:
                '=== MAKER PLAN (JSON) ===\n{{maker-1.text}}\n\n=== MARKET REGIME ===\n{{tool-regime.text}}\n\n=== GUARDRAIL ===\n{{tool-guardrail.text}}\n\n=== OPEN PLANS ===\n{{api-open-plans.bodyText}}\n\n=== ORDER LEARNINGS ===\n{{tool-learnings.text}}',
            },
          ],
          taskConfig: {
            modelSource: 'deepseek',
            apiEndpoint: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
            apiKey: deepseekKey,
            model: checkerModel(),
            maxTokens: 4096,
            systemPrompt: CHECKER_STRATEGY_SYSTEM_PROMPT,
            mcpToolCalling: false,
            mcpServerIds: [],
            mcpToolAllowlist: [],
            mcpMaxToolRounds: 4,
            httpHeadersJson: '{}',
          },
        },
      },
      {
        id: 'parse-checker',
        type: 'custom_script',
        position: { x: 2300, y: 80 },
        data: {
          label: 'Parse checker decision',
          inputBindings: [
            {
              id: 'text',
              mode: 'dynamic',
              sourceNodeId: 'checker-1',
              sourceOutputKey: 'text',
            },
          ],
          taskConfig: {
            customScriptId: parseScriptId,
            customScriptName: 'Monthly Trading Parse Checker',
          },
        },
      },
      {
        id: 'if-checker',
        type: 'if',
        position: { x: 1860, y: 320 },
        data: {
          label: 'Checker approved?',
          taskConfig: {
            sourceNodeId: 'parse-checker',
            sourceOutputKey: 'decision',
            operator: 'eq',
            compareValue: 'approved',
          },
        },
      },
      {
        id: 'hard-gates',
        type: 'custom_script',
        position: { x: 2080, y: 320 },
        data: {
          label: 'Hard gates',
          inputBindings: [
            {
              id: 'plan_text',
              mode: 'dynamic',
              sourceNodeId: 'maker-1',
              sourceOutputKey: 'text',
            },
            {
              id: 'regime',
              mode: 'dynamic',
              sourceNodeId: 'tool-regime',
              sourceOutputKey: 'text',
            },
            {
              id: 'guardrail',
              mode: 'dynamic',
              sourceNodeId: 'tool-guardrail',
              sourceOutputKey: 'text',
            },
          ],
          taskConfig: {
            customScriptId: hardGatesScriptId,
            customScriptName: 'Monthly Trading Hard Gates',
          },
        },
      },
      {
        id: 'if-gates',
        type: 'if',
        position: { x: 2300, y: 320 },
        data: {
          label: 'Gates pass?',
          taskConfig: {
            sourceNodeId: 'hard-gates',
            sourceOutputKey: 'ok',
            operator: 'eq',
            compareValue: 'true',
          },
        },
      },
      {
        id: 'if-ceo-needed',
        type: 'if',
        position: { x: 2520, y: 320 },
        data: {
          label: 'CEO approval needed?',
          taskConfig: {
            sourceNodeId: 'hard-gates',
            sourceOutputKey: 'requires_ceo_approval_str',
            operator: 'eq',
            compareValue: 'true',
          },
        },
      },
      {
        id: 'ceo-day',
        type: 'ceo_approval',
        position: { x: 2740, y: 200 },
        data: {
          label: 'CEO discretionary sells',
          inputBindings: [
            {
              id: 'summary',
              mode: 'dynamic',
              sourceNodeId: 'hard-gates',
              sourceOutputKey: 'text',
            },
          ],
          taskConfig: {
            title: 'Approve monthly trading plan (discretionary loss sells)',
            prompt:
              'Review actions with requires_ceo_approval (loss sells >= discretionary threshold). Approve or reject.',
          },
        },
      },
      {
        id: 'if-ceo',
        type: 'if',
        position: { x: 2960, y: 200 },
        data: {
          label: 'CEO approved?',
          taskConfig: {
            sourceNodeId: 'ceo-day',
            sourceOutputKey: 'decision',
            operator: 'eq',
            compareValue: 'approved',
          },
        },
      },
      {
        id: 'api-save-plan',
        type: 'api',
        position: { x: 3180, y: 320 },
        data: {
          label: 'Save plan approved',
          inputBindings: [
            { id: 'url', mode: 'static', value: `${backendBase}/api/ibkr-trading/day-plan` },
            {
              id: 'body',
              mode: 'static',
              value:
                '{"status":"approved","plan":{{hard-gates.plan_json}},"checker_verdict":{"decision":"{{parse-checker.decision}}","adjustments":{{parse-checker.adjustments}}}}',
            },
            { id: 'headers', mode: 'static', value: INTERNAL_HEADERS },
          ],
          taskConfig: { method: 'POST', authType: 'none', timeoutMs: 60000 },
        },
      },
      {
        id: 'email-digest',
        type: 'email',
        position: { x: 3400, y: 320 },
        data: {
          label: 'Daily digest email',
          inputBindings: [
            { id: 'to', mode: 'static', value: '{{var.digest_email_to}}' },
            {
              id: 'subject',
              mode: 'static',
              value: 'Monthly trading — post-close plan digest',
            },
            {
              id: 'body',
              mode: 'static',
              value:
                'Monthly trading W1 digest\n\nGuardrail:\n{{tool-guardrail.text}}\n\nRegime:\n{{tool-regime.text}}\n\nPlan gates:\n{{hard-gates.text}}\n\nSaved plan:\n{{api-save-plan.bodyText}}\n',
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
      {
        id: 'tool-notify',
        type: 'tool',
        position: { x: 3620, y: 320 },
        data: {
          label: 'Notify CEO',
          toolName: 'notify_ceo',
          toolPayload: {
            title: 'Monthly trading plan ready',
            body: 'Post-close plan saved (approved). Review digest / Kanban if discretionary sells were gated.',
            link_url: '/workflows',
            source_key: 'monthly-trading-w1',
          },
          inputBindings: [],
        },
      },
      {
        id: 'api-reject-note',
        type: 'api',
        position: { x: 2080, y: 480 },
        data: {
          label: 'Save pending/rejected note',
          inputBindings: [
            { id: 'url', mode: 'static', value: `${backendBase}/api/ibkr-trading/day-plan` },
            {
              id: 'body',
              mode: 'static',
              value:
                '{"status":"pending","plan":{"notes":"checker_or_gates_or_ceo_rejected","maker":{{maker-1.text}},"gates":{{hard-gates.text}}}}',
            },
            { id: 'headers', mode: 'static', value: INTERNAL_HEADERS },
          ],
          taskConfig: { method: 'POST', authType: 'none', timeoutMs: 60000 },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'tool-regime' },
      { id: 'e2', source: 'tool-regime', target: 'tool-guardrail' },
      { id: 'e3', source: 'tool-guardrail', target: 'api-open-plans' },
      { id: 'e4', source: 'api-open-plans', target: 'api-snapshot' },
      { id: 'e5', source: 'api-snapshot', target: 'tool-screener' },
      { id: 'e6', source: 'tool-screener', target: 'tool-learnings' },
      { id: 'e7', source: 'tool-learnings', target: 'api-brain-history' },
      { id: 'e8', source: 'api-brain-history', target: 'while-checker' },
      { id: 'e9', source: 'while-checker', target: 'maker-1', sourceHandle: 'loop' },
      { id: 'e10', source: 'maker-1', target: 'checker-1' },
      { id: 'e11', source: 'checker-1', target: 'parse-checker' },
      { id: 'e12', source: 'parse-checker', target: 'while-checker' },
      { id: 'e13', source: 'while-checker', target: 'if-checker', sourceHandle: 'exit' },
      { id: 'e14', source: 'if-checker', target: 'hard-gates', sourceHandle: 'true' },
      { id: 'e15', source: 'if-checker', target: 'api-reject-note', sourceHandle: 'false' },
      { id: 'e16', source: 'hard-gates', target: 'if-gates' },
      { id: 'e17', source: 'if-gates', target: 'if-ceo-needed', sourceHandle: 'true' },
      { id: 'e18', source: 'if-gates', target: 'api-reject-note', sourceHandle: 'false' },
      { id: 'e19', source: 'if-ceo-needed', target: 'ceo-day', sourceHandle: 'true' },
      { id: 'e20', source: 'if-ceo-needed', target: 'api-save-plan', sourceHandle: 'false' },
      { id: 'e21', source: 'ceo-day', target: 'if-ceo' },
      { id: 'e22', source: 'if-ceo', target: 'api-save-plan', sourceHandle: 'true' },
      { id: 'e23', source: 'if-ceo', target: 'api-reject-note', sourceHandle: 'false' },
      { id: 'e24', source: 'api-save-plan', target: 'email-digest' },
      { id: 'e25', source: 'email-digest', target: 'tool-notify' },
    ],
    viewport: { x: 0, y: 0, zoom: 0.45 },
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
  if (existing) {
    return store.updateDraft(WORKFLOW_ID, ownerUserId, patch, actor);
  }
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
      CHAT_PHRASE,
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

export async function seedMonthlyTradingW1(ownerUserId, { publish = true } = {}) {
  initDb();
  ensureIbkrMonthlyTables();
  const authUser = { id: ownerUserId, role: 'ceo' };
  const actor = { id: 'seed-monthly-trading', name: 'Seed Monthly Trading' };

  const parseScript = await upsertScript(authUser, {
    id: PARSE_SCRIPT_ID,
    name: 'Monthly Trading Parse Checker',
    description: 'Parse Maker/Checker JSON decision for while/if gates',
    sourcePath: join(__dirname, 'samples', 'ibkr-parse-checker.js'),
  });
  const hardScript = await upsertScript(authUser, {
    id: HARD_GATES_SCRIPT_ID,
    name: 'Monthly Trading Hard Gates',
    description: 'Deterministic risk/market/guardrail gates on Maker plan JSON',
    sourcePath: join(__dirname, 'samples', 'monthly-trading-hard-gates.js'),
  });

  const graph = buildMonthlyTradingW1Graph({
    parseScriptId: parseScript.id,
    hardGatesScriptId: hardScript.id,
  });
  const cron = MONTHLY_TRADING_VARIABLES.cron_post_close_fallback || '5 21 * * 1-5';
  const patch = {
    name: 'Monthly Trading W1 — Post-Close Plan',
    description:
      'Post-close: regime → guardrail → open plans → snapshot → screener → learnings → Maker(Claude Opus)↔Checker(DeepSeek) → hard gates → optional CEO → save approved plan → digest + notify',
    graph,
    trigger_modes: ['manual', 'chat', 'event', 'schedule'],
    schedule_cron: cron,
    chat_trigger_phrase: CHAT_PHRASE,
    variables: { ...MONTHLY_TRADING_VARIABLES },
  };
  upsertWorkflow(ownerUserId, actor, patch);

  let def;
  if (publish) {
    try {
      def = store.publishDefinition(WORKFLOW_ID, ownerUserId, actor);
    } catch (e) {
      console.warn('[seed-monthly-w1] Publish deferred (set Brain API keys):', e.message);
      def = store.getDefinition(WORKFLOW_ID, ownerUserId);
    }
  } else {
    def = store.getDefinition(WORKFLOW_ID, ownerUserId);
  }
  notifySchedulerConfigurationChanged();
  return { def, parseScript, hardScript };
}

async function main() {
  const owner = getBalaCeoAuthId();
  const { def, parseScript, hardScript } = await seedMonthlyTradingW1(owner, { publish: true });
  console.log('Parse script:', parseScript.id, parseScript.scan_status);
  console.log('Hard gates:', hardScript.id, hardScript.scan_status);
  console.log('Workflow:', def?.id, def?.name, def?.status);
  console.log('Chat phrase:', CHAT_PHRASE);
}

const isCli =
  process.argv[1] &&
  (process.argv[1].includes('seed-monthly-trading-w1-workflow') ||
    import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')));
if (isCli) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}