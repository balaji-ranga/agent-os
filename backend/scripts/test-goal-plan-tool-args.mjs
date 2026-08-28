/**
 * Unit-ish checks for goal-plan tool arg heuristics (no network).
 * Run: node scripts/test-goal-plan-tool-args.mjs
 */
import {
  extractTickersFromGoalText,
  expandMarketBaskets,
  MAG7_SYMBOLS,
  goalWantsChatSynthesis,
  goalWantsAgentInterpretation,
  isCompositionalTool,
  rewriteCompositionalToolsForAgentInterpretation,
  toolNeedsAgentInterpretation,
  resolveAgentToolArgsForGoal,
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
assert(goalWantsAgentInterpretation('Send appealing HTML email via email_send') === true, 'email wants interpretation');
assert(isCompositionalTool('email_send') === true, 'email_send compositional');
assert(isCompositionalTool('status_checker') === false, 'status_checker not compositional');
assert(toolNeedsAgentInterpretation('email_send', { hasPriorSteps: true }) === false, 'real endpoint remains execution evidence with priors');
assert(toolNeedsAgentInterpretation('email_send', { hasPriorSteps: false }) === false, 'lone email can stay dry');

const rewritten = rewriteCompositionalToolsForAgentInterpretation(
  [
    { type: 'agent_tool', tool_name: 'status_checker', label: 'Status' },
    { type: 'agent_tool', tool_name: 'email_send', label: 'Email', args: {} },
    { type: 'notify_ceo', label: 'Notify' },
  ],
  'Run status_checker then email_send HTML report. Do not call notify_ceo.'
);
assert(
  rewritten.some((s) => s.type === 'agent_continue'),
  'rewrite adds agent_continue'
);
assert(
  !rewritten.some((s) => s.tool_name === 'email_send'),
  'rewrite removes email_send after data tool'
);
assert(
  !rewritten.some((s) => s.type === 'notify_ceo'),
  'rewrite strips forbidden notify_ceo'
);
assert(
  rewritten.some((s) => s.tool_name === 'status_checker'),
  'keeps status_checker'
);

const withSpecialty = rewriteCompositionalToolsForAgentInterpretation(
  [
    { type: 'specialty_task', agent_id: 'researchx', label: 'Research' },
    { type: 'agent_tool', tool_name: 'kanban_create_task', label: 'Kanban' },
    { type: 'notify_ceo', label: 'Notify' },
  ],
  'Rank the top 5 prospects and create a Kanban card'
);
assert(
  !withSpecialty.some((s) => s.type === 'agent_continue'),
  'specialty plans must not collapse to agent_continue just because rank/prospects/kanban appear'
);

const loneEmail = rewriteCompositionalToolsForAgentInterpretation(
  [{ type: 'agent_tool', tool_name: 'email_send', label: 'Email', args: { to: 'a@b.c', body: 'hi' } }],
  'Just email_send a note'
);
assert(
  loneEmail.some((s) => s.tool_name === 'email_send'),
  'lone email_send stays dry (no prior work)'
);

// With no owner/model call, the deterministic basket must preserve every symbol.
const resolvedBasket = await resolveAgentToolArgsForGoal({
  toolName: 'market_history',
  goalPrompt: prompt,
});
assert(resolvedBasket.symbols?.length === 8, 'MAG7 + VOOG preserves eight symbols');
assert(resolvedBasket.symbols.includes('VOOG'), 'VOOG preserved in resolved tool args');

console.log('ok', { tickers, basket_len: basket.length, rewritten: rewritten.map((s) => s.type) });
