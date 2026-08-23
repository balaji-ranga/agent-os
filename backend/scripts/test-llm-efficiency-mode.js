/**
 * Profile Efficiency mode: wave-1 utility jobs route to local Ollama.
 */
import {
  parseEfficiencyModeFlag,
  isEfficiencyModeTool,
  shouldUseEfficiencyOllama,
  getEfficiencyOllamaLlmConfig,
  EFFICIENCY_MODE_TOOLS,
} from '../src/services/llm-efficiency-mode.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  OK: ${msg}`);
  } else {
    failed += 1;
    console.error(`  FAIL: ${msg}`);
  }
}

console.log('=== LLM efficiency mode ===');

assert(parseEfficiencyModeFlag(true) === true, 'true → yes');
assert(parseEfficiencyModeFlag(1) === true, '1 → yes');
assert(parseEfficiencyModeFlag('yes') === true, 'yes → yes');
assert(parseEfficiencyModeFlag('No') === false, 'No → no');
assert(parseEfficiencyModeFlag(0) === false, '0 → no');
assert(parseEfficiencyModeFlag(undefined) === false, 'unset → no');

for (const t of [
  'learnings_summary',
  'chat_archive_title',
  'brain_history',
  'ibkr_order_learnings',
  'broadcast_notify_intent',
  'coo_tool_ownership',
  'goal_plan_tool_args',
  'ceo_guardrails_enrich',
]) {
  assert(isEfficiencyModeTool(t), `wave-1 tool ${t}`);
}
assert(EFFICIENCY_MODE_TOOLS.length === 8, 'eight wave-1 tools');
assert(!isEfficiencyModeTool('workflow_builder_chat'), 'builder chat stays on BYOK');
assert(!isEfficiencyModeTool('summarize_url'), 'summarize_url is wave-2, not wave-1');
assert(!shouldUseEfficiencyOllama(null, 'learnings_summary'), 'no owner → no efficiency route');

const ollama = getEfficiencyOllamaLlmConfig();
assert(!!ollama.primary?.baseUrl, 'ollama base url');
assert(/11434|ollama/i.test(ollama.primary.baseUrl), `ollama host in ${ollama.primary.baseUrl}`);
assert(!!ollama.primary?.model, 'ollama model');
assert(ollama.using_byok === false, 'efficiency ollama is not BYOK');
assert(ollama.platform_endpoint === 'efficiency_ollama', 'endpoint tag');

console.log(`\n=== RESULT passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
console.log('LLM_EFFICIENCY_MODE_OK');
