import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';

const dir = mkdtempSync(join(tmpdir(), 'flolah-objectives-api-'));
process.env.AGENT_OS_DATA_DIR = dir;
const { initDb, getDb } = await import('../src/db/schema.js');
initDb();
const { default: router } = await import('../src/routes/company-objectives.js');
const app = express(); app.use(express.json());
app.use('/unauth', router);
app.use('/api/company-objectives', (req, _res, next) => { req.authUser = { id: 'ceo-api-test', role: 'ceo', name: 'API CEO' }; req.user = req.authUser; next(); }, router);
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const request = async (path, options = {}) => { const response = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } }); const body = await response.json(); return { response, body }; };

try {
  assert.equal((await request('/unauth')).response.status, 401);
  const registry = await request('/api/company-objectives/measurement-registry'); assert.equal(registry.response.status, 200); assert.ok(registry.body.sources.length >= 10); assert.equal(registry.body.scope, 'company'); assert.equal(registry.body.owner_user_id, 'ceo-api-test'); assert.equal(registry.body.sources.find((source) => source.id === 'goal_plans').availability, 'available');
  const idea = await request('/api/company-objectives/ideate', { method: 'POST', body: JSON.stringify({ use_llm: false, outcome: 'Generate S$100k qualified pipeline without unapproved sends', period_type: 'quarterly', period_label: 'Q4 2026', starts_on: '2026-10-01', ends_on: '2026-12-31' }) });
  assert.equal(idea.response.status, 200); assert.equal(idea.body.proposal.authority.external_communications, 'approval_required');
  const created = await request('/api/company-objectives', { method: 'POST', body: JSON.stringify({ ...idea.body.proposal, period_type: idea.body.proposal.periodType, period_label: idea.body.proposal.periodLabel, starts_on: idea.body.proposal.startsOn, ends_on: idea.body.proposal.endsOn, status: 'active' }) });
  assert.equal(created.response.status, 201); const objective = created.body.objective; assert.ok(objective.id.startsWith('obj-'));
  assert.equal(objective.initiatives[0].scheduled_goals.length, 1);
  assert.equal(objective.initiatives[0].status, 'active');
  const operating = await request(`/api/company-objectives/${objective.id}/operating-model`, { method: 'POST', body: '{}' });
  assert.equal(operating.response.status, 200); assert.equal(operating.body.objective.execution_summary.scheduled_goals, 1, 'operating model is idempotent');
  assert.equal((await request('/api/company-objectives?limit=1&offset=0')).body.total, 1);
  const evidence = await request(`/api/company-objectives/${objective.id}/revenue-evidence`, { method: 'POST', body: JSON.stringify({ record_type: 'opportunity', external_id: 'api-opp-1', status: 'qualified', amount: 50000, probability: 0.5, evidence: ['crm:api-opp-1'] }) });
  assert.equal(evidence.body.objective.revenue.weighted_pipeline, 25000);
  const blockedSend = await request(`/api/company-objectives/${objective.id}/revenue-evidence`, { method: 'POST', body: JSON.stringify({ record_type: 'send', external_id: 'blocked-send', status: 'sent', channel: 'email', recipient: 'buyer@example.test', content_hash: 'copy-v1' }) });
  assert.equal(blockedSend.response.status, 403);
  const approval = await request(`/api/company-objectives/${objective.id}/approvals`, { method: 'POST', body: JSON.stringify({ channel: 'email', content_hash: 'copy-v1', recipients: ['buyer@example.test'], max_uses: 1 }) });
  assert.equal(approval.response.status, 201); assert.equal(approval.body.approval.status, 'pending');
  const decided = await request(`/api/company-objectives/${objective.id}/approvals/${approval.body.approval.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) });
  assert.equal(decided.body.approval.status, 'approved');
  const allowedSend = await request(`/api/company-objectives/${objective.id}/revenue-evidence`, { method: 'POST', body: JSON.stringify({ record_type: 'send', external_id: 'allowed-send', status: 'sent', channel: 'email', recipient: 'buyer@example.test', content_hash: 'copy-v1', approval_id: approval.body.approval.id }) });
  assert.equal(allowedSend.response.status, 201); assert.equal(allowedSend.body.objective.revenue.approved_sends, 1);
  const evidencePage = await request(`/api/company-objectives/${objective.id}/revenue-evidence?limit=1&offset=0`); assert.equal(evidencePage.body.evidence.length, 1); assert.equal(evidencePage.body.has_more, true);
  const digest = await request('/api/company-objectives/digest'); assert.equal(digest.body.summary.active, 1); assert.equal(digest.body.summary.weighted_pipeline, 25000);
  const updated = await request(`/api/company-objectives/${objective.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'paused', reason: 'API test' }) });
  assert.equal(updated.body.objective.status, 'paused'); assert.equal(updated.body.objective.version, 2);
  const versions = await request(`/api/company-objectives/${objective.id}/versions`); assert.equal(versions.body.versions.length, 2);
  const demo = await request('/api/company-objectives/demo/northstar', { method: 'POST', body: '{}' }); assert.equal(demo.response.status, 201); assert.equal(demo.body.objectives.length, 4);
  console.log('company objectives API: PASS (auth, ideation, CRUD, pagination, evidence, digest, versions, demo)');
} finally {
  await new Promise((resolve) => server.close(resolve));
  getDb().close(); rmSync(dir, { recursive: true, force: true });
}
