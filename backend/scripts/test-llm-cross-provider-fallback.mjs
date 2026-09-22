import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'flolah-llm-fallback-'));
process.env.AGENT_OS_DATA_DIR = dir;
process.env.MODEL_ROUTING_ENABLED = '1';
process.env.LITELLM_BASE_URL = 'http://litellm:4000/v1';
process.env.LITELLM_MASTER_KEY = 'test-only';
process.env.OPENAI_PRIMARY_BASE_URL = 'https://api.deepseek.com/v1';
process.env.OPENAI_PRIMARY_MODEL = 'deepseek-v4-flash';
process.env.OPENAI_PRIMARY_API_KEY = 'test-primary';
process.env.OPENAI_SECONDARY_BASE_URL = 'https://api.openai.com/v1';
process.env.OPENAI_SECONDARY_MODEL = 'gpt-4o-mini';
process.env.OPENAI_SECONDARY_API_KEY = 'test-secondary';

const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, init = {}) => {
  const body = JSON.parse(String(init.body || '{}'));
  requests.push(body);
  if (requests.length === 1) {
    return new Response(JSON.stringify({
      error: {
        message: 'Primary balance exhausted; fallback failed: Unrecognized request argument supplied: thinking',
      },
    }), { status: 402, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({
    choices: [{ message: { content: '{"route":"secondary"}' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

try {
  const { chatCompletions } = await import('../src/config/llm.js');
  const result = await chatCompletions({
    messages: [{ role: 'user', content: 'route this request' }],
    toolName: 'agent_turn_router',
    thinkingMode: 'disabled',
    responseFormat: 'json_object',
  });

  assert.equal(result.content, '{"route":"secondary"}');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].thinking, { type: 'disabled' });
  assert.deepEqual(requests[0].extra_body?.thinking, { type: 'disabled' });
  assert.equal(requests[1].thinking, undefined);
  assert.equal(requests[1].extra_body, undefined);
  assert.deepEqual(requests[1].response_format, { type: 'json_object' });
  console.log('LLM_CROSS_PROVIDER_FALLBACK_OK');
} finally {
  globalThis.fetch = originalFetch;
  try {
    const { getDb } = await import('../src/db/schema.js');
    getDb().close();
  } catch {}
  rmSync(dir, { recursive: true, force: true });
}
