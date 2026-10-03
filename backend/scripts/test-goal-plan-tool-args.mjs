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
  bindToolArgsFromGoalContext,
  resolveAgentToolArgsForGoal,
  requestedBrowserDriver,
  resolveBrowserTaskExecutorPreference,
  buildBrowserTaskArgsForGoal,
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

const unrelated = await resolveAgentToolArgsForGoal({
  toolName: 'crm_status',
  args: { symbols: ['AAPL', 'MSFT'], symbol: 'NVDA', ticker: 'VOOG' },
  goalPrompt: prompt,
});
assert(!unrelated.symbols, 'non-market tool must not receive multi-symbol fan-out');
assert(!('symbols' in unrelated.args), 'non-market tool strips symbols');
assert(!('symbol' in unrelated.args), 'non-market tool strips symbol');
assert(!('ticker' in unrelated.args), 'non-market tool strips ticker');

const eventId = 'epe-test-event-context';
const boundEvent = bindToolArgsFromGoalContext({
  toolName: 'event_inbox_get',
  args: {},
  goalContext: { productivity_event_id: eventId, productivity_event: { id: 'ignored-fallback' } },
});
assert(boundEvent.event_id === eventId, 'event_inbox_get binds the authoritative goal event id');

const explicitEvent = bindToolArgsFromGoalContext({
  toolName: 'event_inbox_get',
  args: { event_id: 'explicit-event-id' },
  goalContext: { productivity_event_id: eventId },
});
assert(explicitEvent.event_id === 'explicit-event-id', 'explicit step event id remains authoritative');

const nestedEvent = bindToolArgsFromGoalContext({
  toolName: 'event_inbox_get',
  args: {},
  goalContext: { productivity_event: { id: 'nested-event-id' } },
});
assert(nestedEvent.event_id === 'nested-event-id', 'legacy nested event context remains supported');

const unrelatedContext = bindToolArgsFromGoalContext({
  toolName: 'crm_status',
  args: {},
  goalContext: { productivity_event_id: eventId },
});
assert(!('event_id' in unrelatedContext), 'event context is not leaked into unrelated tools');

assert(
  requestedBrowserDriver('Use the browsertools desktop worker for this task') === 'playwright_chrome',
  'desktop worker resolves to the canonical local Playwright driver'
);
assert(
  requestedBrowserDriver('Use the paired Chrome extension tab') === 'chrome_extension',
  'Chrome extension remains explicitly selectable'
);
const delegatedPreference = resolveBrowserTaskExecutorPreference(
  { goal: 'Open Example Website', start_url: 'https://example.com' },
  {
    original_request: 'Use browsertools desktop worker to read https://example.com.',
    resolved_request: 'Browser-specific assignment: Open Example Website',
  }
);
assert(delegatedPreference.preferred_driver === 'playwright_chrome', 'delegated browser calls retain the owner-requested desktop executor');
assert(delegatedPreference.allow_fallback === false, 'delegated explicit executor cannot silently fall back');
const callerPreference = resolveBrowserTaskExecutorPreference({
  goal: 'Open Example Website', preferred_driver: 'chrome_extension', allow_fallback: true,
});
assert(callerPreference.preferred_driver === 'chrome_extension', 'caller-supplied executor remains supported');
assert(callerPreference.allow_fallback === true, 'caller fallback policy remains supported without a conflicting contextual instruction');
const exactPost = 'AI is improving financial analysis while accountable humans retain approval and oversight.';
const browserArgs = buildBrowserTaskArgsForGoal({
  args: {
    mode: 'autonomous',
    start_url: 'https://www.linkedin.com/',
    input: { operation: 'social_publish', platform: 'linkedin', body: '{{post_content}}' },
  },
  goalPrompt: 'Post the generated content to LinkedIn using the browsertools desktop worker.',
  stepInstruction: 'Publish {{post_content}} and return durable confirmation.',
  requiredInputValues: { post_content: exactPost },
});
assert(browserArgs.preferred_driver === 'playwright_chrome', 'explicit desktop executor is preserved');
assert(browserArgs.allow_fallback === false, 'explicit executor must not silently fall back');
assert(browserArgs.input.body === exactPost, 'prior-step content remains exact in the browser action contract');
assert(browserArgs.input.constraints.max_submissions === 1, 'social publishing is bounded to one submission');

console.log('ok', { tickers, basket_len: basket.length, rewritten: rewritten.map((s) => s.type) });
