/**
 * Company people (employees / sub-users) RBAC smoke.
 * Usage: node backend/scripts/test-org-people.js
 *
 * Creates a temporary CEO + two employees, then checks tenant inherit, department
 * agent filter, Kanban mutate, API permission map, and efficiency user rollup.
 * Cleans up rows it created. Does not require a running HTTP server.
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { hashPassword } from '../src/services/auth/password.js';
import {
  inviteOrgPerson,
  listOrgPeople,
  listOrgRoles,
  createOrgRole,
  setRolePermissions,
} from '../src/services/org-people.js';
import {
  ensureBuiltInRoles,
  filterAgentsForActor,
  hydrateOrgFields,
  matchApiPermission,
  resolveRootOwnerUserId,
  hasPermission,
  isTenantFullAccess,
} from '../src/services/org-permissions.js';
import { canMutateKanbanTask } from '../src/services/kanban-user-scope.js';
import { getDepartmentEfficiency } from '../src/services/department-efficiency.js';
import { getUsersEfficiencySummary } from '../src/services/user-efficiency.js';

initDb();
const db = getDb();

const stamp = Date.now().toString(36);
const ownerId = `ceo-people-t-${stamp}`;
const ownerEmail = `people-ceo-${stamp}@example.test`;
const memberEmail = `people-mem-${stamp}@example.test`;
const otherEmail = `people-fin-${stamp}@example.test`;

let failed = 0;
let passed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else {
    passed += 1;
    console.log('OK:', msg);
  }
}

function cleanup() {
  try {
    db.prepare('DELETE FROM kanban_tasks WHERE owner_user_id = ?').run(ownerId);
  } catch {
    /* ignore */
  }
  const people = db
    .prepare(`SELECT id FROM platform_users WHERE owner_user_id = ? AND role = 'org_user'`)
    .all(ownerId);
  const roleIds = db.prepare('SELECT id FROM org_roles WHERE owner_user_id = ?').all(ownerId).map((r) => r.id);
  for (const rid of roleIds) {
    db.prepare('DELETE FROM org_role_permissions WHERE role_id = ?').run(rid);
  }
  db.prepare('DELETE FROM org_roles WHERE owner_user_id = ?').run(ownerId);
  for (const p of people) {
    try {
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(p.id);
    } catch {
      /* table may not exist */
    }
    try {
      db.prepare('DELETE FROM platform_sessions WHERE user_id = ?').run(p.id);
    } catch {
      /* ignore */
    }
    db.prepare('DELETE FROM platform_users WHERE id = ?').run(p.id);
  }
  db.prepare('DELETE FROM user_agents WHERE user_id = ?').run(ownerId);
  db.prepare('DELETE FROM platform_users WHERE id = ?').run(ownerId);
}

