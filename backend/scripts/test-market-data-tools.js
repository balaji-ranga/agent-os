/**
 * Smoke-test market-data service (no HTTP server required).
 * Without MARKET_DATA_API_KEY: expects ok:false / not configured.
 * With key: optionally hits FMP (network) unless --offline.
 *
 * Usage: node scripts/test-market-data-tools.js [--offline]
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb } from '../src/db/schema.js';
import * as marketData from '../src/services/market-data.js';
import {
  recordEquityMark,
  getMonthlyGuardrail,
  ensureIbkrMonthlyTables,
} from '../src/services/ibkr-monthly-guardrail.js';
import { savePlan, getPlan } from '../src/services/trading-day-plans.js';
import { summarizeJournal } from '../src/services/trading-journal.js';

initDb();
ensureIbkrMonthlyTables();

const offline = process.argv.includes('--offline');
const hasKey = Boolean(String(process.env.MARKET_DATA_API_KEY || '').trim());
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    failed += 1;
  } else {
    console.log('ok', msg);
  }
}

console.log('=== Market data + monthly portfolio foundation smoke ===');
console.log('MARKET_DATA_API_KEY', hasKey ? '(set)' : '(missing)');
console.log('offline', offline);

const regime = await marketData.getRegime({ indexSymbol: 'SPY', force: false });
if (!hasKey) {
  assert(regime.ok === false, 'regime without key -> ok:false');
  assert(
    String(regime.error || '').includes('MARKET_DATA_API_KEY'),
    'regime error mentions MARKET_DATA_API_KEY'
  );
} else if (offline) {
  console.log('skip live regime (offline + key present)');
} else {
  assert(regime.ok === true, `regime ok (risk_on=${regime.risk_on})`);
  assert(regime.sma_200 != null, 'regime has sma_200');
}

const screener = await marketData.runScreener({ minMarketCap: 5e10, limit: 5, force: false });
if (!hasKey) {
  assert(screener.ok === false, 'screener without key -> ok:false');
} else if (!offline) {
  assert(screener.ok === true, `screener ok count=${screener.count}`);
}

const hist = await marketData.getHistory({ symbol: 'AAPL', days: 260, force: false });
if (!hasKey) {
  assert(hist.ok === false, 'history without key -> ok:false');
} else if (!offline) {
  assert(hist.ok === true, `history ok bars=${hist.bars?.length}`);
}

const fund = await marketData.getFundamentals({ symbol: 'AAPL', force: false });
if (!hasKey) {
  assert(fund.ok === false, 'fundamentals without key -> ok:false');
} else if (!offline) {
  assert(fund.ok === true, 'fundamentals ok');
}

const owner = `smoke-test-owner-${Date.now()}`;
const mark = recordEquityMark(owner, { equity: 100000, cash: 40000, date: '2026-07-01' });
assert(mark.ok === true && mark.month_hwm_usd === 100000, 'equity mark recorded');
recordEquityMark(owner, { equity: 105000, cash: 38000, date: '2026-07-15' });
recordEquityMark(owner, { equity: 100500, cash: 42000, date: '2026-07-28' });
const guard = getMonthlyGuardrail(owner, { drawdownStopPct: 4, asOfDate: '2026-07-28' });
assert(guard.ok === true, `guardrail mtd=${guard.mtd_return_pct} dd=${guard.drawdown_from_hwm_pct}`);
assert(guard.risk_mode === 'normal' || guard.risk_mode === 'reduce' || guard.risk_mode === 'halt_new', 'risk_mode set');

const plan = savePlan(owner, {
  plan_date: '2026-07-29',
  status: 'pending',
  plan: { entries: [], notes: 'smoke' },
});
assert(plan?.plan_date === '2026-07-29', 'day plan saved');
const fetched = getPlan(owner, { plan_date: '2026-07-29' });
assert(fetched?.status === 'pending', 'day plan fetched');

const journal = summarizeJournal(owner, { days: 30 });
assert(journal.ok === true, `journal ok fills=${journal.fills_count}`);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll smoke checks passed');
