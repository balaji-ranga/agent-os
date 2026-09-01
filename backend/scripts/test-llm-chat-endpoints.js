/**
 * chatCompletions endpoint selection: Profile BYOK / platform primary model
 * must match the host. Never copy deepseek-v4-flash onto api.openai.com.
 */
import { buildChatCompletionEndpoints, modelFitsChatEndpoint } from '../src/config/llm.js';

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

console.log('=== LLM chat endpoint model fit ===');

assert(
  modelFitsChatEndpoint('https://api.deepseek.com/v1', 'deepseek-v4-flash'),
  'DeepSeek host accepts deepseek-v4-flash'
);
assert(
  !modelFitsChatEndpoint('https://api.deepseek.com/v1', 'gpt-4o-mini'),
  'DeepSeek host rejects an OpenAI model id'
);
assert(
  !modelFitsChatEndpoint('https://api.openai.com/v1', 'deepseek-v4-flash'),
  'OpenAI host rejects deepseek-v4-flash'
);
assert(
  modelFitsChatEndpoint('https://api.openai.com/v1', 'gpt-4o-mini'),
  'OpenAI host accepts gpt-4o-mini'
);

const platform = {
  provider: 'platform_decided',
  using_byok: false,
  primary: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-ds',
    model: 'deepseek-v4-flash',
  },
  secondary: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-oa',
    model: 'gpt-4o-mini',
  },
};

const mixed = buildChatCompletionEndpoints(platform, 'deepseek-v4-flash');
assert(mixed[0].model === 'deepseek-v4-flash', `primary keeps DeepSeek model (${mixed[0]?.model})`);
assert(mixed[1].model === 'gpt-4o-mini', `secondary keeps OpenAI model, not deepseek-v4-flash (${mixed[1]?.model})`);

const openAiPrimary = {
  provider: 'platform_decided',
  using_byok: false,
  primary: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-oa',
    model: 'gpt-4o-mini',
  },
  secondary: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-ds',
    model: 'deepseek-v4-flash',
  },
};
const failover = buildChatCompletionEndpoints(openAiPrimary, 'gpt-4o-mini');
assert(failover[0].model === 'gpt-4o-mini', `OpenAI primary keeps OpenAI model (${failover[0]?.model})`);
assert(failover[1].model === 'deepseek-v4-flash', `DeepSeek failover keeps DeepSeek model (${failover[1]?.model})`);

const byok = {
  provider: 'openai',
  using_byok: true,
  primary: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-user',
    model: 'gpt-4o',
  },
  secondary: null,
};
const byokEps = buildChatCompletionEndpoints(byok, 'gpt-4o');
assert(byokEps.length === 1 && byokEps[0].model === 'gpt-4o', 'OpenAI BYOK uses profile model only');

const leftover = buildChatCompletionEndpoints(byok, 'deepseek-v4-flash');
assert(
  leftover[0].model === 'gpt-4o',
  `OpenAI BYOK ignores leftover DeepSeek override (${leftover[0]?.model})`
);

console.log(`\n=== RESULT passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
console.log('LLM_CHAT_ENDPOINTS_OK');
