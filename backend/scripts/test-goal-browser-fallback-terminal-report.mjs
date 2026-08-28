import assert from 'node:assert/strict';
import {
  explicitGoalUrls,
  selectExplicitFallbackUrl,
  goalRequestsBrowserRecovery,
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
assert.equal(goalRequestsBrowserRecovery('use Yahoo Finance browser tool if provider fails'), true);
assert.equal(goalRequestsBrowserRecovery('use only the market API'), false);
const sanitized = sanitizeUnsupportedItemClaims('| VOOG | +0.68% |\n| AAPL | +1.2% |', ['VOOG']);
assert.doesNotMatch(sanitized, /VOOG[^\n]*0\.68%/);
assert.match(sanitized, /AAPL[^\n]*\+1\.2%/);
assert.match(sanitized, /Verified-data correction: VOOG/);

const verified = buildVerifiedMarketOutcome([{
  step_index: 0,
  result_json: JSON.stringify({
    multi_symbol: true,
    results: [{ symbol: 'MSFT', result: { daily_change_pct: 0.026, close: 499.99 } }],
    fallbacks: [{ symbol: 'VOOG', status: 'completed', task: { result: { summary: 'VOOG +0.68% from Yahoo Finance' } } }],
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
          task: { status: 'completed' },
        }],
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
console.log('goal browser fallback + terminal report tests passed');
