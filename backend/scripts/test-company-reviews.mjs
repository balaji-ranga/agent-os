import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-company-review-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
try {
  const { initDb, getDb } = await import('../src/db/schema.js');
  const { prepareCompanyReview, addReviewFeedback, createImprovement, decideImprovement, setReviewStatus } = await import('../src/services/company-reviews.js');
  initDb(); const db = getDb();
  db.prepare("INSERT OR IGNORE INTO platform_users (id,email,password_hash,name,role) VALUES ('owner-review','review@example.test','test','Review CEO','ceo')").run();
  db.prepare("UPDATE platform_users SET ceo_db_mode='shared' WHERE id='owner-review'").run();
  db.prepare("INSERT OR IGNORE INTO agents (id,name,role,is_coo,is_orchestrator) VALUES ('coo','COO','Chief Operating Officer',1,1)").run();
  db.prepare("INSERT OR IGNORE INTO user_agents (user_id,agent_id,enabled) VALUES ('owner-review','coo',1)").run();
  db.prepare(`INSERT INTO agent_goal_runs (id,owner_user_id,agent_id,title,prompt,status,created_at,completed_at) VALUES
    ('goal-ok','owner-review','coo','Publish weekly brief','brief','completed',datetime('now'),datetime('now')),
    ('goal-fail','owner-review','coo','Research target accounts','research','failed',datetime('now'),datetime('now'))`).run();
  db.prepare(`INSERT INTO agent_goal_steps (id,goal_run_id,step_index,step_type,label,status,exception_retry_count,error_message) VALUES
    ('step-ok','goal-ok',0,'agent_continue','Draft','completed',0,''),
    ('step-fail','goal-fail',0,'agent_tool','Search','failed',1,'External quota exhausted')`).run();
  const review = prepareCompanyReview({ ownerUserId: 'owner-review', cadence: 'weekly', preparedByAgentId: 'coo' });
  assert.equal(review.status, 'ready'); assert.equal(review.snapshot.summary.outcomes_total, 2); assert.equal(review.snapshot.summary.goals_completed, 1); assert.equal(review.snapshot.summary.needs_attention, 1);
  const inSession = setReviewStatus('owner-review', review.id, 'in_session'); assert.equal(inSession.status, 'in_session');
  const withFeedback = addReviewFeedback({ ownerUserId: 'owner-review', reviewId: review.id, evidenceId: 'goal-fail', agentId: 'coo', rating: 'needs_improvement', feedback: 'Use an entitled fallback and preserve partial results.', scope: ['coo'] }); assert.equal(withFeedback.feedback.length, 1);
  const withImprovement = createImprovement({ ownerUserId: 'owner-review', reviewId: review.id, title: 'Research fallback', proposedChange: 'Use an entitled fallback and preserve partial results.', destination: 'agent_playbook', scope: ['coo'], evidence: [{ type: 'goal', id: 'goal-fail' }], successMetric: 'No repeated quota retries' }); assert.equal(withImprovement.improvements[0].status, 'draft');
  const approved = decideImprovement({ ownerUserId: 'owner-review', improvementId: withImprovement.improvements[0].id, decision: 'approve', userId: 'owner-review' }); assert.equal(approved.improvements[0].status, 'approved');
  assert.equal(db.prepare("SELECT COUNT(*) count FROM agent_response_feedback WHERE owner_user_id='owner-review' AND agent_id='coo'").get().count, 1);
  const rolledBack = decideImprovement({ ownerUserId: 'owner-review', improvementId: withImprovement.improvements[0].id, decision: 'rollback', userId: 'owner-review' }); assert.equal(rolledBack.improvements[0].status, 'rolled_back');
  assert.equal(db.prepare("SELECT COUNT(*) count FROM agent_response_feedback WHERE owner_user_id='owner-review' AND agent_id='coo'").get().count, 0);
  assert.throws(() => createImprovement({ ownerUserId: 'owner-review', reviewId: review.id, title: 'Silent identity rewrite', proposedChange: 'Change identity', destination: 'soul' }), /explicit identity-governance/);
  console.log('company review lifecycle tests passed');
} finally {
  try { const { getDb } = await import('../src/db/schema.js'); getDb().close(); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
}
