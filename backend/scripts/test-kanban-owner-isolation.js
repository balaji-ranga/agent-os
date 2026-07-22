/**
 * Unit-style checks for Kanban multi-tenant isolation.
 * Usage: node scripts/test-kanban-owner-isolation.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import {
  kanbanTaskBelongsToUser,
  filterKanbanTasksForUser,
  resolveKanbanTaskOwnerId,
  extractOwnerUserIdFromKanbanText,
} from '../src/services/kanban-user-scope.js';

initDb();
const db = getDb();

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Soft-filter must NOT treat shared agent assignment as ownership
const sharedAgentTask = {
  id: 1,
  title: 'biryani recipe',
  description: '',
  assigned_agent_id: 'techresearcher',
  created_by: 'coo',
  owner_user_id: 'ceo-user-a',
};
const userA = { id: 'ceo-user-a', role: 'ceo' };
const userB = { id: 'ceo-user-b', role: 'ceo' };

assert(kanbanTaskBelongsToUser(sharedAgentTask, userA) === true, 'owner A should see own task');
assert(kanbanTaskBelongsToUser(sharedAgentTask, userB) === false, 'owner B must NOT see A task via shared agent');

const unownedLegacy = {
  id: 2,
  title: 'standup leak',
  description: '',
  assigned_agent_id: 'techresearcher',
  created_by: 'coo',
  owner_user_id: null,
};
assert(kanbanTaskBelongsToUser(unownedLegacy, userA) === false, 'NULL owner must be hidden');
assert(kanbanTaskBelongsToUser(unownedLegacy, userB) === false, 'NULL owner must be hidden from all CEOs');

const userCreatedGlobal = {
  id: 3,
  title: 'manual',
  description: '',
  assigned_agent_id: null,
  created_by: 'user',
  owner_user_id: null,
};
assert(kanbanTaskBelongsToUser(userCreatedGlobal, userA) === false, 'created_by=user without owner must NOT be world-readable');

const tagged = {
  id: 4,
  title: 'tagged',
  description: 'owner_user_id: ceo-user-b\nhello',
  assigned_agent_id: 'balserve',
  created_by: 'agent_workflow',
  owner_user_id: null,
};
assert(extractOwnerUserIdFromKanbanText(tagged.description) === 'ceo-user-b', 'extract owner from description');
assert(resolveKanbanTaskOwnerId(tagged) === 'ceo-user-b', 'resolve from description when column null');
assert(kanbanTaskBelongsToUser(tagged, userB) === true, 'B sees tagged task');
assert(kanbanTaskBelongsToUser(tagged, userA) === false, 'A does not see B tagged task');

const filtered = filterKanbanTasksForUser([sharedAgentTask, unownedLegacy, tagged], userA);
assert(filtered.length === 1 && filtered[0].id === 1, 'filter keeps only A tasks');

// Schema column exists after initDb
const cols = db.prepare(`PRAGMA table_info(kanban_tasks)`).all().map((c) => c.name);
assert(cols.includes('owner_user_id'), 'kanban_tasks.owner_user_id column must exist');

console.log('OK: Kanban owner isolation checks passed');
