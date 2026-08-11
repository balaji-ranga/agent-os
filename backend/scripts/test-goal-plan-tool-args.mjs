/**
 * Unit-ish checks for goal-plan tool arg heuristics (no network).
 * Run: node scripts/test-goal-plan-tool-args.mjs
 */
import {
  extractTickersFromGoalText,
  expandMarketBaskets,
  MAG7_SYMBOLS,
  goalWantsChatSynthesis,
} from '../src/services/goal-plan-tool-args.js';

const prompt =
  'Morning market reminder for the CEO: Pull current market performance for the Magnificent 7 stocks (AAPL, MSFT, GOOGL, AMZN, META, NVDA, TSLA) and VOOG (Vanguard S&P 500 Growth ETF). Use market_history / market_fundamentals tools to get daily performance and momentum. Summarize in a clean, brief morning report with % daily change for each name, and send it to the CEO in this chat.';

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

const basket = expandMarketBaskets('check MAGS vs previous close');
assert(basket.length === 7, 'MAGS expands to 7');
assert(basket.includes('NVDA'), 'has NVDA');

const tickers = extractTickersFromGoalText(prompt);
for (const s of MAG7_SYMBOLS) {
  assert(tickers.includes(s), 'missing ' + s);
}
assert(tickers.includes('VOOG'), 'missing VOOG');
assert(goalWantsChatSynthesis(prompt) === true, 'wants synthesis');
assert(goalWantsChatSynthesis('list my workflows') === false, 'no false synthesis');

console.log('ok', { tickers, basket_len: basket.length });
