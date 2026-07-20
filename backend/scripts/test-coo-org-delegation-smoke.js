#!/usr/bin/env node
import { initDb, getDb } from '../src/db/schema.js';
import { buildOrgContextForCeo } from '../src/services/org-context.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { getAgentToolGrants } from '../src/services/openclaw-agent-tools.js';
import { scheduleCeoRequestViaOpenClawCron } from '../src/services/delegation-queue.js';

initDb();
const db = getDb();
const owner = getBalaCeoAuthId();

const cols = db.prepare('PRAGMA table_info(standups)').all().map((c) => c.name);
console.log('standups owner_user_id column:', cols.includes('owner_user_id'));

const ctx = buildOrgContextForCeo(owner);
console.log('org ceo:', ctx.ceo.name, 'agents:', ctx.agents.length, 'delegatees:', ctx.delegatees.length);
console.log('delegatees:', ctx.delegatees.map((a) => a.id).join(', '));

const grants = getAgentToolGrants('balserve');
console.log('COO intent_classify_and_delegate:', grants.includes('intent_classify_and_delegate'));
console.log('COO kanban_assign_task:', grants.includes('kanban_assign_task'));

db.prepare(
  "INSERT INTO standups (scheduled_at, status, source, owner_user_id) VALUES (datetime('now'), 'scheduled', 'test', ?)"
).run(owner);
const sid = db.prepare('SELECT id FROM standups ORDER BY id DESC LIMIT 1').get().id;
const msg = 'Create an indian thali recipe with image';
const result = await scheduleCeoRequestViaOpenClawCron(sid, msg, owner);
console.log('delegation standup', sid, 'count', result.count, 'agents', result.agentNames.join(', '));
if (result.count === 0) {
  console.error('FAIL: no agents delegated');
  process.exit(1);
}
console.log('PASS');
