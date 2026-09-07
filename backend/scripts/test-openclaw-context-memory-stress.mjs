/**
 * Read-only OpenClaw context stress probe. Sends small requests through fresh
 * isolated sessions, reports provider usage, then removes those session files.
 */
import assert from 'node:assert/strict';
import * as openclaw from '../src/gateway/openclaw.js';
import { clearOpenClawSessionForUser } from '../src/services/agent-chat-scope.js';

const ownerUserId = String(process.env.REGRESSION_CEO_ID || 'ceo-bala');
const baseAgentId = String(process.env.OPENCLAW_STRESS_BASE_AGENT_ID || 'balserve');
const runtimeAgentId = String(process.env.OPENCLAW_STRESS_AGENT_ID || `t-${ownerUserId}--${baseAgentId}`);
const repeats = Math.min(10, Math.max(2, Number(process.env.OPENCLAW_STRESS_REPEATS || 5)));
const stamp = `context-stress-${Date.now()}`;
const rows = [];

try {
  for (let index = 0; index < repeats; index += 1) {
    const thread = `${stamp}-${index}`;
    const sessionUser = openclaw.sessionUserFor(baseAgentId, ownerUserId, thread);
    const started = Date.now();
    const result = await openclaw.chatCompletions(
      runtimeAgentId,
      [{ role: 'user', content: `Health probe ${index + 1}: reply with exactly OK. Do not call tools.` }],
      sessionUser,
      false,
      {
        timeoutMs: 180000,
        retries: 1,
        injectSessionHistoryInstruction: false,
        injectLearningsInstruction: false,
        injectBrowserInstruction: false,
        injectKanbanInstruction: false,
      }
    );
    const usage = result.usage || {};
    rows.push({
      index: index + 1,
      elapsed_ms: Date.now() - started,
      input_tokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? 0),
      output_tokens: Number(usage.output_tokens ?? usage.completion_tokens ?? 0),
      reply: String(result.content || '').trim().slice(0, 80),
      thread,
    });
    assert.match(String(result.content || ''), /\bOK\b/i, `unexpected OpenClaw reply at iteration ${index + 1}`);
  }
  const tokenSeries = rows.map((row) => row.input_tokens);
  const nonzero = tokenSeries.filter((value) => value > 0);
  const spread = nonzero.length ? Math.max(...nonzero) - Math.min(...nonzero) : 0;
  console.log(JSON.stringify({
    ok: true,
    runtime_agent_id: runtimeAgentId,
    repeats,
    input_token_series: tokenSeries,
    input_token_spread: spread,
    rows: rows.map(({ thread: _thread, ...row }) => row),
  }, null, 2));
} finally {
  for (const row of rows) {
    try { clearOpenClawSessionForUser(baseAgentId, runtimeAgentId, ownerUserId, row.thread); } catch {}
  }
}
