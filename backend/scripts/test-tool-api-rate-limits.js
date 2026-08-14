/**
 * Per-user tool API rate limits: consume, block, auto day/month reset with audit, manual reset.
 *
 * Uses a disposable owner so deploy smoke never mutates a real CEO tenant.
 *
 * Usage: node backend/scripts/test-tool-api-rate-limits.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import {
  putToolApiRateLimits,
  assertAndConsumeToolRateLimit,
  resetToolApiRateLimit,
  applyDueToolRateLimitResets,
  listToolApiRateLimits,
  listToolApiRateLimitResets,
  isToolApiRateLimitable,
  periodKeys,
} from '../src/services/tool-api-rate-limits.js';

const OWNER = 'ceo-tool-rate-limit-probe';
const TOOL = 'brave_web_search';

initDb();

let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

const db = getDb();
db.prepare('DELETE FROM tool_api_rate_limits WHERE owner_user_id = ?').run(OWNER);
db.prepare('DELETE FROM tool_api_rate_limit_resets WHERE owner_user_id = ?').run(OWNER);

console.log(`== tool API rate limits (${OWNER} / ${TOOL}) ==`);

check('brave_web_search is rate-limitable', isToolApiRateLimitable('brave_web_search'));
check('browse_task_start is NOT rate-limitable (fallback path)', !isToolApiRateLimitable('browse_task_start'));
check('kanban_create_task is NOT rate-limitable', !isToolApiRateLimitable('kanban_create_task'));

const unlimited = assertAndConsumeToolRateLimit({ ownerUserId: OWNER, toolName: TOOL, actor: 'test' });
check('unlimited when no row', unlimited.ok === true && unlimited.skipped === 'unlimited', JSON.stringify(unlimited));

putToolApiRateLimits(OWNER, [{ tool_name: TOOL, max_calls_per_day: 2, max_calls_per_month: 5 }]);
const listed = listToolApiRateLimits(OWNER);
const row = (listed.tools || []).find((t) => t.name === TOOL);
check('saved daily=2 monthly=5', row && Number(row.max_calls_per_day) === 2 && Number(row.max_calls_per_month) === 5);

const a = assertAndConsumeToolRateLimit({ ownerUserId: OWNER, toolName: TOOL, actor: 'test' });
const b = assertAndConsumeToolRateLimit({ ownerUserId: OWNER, toolName: TOOL, actor: 'test' });
check('first consume ok', a.ok === true && a.calls_today === 1, JSON.stringify(a));
check('second consume ok (at cap)', b.ok === true && b.calls_today === 2, JSON.stringify(b));

const blocked = assertAndConsumeToolRateLimit({ ownerUserId: OWNER, toolName: TOOL, actor: 'test' });
check('third call blocked for day', blocked.ok === false && blocked.code === 'tool_rate_limit_reached' && blocked.period === 'day');
check(
  'agent message mentions day + browser fallback',
  typeof blocked.error === 'string' &&
    /rate limit reached for day/i.test(blocked.error) &&
    /Browser Session|Playwright/i.test(blocked.error),
  blocked.error
);

const afterBlock = listToolApiRateLimits(OWNER).tools.find((t) => t.name === TOOL);
check('actuals stay at 2 after blocked call', Number(afterBlock.calls_today) === 2);

resetToolApiRateLimit(OWNER, TOOL, { period: 'day', resetBy: 'test' });
const afterManual = listToolApiRateLimits(OWNER).tools.find((t) => t.name === TOOL);
check('manual day reset zeros today, keeps month actuals', Number(afterManual.calls_today) === 0 && Number(afterManual.calls_this_month) === 2);

const audits = listToolApiRateLimitResets(OWNER, { toolName: TOOL, limit: 10 });
const manual = audits.find((r) => r.reset_kind === 'manual_day');
check(
  'manual reset audited budget vs actuals',
  !!manual && Number(manual.budget_max_day) === 2 && Number(manual.actuals_day) === 2,
  JSON.stringify(manual || audits[0] || {})
);

const keys = periodKeys();
db.prepare(
  `UPDATE tool_api_rate_limits SET calls_today = 2, period_day = ?, period_month = ? WHERE owner_user_id = ? AND tool_name = ?`
).run('1999-01-01', keys.month, OWNER, TOOL);

const auto = applyDueToolRateLimitResets({ ownerUserId: OWNER, resetBy: 'cron' });
check('cron/auto rollover writes audit', auto.ok === true && auto.audits >= 1, JSON.stringify(auto));
const afterAuto = listToolApiRateLimits(OWNER).tools.find((t) => t.name === TOOL);
check('auto day reset zeros today', Number(afterAuto.calls_today) === 0);
const autoAudit = listToolApiRateLimitResets(OWNER, { toolName: TOOL }).find((r) => r.reset_kind === 'auto_day');
check(
  'auto reset stored previous actuals',
  !!autoAudit && Number(autoAudit.actuals_day) === 2 && Number(autoAudit.budget_max_day) === 2
);

const skippedOther = assertAndConsumeToolRateLimit({
  ownerUserId: OWNER,
  toolName: 'kanban_create_task',
  actor: 'test',
});
check('internal tool skips validator', skippedOther.ok === true && skippedOther.skipped === 'not_limitable');

putToolApiRateLimits(OWNER, [{ tool_name: TOOL, max_calls_per_day: '', max_calls_per_month: '' }]);
const cleared = listToolApiRateLimits(OWNER).tools.find((t) => t.name === TOOL);
check('clearing both maxes removes limit', cleared && !cleared.limited && Number(cleared.max_calls_per_day || 0) === 0);

db.prepare('DELETE FROM tool_api_rate_limits WHERE owner_user_id = ?').run(OWNER);
db.prepare('DELETE FROM tool_api_rate_limit_resets WHERE owner_user_id = ?').run(OWNER);

if (failures) {
  console.error(`FAILED ${failures} check(s)`);
  process.exit(1);
}
console.log('PASS tool API rate limits');
