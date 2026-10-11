/** Explicit live acceptance: synthetic users/prompts only; never changes platform policy or existing companies. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

if (process.env.EFFICIENCY_LIVE_ACCEPTANCE !== '1') {
  throw new Error('Set EFFICIENCY_LIVE_ACCEPTANCE=1 explicitly on the VPS to run live acceptance.');
}
const base = process.env.EFFICIENCY_ACCEPTANCE_URL || 'https://login.flolah.cloud';
if (!['https://login.flolah.cloud', 'http://127.0.0.1:3001'].includes(base)) throw new Error('Unsupported acceptance origin');
const { getDb } = await import('../src/db/schema.js');
const { createSession } = await import('../src/services/auth/session.js');
const { chatCompletions } = await import('../src/config/llm.js');
const { getEfficiencyPolicy, ensureEfficiencyControlTables, localEfficiencyModel } = await import('../src/services/efficiency-control-plane.js');
const { runWithLlmopsContext } = await import('../src/services/llmops-context.js');
const db = getDb();
ensureEfficiencyControlTables();
if (process.argv.includes('--warm-local') || process.argv.includes('--cpu-diagnostic')) {
  // Diagnostic only: no company data or fallback. Does not change persisted policy or model settings.
  const endpoint = localEfficiencyModel('ollama-efficiency');
  const started = Date.now();
  try {
    const cpuDiagnostic = process.argv.includes('--cpu-diagnostic');
    const response = await fetch(cpuDiagnostic ? new URL('/api/chat', endpoint.baseUrl) : endpoint.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(120000), headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cpuDiagnostic ? { model: endpoint.model, stream: false, format: 'json',
        messages: [{ role: 'user', content: 'Return only JSON with key query containing "2026 AI regulation".' }],
        options: { num_thread: 2, num_predict: 100, temperature: 0 } }
        : { model: endpoint.model, messages: [{ role: 'user', content: 'Say READY.' }], max_tokens: 8, temperature: 0 }),
    });
    checkWarmResponse(response.ok);
    const result = await response.json();
    console.log(JSON.stringify({ stage: cpuDiagnostic ? 'cpu_thread_diagnostic' : 'cold_load_diagnostic', model: result.model, latency_ms: Date.now() - started,
      output_present: !!(result.message?.content || result.choices?.[0]?.message?.content), finish_reason: result.done_reason || result.choices?.[0]?.finish_reason,
      tokens: result.eval_count, tokens_per_second: result.eval_duration ? result.eval_count / (result.eval_duration / 1e9) : undefined }));
  } finally { db.close(); }
  process.exit(0);
}
function checkWarmResponse(ok) { if (!ok) throw new Error('Local cold-load diagnostic failed'); }
const suffix = randomUUID();
const ids = Object.fromEntries(['admin', 'a', 'b', 'employee'].map(key => [key, `efficiency-acceptance-${key}-${suffix}`]));
const tokens = {};
const policyBefore = JSON.stringify(getEfficiencyPolicy());
let jobId = null, jobCompleted = false, checks = 0;
const check = (ok, message) => { assert.ok(ok, message); checks++; };
async function call(path, user, method = 'GET', body) {
  const response = await fetch(base + path, { method, signal: AbortSignal.timeout(20000),
    headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${tokens[user]}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
}
try {
  db.transaction(() => {
    for (const [key, id] of Object.entries(ids)) {
      db.prepare('INSERT INTO platform_users(id,email,password_hash,name,role,enabled,llm_efficiency_mode) VALUES (?,?,?,?,?,1,?)')
        .run(id, `${id}@fixture.invalid`, 'no-login-live-acceptance', 'Efficiency acceptance fixture',
          key === 'admin' ? 'admin' : key === 'employee' ? 'org_user' : 'ceo', key === 'a' || key === 'b' ? 1 : 0);
      tokens[key] = createSession(id).token;
    }
  })();
  check((await call('/api/admin/models/efficiency')).status === 401, 'Unauthenticated Admin request rejected');
  check((await call('/api/admin/models/efficiency', 'a')).status === 403, 'CEO cannot access Admin control plane');
  check((await call('/api/efficiency/local-models', 'employee')).status === 403, 'Employee cannot access company control plane');
  const admin = await call('/api/admin/models/efficiency', 'admin');
  check(admin.status === 200 && admin.data.policy.workloads.length === 10, 'Live Admin API and exact ten-workload policy');
  check((await call('/api/admin/models/efficiency/policy', 'admin', 'PUT', { workloads: ['agent_turn_router'] })).status === 400, 'Protected router cannot join efficiency policy');
  check((await call('/api/admin/models/efficiency/policy', 'a', 'PUT', { enabled: false })).status === 403, 'CEO cannot change Admin policy');
  const bBefore = (await call('/api/efficiency/local-models', 'b')).data.preferences;
  const saved = await call('/api/efficiency/local-models/preferences', 'a', 'PUT', { fallback_mode: 'local_only', ceo_user_id: ids.b });
  check(saved.status === 200 && !saved.data.preferences.effective_cloud_fallback, 'Fixture CEO local-only preference saved');
  check(JSON.stringify((await call('/api/efficiency/local-models', 'b')).data.preferences) === JSON.stringify(bBefore), 'Owner spoofing cannot change company B');
  check((await call('/api/efficiency/local-models/preferences', 'a', 'PUT', { max_concurrency: 10 })).status === 400, 'CEO cannot edit platform capacity');

  const trace = `efficiency-live-${suffix}`;
  const inference = await runWithLlmopsContext({ ownerUserId: ids.a, memberKey: 'acceptance', sessionId: trace, clientTurnId: trace }, () => chatCompletions({
    toolName: 'goal_plan_tool_args', source: 'efficiency_live_acceptance', responseFormat: 'json_object',
    messages: [{ role: 'user', content: 'Return only JSON with key query containing "2026 AI regulation". No tools or actions.' }], maxTokens: 100, temperature: 0,
  }));
  check(inference.localModel && !inference.efficiency.fallback, 'Real inference succeeds locally without hosted fallback');
  check(typeof JSON.parse(inference.content).query === 'string', 'Real local JSON contract is valid');
  const own = await call(`/api/efficiency/local-models?trace_id=${trace}`, 'a');
  check(own.status === 200 && own.data.report.events.length === 1 && own.data.report.events[0].status === 'success', 'Live report contains correlated successful inference');
  check(own.data.report.events[0].actual_model === inference.actualModel && own.data.report.events[0].member_key === 'acceptance', 'Actual model and agent correlation are persisted');
  const other = await call(`/api/efficiency/local-models?ceo_user_id=${ids.a}&trace_id=${trace}`, 'b');
  check(other.status === 200 && other.data.report.events.length === 0, 'Cross-company evidence remains inaccessible');
  check(!JSON.stringify(own.data).includes(tokens.a) && !JSON.stringify(own.data).includes(ids.a), 'Report contains no credentials or owner IDs');
  console.log(JSON.stringify({ stage: 'live_api_and_inference', checks, actual_model: inference.actualModel, latency_ms: inference.efficiency.latencyMs, public_origin: base }));

  check(!admin.data.evaluations.some(e => e.status === 'running'), 'No existing evaluation is in progress');
  const started = await call('/api/admin/models/efficiency/evaluations', 'admin', 'POST', { model_id: 'ollama-efficiency', compare_hosted: false });
  check(started.status === 202 && started.data.id, 'Live Admin evaluation starts asynchronously');
  jobId = started.data.id;
  const deadline = Date.now() + admin.data.policy.local_timeout_ms * 10 + 90000;
  let report;
  while (Date.now() < deadline) {
    const state = await call('/api/admin/models/efficiency', 'admin');
    check(state.status === 200, 'Live evaluation polling remains authenticated');
    report = state.data.evaluations.find(e => e.id === jobId);
    if (report?.status === 'completed') { jobCompleted = true; break; }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  check(jobCompleted && report.total_count === 10, 'All ten real local evaluation cases finish');
  check(report.cases.every(c => !c.actual_model || !/flolah-platform/.test(c.actual_model)), 'Evaluation never falls back to hosted aliases');
  console.log(JSON.stringify({ stage: 'real_local_evaluation', model: report.model, passed: report.passed, passed_count: report.passed_count,
    total_count: report.total_count, average_latency_ms: report.average_latency_ms, cases: report.cases, approved: report.approved }));
  if (!report.passed) check((await call(`/api/admin/models/efficiency/evaluations/${jobId}/approve`, 'admin', 'POST', {})).status === 400, 'Failed live evaluation cannot be approved');
  check(JSON.stringify(getEfficiencyPolicy()) === policyBefore, 'Platform policy remains unchanged');
  console.log(`EFFICIENCY_LIVE_ACCEPTANCE_OK ${checks} checks; model quality pass rate reported separately; no trading actions.`);
} finally {
  // Exact fixture ownership only. Never restore a DB backup over ongoing company writes.
  db.transaction(() => {
    for (const id of Object.values(ids)) {
      for (const [table, field] of [['efficiency_calls', 'owner_user_id'], ['efficiency_preferences', 'owner_user_id'], ['token_usage', 'owner_user_id'], ['model_route_events', 'owner_user_id'], ['platform_sessions', 'user_id']]) {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) db.prepare(`DELETE FROM ${table} WHERE ${field}=?`).run(id);
      }
      db.prepare('DELETE FROM platform_users WHERE id=?').run(id);
    }
    if (jobId && jobCompleted) db.prepare('DELETE FROM efficiency_evaluations WHERE id=? AND approved=0').run(jobId);
  })();
  console.log('Exact live acceptance users, sessions, preferences and telemetry removed; platform policy and existing companies untouched.');
  db.close();
}
