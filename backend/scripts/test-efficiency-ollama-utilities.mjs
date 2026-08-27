import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-efficiency-ollama-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
const owner = 'efficiency-ollama-test-owner';

const cases = [
  ['learnings_summary', 'Summarize this learning in one sentence: Never invent market prices; verify them with a live tool.', /verify|live|invent|market/i],
  ['chat_archive_title', 'Return a short title of at most six words for a conversation about weekly sales reporting.', /sales|weekly|report/i],
  ['brain_history', 'Summarize this workflow history: fetch succeeded, validation succeeded, email failed authentication.', /email|authentication|failed/i],
  ['ibkr_order_learnings', 'Summarize this historical lesson without recommending a trade: a paper order was rejected because buying power was insufficient.', /buying power|rejected|insufficient/i],
  ['broadcast_notify_intent', 'Classify this notification intent in one sentence: Tell all department leads that the weekly review starts at 4 PM.', /review|department|notification|lead/i],
  ['coo_tool_ownership', 'Choose the capability for finding current public company news: web search or invoice creation. Answer briefly.', /web search/i],
  ['goal_plan_tool_args', 'Return compact JSON arguments for a web search about 2026 AI regulation using key query.', /query|2026|regulation/i],
  ['ceo_guardrails_enrich', 'Rewrite as a concise guardrail: Never publish externally without the configured action policy.', /publish|policy|external/i],
  ['summarize_url', 'Summarize this fetched page text in one sentence: Flolah is an open-source AI company operating system for coordinating AI employees.', /Flolah|open.source|AI company/i],
  ['master_data_rag', 'Using only this context, answer where support escalations go. Context: Critical support escalations go to the COO.', /COO/i],
];

try {
  const { initDb, getDb } = await import('../src/db/schema.js');
  initDb(); const db = getDb();
  db.prepare("INSERT INTO platform_users (id,email,password_hash,name,role,llm_efficiency_mode) VALUES (?,?,?,?,?,1)").run(owner, 'efficiency-ollama@example.test', 'test', 'Efficiency Ollama Test', 'ceo');
  const { shouldUseEfficiencyOllama } = await import('../src/services/llm-efficiency-mode.js');
  const { chatCompletions } = await import('../src/config/llm.js');
  const results = [];
  for (const [toolName, prompt, expected] of cases) {
    assert.equal(shouldUseEfficiencyOllama(owner, toolName), true, `${toolName} should route to Ollama`);
    const out = await chatCompletions({ messages: [{ role: 'user', content: prompt }], maxTokens: 100, ownerUserId: owner, toolName, temperature: 0 });
    const text = String(out.content || '').trim();
    assert.ok(text.length >= 3, `${toolName} returned text`);
    assert.match(text, expected, `${toolName} returned a meaningful response`);
    results.push({ tool: toolName, model: out.modelUsed, preview: text.replace(/\s+/g, ' ').slice(0, 180) });
  }
  console.log(JSON.stringify({ ok: true, owner_cleaned: true, results }, null, 2));
} finally {
  try { const { getDb } = await import('../src/db/schema.js'); getDb().close(); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
}
