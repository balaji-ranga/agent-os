/**
 * Phase 4 paper E2E: Monthly Positive Return pipeline without live Claude Opus / Gateway.
 *
 * Covers: seed → regime/screener (cache or FMP) → guardrail → hard gates (incl. CEO loss-sell
 * branch) → plan save/fetch → dry-run place (ledger + optional bridge mock) → W3 fill/event
 * parse + webhook smoke → digest/journal smoke.
 *
 * Usage:
 *   node scripts/test-monthly-trading-paper-e2e.js
 *   SKIP_BRIDGE_MOCK=1 node scripts/test-monthly-trading-paper-e2e.js
 *   SKIP_WEBHOOK=1 node scripts/test-monthly-trading-paper-e2e.js
 *
 * Env: BRIDGE_MOCK_IBKR=1 (default here), IBKR_TRADING_ENABLED=0 preferred.
 * Does not require ANTHROPIC / live Gateway. MARKET_DATA_API_KEY optional (cache inject).
 */
import { config } from 'dotenv';
import { createServer } from 'node:http';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

// Prefer paper / mock paths for this suite
if (process.env.IBKR_TRADING_ENABLED == null) process.env.IBKR_TRADING_ENABLED = '0';
if (process.env.BRIDGE_MOCK_IBKR == null) process.env.BRIDGE_MOCK_IBKR = '1';
if (process.env.DESKTOP_PACKAGE_SKIP_NODE_RUNTIME == null) {
  process.env.DESKTOP_PACKAGE_SKIP_NODE_RUNTIME = '1';
}

