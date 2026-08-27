import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-company-review-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
try {
  const { initDb, getDb } = await import('../src/db/schema.js');
  const { prepareCompanyReview, addReviewFeedback, addReviewOpinion, createImprovement, decideImprovement, getCompanyReview, setReviewStatus } = await import('../src/services/company-reviews.js');
  const { getActiveLearningPrompt, getAgentLearningWorkspace, overrideAgentLearningVersion, removeAgentLearningVersion } = await import('../src/services/agent-learning-rollout.js');
  initDb(); const db = getDb();
  db.prepare("INSERT OR IGNORE INTO platform_users (id,email,password_hash,name,role) VALUES ('owner-review','review@example.test','test','Review CEO','ceo')").run();
  db.prepare("INSERT OR IGNORE INTO platform_users (id,email,password_hash,name,role) VALUES ('owner-other','other@example.test','test','Other CEO','ceo')").run();
  db.prepare("UPDATE platform_users SET ceo_db_mode='shared' WHERE id='owner-review'").run();
  db.prepare("INSERT OR IGNORE INTO agents (id,name,role,is_coo,is_orchestrator) VALUES ('coo','COO','Chief Operating Officer',1,1)").run();
  db.prepare("INSERT OR IGNORE INTO agents (id,name,role,is_coo,is_orchestrator) VALUES ('market-watcher','Market Watcher','Market Analyst',0,0)").run();
  db.prepare("INSERT OR IGNORE INTO user_agents (user_id,agent_id,enabled) VALUES ('owner-review','coo',1)").run();
  db.prepare("INSERT OR IGNORE INTO user_agents (user_id,agent_id,enabled) VALUES ('owner-review','market-watcher',1)").run();
  db.prepare(`INSERT INTO agent_goal_runs (id,owner_user_id,agent_id,title,prompt,status,created_at,completed_at) VALUES
    ('goal-ok','owner-review','coo','Publish weekly brief','brief','completed',datetime('now'),datetime('now')),
    ('goal-fail','owner-review','coo','Research target accounts','research','failed',datetime('now'),datetime('now'))`).run();
  db.prepare(`INSERT INTO agent_goal_steps (id,goal_run_id,step_index,step_type,label,status,exception_retry_count,error_message,spec_json,result_json) VALUES
    ('step-ok','goal-ok',0,'agent_continue','Draft','completed',0,'','{"prompt":"Draft the weekly brief"}','{"artifact_id":"brief-1"}'),
    ('step-fail','goal-fail',0,'agent_tool','Search','failed',1,'External quota exhausted','{"tool_name":"web_search","api_key":"must-not-leak"}','{"partial_results":32}')`).run();
  db.prepare(`INSERT INTO kanban_tasks (title,status,assigned_agent_id,owner_user_id,goal_run_id,goal_step_id)
    VALUES ('Delegated market research','in_progress','market-watcher','owner-review','goal-fail','step-fail')`).run();
  const review = prepareCompanyReview({ ownerUserId: 'owner-review', cadence: 'weekly', preparedByAgentId: 'coo' });
  assert.equal(review.status, 'ready'); assert.equal(review.snapshot.summary.outcomes_total, 2); assert.equal(review.snapshot.summary.goals_completed, 1); assert.equal(review.snapshot.summary.needs_attention, 1);
  assert.match(review.snapshot.misses[0].input_summary, /web_search/); assert.doesNotMatch(review.snapshot.misses[0].input_summary, /must-not-leak/); assert.match(review.snapshot.misses[0].output_summary, /partial_results/); assert.match(review.snapshot.misses[0].agent_explanation, /External quota exhausted/);
  const contribution = review.snapshot.misses.find((item) => item.type === 'agent_contribution');
  assert.equal(contribution.agent_id, 'market-watcher'); assert.equal(contribution.orchestrator_id, 'coo'); assert.equal(contribution.attribution, 'kanban_assignment');
  assert.equal(review.snapshot.summary.outcomes_total, 2); assert.equal(review.snapshot.summary.agent_contributions, 1);
  const inSession = setReviewStatus('owner-review', review.id, 'in_session'); assert.equal(inSession.status, 'in_session');
  const withFeedback = addReviewFeedback({ ownerUserId: 'owner-review', reviewId: review.id, evidenceId: 'goal-fail', agentId: 'coo', rating: 'needs_improvement', feedback: 'Use an entitled fallback and preserve partial results.', scope: ['coo'] }); assert.equal(withFeedback.feedback.length, 1);
  const reviewDraft = 'Use an entitled fallback and preserve partial results.';
  const withCooOpinion = addReviewOpinion({ ownerUserId: 'owner-review', reviewId: review.id, evidenceId: 'goal-fail', actorRole: 'coo', agentId: 'coo', position: 'agree_with_revisions', content: 'Preserve partial results, but stop retrying quota failures.', subjectText: reviewDraft }); assert.equal(withCooOpinion.opinions[0].position, 'agree_with_revisions');
  addReviewOpinion({ ownerUserId: 'owner-review', reviewId: review.id, evidenceId: 'goal-fail', actorRole: 'agent', agentId: 'coo', position: 'acknowledge', content: 'I can stop retrying non-transient quota failures and retain partial evidence.', subjectText: reviewDraft });
  assert.throws(() => addReviewOpinion({ ownerUserId: 'owner-other', reviewId: review.id, evidenceId: 'goal-fail', actorRole: 'coo', agentId: 'coo', position: 'agree', content: 'Cross tenant attempt' }), /Review not found/);
  const withImprovement = createImprovement({ ownerUserId: 'owner-review', reviewId: review.id, title: 'Research fallback', proposedChange: reviewDraft, destination: 'agent_playbook', scope: ['coo'], evidence: [{ type: 'goal', id: 'goal-fail' }], successMetric: 'No repeated quota retries' }); assert.equal(withImprovement.improvements[0].status, 'draft');
  const approved = decideImprovement({ ownerUserId: 'owner-review', improvementId: withImprovement.improvements[0].id, decision: 'approve', userId: 'owner-review' }); assert.equal(approved.improvements[0].status, 'approved');
  assert.equal(approved.improvements[0].learning_versions[0].status, 'active');
  const activePrompt = getActiveLearningPrompt({ ownerUserId: 'owner-review', agentId: 'coo' }); assert.match(activePrompt.text, /Use an entitled fallback/); assert.equal(activePrompt.version_ids.length, 1);
  const second = createImprovement({ ownerUserId: 'owner-review', reviewId: review.id, title: 'Structured completion reports', proposedChange: 'Always report the exact final tool result and execution identifier.', scope: ['coo'] });
  const secondId = second.improvements.find((item) => item.title === 'Structured completion reports').id;
  const secondApproved = decideImprovement({ ownerUserId: 'owner-review', improvementId: secondId, decision: 'approve', userId: 'owner-review' });
  const multiPrompt = getActiveLearningPrompt({ ownerUserId: 'owner-review', agentId: 'coo', topic: 'report final tool result' });
  assert.match(multiPrompt.text, /Use an entitled fallback/); assert.match(multiPrompt.text, /Always report the exact final tool result/); assert.equal(multiPrompt.available_count, 2); assert.equal(multiPrompt.selected_count, 2);
  const secondVersion = secondApproved.improvements.find((item) => item.id === secondId).learning_versions[0];
  const overridden = overrideAgentLearningVersion({ ownerUserId: 'owner-review', agentId: 'coo', versionId: secondVersion.id, instruction: 'Report the exact final tool result, trace identifier, and terminal status.', userId: 'owner-review' });
  assert.match(overridden.active_playbooks.find((item) => item.improvement_id === secondId).instruction, /trace identifier/);
  const activeSecond = overridden.active_playbooks.find((item) => item.improvement_id === secondId);
  const removed = removeAgentLearningVersion({ ownerUserId: 'owner-review', agentId: 'coo', versionId: activeSecond.id, userId: 'owner-review' });
  assert.ok(!removed.active_playbooks.some((item) => item.id === activeSecond.id)); assert.ok(removed.version_history.some((item) => item.id === activeSecond.id && item.status === 'removed'));
  const rolledBack = decideImprovement({ ownerUserId: 'owner-review', improvementId: withImprovement.improvements[0].id, decision: 'rollback', userId: 'owner-review' }); assert.equal(rolledBack.improvements[0].status, 'rolled_back');
  assert.equal(rolledBack.improvements[0].learning_versions[0].status, 'rolled_back'); assert.equal(getActiveLearningPrompt({ ownerUserId: 'owner-review', agentId: 'coo' }).version_ids.length, 0);
  assert.throws(() => createImprovement({ ownerUserId: 'owner-review', reviewId: review.id, title: 'Silent identity rewrite', proposedChange: 'Change identity', destination: 'soul' }), /explicit identity-governance/);
  assert.throws(() => createImprovement({ ownerUserId: 'owner-review', reviewId: review.id, title: 'Vague', proposedChange: 'Runs ok' }), /specific, actionable/);
  const pending = createImprovement({ ownerUserId: 'owner-review', reviewId: review.id, title: 'Pending governed change', proposedChange: 'Always retain structured evidence before reporting completion.', scope: ['coo'] });
  assert.throws(() => setReviewStatus('owner-review', review.id, 'completed'), /Decide or refine every improvement/);
  decideImprovement({ ownerUserId: 'owner-review', improvementId: pending.improvements.find((item) => item.title === 'Pending governed change').id, decision: 'reject', userId: 'owner-review' });
  const completed = setReviewStatus('owner-review', review.id, 'completed'); assert.equal(completed.status, 'completed');
  assert.throws(() => setReviewStatus('owner-review', review.id, 'in_session'), /immutable/);
  assert.throws(() => addReviewFeedback({ ownerUserId: 'owner-review', reviewId: review.id, agentId: 'coo', feedback: 'This should remain locked.' }), /Completed reviews are locked/);
  console.log('company review lifecycle tests passed');
} finally {
  try { const { getDb } = await import('../src/db/schema.js'); getDb().close(); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
}
