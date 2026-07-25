/**
 * Probe learnings feedback + cache for a CEO (VPS/local).
 * Usage: node scripts/probe-learnings-feedback.js [ownerUserId] [agentId]
 */
import { initDb, getDb } from '../src/db/schema.js';
import {
  listFeedback,
  listKanbanLearningActions,
  summarizeLearnings,
} from '../src/services/agent-feedback.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { usesTenantCeoDb } from '../src/db/ceo-db-config.js';
import { getCeoDb } from '../src/db/ceo-db.js';

initDb();
const owner = process.argv[2] || getBalaCeoAuthId();
const agentId = process.argv[3] || 'balserve';

const db = usesTenantCeoDb(owner) ? getCeoDb(owner) : getDb();

console.log('owner', owner, 'agent', agentId, 'tenant', usesTenantCeoDb(owner));

const recent = db
  .prepare(
    `SELECT id, agent_id, rating, substr(comment,1,200) AS comment, substr(message_content,1,120) AS msg, created_at
     FROM agent_response_feedback
     WHERE owner_user_id = ?
     ORDER BY created_at DESC LIMIT 15`
  )
  .all(owner);
console.log('recent_feedback_all_agents', recent.length);
for (const r of recent) console.log(JSON.stringify(r));

const forCoo = listFeedback({ ownerUserId: owner, agentId, days: 30, limit: 20 });
console.log('listFeedback_coo_30d', forCoo.length);
for (const r of forCoo.slice(0, 8)) {
  console.log(
    JSON.stringify({
      id: r.id,
      rating: r.rating,
      comment: String(r.comment || '').slice(0, 160),
      created_at: r.created_at,
    })
  );
}

const anyMaster = recent.filter((r) =>
  /master.?data|rag|guess/i.test(`${r.comment || ''} ${r.msg || ''}`)
);
console.log('master_data_related_hits', anyMaster.length, anyMaster.map((r) => r.id));

try {
  const cache = db
    .prepare(
      `SELECT agent_id, valid_date, last_feedback_id, feedback_count, substr(summary,1,300) AS summary_head, base_generated_at, updated_at
       FROM agent_learnings_cache WHERE owner_user_id = ?`
    )
    .all(owner);
  console.log('learnings_cache_rows', cache.length);
  for (const c of cache) console.log(JSON.stringify(c));
} catch (e) {
  console.log('cache_table_err', e.message);
}

const out = await summarizeLearnings({
  ownerUserId: owner,
  agentId,
  topic: 'Flolah platform performance',
  days: 30,
});
console.log('summarize', {
  mode: out.mode,
  cached: out.cached,
  feedback_count: out.feedback_count,
  sample_comments: (out.feedback_sample || []).map((f) => ({
    id: f.id,
    rating: f.rating,
    comment: String(f.comment || '').slice(0, 120),
  })),
  summary_has_master_data: /master.?data|rag|guess/i.test(out.summary || ''),
  summary_head: String(out.summary || '').slice(0, 400),
});
