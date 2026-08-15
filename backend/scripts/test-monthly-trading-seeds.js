/**
 * Smoke-test Monthly Trading Phase 3 seeds (no live LLMs).
 * Usage: node scripts/test-monthly-trading-seeds.js
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __dirname = dirname(fileURLToPath(import.meta.url));

function assertUtf8AsciiHead(relPath, expectedPrefixHex) {
  const abs = join(__dirname, relPath);
  const buf = readFileSync(abs);
  const head = Buffer.from(buf.subarray(0, expectedPrefixHex.length / 2));
  const hex = [...head].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.strictEqual(
    hex,
    expectedPrefixHex,
    `${relPath} must start with UTF-8 ${expectedPrefixHex}, got ${hex}`
  );
}

function collectTypes(graph) {
  return (graph.nodes || []).map((n) => n.type);
}

async function main() {
  console.log('[test-monthly-trading-seeds] start');

  // Encoding guards
  const utf8Files = [
    'lib/trading-strategy-prompt.js',
    'lib/trading-checker-prompt.js',
    'monthly-trading-seed-variables.js',
    'samples/monthly-trading-hard-gates.js',
    'samples/monthly-trading-event-parse.js',
    'samples/monthly-trading-weekly-digest.js',
    'seed-monthly-trading-w1-workflow.js',
    'seed-monthly-trading-w2-workflow.js',
    'seed-monthly-trading-w3-workflow.js',
    'seed-monthly-trading-w5-workflow.js',
    'seed-monthly-trading-workflows.js',
  ];
  for (const f of utf8Files) {
    assertUtf8AsciiHead(f, '2f2a2a0a'); // /**
  }
  assertUtf8AsciiHead('../src/services/trading-day-plans.js', '2f2a2a0a');

  const { MONTHLY_TRADING_VARIABLES } = await import('./monthly-trading-seed-variables.js');
  assert.ok(MONTHLY_TRADING_VARIABLES.cron_post_close_fallback);
  assert.ok(MONTHLY_TRADING_VARIABLES.local_bridge_base_url.includes('127.0.0.1'));

  const { MAKER_STRATEGY_SYSTEM_PROMPT } = await import('./lib/trading-strategy-prompt.js');
  const { CHECKER_STRATEGY_SYSTEM_PROMPT } = await import('./lib/trading-checker-prompt.js');
  assert.ok(MAKER_STRATEGY_SYSTEM_PROMPT.includes('EXECUTION RECOVERY'));
  assert.ok(MAKER_STRATEGY_SYSTEM_PROMPT.includes('prior_plan_reconcile'));
  assert.ok(MAKER_STRATEGY_SYSTEM_PROMPT.includes('{{var.discretionary_loss_sell_pct}}'));
  assert.ok(CHECKER_STRATEGY_SYSTEM_PROMPT.includes('prior_plan_reconcile'));

  const {
    PLAN_STATUSES,
    OPEN_PLAN_STATUSES,
    listOpenPlans,
    markPlanExecution,
    savePlan,
  } = await import('../src/services/trading-day-plans.js');
  assert.deepStrictEqual(
    [...PLAN_STATUSES],
    ['pending', 'approved', 'executing', 'partial', 'executed', 'failed', 'superseded']
  );
  assert.ok(OPEN_PLAN_STATUSES.includes('approved'));
  assert.ok(typeof listOpenPlans === 'function');
  assert.ok(typeof markPlanExecution === 'function');
  assert.ok(typeof savePlan === 'function');

  const { run: hardGates } = await import('./samples/monthly-trading-hard-gates.js');
  const pass = hardGates({
    plan_text: JSON.stringify({
      prior_plan_reconcile: { prior_dates: [], notes: 'none' },
      actions: [
        {
          type: 'hold',
          key: 'NASDAQ:AAPL',
          qty: 1,
          requires_ceo_approval: false,
          thesis: 'ok',
          risks: 'ok',
          why_now: 'ok',
          rationale: 'ok',
        },
      ],
      watchlist: [],
      risk_summary: { cash_pct: 40, exposure_pct: 60, open_stop_risk_pct: 1, risk_mode: 'normal' },
      notes: 'smoke',
    }),
  });
  assert.strictEqual(pass.ok, true, `hard gates should pass: ${JSON.stringify(pass.errors)}`);

  const failAvg = hardGates({
    plan_text: JSON.stringify({
      prior_plan_reconcile: { notes: 'x' },
      actions: [{ type: 'new_entry', key: 'NASDAQ:X', average_down: true, stop_price: 1 }],
      risk_summary: { risk_mode: 'normal' },
    }),
    regime: { risk_on: true },
  });
  assert.strictEqual(failAvg.ok, false);
  assert.ok(failAvg.errors.some((e) => /average_down/i.test(e)));

  const farBelow = hardGates({
    plan_text: JSON.stringify({
      prior_plan_reconcile: { notes: 'x' },
      actions: [
        {
          type: 'new_entry',
          key: 'NASDAQ:AMD',
          qty: 1,
          entry_price: 78,
          stop_price: 74,
          tp_price: 85,
          notional_usd: 78,
        },
      ],
      risk_summary: { risk_mode: 'normal' },
    }),
    regime: { risk_on: true },
    account_snapshot: JSON.stringify({
      reference_prices: { 'NASDAQ:AMD': { reference_price: 500 } },
    }),
  });
  assert.strictEqual(farBelow.ok, false);
  assert.ok(farBelow.errors.some((e) => /below last/i.test(e)), farBelow.errors);

  const missingQuote = hardGates({
    plan_text: JSON.stringify({
      prior_plan_reconcile: { notes: 'x' },
      actions: [
        {
          type: 'new_entry',
          key: 'NASDAQ:AMD',
          qty: 1,
          entry_price: 500,
          stop_price: 490,
          tp_price: 510,
          notional_usd: 500,
        },
      ],
      risk_summary: { risk_mode: 'normal' },
    }),
    regime: { risk_on: true },
    account_snapshot: JSON.stringify({ reference_prices: {} }),
  });
  assert.strictEqual(missingQuote.ok, false);
  assert.ok(missingQuote.errors.some((e) => /invented entry_price/i.test(e)), missingQuote.errors);

  const missingTp = hardGates({
    plan_text: JSON.stringify({
      prior_plan_reconcile: { notes: 'x' },
      actions: [
        {
          type: 'new_entry',
          key: 'NASDAQ:AMD',
          qty: 8,
          entry_price: 100,
          stop_price: 97,
          tp_price: null,
          notional_usd: 800,
        },
      ],
      risk_summary: { risk_mode: 'normal' },
    }),
    regime: { risk_on: true },
    account_snapshot: JSON.stringify({
      cash_usd: 10000,
      equity_usd: 10000,
      reference_prices: { 'NASDAQ:AMD': { reference_price: 100 } },
    }),
  });
  assert.strictEqual(missingTp.ok, false);
  assert.ok(missingTp.errors.some((e) => /tp_price/i.test(e)), missingTp.errors);

  const undersized = hardGates({
    plan_text: JSON.stringify({
      prior_plan_reconcile: { notes: 'x' },
      actions: [
        {
          type: 'new_entry',
          key: 'NASDAQ:AMD',
          qty: 1,
          entry_price: 100,
          stop_price: 97,
          tp_price: 104,
          notional_usd: 100,
        },
      ],
      risk_summary: { risk_mode: 'normal' },
    }),
    regime: { risk_on: true },
    account_snapshot: JSON.stringify({
      cash_usd: 10000,
      equity_usd: 10000,
      reference_prices: { 'NASDAQ:AMD': { reference_price: 100 } },
    }),
  });
  assert.strictEqual(undersized.ok, false);
  assert.ok(
    undersized.errors.some((e) => /position_size_pct_min|unused spendable/i.test(e)),
    undersized.errors
  );

  const sizedOk = hardGates({
    plan_text: JSON.stringify({
      prior_plan_reconcile: { notes: 'x' },
      actions: [
        {
          type: 'new_entry',
          key: 'NASDAQ:AMD',
          qty: 8,
          entry_price: 100,
          stop_price: 97,
          tp_price: 104,
          notional_usd: 800,
        },
      ],
      risk_summary: { risk_mode: 'normal' },
    }),
    regime: { risk_on: true },
    account_snapshot: JSON.stringify({
      cash_usd: 10000,
      equity_usd: 10000,
      reference_prices: { 'NASDAQ:AMD': { reference_price: 100 } },
    }),
  });
  assert.strictEqual(sizedOk.ok, true, `sized new_entry should pass: ${JSON.stringify(sizedOk.errors)}`);

  const emptyWithScreener = hardGates({
    plan_text: JSON.stringify({
      prior_plan_reconcile: { notes: 'x' },
      actions: [],
      risk_summary: { risk_mode: 'normal' },
    }),
    regime: { risk_on: true },
    account_snapshot: JSON.stringify({
      cash_usd: 10000,
      equity_usd: 10000,
      reference_prices: { 'NASDAQ:NVDA': { reference_price: 225 } },
    }),
    screener: JSON.stringify({
      ok: true,
      count: 1,
      candidates: [{ symbol: 'NVDA', price: 225 }],
    }),
  });
  assert.strictEqual(emptyWithScreener.ok, false);
  assert.ok(emptyWithScreener.errors.some((e) => /requires at least one bookable new_entry/i.test(e)), emptyWithScreener.errors);

  const {
    evaluateBuyLimitVsReference,
    filterBuyTradesByReference,
  } = await import('../src/services/trading-plan-bridge-map.js');
  const bandOk = evaluateBuyLimitVsReference(500, 500, { entry_slip_pct_max: 0.25, entry_discount_pct_max: 3 });
  assert.strictEqual(bandOk.ok, true);
  const bandLow = evaluateBuyLimitVsReference(78, 500, { entry_slip_pct_max: 0.25, entry_discount_pct_max: 3 });
  assert.strictEqual(bandLow.ok, false);
  assert.strictEqual(bandLow.reason, 'entry_below_discount');
  const filtered = filterBuyTradesByReference(
    [{ key: 'NASDAQ:AMD', symbol: 'AMD', side: 'BUY', qty: 1, entry_price: 78 }],
    { 'NASDAQ:AMD': { reference_price: 500 } },
    { entry_discount_pct_max: 3 }
  );
  assert.strictEqual(filtered.trades.length, 0);
  assert.strictEqual(filtered.skipped[0].reason, 'entry_below_discount');

  const { run: eventParse } = await import('./samples/monthly-trading-event-parse.js');
  const eod = eventParse({ payload: JSON.stringify({ event: 'eod_snapshot', payload: {} }) });
  assert.strictEqual(eod.is_eod_snapshot, 'true');

  const { buildMonthlyTradingW1Graph, WORKFLOW_ID: W1 } = await import(
    './seed-monthly-trading-w1-workflow.js'
  );
  const { buildMonthlyTradingW2Graph, WORKFLOW_ID: W2 } = await import(
    './seed-monthly-trading-w2-workflow.js'
  );
  const { buildMonthlyTradingW3Graph, WORKFLOW_ID: W3 } = await import(
    './seed-monthly-trading-w3-workflow.js'
  );
  const { buildMonthlyTradingW5Graph, WORKFLOW_ID: W5 } = await import(
    './seed-monthly-trading-w5-workflow.js'
  );

  assert.strictEqual(W1, 'monthly-trading-w1-post-close');
  assert.strictEqual(W2, 'monthly-trading-w2-execute');
  assert.strictEqual(W3, 'monthly-trading-w3-events');
  assert.strictEqual(W5, 'monthly-trading-w5-weekly');

  const g1 = buildMonthlyTradingW1Graph();
  const t1 = collectTypes(g1);
  for (const need of [
    'trigger',
    'tool',
    'api',
    'brain',
    'while',
    'custom_script',
    'if',
    'ceo_approval',
    'email',
  ]) {
    assert.ok(t1.includes(need), `W1 missing node type ${need}`);
  }
  const maker = g1.nodes.find((n) => n.id === 'maker-1');
  const checker = g1.nodes.find((n) => n.id === 'checker-1');
  assert.strictEqual(maker.data.taskConfig.modelSource, 'openai');
  assert.strictEqual(checker.data.taskConfig.modelSource, 'deepseek');
  assert.ok(String(maker.data.taskConfig.model).includes('gpt') || maker.data.taskConfig.model);
  assert.ok(String(checker.data.taskConfig.model).includes('deepseek'));
  const hardGatesNode = g1.nodes.find((n) => n.id === 'hard-gates');
  const hgBind = (hardGatesNode?.data?.inputBindings || []).map((b) => b.id);
  assert.ok(hgBind.includes('account_snapshot'), 'W1 hard gates bind account snapshot');
  assert.ok(hgBind.includes('screener'), 'W1 hard gates bind screener');
  const checkerUser = String(
    (checker.data.inputBindings || []).find((b) => b.id === 'userMessage')?.value || ''
  );
  assert.ok(checkerUser.includes('{{tool-screener.text}}'), 'W1 Checker user message must include screener');
  assert.ok(checkerUser.includes('{{api-snapshot.bodyText}}'), 'W1 Checker user message must include snapshot');
  assert.ok(MAKER_STRATEGY_SYSTEM_PROMPT.includes('entry_discount_pct_max'));
  assert.ok(MAKER_STRATEGY_SYSTEM_PROMPT.includes('Bookable IBKR stock bracket'));
  assert.ok(CHECKER_STRATEGY_SYSTEM_PROMPT.includes('tp_price above entry'));

  const demoPack = JSON.parse(
    readFileSync(
      join(__dirname, '../src/services/company-blueprints/packs/demo_balaji_ranganathan.json'),
      'utf8'
    )
  );
  const demoW1 = (demoPack.workflow_templates || []).find(
    (w) => w.template_key === 'monthly-trading-w1-post-close'
  );
  assert.ok(demoW1, 'demo_balaji_ranganathan pack must include W1');
  assert.strictEqual(demoW1.variables?.entry_discount_pct_max, 3);
  const demoHg = (demoW1.graph?.nodes || []).find((n) => n.id === 'hard-gates');
  const demoHgBind = (demoHg?.data?.inputBindings || []).map((b) => b.id);
  assert.ok(demoHgBind.includes('account_snapshot'), 'demo pack W1 hard gates bind snapshot');
  assert.ok(demoHgBind.includes('screener'), 'demo pack W1 hard gates bind screener');
  const demoMaker = (demoW1.graph?.nodes || []).find((n) => n.id === 'maker-1');
  const demoChecker = (demoW1.graph?.nodes || []).find((n) => n.id === 'checker-1');
  assert.ok(String(demoMaker?.data?.taskConfig?.systemPrompt || '').includes('entry_discount_pct_max'));
  assert.ok(String(demoMaker?.data?.taskConfig?.systemPrompt || '').includes('Bookable IBKR stock bracket'));
  assert.ok(String(demoChecker?.data?.taskConfig?.systemPrompt || '').includes('entry_discount_pct_max'));
  assert.ok(String(demoChecker?.data?.taskConfig?.systemPrompt || '').includes('tp_price above entry'));
  const demoCheckerUser = String(
    (demoChecker?.data?.inputBindings || []).find((b) => b.id === 'userMessage')?.value || ''
  );
  assert.ok(demoCheckerUser.includes('{{tool-screener.text}}'), 'demo pack Checker user message must include screener');
  const demoIbkr = (demoPack.workflow_templates || []).find(
    (w) => w.template_key === 'ibkr-maker-checker-paper'
  );
  assert.strictEqual(demoIbkr?.variables?.entry_discount_pct_max, 3);
  const demoIbkrMaker = (demoIbkr?.graph?.nodes || []).find((n) => n.id === 'maker-1');
  assert.ok(
    String(demoIbkrMaker?.data?.taskConfig?.systemPrompt || '').includes('entry_discount_pct_max')
  );

  const g2 = buildMonthlyTradingW2Graph();
  const t2 = collectTypes(g2);
  assert.ok(!t2.includes('brain'), 'W2 must not include brain');
  assert.ok(!t2.includes('ceo_approval'), 'W2 must not include ceo_approval');
  assert.ok(!t2.includes('agent'), 'W2 must not include agent');
  assert.ok(t2.includes('tool') && t2.includes('api') && t2.includes('if'));
  const localApi = g2.nodes.find((n) => n.id === 'api-execute-plan') || g2.nodes.find((n) => n.id === 'api-place-bracket');
  assert.ok(localApi, 'W2 should have local bridge execute node');
  assert.ok(
    String(localApi.data.inputBindings.find((b) => b.id === 'url').value).includes('local_bridge_base_url') ||
      String(localApi.data.inputBindings.find((b) => b.id === 'url').value).includes('execute-day-plan') ||
      String(localApi.data.inputBindings.find((b) => b.id === 'url').value).includes('place-bracket')
  );

  const g3 = buildMonthlyTradingW3Graph();
  const t3 = collectTypes(g3);
  assert.ok(t3.includes('sub_workflow'), 'W3 should use sub_workflow to chain W1');
  const sub = g3.nodes.find((n) => n.id === 'sub-w1');
  assert.strictEqual(sub.data.taskConfig.targetWorkflowId, W1);
  assert.strictEqual(sub.data.taskConfig.waitForCompletion, false);
  const ingestSnap = g3.nodes.find((n) => n.id === 'api-ingest-snapshot');
  assert.ok(ingestSnap, 'W3 should ingest account_snapshot into VPS cache');
  assert.ok(String(ingestSnap.data.inputBindings.find((b) => b.id === 'url').value).includes('account-snapshot/ingest'));

  const g1snap = g1.nodes.find((n) => n.id === 'api-snapshot');
  assert.ok(String(g1snap.data.inputBindings.find((b) => b.id === 'url').value).includes('account-snapshot/latest'));

  const g5 = buildMonthlyTradingW5Graph();
  const t5 = collectTypes(g5);
  assert.ok(t5.includes('email') && t5.includes('tool') && t5.includes('custom_script'));
  const trig5 = g5.nodes.find((n) => n.id === 'trigger-1');
  assert.ok(trig5.data.triggerModes.includes('schedule'));

  console.log('[test-monthly-trading-seeds] OK', { W1, W2, W3, W5, nodes: { w1: g1.nodes.length, w2: g2.nodes.length, w3: g3.nodes.length, w5: g5.nodes.length } });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});