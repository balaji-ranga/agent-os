import assert from 'node:assert/strict';
import {
  explicitGoalUrls,
  selectExplicitFallbackUrl,
  resolveBrowserRecoveryUrl,
  goalRequestsBrowserRecovery,
  unresolvedRequiredBrowserItems,
  hasUsefulPartialResult,
  unresolvedItemsFromSteps,
  terminalGoalStatusFromSteps,
  sanitizeUnsupportedItemClaims,
  buildVerifiedMarketOutcome,
  buildOutcomeRichTerminalReport,
} from '../src/services/agent-goal-run.js';

const prompt = [
  'Check AAPL and VOOG.',
  'If VOOG is subscription limited, use https://query1.finance.yahoo.com/v8/finance/chart/VOOG.',
  'Reference https://example.com/background only for background.',
].join(' ');

assert.equal(explicitGoalUrls(prompt).length, 2);
assert.equal(
  selectExplicitFallbackUrl(prompt, 'VOOG'),
  'https://query1.finance.yahoo.com/v8/finance/chart/VOOG'
);
assert.equal(selectExplicitFallbackUrl(prompt, 'MSFT'), null, 'must not guess among multiple URLs');
assert.equal(
  resolveBrowserRecoveryUrl('Use Yahoo Finance browser data for QQQ', 'QQQ'),
  null,
  'provider names must not synthesize vendor-specific endpoints'
);
assert.equal(resolveBrowserRecoveryUrl('Use a browser source for QQQ', 'QQQ'), null);
assert.equal(goalRequestsBrowserRecovery('use Yahoo Finance browser tool if provider fails'), true);
assert.equal(goalRequestsBrowserRecovery('use only the market API'), false);
assert.equal(unresolvedRequiredBrowserItems(
  [{ symbol: 'VOOG', error: '402' }],
  [{ symbol: 'VOOG', status: 'failed', task: { error: '429' } }],
  'Use browser recovery for VOOG'
).length, 1);
assert.equal(unresolvedRequiredBrowserItems(
  [{ symbol: 'VOOG', error: '402' }],
  [{ symbol: 'VOOG', status: 'completed', task: { result: {
    summary: 'verified',
    verification: { satisfied: true },
  } } }],
  'Use browser recovery for VOOG'
).length, 0);
assert.equal(unresolvedRequiredBrowserItems(
  [{ symbol: 'VOOG', error: '402' }],
  [{ symbol: 'VOOG', status: 'completed', task: { result: { summary: 'unverified prose' } } }],
  'Use browser recovery for VOOG'
).length, 1, 'completed browser prose without verified evidence must remain unresolved');
const partialStep = {
  result_json: JSON.stringify({
    partial_success: true,
    results: [{ symbol: 'AAPL', ok: true, result: { close: 1 } }],
    errors: [{ symbol: 'XYXY', error: 'not found' }],
  }),
};
assert.equal(hasUsefulPartialResult(JSON.parse(partialStep.result_json)), true);
assert.deepEqual(unresolvedItemsFromSteps([partialStep]), ['XYXY']);
assert.equal(terminalGoalStatusFromSteps([partialStep]), 'partial_success');
assert.equal(terminalGoalStatusFromSteps([
  partialStep,
  { result_json: JSON.stringify({ results: [{ symbol: 'XYXY', ok: true, result: { close: 2 } }] }) },
]), 'completed', 'a later verified source resolves an earlier gap');
const sanitized = sanitizeUnsupportedItemClaims('| VOOG | +0.68% |\n| AAPL | +1.2% |', ['VOOG']);
assert.doesNotMatch(sanitized, /VOOG[^\n]*0\.68%/);
assert.match(sanitized, /AAPL[^\n]*\+1\.2%/);
assert.match(sanitized, /Verified-data correction: VOOG/);

const verified = buildVerifiedMarketOutcome([{
  step_index: 0,
  result_json: JSON.stringify({
    multi_symbol: true,
    results: [{ symbol: 'MSFT', result: { daily_change_pct: 0.026, close: 499.99 } }],
    fallbacks: [{ symbol: 'VOOG', status: 'completed', task: { result: {
      summary: 'VOOG +0.68% from Yahoo Finance',
      verification: { satisfied: true },
    } } }],
  }),
}]);
assert.match(verified, /MSFT: \+0\.03%/);
assert.doesNotMatch(verified, /2\.60%/);
assert.match(verified, /VOOG \(browser recovery\).*\+0\.68%/);

const report = buildOutcomeRichTerminalReport({
  terminal: 'completed',
  goal: { id: 'agr-test', title: 'Morning MAG7 & VOOG' },
  steps: [
    {
      label: 'Market history',
      status: 'completed',
      result_json: JSON.stringify({
        ok: true,
        tool_name: 'market_history',
        multi_symbol: true,
        results: [{ symbol: 'AAPL', ok: true, result: { close: 1 } }],
        errors: [{ symbol: 'VOOG', ok: false, error: 'provider HTTP 402' }],
        fallbacks: [{
          symbol: 'VOOG',
          url: 'https://query1.finance.yahoo.com/v8/finance/chart/VOOG',
          status: 'completed',
          task: { status: 'completed', result: { verification: { satisfied: true } } },
        }],
      }),
    },
    {
      step_type: 'human_task',
      label: 'Human: Raji',
      status: 'completed',
      result_json: JSON.stringify({
        ok: true,
        human_outcome: 'Customer confirmed payment on 3 September; no fee waiver was promised.',
        assigned_user_id: 'user-raji',
        kanban_task_id: 14132,
      }),
    },
    {
      label: 'Synthesize',
      status: 'completed',
      result_json: JSON.stringify({
        ok: true,
        reply_preview: 'AAPL closed at 232.10. VOOG closed at 405.21 from Yahoo Finance.',
      }),
    },
  ],
});

assert.match(report, /AAPL closed at 232\.10/);
assert.match(report, /VOOG closed at 405\.21/);
assert.match(report, /browser fallback completed/);
assert.match(report, /provider HTTP 402/);
assert.match(report, /Human: Raji: Customer confirmed payment on 3 September/);
console.log('goal browser fallback + terminal report tests passed');
