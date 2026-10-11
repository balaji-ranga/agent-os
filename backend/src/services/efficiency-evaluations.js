import { getEfficiencyPolicy, localEfficiencyModel, storeEfficiencyEvaluation, updateEfficiencyEvaluation } from './efficiency-control-plane.js';

// Synthetic, read-only prompts: never invoke tools or send tenant documents to a model.
export const EFFICIENCY_FIXTURES = Object.freeze([
  ['learnings_summary', 'Summarize: Never invent market prices; verify them with a live tool.', /verify|invent|market/i],
  ['chat_archive_title', 'Return a title of at most six words about weekly sales reporting.', /sales|weekly|report/i],
  ['brain_history', 'Summarize: fetch succeeded, validation succeeded, email failed authentication.', /email|authentication|failed/i],
  ['ibkr_order_learnings', 'Summarize this lesson, without recommending trades: a paper order was rejected for insufficient buying power.', /buying power|rejected|insufficient/i],
  ['broadcast_notify_intent', 'Classify this message: "Get back with your status and notify me when ready". Return JSON with require_notify true, status_rollup true and a short string reason.', value => { const result=JSON.parse(value);return result.require_notify===true&&result.status_rollup===true&&typeof result.reason==='string'; }, 'json_object'],
  ['coo_tool_ownership', 'Return JSON {"tool":"web_search"} if web search is the correct tool for current public news; otherwise {"tool":"invoice"}.', value => JSON.parse(value).tool === 'web_search', 'json_object'],
  ['goal_plan_tool_args', 'Return JSON arguments with key query for web search about 2026 AI regulation.', value => typeof JSON.parse(value).query === 'string' && /2026|regulation|AI/i.test(JSON.parse(value).query), 'json_object'],
  ['ceo_guardrails_enrich', 'Rewrite concisely: Never publish externally without the configured action policy.', /publish|policy|external/i],
  ['summarize_url', 'Summarize provided text: Flolah is an open-source AI company operating system coordinating AI employees.', /Flolah|open.source|AI company/i],
  ['master_data_rag', 'Answer only from context. Where do critical support escalations go? Context: Critical support escalations go to the COO.', /COO/i],
]);

export function startEfficiencyEvaluation(modelId, ownerUserId, callModel, { compareHosted = false, callBaseline = null } = {}) {
  const endpoint = localEfficiencyModel(modelId);
  const job = storeEfficiencyEvaluation(modelId, { status: 'running', model: endpoint.model, passed: false,
    cases: [], scope: 'Synthetic utility smoke tests; not a profitability, authorization or full quality benchmark.' });
  const completion = runEfficiencyEvaluation(job, ownerUserId, callModel, {compareHosted,callBaseline});
  completion.catch(() => {}); // The persisted job contains sanitized failure evidence.
  return { job, completion };
}

async function runEfficiencyEvaluation(job, ownerUserId, callModel, {compareHosted,callBaseline}) {
  const policy = getEfficiencyPolicy();
  const cases = [];
  const baseline = [];
  for (const [tool, prompt, expected, format] of EFFICIENCY_FIXTURES) {
    const started = Date.now();
    try {
      const result = await callModel({ ownerUserId, toolName: tool, modelId: job.model_id,
        messages: [{ role: 'user', content: prompt }], maxTokens: 180, temperature: 0,
        responseFormat: format || null, timeoutMs: policy.local_timeout_ms });
      const text = String(result.content || '').trim();
      const pass = result.finishReason !== 'length' && (typeof expected === 'function' ? expected(text) : expected.test(text));
      cases.push({ tool, passed: pass, actual_model: result.actualModel || result.modelUsed,
        latency_ms: Date.now()-started, input_tokens: result.usage?.input_tokens || 0, output_tokens: result.usage?.output_tokens || 0 });
    } catch { cases.push({ tool, passed: false, latency_ms: Date.now()-started, reason: 'model_or_contract_failed' }); }
    if (compareHosted && callBaseline) {
      const began = Date.now();
      try {
        const result = await callBaseline({ownerUserId,toolName:tool,messages:[{role:'user',content:prompt}],maxTokens:180,temperature:0,responseFormat:format||null,timeoutMs:policy.local_timeout_ms});
        const text=String(result.content||'').trim();
        baseline.push({tool,passed:result.finishReason!=='length'&&(typeof expected==='function'?expected(text):expected.test(text)),actual_model:result.actualModel||result.modelUsed,latency_ms:Date.now()-began,input_tokens:result.usage?.input_tokens||0,output_tokens:result.usage?.output_tokens||0});
      } catch { baseline.push({tool,passed:false,latency_ms:Date.now()-began,reason:'baseline_or_contract_failed'}); }
    }
    updateEfficiencyEvaluation(job.id, { status: 'running', model: job.model, passed: false, cases, baseline, scope: job.scope });
  }
  const report = { status: 'completed', model: job.model, passed: cases.every(c => c.passed),
    passed_count: cases.filter(c => c.passed).length, total_count: cases.length, cases,
    average_latency_ms: cases.reduce((sum,c) => sum+c.latency_ms,0)/cases.length,
    scope: job.scope, cost_note: 'Local inference only. Infrastructure cost and hosted-model comparison are not measured.' };
  if (compareHosted) {
    report.baseline=baseline;
    report.baseline_passed_count=baseline.filter(c=>c.passed).length;
    report.baseline_average_latency_ms=baseline.length?baseline.reduce((sum,c)=>sum+c.latency_ms,0)/baseline.length:null;
    report.cost_note='Latency, contract pass rate and provider-reported tokens are compared. No savings estimate: local infrastructure cost and provider prices must be measured separately.';
  }
  updateEfficiencyEvaluation(job.id, report);
  return report;
}