try {
  db.prepare(
    `INSERT INTO platform_users (id, email, password_hash, name, role, enabled)
     VALUES (?, ?, ?, 'People Test CEO', 'ceo', 1)`
  ).run(ownerId, ownerEmail, hashPassword(`Tmp!${stamp}`));

  const builtins = ensureBuiltInRoles(ownerId);
  assert(!!builtins.delegate && !!builtins.member, 'built-in CEO Delegate and Member roles');

  const invited = await inviteOrgPerson(
    ownerId,
    {
      name: 'Research Member',
      email: memberEmail,
      mobile: '+10000000001',
      department: 'Research',
      org_role_id: builtins.member,
    },
    { invitedBy: ownerId }
  );
  assert(!!invited?.person?.id, 'invite returns person');
  assert(invited.person.role === 'org_user', 'invited role is org_user');
  assert(invited.person.owner_user_id === ownerId, 'employee tagged to CEO root');
  assert(invited.person.department === 'Research', 'invite stores department');

  const grants = db.prepare('SELECT COUNT(*) AS n FROM user_agents WHERE user_id = ?').get(invited.person.id);
  assert((grants?.n || 0) === 0, 'employee has no user_agents grants (inherits CEO entitlements)');

  const other = await inviteOrgPerson(
    ownerId,
    {
      name: 'Finance Member',
      email: otherEmail,
      department: 'Finance',
      org_role_id: builtins.member,
    },
    { invitedBy: ownerId }
  );

  const people = listOrgPeople(ownerId);
  assert(people.length >= 2, `list people n=${people.length}`);

  const memberRow = db.prepare('SELECT * FROM platform_users WHERE id = ?').get(invited.person.id);
  const member = hydrateOrgFields({ id: memberRow.id, role: memberRow.role, email: memberRow.email, name: memberRow.name }, memberRow);
  assert(resolveRootOwnerUserId(member) === ownerId, 'resolveRootOwnerUserId → CEO');
  assert(isTenantFullAccess(member) === false, 'Member is not tenant-full-access');
  assert(hasPermission(member, 'home') === true, 'Member always-on Home');
  assert(hasPermission(member, 'kanban') === true, 'Member always-on Kanban');
  assert(hasPermission(member, 'org') === false, 'Member default has no My Org');
  assert(hasPermission(member, 'people.manage') === false, 'Member cannot manage people');

  const custom = createOrgRole(ownerId, { name: `Ops ${stamp}`, permissions: ['org', 'efficiency', 'people.manage', 'crm'] });
  assert(custom.permissions.includes('org'), 'custom role can include org');
  assert(custom.permissions.includes('crm'), 'custom role can include crm access');
  assert(!custom.permissions.includes('people.manage'), 'custom role cannot include people.manage');

  const roles = listOrgRoles(ownerId);
  const memberRole = roles.find((r) => r.slug === 'member');
  setRolePermissions(ownerId, memberRole.id, ['efficiency', 'crm']);
  const memberAfter = hydrateOrgFields({ id: memberRow.id, role: 'org_user' }, {
    ...memberRow,
    org_role_id: memberRole.id,
  });
  assert(hasPermission(memberAfter, 'efficiency') === true, 'Member can receive efficiency permission');
  assert(hasPermission(memberAfter, 'crm') === true, 'Member can receive CRM access permission');

  const agents = [
    { id: 'coo-mock', is_coo: 1, department: 'Executive' },
    { id: 'research-mock', department: 'Research' },
    { id: 'finance-mock', department: 'Finance' },
  ];
  const filtered = filterAgentsForActor(member, agents);
  const filteredIds = filtered.map((a) => a.id).sort();
  assert(filteredIds.includes('coo-mock'), 'department employee can chat with COO');
  assert(filteredIds.includes('research-mock'), 'department employee can chat with same-dept AI employee');
  assert(!filteredIds.includes('finance-mock'), 'department employee cannot chat with other-dept AI employee');

  const ceoActor = { id: ownerId, role: 'ceo' };
  assert(filterAgentsForActor(ceoActor, agents).length === 3, 'CEO sees full roster');

  db.prepare(
    `INSERT INTO kanban_tasks (title, status, assigned_agent_id, assigned_user_id, created_by, owner_user_id)
     VALUES (?, 'open', NULL, ?, 'coo', ?)`
  ).run(`People task ${stamp}`, invited.person.id, ownerId);
  const humanTask = db.prepare('SELECT * FROM kanban_tasks WHERE owner_user_id = ? ORDER BY id DESC LIMIT 1').get(ownerId);

  db.prepare(
    `INSERT INTO kanban_tasks (title, status, assigned_agent_id, assigned_user_id, created_by, owner_user_id)
     VALUES (?, 'open', NULL, ?, 'coo', ?)`
  ).run(`Finance task ${stamp}`, other.person.id, ownerId);
  const otherTask = db.prepare('SELECT * FROM kanban_tasks WHERE owner_user_id = ? ORDER BY id DESC LIMIT 1').get(ownerId);

  db.prepare(
    `INSERT INTO kanban_tasks (title, status, assigned_agent_id, assigned_user_id, created_by, owner_user_id)
     VALUES (?, 'open', NULL, NULL, 'user', ?)`
  ).run(`Unassigned ${stamp}`, ownerId);
  const unassigned = db.prepare('SELECT * FROM kanban_tasks WHERE owner_user_id = ? ORDER BY id DESC LIMIT 1').get(ownerId);

  assert(canMutateKanbanTask(humanTask, member) === true, 'member can mutate same-dept (self) card');
  assert(canMutateKanbanTask(otherTask, member) === false, 'member cannot mutate other-dept card');
  assert(canMutateKanbanTask(unassigned, member) === false, 'member cannot mutate unassigned card');
  assert(canMutateKanbanTask(otherTask, ceoActor) === true, 'CEO can mutate any company card');

  assert(matchApiPermission('GET', '/kanban/tasks') === true, 'kanban always allowed');
  assert(matchApiPermission('GET', '/efficiency/users') === 'efficiency', 'efficiency users requires permission');
  assert(matchApiPermission('POST', '/org-people') === 'people.manage', 'invite requires people.manage');
  assert(matchApiPermission('GET', '/business-core/embed/crm') === 'crm', 'CRM embed maps to crm');
  assert(matchApiPermission('GET', '/business-core/embed/erp') === 'erp', 'ERP embed maps to erp');
  assert(matchApiPermission('POST', '/company-setup') === '__full__', 'company setup is CEO/delegate');
  assert(matchApiPermission('GET', '/admin/users') === false, 'admin denied for org_user');

  const dept = getDepartmentEfficiency(ownerId);
  assert(Array.isArray(dept.departments), 'department efficiency returns departments');
  const research = dept.departments.find((d) => String(d.name).toLowerCase() === 'research');
  if (research) {
    assert((research.people_count || 0) >= 1, 'Research department includes people');
    assert(research.tasks && typeof research.tasks.assigned === 'number', 'department tasks.assigned present');
  } else {
    console.log('skip Research department people check (no Master Data Research row)');
  }

  const users = getUsersEfficiencySummary(ownerId);
  assert(Array.isArray(users.users), 'user efficiency list');
  assert(users.users.some((u) => u.user_id === invited.person.id), 'invited employee in User View');
  const row = users.users.find((u) => u.user_id === invited.person.id);
  assert((row?.assigned || 0) >= 1, 'employee assigned count includes inserted card');
} finally {
  cleanup();
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
