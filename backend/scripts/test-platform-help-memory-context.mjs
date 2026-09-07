/**
 * VPS-safe Platform Help context/memory exercise.
 * Creates and revokes one temporary owner session; it does not alter agents,
 * tools, documents, objectives, or OpenClaw configuration.
 */
import assert from 'node:assert/strict';
import { createSession, revokeSession } from '../src/services/auth/session.js';

const base = String(process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const ownerUserId = String(process.env.REGRESSION_CEO_ID || 'ceo-bala').trim();
const repeats = Math.min(10, Math.max(1, Number(process.env.PLATFORM_HELP_STRESS_REPEATS || 3)));
const timeoutMs = Math.max(30000, Number(process.env.PLATFORM_HELP_STRESS_TIMEOUT_MS || 180000));
const session = createSession(ownerUserId);
const results = [];

async function chat(message, kind) {
  const started = Date.now();
  const response = await fetch(`${base}/api/agents/platformhelp/chat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, 200, `${kind} failed: ${data.error || response.status}`);
  const toolNames = (data.tool_calls || []).map((call) => call.tool_name || call.name).filter(Boolean);
  const inputTokens = Number(data.usage?.input_tokens ?? data.usage?.prompt_tokens ?? 0);
  const outputTokens = Number(data.usage?.output_tokens ?? data.usage?.completion_tokens ?? 0);
  const row = {
    kind,
    elapsed_ms: Date.now() - started,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    tool_names: toolNames,
    reply_preview: String(data.reply || '').replace(/\s+/g, ' ').slice(0, 180),
  };
  results.push(row);
  return row;
}

try {
  for (let index = 0; index < repeats; index += 1) {
    const courtesy = await chat(index % 2 ? 'Thanks' : 'Hi', 'courtesy');
    assert.equal(courtesy.input_tokens, 0, 'courtesy request must not consume LLM input tokens');
    assert.deepEqual(courtesy.tool_names, [], 'courtesy request must not call tools');
    assert(courtesy.elapsed_ms < 2000, `courtesy response took ${courtesy.elapsed_ms}ms`);
  }

  const questions = [
    'Give me a concise step-by-step guide to set up an Objective and Key Results in Flolah. Use Platform Help evidence.',
    'How do initiatives, scheduled goals, goal-plan runs, evidence and KR progress connect in Flolah?',
    'Where can I review OKR measurements and daily digest progress in Flolah?',
  ];
  for (const question of questions) await chat(question, 'rag_help');

  const helpRows = results.filter((row) => row.kind === 'rag_help');
  assert(helpRows.every((row) => !row.tool_names.includes('master_data_list_documents')), 'Platform Help must not list the entire corpus as a RAG fallback');
  assert(helpRows.every((row) => row.tool_names.length === 1 && row.tool_names[0] === 'master_data_rag'), `Platform Help must retrieve exactly once: ${JSON.stringify(helpRows)}`);
  assert(helpRows.every((row) => row.input_tokens < 10000), `Platform Help input context exceeded 10k tokens: ${JSON.stringify(helpRows)}`);
  const tokenSeries = helpRows.map((row) => row.input_tokens);
  console.log(JSON.stringify({
    ok: true,
    owner_user_id: ownerUserId,
    courtesy_repeats: repeats,
    courtesy_max_ms: Math.max(...results.filter((row) => row.kind === 'courtesy').map((row) => row.elapsed_ms)),
    rag_calls: helpRows.length,
    rag_elapsed_ms: helpRows.map((row) => row.elapsed_ms),
    input_token_series: tokenSeries,
    input_token_growth: tokenSeries.length ? tokenSeries.at(-1) - tokenSeries[0] : 0,
    results,
  }, null, 2));
} finally {
  revokeSession(session.token);
}
