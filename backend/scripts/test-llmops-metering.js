/**
 * LLMOps metering, trace_id, price book, cost estimates, owner isolation.
 * Disposable owner ids only — never a production CEO.
 *
 * Usage: node scripts/test-llmops-metering.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import {
  recordTokenUsage,
  meterChatCompletionsUsage,
  getOwnerTokenTotals,
  listRecentTraces,
  monthPeriod,
} from '../src/services/token-usage.js';
import { withLlmopsContext } from '../src/services/llmops-context.js';
import {
  ensureDefaultPriceBook,
  saveCeoPriceBook,
  tokensToUsd,
  resolveModelRates,
  valueTokenUsage,
  addManualCostLine,
  listManualCostLines,
  deleteManualCostLine,
} from '../src/services/llmops-cost.js';
import { getLlmopsSummary } from '../src/services/llmops-summary.js';

const OWNER = 'ceo-llmops-meter-probe';
const OTHER = 'ceo-llmops-other-probe';
const AGENT = 'techresearcher';
const TRACE = 'agr-llmopstest0001';

initDb();
ensureDefaultPriceBook();

const db = getDb();
db.prepare('DELETE FROM token_usage WHERE owner_user_id IN (?, ?)').run(OWNER, OTHER);
db.prepare('DELETE FROM llm_price_book WHERE owner_user_id IN (?, ?)').run(OWNER, OTHER);
db.prepare("DELETE FROM cost_lines WHERE owner_user_id IN (?, ?) AND category = 'manual_external'").run(
  OWNER,
  OTHER
);

let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

console.log(`== llmops metering (${OWNER}) ==`);

const wrote = recordTokenUsage(OWNER, {
  memberKey: AGENT,
  source: 'content_tool',
  modelId: 'gpt-4o-mini',
  inputTokens: 1000,
  outputTokens: 500,
  estimated: false,
  traceId: TRACE,
  runId: TRACE,
});
check('recordTokenUsage wrote', wrote === true);

withLlmopsContext(
  {
    ownerUserId: OWNER,
    memberKey: AGENT,
    source: 'goal_planner',
    traceId: TRACE,
    goalRunId: TRACE,
  },
  () => {
    meterChatCompletionsUsage(OWNER, {
      usage: { prompt_tokens: 200, completion_tokens: 50 },
      modelId: 'gpt-4o-mini',
      promptText: 'plan this',
      replyText: 'ok',
    });
  }
);

const totals = getOwnerTokenTotals(OWNER);
check('owner tokens include both rows', totals.total_tokens === 1750, `got ${totals.total_tokens}`);
check('calls = 2', totals.calls === 2, `got ${totals.calls}`);

const otherTotals = getOwnerTokenTotals(OTHER);
check('other owner sees zero tokens', otherTotals.total_tokens === 0);

const traces = listRecentTraces(OWNER, { limit: 10 });
const hit = traces.find((t) => t.trace_id === TRACE);
check('trace listed', !!hit, hit ? `tokens=${hit.tokens}` : 'missing');
check('trace href is goal plan', hit?.href === `/goal-plans/${TRACE}`, hit?.href || '');

saveCeoPriceBook(OWNER, [{ model_id: '*', input_usd_per_1m: 1, output_usd_per_1m: 2 }]);
const rates = resolveModelRates(OWNER, 'gpt-4o-mini');
check('ceo wildcard rates apply', rates.input_usd_per_1m === 1 && rates.output_usd_per_1m === 2);
const usd = tokensToUsd(1_000_000, 1_000_000, rates);
check('tokensToUsd 1M in + 1M out = $3', usd === 3, `got ${usd}`);

const valued = valueTokenUsage(OWNER);
check('valued amount is positive', valued.amount_usd > 0, `usd=${valued.amount_usd}`);
check(
  'other owner valuation empty',
  valueTokenUsage(OTHER).amount_usd === 0
);

const line = addManualCostLine(OWNER, { amount_usd: 12.5, note: 'ads' });
check('manual cost line id', Number(line.id) > 0);
const manuals = listManualCostLines(OWNER, { period: monthPeriod() });
check('manual listed for owner', manuals.some((m) => m.id === line.id && m.amount_usd === 12.5));
check('other owner manuals empty', listManualCostLines(OTHER).length === 0);

let isolated = false;
try {
  deleteManualCostLine(OTHER, line.id);
} catch (e) {
  isolated = e?.status === 404;
}
check('cannot delete other owner line', isolated);
check('owner line still present after other delete', listManualCostLines(OWNER).some((m) => m.id === line.id));
deleteManualCostLine(OWNER, line.id);
check('manual deleted', listManualCostLines(OWNER).length === 0);

const summary = getLlmopsSummary(OWNER, { days: 30 });
check('summary tokens', summary.tokens.total_tokens === 1750);
check('summary has cost disclaimer', String(summary.cost?.disclaimer || '').length > 20);
check('summary traces include agr', (summary.traces || []).some((t) => t.trace_id === TRACE));
check('summary split mentions Admin', /Admin/i.test(summary.split?.operator || ''));

db.prepare('DELETE FROM token_usage WHERE owner_user_id IN (?, ?)').run(OWNER, OTHER);
db.prepare('DELETE FROM llm_price_book WHERE owner_user_id IN (?, ?)').run(OWNER, OTHER);
db.prepare("DELETE FROM cost_lines WHERE owner_user_id IN (?, ?) AND category = 'manual_external'").run(
  OWNER,
  OTHER
);

if (failures) {
  console.error(`LLMOPS_METERING_FAIL count=${failures}`);
  process.exit(1);
}
console.log('LLMOPS_METERING_OK');
