import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-capability-registry-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
try {
  const { initDb } = await import('../src/db/schema.js');
  const db = initDb();
  const owner = 'ceo-capability-test';
  db.prepare(`INSERT INTO platform_users (id,email,password_hash,name,role) VALUES (?,?,?,?,?)`)
    .run(owner, 'capability@example.test', 'x', 'Capability Test', 'ceo');
  db.prepare(`INSERT INTO platform_users (id,email,password_hash,name,role) VALUES (?,?,?,?,?)`)
    .run('ceo-other', 'other@example.test', 'x', 'Other CEO', 'ceo');
  db.prepare(`INSERT INTO browser_recipes (id,ceo_user_id,name,description,status,start_url) VALUES (?,?,?,?,?,?)`)
    .run('br-linkedin', owner, 'LinkedIn dynamic post', 'Publish a LinkedIn post with dynamic content', 'published', 'https://www.linkedin.com/feed/');
  db.prepare(`INSERT INTO browser_recipes (id,ceo_user_id,name,description,status,start_url) VALUES (?,?,?,?,?,?)`)
    .run('br-private-other', 'ceo-other', 'Private payroll export', 'Other tenant only', 'published', 'https://example.test/');
  db.prepare(`INSERT INTO browser_recipe_steps (recipe_id,step_order,action,args_json,label) VALUES (?,?,?,?,?)`)
    .run('br-linkedin', 1, 'type', JSON.stringify({ request: { kind: 'type', text: '{{post_content}}' } }), 'Enter post');
  db.prepare(`INSERT INTO agent_workflow_definitions (id,name,description,owner_user_id,status,chat_trigger_phrase) VALUES (?,?,?,?,?,?)`)
    .run('wf-digest', 'Weekly digest email', 'Send operating summary', owner, 'published', 'run weekly digest');
  const { buildRuntimeCapabilityRegistry, resolveRuntimeCapability, mergeRuntimeCapabilityStep } = await import('../src/services/runtime-capability-registry.js');
  const registry = buildRuntimeCapabilityRegistry(owner);
  assert(registry.some((entry) => entry.kind === 'recipe' && entry.id === 'br-linkedin'));
  assert(registry.some((entry) => entry.kind === 'workflow' && entry.id === 'wf-digest'));
  assert(!registry.some((entry) => entry.id === 'br-private-other'));
  const resolution = resolveRuntimeCapability(owner, 'Publish a LinkedIn post using the saved automation');
  assert.equal(resolution.selected?.id, 'br-linkedin');
  assert(resolution.selected.score >= resolution.threshold);
  assert(resolution.selected.decision_evidence.matched_terms.includes('linkedin'));
  const steps = mergeRuntimeCapabilityStep([], owner, 'Publish a LinkedIn post using the saved automation');
  assert.equal(steps[0].tool_name, 'browse_recipe_run');
  assert.deepEqual(steps[0].required_inputs, ['post_content']);
  assert.equal(steps[0].resolution_evidence.resolver, 'runtime_registry_v1');
  const exclusive = mergeRuntimeCapabilityStep([
    { type: 'specialty_task', agent_id: 'social-researcher', message: 'Publish a LinkedIn post using the saved automation' },
  ], owner, 'Publish a LinkedIn post using the saved automation');
  assert.equal(exclusive.length, 1);
  assert.equal(exclusive[0].tool_name, 'browse_recipe_run');
  db.close();
  console.log('runtime capability registry tests passed');
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
