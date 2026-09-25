import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'flolah-demo-seed-'));
process.env.AGENT_OS_DATA_DIR = join(root, 'data');
process.env.USERPROFILE = join(root, 'home');
process.env.HOME = join(root, 'home');
process.env.OPENCLAW_CONFIG_PATH = join(root, 'home', '.openclaw', 'openclaw.json');
process.env.TWENTY_API_URL = '';
process.env.ERPNEXT_URL = '';

let dbHandle = null;
let testOwnerId = '';
let closeCeoDb = null;
let getCeoDb = null;
try {
  const { initDb } = await import('../src/db/schema.js');
  ({ closeCeoDb, getCeoDb } = await import('../src/db/ceo-db.js'));
  const {
    cleanupDemoSeedPack,
    ensureDemoCeo,
    getDemoSeedPackInstall,
    getNorthstarIndustrialDemoPack,
    planDemoSeedPack,
    reseedDemoSeedPack,
    seedDemoSeedPack,
    validateDemoSeedPack,
  } = await import('../src/services/demo-seed-pack.js');

  const db = initDb();
  dbHandle = db;
  const pack = getNorthstarIndustrialDemoPack();
  const validation = validateDemoSeedPack(pack);
  assert.equal(validation.ok, true);
  assert.equal(validation.agents, 8);
  assert.equal(validation.workflows, 7);
  assert.equal(validation.monthly_token_budget, 6_200_000);
  assert.equal(planDemoSeedPack({ includeExternal: false }).resources.crm_people, 20);
  assert.equal(planDemoSeedPack({ includeExternal: false }).resources.objective_linked_goals, 7);
  const unsafe = structuredClone(pack);
  unsafe.policies.find((item) => item.family === 'financial_destructive').mode = 'autonomous';
  assert.throws(() => validateDemoSeedPack(unsafe), /financial_destructive/);
  const brokenLink = structuredClone(pack);
  brokenLink.workflows[0].agents.push('missing-agent');
  assert.throws(() => validateDemoSeedPack(brokenLink), /unknown agent/);

  const { user } = await ensureDemoCeo();
  testOwnerId = user.id;
  const first = await seedDemoSeedPack({ ownerUserId: user.id, includeExternal: false });
  assert.equal(first.ok, true);
  assert.equal(first.idempotent, false);
  assert.equal(getDemoSeedPackInstall(user.id)?.status, 'installed');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agents WHERE owner_user_id=? AND source_publish_id=?").get(user.id, pack.pack_id).n, 8);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM company_objectives WHERE owner_user_id=? AND id LIKE ?').get(user.id, 'demo-ns-%-objective-%').n, 5);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM scheduled_goals WHERE owner_user_id=? AND source='company_objective'").get(user.id).n, 4);
  assert.equal(getDemoSeedPackInstall(user.id)?.resources?.scheduled_goals?.length, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_workflow_definitions WHERE owner_user_id=? AND id LIKE ?').get(user.id, 'demo-ns-%-workflow-%').n, 7);
  assert.equal(getCeoDb(user.id).prepare("SELECT COUNT(*) AS n FROM master_data_tables WHERE owner_user_id=? AND name LIKE 'demo_northstar_%'").get(user.id).n, 7);
  assert.equal(db.prepare("SELECT mode FROM action_family_policies WHERE owner_user_id=? AND family='communicate_external'").get(user.id).mode, 'autonomous');
  assert.equal(db.prepare("SELECT mode FROM action_family_policies WHERE owner_user_id=? AND family='financial_destructive'").get(user.id).mode, 'prohibited');

  const second = await seedDemoSeedPack({ ownerUserId: user.id, includeExternal: false });
  assert.equal(second.idempotent, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agents WHERE owner_user_id=? AND source_publish_id=?").get(user.id, pack.pack_id).n, 8);

  await assert.rejects(
    cleanupDemoSeedPack({ ownerUserId: user.id, includeExternal: false, confirmOwnerUserId: 'another-owner' }),
    /confirmOwnerUserId/
  );
  assert.equal(getDemoSeedPackInstall(user.id)?.status, 'installed');

  const cleaned = await cleanupDemoSeedPack({ ownerUserId: user.id, includeExternal: false, confirmOwnerUserId: user.id });
  assert.equal(cleaned.ok, true, JSON.stringify(cleaned.errors));
  assert.equal(getDemoSeedPackInstall(user.id), null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agents WHERE owner_user_id=? AND source_publish_id=?").get(user.id, pack.pack_id).n, 0);
  assert.equal(getCeoDb(user.id).prepare("SELECT COUNT(*) AS n FROM master_data_tables WHERE owner_user_id=? AND name LIKE 'demo_northstar_%'").get(user.id).n, 0);
  assert.ok(db.prepare('SELECT id FROM platform_users WHERE id=?').get(user.id), 'cleanup retains CEO');

  const reseeded = await reseedDemoSeedPack({ ownerUserId: user.id, includeExternal: false });
  assert.equal(reseeded.ok, true);
  assert.equal(getDemoSeedPackInstall(user.id)?.status, 'installed');
  const finalCleanup = await cleanupDemoSeedPack({ ownerUserId: user.id, includeExternal: false, confirmOwnerUserId: user.id });
  assert.equal(finalCleanup.ok, true, JSON.stringify(finalCleanup.errors));

  console.log(JSON.stringify({ ok: true, validation, lifecycle: ['seed', 'idempotent-seed', 'confirmation-denied', 'cleanup', 'reseed', 'cleanup'] }, null, 2));
} finally {
  try { if (testOwnerId) closeCeoDb?.(testOwnerId); } catch {}
  try { dbHandle?.close(); } catch {}
  rmSync(root, { recursive: true, force: true });
}