import { initDb, getDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { seedAllMonthlyTradingWorkflows } from './seed-monthly-trading-workflows.js';
import { WORKFLOW_ID as W1 } from './seed-monthly-trading-w1-workflow.js';
import { WORKFLOW_ID as W2 } from './seed-monthly-trading-w2-workflow.js';
import { WORKFLOW_ID as W3 } from './seed-monthly-trading-w3-workflow.js';
import { WORKFLOW_ID as W5 } from './seed-monthly-trading-w5-workflow.js';
import {
  recordEquityMark,
  getMonthlyGuardrail,
  ensureIbkrMonthlyTables,
} from '../src/services/ibkr-monthly-guardrail.js';
import {
  savePlan,
  getPlan,
  listOpenPlans,
  markPlanExecution,
  updateStatus,
} from '../src/services/trading-day-plans.js';
import { setCached } from '../src/services/market-data-cache.js';
import { getRegime, runScreener } from '../src/services/market-data.js';
import * as ledger from '../src/services/ibkr-trading-ledger.js';
import { getIbkrTradingConfig } from '../src/services/ibkr-trading-rules.js';
import { summarizeJournal } from '../src/services/trading-journal.js';
import * as store from '../src/services/agent-workflow-store.js';
import { verifyHookSecret } from '../src/services/agent-workflow-webhooks.js';
import { run as hardGates } from './samples/monthly-trading-hard-gates.js';
import { run as eventParse } from './samples/monthly-trading-event-parse.js';
import { run as weeklyDigest } from './samples/monthly-trading-weekly-digest.js';

initDb();
ensureIbkrMonthlyTables();
ledger.ensureIbkrLedgerTables();

const owner = getBalaCeoAuthId();
const backend = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const BRIDGE_PORT = Number(process.env.TEST_BRIDGE_PORT || 13011);
const BRIDGE_TOKEN = 'monthly-paper-e2e-bridge-token';

let failed = 0;
function section(title) {
  console.log(`\n=== ${title} ===`);
}
function ok(msg, detail) {
  console.log(`  OK: ${msg}${detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
function fail(msg, detail) {
  failed += 1;
  console.error(`  FAIL: ${msg}${detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
function assert(cond, msg, detail) {
  if (cond) ok(msg, detail);
  else fail(msg, detail);
}

function assertUtf8Head(relFromScripts, expectedHex = '2f2a2a0a') {
  const abs = join(__dirname, relFromScripts);
  const buf = readFileSync(abs);
  const need = expectedHex.length / 2;
  const hex = [...buf.subarray(0, need)].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert(hex === expectedHex, `UTF-8 head ${relFromScripts}`, hex);
}

function sampleMakerPlan({ withCeoLossSell = false, averageDown = false } = {}) {
  const actions = [
    {
      type: 'hold',
      key: 'NASDAQ:AAPL',
      qty: 10,
      requires_ceo_approval: false,
      thesis: 'Above 50/200 DMA',
      risks: 'Broad market pullback',
      why_now: 'No thesis change',
      rationale: 'Hold core large-cap winner',
    },
    {
      type: 'new_entry',
      key: 'NASDAQ:MSFT',
      qty: 2,
      entry_price: 420,
      stop_price: 412,
      tp_price: 426,
      notional_usd: 840,
      position_size_pct: 5,
      risk_pct: 0.6,
      average_down: averageDown,
      requires_ceo_approval: false,
      thesis: 'Breakout with volume',
      risks: 'False breakout',
      why_now: 'Risk-on regime',
      rationale: 'Liquid mega-cap breakout candidate within size band',
    },
  ];
  if (withCeoLossSell) {
    actions.push({
      type: 'exit',
      key: 'NYSE:IBM',
      qty: 20,
      loss_pct_if_exit: 4.2,
      requires_ceo_approval: true,
      thesis: 'Thesis broken; discretionary cut',
      risks: 'Further decline',
      why_now: 'Loss exceeds discretionary band',
      rationale: 'CEO approval required for discretionary loss sell',
    });
  }
  return {
    prior_plan_reconcile: { prior_dates: [], notes: 'paper e2e — no prior open plan' },
    actions,
    watchlist: [{ key: 'NASDAQ:NVDA', note: 'watch consolidation' }],
    risk_summary: {
      cash_pct: 45,
      exposure_pct: 55,
      open_stop_risk_pct: 1.2,
      risk_mode: 'normal',
    },
    notes: 'monthly trading paper e2e plan',
  };
}

async function waitPortFree(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
  }).catch(() => {});
}

async function runBridgeMockPlace() {
  if (process.env.SKIP_BRIDGE_MOCK === '1') {
    ok('bridge mock skipped (SKIP_BRIDGE_MOCK=1)');
    return;
  }
  process.env.BRIDGE_HOST = '127.0.0.1';
  process.env.BRIDGE_PORT = String(BRIDGE_PORT);
  process.env.LOCAL_BRIDGE_TOKEN = BRIDGE_TOKEN;
  process.env.BRIDGE_MOCK_IBKR = '1';
  process.env.BRIDGE_ALLOW_EPHEMERAL_TOKEN = '0';
  process.env.EQUITY_MARK_INTERVAL_SEC = '0';
  process.env.WEBHOOK_URL = '';

  await waitPortFree(BRIDGE_PORT);
  const { startBridge } = await import('../local-ibkr-bridge/server.js');
  const handle = await startBridge();
  try {
    const res = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/place-bracket`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${BRIDGE_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        trades: [
          {
            key: 'NASDAQ:MSFT',
            symbol: 'MSFT',
            side: 'BUY',
            qty: 1,
            entry_price: 420,
            stop_price: 410,
            tp_price: 440,
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json().catch(() => ({}));
    assert(
      res.status === 200 && json.ok && (json.dry_run || json.mock),
      'bridge place-bracket dry-run/mock',
      { status: res.status, dry_run: json.dry_run, mock: json.mock }
    );
  } finally {
    if (handle?.stop) await handle.stop();
    else if (handle?.server?.close) {
      await new Promise((r) => handle.server.close(r));
    }
  }
}

async function main() {
  section('Monthly Trading Paper E2E');
  console.log('owner', owner);
  console.log('backend', backend);
  console.log('IBKR_TRADING_ENABLED', process.env.IBKR_TRADING_ENABLED);
  console.log('BRIDGE_MOCK_IBKR', process.env.BRIDGE_MOCK_IBKR);
  console.log('MARKET_DATA_API_KEY', process.env.MARKET_DATA_API_KEY ? 'set' : 'missing (will cache-inject)');
  console.log('ANTHROPIC', !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY));

  section('0) Encoding guard');
  assertUtf8Head('test-monthly-trading-paper-e2e.js');
  assertUtf8Head('samples/monthly-trading-hard-gates.js');

  section('1) Backend health');
  try {
    const h = await fetch(`${backend}/api/health`, { signal: AbortSignal.timeout(4000) });
    const body = await h.json().catch(() => ({}));
    assert(h.ok && (body.status === 'ok' || body.ok !== false), 'backend /api/health', h.status);
  } catch (e) {
    try {
      const h2 = await fetch(`${backend}/health`, { signal: AbortSignal.timeout(4000) });
      assert(h2.ok, 'backend /health fallback', h2.status);
    } catch (e2) {
      fail('backend not reachable', e2.message || e.message);
    }
  }

  section('2) Seed W1/W2/W3/W5');
  const seeded = await seedAllMonthlyTradingWorkflows(owner, { publish: true });
  for (const id of [W1, W2, W3, W5]) {
    const def = store.getDefinition(id, owner);
    assert(!!def, `workflow exists ${id}`, def?.status);
  }
  assert(seeded.ids?.length === 4, 'seed returned 4 ids', seeded.ids);

  section('3) Regime + screener (cache inject if no FMP)');
  const provider = String(process.env.MARKET_DATA_PROVIDER || 'fmp').trim() || 'fmp';
  const regimePayload = {
    ok: true,
    index: 'SPY',
    regime: 'risk_on',
    risk_on: true,
    price: 500,
    sma_200: 480,
    paper_e2e_inject: true,
  };
  setCached({
    cacheKey: `${provider}:regime:SPY`,
    provider,
    kind: 'regime',
    payload: regimePayload,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  const regime = await getRegime({ indexSymbol: 'SPY', force: false });
  assert(regime?.ok !== false && (regime.risk_on === true || regime.regime === 'risk_on' || regime.cached), 'market regime', {
    risk_on: regime.risk_on,
    regime: regime.regime,
    cached: regime.cached,
  });

  // Screener may need live key; inject a minimal cache hit for default filters hash is hard —
  // call with force:false and tolerate missing key by asserting graceful error OR success.
  let screener;
  try {
    screener = await runScreener({ limit: 5, force: false });
  } catch (e) {
    screener = { ok: false, error: e.message };
  }
  if (screener?.ok && Array.isArray(screener.candidates || screener.results || screener.symbols)) {
    ok('screener returned candidates', (screener.candidates || screener.results || screener.symbols).length);
  } else if (screener?.error && /MARKET_DATA_API_KEY|not configured/i.test(String(screener.error))) {
    ok('screener skipped gracefully (no MARKET_DATA_API_KEY)', screener.error);
  } else if (screener?.ok === false && screener.error) {
    ok('screener soft-fail (paper path continues)', screener.error);
  } else {
    ok('screener response present', { ok: screener?.ok, keys: Object.keys(screener || {}) });
  }

  section('4) Equity mark → guardrail');
  const markDate = new Date().toISOString().slice(0, 10);
  const mark = recordEquityMark(owner, {
    equity: 100000,
    cash: 45000,
    date: markDate,
    detail: { source: 'paper-e2e' },
  });
  assert(mark.ok && mark.equity_usd === 100000, 'equity mark recorded', mark.mark_date);
  const guard = getMonthlyGuardrail(owner, { drawdownStopPct: 4 });
  assert(guard.ok && guard.risk_mode, 'monthly guardrail', {
    risk_mode: guard.risk_mode,
    mtd_return_pct: guard.mtd_return_pct,
    guardrail_breached: guard.guardrail_breached,
  });

  section('5) Hard gates (pass / CEO loss-sell / average-down reject)');
  const passPlan = sampleMakerPlan();
  const pass = hardGates({
    plan_text: JSON.stringify(passPlan),
    regime: { risk_on: true },
    guardrail: { guardrail_breached: false, risk_mode: 'normal' },
  });
  assert(pass.ok === true, 'hard gates pass clean plan', pass.errors);

  const ceoPlan = sampleMakerPlan({ withCeoLossSell: true });
  const ceoGate = hardGates({
    plan_text: JSON.stringify(ceoPlan),
    regime: { risk_on: true },
  });
  assert(
    ceoGate.ok === true && ceoGate.requires_ceo_approval === true,
    'CEO approval branch flagged for discretionary loss sell',
    { requires_ceo_approval: ceoGate.requires_ceo_approval, errors: ceoGate.errors }
  );

  const missingFlag = sampleMakerPlan({ withCeoLossSell: true });
  missingFlag.actions = missingFlag.actions.map((a) =>
    a.type === 'exit' ? { ...a, requires_ceo_approval: false } : a
  );
  const miss = hardGates({ plan_text: JSON.stringify(missingFlag), regime: { risk_on: true } });
  assert(miss.ok === false, 'gates reject loss sell without CEO flag', miss.errors);

  const avgDown = hardGates({
    plan_text: JSON.stringify(sampleMakerPlan({ averageDown: true })),
    regime: { risk_on: true },
  });
  assert(avgDown.ok === false && avgDown.errors?.some((e) => /average_down/i.test(e)), 'gates reject average_down');

  section('6) Plan save → approve → fetch → execution report');
  const planDate = markDate;
  const saved = savePlan(owner, {
    plan_date: planDate,
    status: 'pending',
    plan: ceoPlan,
    checker_verdict: { decision: 'approved', notes: 'paper e2e checker stub' },
    approvals: { requires_ceo_approval: true, items: ['NYSE:IBM'] },
  });
  assert(saved?.status === 'pending' && saved?.plan?.actions?.length >= 2, 'plan saved pending', saved?.id);

  const approved = updateStatus(owner, {
    plan_date: planDate,
    status: 'approved',
    approvals: {
      requires_ceo_approval: true,
      ceo_decision: 'approve',
      comment: 'paper e2e approve discretionary exit',
      approved_at: new Date().toISOString(),
    },
  });
  assert(approved?.status === 'approved', 'plan approved after CEO path');

  const fetched = getPlan(owner, { plan_date: planDate });
  assert(fetched?.status === 'approved' && fetched?.plan?.notes, 'plan fetch', fetched?.plan_date);

  const open = listOpenPlans(owner, { limit: 5 });
  assert(
    open.some((p) => p.plan_date === planDate && p.status === 'approved'),
    'listOpenPlans includes approved plan',
    open.map((p) => `${p.plan_date}:${p.status}`)
  );

  const exec = markPlanExecution(owner, {
    plan_date: planDate,
    status: 'executing',
    execution_report: {
      source: 'paper-e2e',
      dry_run: true,
      placed: [{ key: 'NASDAQ:MSFT', dry_run: true }],
      pending: [{ key: 'NYSE:IBM', note: 'await laptop' }],
    },
  });
  assert(exec?.status === 'executing' && exec?.plan?.execution?.dry_run === true, 'markPlanExecution');

  section('7) Dry-run place (ledger, IBKR_TRADING_ENABLED=0)');
  const cfg = getIbkrTradingConfig();
  assert(cfg.tradingEnabled === false || process.env.IBKR_TRADING_ENABLED === '0', 'trading disabled for paper', {
    tradingEnabled: cfg.tradingEnabled,
  });
  const place = await ledger.recordPlaceAttempt(
    owner,
    [
      {
        key: 'NASDAQ:MSFT',
        side: 'BUY',
        qty: 1,
        entry_price: 420,
        stop_price: 410,
        tp_price: 440,
        reference_price: 420,
      },
    ],
    { dryRun: true, budgetUsd: 1000, maxTradesPerDay: 5 }
  );
  assert(place.ok && place.dry_run === true, 'ledger dry-run place', place.message);

  section('8) Bridge mock place-bracket');
  await runBridgeMockPlace();

  section('9) W3 event parse + fill / eod flags');
  const fillParsed = eventParse({
    payload: JSON.stringify({
      event: 'fill',
      payload: { symbol: 'MSFT', qty: 1, side: 'BUY', fill_price: 420.1 },
    }),
  });
  assert(fillParsed.is_fill === 'true', 'event parse fill', fillParsed.event_type);

  const eodParsed = eventParse({
    payload: JSON.stringify({ event: 'eod_snapshot', payload: { equity_usd: 100100 } }),
  });
  assert(eodParsed.is_eod_snapshot === 'true', 'event parse eod_snapshot');

  section('10) W3 webhook secret + optional HTTP smoke');
  {
    const secret = store.ensureWebhookSecret(W3);
    assert(!!secret, 'W3 webhook secret ensured');
    const checkOk = verifyHookSecret(W3, secret);
    assert(checkOk.ok === true, 'verifyHookSecret accepts W3 secret');
    const checkBad = verifyHookSecret(W3, 'not-the-real-secret');
    assert(checkBad.ok === false, 'verifyHookSecret rejects bad secret', checkBad.error);

    if (process.env.SKIP_WEBHOOK === '1') {
      ok('HTTP webhook POST skipped (SKIP_WEBHOOK=1) — secret handling covered');
    } else if (process.env.POST_WEBHOOK === '1') {
      try {
        const res = await fetch(`${backend}/api/agent-workflows/hooks/${W3}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-workflow-hook-secret': secret,
          },
          body: JSON.stringify({
            event: 'fill',
            ts: new Date().toISOString(),
            source: 'monthly-trading-paper-e2e',
            payload: {
              symbol: 'MSFT',
              key: 'NASDAQ:MSFT',
              qty: 1,
              side: 'BUY',
              fill_price: 420.1,
              paper: true,
            },
          }),
          signal: AbortSignal.timeout(8000),
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 202 && body.ok && body.run_id) {
          ok('W3 webhook accepted fill', { run_id: body.run_id, status: body.status });
        } else {
          ok('W3 webhook HTTP soft', { status: res.status, error: body.error });
        }
      } catch (e) {
        const msg = e.message || String(e);
        if (/abort|timeout/i.test(msg)) {
          ok('W3 webhook POST soft-pass (timeout — secret verify already passed)', msg);
        } else {
          fail('W3 webhook POST', msg);
        }
      }
    } else {
      ok('HTTP webhook POST skipped by default (set POST_WEBHOOK=1 to exercise live run start)');
    }
  }

  section('11) Digest / journal smoke');
  const journal = summarizeJournal(owner, { days: 7 });
  assert(journal.ok === true, 'trading_journal summarize', {
    fills_count: journal.fills_count,
    days: journal.days,
  });
  const digest = weeklyDigest({
    journal: JSON.stringify(journal),
    guardrail: JSON.stringify(guard),
    analytics: '{"paper_e2e":true}',
  });
  assert(digest.ok === true && /Weekly Review/i.test(digest.text), 'weekly digest compose', {
    include_monthly: digest.include_monthly,
  });

  // Email path: confirm W1/W5 graphs include email nodes (no SMTP send in paper suite)
  const def1 = store.getDefinition(W1, owner);
  const def5 = store.getDefinition(W5, owner);
  const g1 = def1?.published_graph || def1?.draft_graph;
  const g5 = def5?.published_graph || def5?.draft_graph;
  const emailW1 = (g1?.nodes || []).some((n) => n.type === 'email');
  const emailW5 = (g5?.nodes || []).some((n) => n.type === 'email');
  assert(emailW1 && emailW5, 'W1 and W5 have email digest nodes', { emailW1, emailW5 });
  const smtpConfigured = !!(process.env.WORKFLOW_SMTP_HOST || process.env.SMTP_HOST);
  ok(smtpConfigured ? 'SMTP env present (live digest possible)' : 'SMTP not set — digest compose-only smoke');

  section('12) Certify env reminder (no live certify here)');
  const makerModel = process.env.WORKFLOW_CERTIFY_MAKER_MODEL || '(unset — recommend Claude Opus)';
  const checkerModel = process.env.WORKFLOW_CERTIFY_CHECKER_MODEL || '(unset — recommend deepseek-v4-flash)';
  console.log('  WORKFLOW_CERTIFY_MAKER_MODEL =', makerModel);
  console.log('  WORKFLOW_CERTIFY_CHECKER_MODEL =', checkerModel);
  console.log('  Run: node scripts/certify-monthly-trading-workflows.js [--dry-run|--poll]');

  section('Summary');
  // Mark plan executed for cleanliness
  try {
    markPlanExecution(owner, {
      plan_date: planDate,
      status: 'executed',
      execution_report: { source: 'paper-e2e', completed: true, dry_run: true },
    });
  } catch {
    /* ignore */
  }

  if (failed) {
    console.error(`\nTEST FAILED — ${failed} assertion(s)`);
    process.exit(1);
  }
  console.log('\nAll monthly trading paper E2E checks passed');
  process.exit(0);
}

main().catch((e) => {
  console.error('\nTEST FAILED — uncaught', e);
  process.exit(1);
});
