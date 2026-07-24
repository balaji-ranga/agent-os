/**
 * Smoke-test platform agent workspace templates (Balaji / ceo-bala).
 * Usage: node scripts/vps-test-workspace-templates.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import {
  seedPlatformStandardWorkspaceTemplate,
  PLATFORM_STANDARD_TEMPLATE_ID,
  listPublishedTemplates,
  applyTemplateToAgentWorkspace,
  publishAgentWorkspaceAsTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../src/services/platform-agent-workspace-templates.js';
import * as workspace from '../src/workspace/adapter.js';

initDb();
const db = getDb();
seedPlatformStandardWorkspaceTemplate();

const CEO =
  db.prepare(`SELECT id, name FROM platform_users WHERE id = 'ceo-bala'`).get() ||
  db.prepare(`SELECT id, name FROM platform_users WHERE name = ?`).get('Balaji Ranganathan');
if (!CEO) throw new Error('ceo-bala not found');

const admin = db.prepare(`SELECT id, name, role FROM platform_users WHERE role = 'admin' LIMIT 1`).get();
const token = createSession(CEO.id).token;
const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');

let failed = 0;
function ok(cond, msg, extra) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg, extra ?? '');
  } else console.log('OK', msg);
}

async function api(method, path, body, hdr = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...hdr,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const published = listPublishedTemplates();
ok(published.some((t) => t.id === PLATFORM_STANDARD_TEMPLATE_ID), 'platform-standard in published list');

const agent =
  db.prepare(`SELECT * FROM agents WHERE id = 'techresearcher'`).get() ||
  db.prepare(`SELECT a.* FROM agents a JOIN user_agents ua ON ua.agent_id = a.id WHERE ua.user_id = ? LIMIT 1`).get(
    CEO.id
  );
ok(!!agent, `found agent ${agent?.id}`);

if (agent) {
  const applied = await applyTemplateToAgentWorkspace({
    agent,
    ownerUserId: CEO.id,
    templateId: PLATFORM_STANDARD_TEMPLATE_ID,
    authUser: { ...CEO, role: 'ceo' },
  });
  ok(applied.written?.includes('tools'), `apply wrote tools (${applied.written})`);
  ok(applied.written?.includes('ops'), `apply wrote ops`);
  const root = workspace.resolveAgentWorkspaceRoot(agent, { ceoUserId: CEO.id, healDb: false });
  const tools = await workspace.readWorkspaceFile('tools', { workspaceRoot: root });
  const ops = await workspace.readWorkspaceFile('ops', { workspaceRoot: root });
  ok(/AGENT-OS-OPS|learnings_summary|kanban/i.test(tools.text || ''), 'TOOLS.md has ops guidance');
  ok(/Kanban|learnings/i.test(ops.text || ''), 'AGENT-OS-OPS.md present');

  const httpList = await api('GET', '/api/agents/workspace-templates');
  ok(httpList.status === 200 && (httpList.data.templates || []).length >= 1, 'HTTP list templates');

  const httpApply = await api('POST', `/api/agents/${agent.id}/workspace/apply-template`, {
    template_id: PLATFORM_STANDARD_TEMPLATE_ID,
  });
  ok(httpApply.status < 400, `HTTP apply ${httpApply.status}`, httpApply.data?.error);

  const pub = await publishAgentWorkspaceAsTemplate({
    agent,
    ownerUserId: CEO.id,
    name: `E2E ${agent.name} tpl ${Date.now()}`,
    description: 'e2e publish',
    actor: CEO,
  });
  ok(pub.status === 'published' && pub.source === 'ceo', `CEO publish ${pub.id}`);
  ok(listPublishedTemplates().some((t) => t.id === pub.id), 'published visible to CEOs');

  if (admin) {
    const created = createTemplate({
      name: `Admin draft ${Date.now()}`,
      description: 'admin e2e',
      status: 'draft',
      actor: admin,
    });
    ok(created.status === 'draft', 'admin draft created');
    ok(!listPublishedTemplates().some((t) => t.id === created.id), 'draft not in CEO list');
    const pub2 = updateTemplate(created.id, { status: 'published' }, admin);
    ok(pub2.status === 'published', 'admin publish');
    ok(listPublishedTemplates().some((t) => t.id === created.id), 'admin published visible');
    deleteTemplate(created.id);
    ok(!listPublishedTemplates().some((t) => t.id === created.id), 'admin delete');
  }

  // cleanup CEO publish (keep platform-standard)
  deleteTemplate(pub.id);
}

console.log(failed ? 'WORKSPACE_TEMPLATES_FAIL' : 'WORKSPACE_TEMPLATES_OK', { failed });
process.exit(failed ? 1 : 0);
