/**
 * Central owner IP whitelist: desktop, browser, a2a, ibkr feature enforcement + migrations.
 * Usage: node scripts/test-owner-ip-whitelist.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import {
  ensureOwnerIpWhitelistTables,
  addOwnerIpWhitelistEntry,
  removeOwnerIpWhitelistEntry,
  listOwnerIpWhitelists,
  assertFeatureIpAllowed,
  IP_FEATURES,
  validateIpOrCidr,
  updateOwnerIpWhitelistEntry,
} from '../src/services/owner-ip-whitelist.js';
import {
  createDesktopToken,
  authenticateDesktopToken,
  addIpWhitelistEntry as addDesktopIp,
  removeIpWhitelistEntry as removeDesktopIp,
  listIpWhitelist as listDesktopIp,
} from '../src/services/agent-workflow-desktop-auth.js';
import {
  createBrowserWorkerToken,
  authenticateBrowserWorkerToken,
  addBrowserWorkerIpWhitelistEntry,
  removeBrowserWorkerIpWhitelistEntry,
} from '../src/services/browser-worker-auth.js';
import {
  checkA2AClientIp,
  addA2AIpWhitelistEntry,
  setA2AAccessPolicy,
  getA2AAccessSettings,
} from '../src/services/workflow-a2a-access.js';
import * as store from '../src/services/agent-workflow-store.js';

initDb();
ensureOwnerIpWhitelistTables();
const db = getDb();

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const OWNER = process.env.AGENT_OS_BALA_CEO_ID || 'ceo-bala';
const tag = `ipw-test-${Date.now()}`;
const DEF_ID = `wf-${tag}`;

console.log('== validateIpOrCidr ==');
assert(validateIpOrCidr('203.0.113.9') === '203.0.113.9', 'exact ip');
assert(validateIpOrCidr('203.0.113.0/24') === '203.0.113.0/24', 'cidr');
try {
  validateIpOrCidr('not-an-ip');
  throw new Error('should reject');
} catch (e) {
  assert(/valid/i.test(e.message), 'invalid rejected');
}

console.log('== central multi-apply ==');
const multi = addOwnerIpWhitelistEntry(OWNER, {
  cidr_or_ip: '203.0.113.0/24',
  label: tag,
  apply_workflow_desktop: true,
  apply_browser_worker: true,
  apply_ibkr_bridge: true,
  apply_a2a: false,
});
assert(multi.apply_workflow_desktop && multi.apply_browser_worker && multi.apply_ibkr_bridge, 'flags');

let r = assertFeatureIpAllowed(OWNER, IP_FEATURES.WORKFLOW_DESKTOP, '203.0.113.50');
assert(r.ok, 'desktop match');
r = assertFeatureIpAllowed(OWNER, IP_FEATURES.WORKFLOW_DESKTOP, '198.51.100.1');
assert(!r.ok, 'desktop miss');
r = assertFeatureIpAllowed(OWNER, IP_FEATURES.BROWSER_WORKER, '203.0.113.50');
assert(r.ok, 'browser match');
r = assertFeatureIpAllowed(OWNER, IP_FEATURES.IBKR_BRIDGE, '198.51.100.1');
assert(!r.ok, 'ibkr miss');
r = assertFeatureIpAllowed(OWNER, IP_FEATURES.IBKR_BRIDGE, '203.0.113.10');
assert(r.ok, 'ibkr match');

// list filters
const desktopList = listOwnerIpWhitelists(OWNER, { feature: IP_FEATURES.WORKFLOW_DESKTOP });
assert(desktopList.some((e) => e.id === multi.id), 'list desktop includes multi');

console.log('== federated desktop wrapper ==');
store.createDefinition({
  id: DEF_ID,
  name: 'IPW smoke',
  description: 'test',
  ownerUserId: OWNER,
  graph: {
    nodes: [{ id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'S' } }],
    edges: [],
  },
  actor: { id: OWNER, name: 'test' },
});
store.publishDefinition(DEF_ID, OWNER, { id: OWNER, name: 'test' });
const minted = createDesktopToken(DEF_ID, OWNER, { name: 'smoke' });
// multi already restricts desktop for owner (owner-wide definition_id null)
let auth = authenticateDesktopToken(minted.token, '198.51.100.1');
assert(!auth.ok && auth.status === 403, 'desktop token blocked by central rule');
auth = authenticateDesktopToken(minted.token, '203.0.113.40');
assert(auth.ok, 'desktop token allowed');

// Workflow-scoped add via federated API should merge/add
const scoped = addDesktopIp(OWNER, { cidrOrIp: '198.51.100.0/24', definitionId: DEF_ID, label: 'lab' });
const deskEntries = listDesktopIp(OWNER, DEF_ID);
assert(deskEntries.some((e) => e.id === scoped.id), 'scoped listed');
auth = authenticateDesktopToken(minted.token, '198.51.100.9');
assert(auth.ok, 'allowed by workflow-scoped rule');
removeDesktopIp(scoped.id, OWNER);

console.log('== browser worker ==');
const bwk = createBrowserWorkerToken(OWNER, { name: tag });
// multi already has browser rules
let bw = authenticateBrowserWorkerToken(bwk.token, '198.51.100.1');
assert(!bw.ok && bw.status === 403, 'browser blocked');
bw = authenticateBrowserWorkerToken(bwk.token, '203.0.113.2');
assert(bw.ok, 'browser allowed');
const bwExtra = addBrowserWorkerIpWhitelistEntry(OWNER, { cidrOrIp: '192.0.2.1', label: 'x' });
bw = authenticateBrowserWorkerToken(bwk.token, '192.0.2.1');
assert(bw.ok, 'browser extra');
removeBrowserWorkerIpWhitelistEntry(bwExtra.id, OWNER);

console.log('== A2A policy ==');
// Clean multi a2a was false — ensure empty a2a deny with whitelist policy row
const publishId = `pub-${tag}`;
db.prepare(
  `INSERT INTO workflow_a2a_publications
   (id, workflow_definition_id, owner_user_id, name, status, access_policy, visibility, published_at)
   VALUES (?, ?, ?, ?, 'published', 'deny_all', 'public', datetime('now'))`
).run(publishId, DEF_ID, OWNER, 'IPW A2A');

let pub = db.prepare(`SELECT * FROM workflow_a2a_publications WHERE id = ?`).get(publishId);
let check = checkA2AClientIp(pub, '203.0.113.1');
assert(!check.ok && check.policy === 'deny_all', 'deny all');

setA2AAccessPolicy(publishId, OWNER, 'whitelist');
pub = db.prepare(`SELECT * FROM workflow_a2a_publications WHERE id = ?`).get(publishId);
check = checkA2AClientIp(pub, '203.0.113.1');
assert(!check.ok, 'whitelist empty denies');

addA2AIpWhitelistEntry(publishId, OWNER, { cidr_or_ip: '203.0.113.0/24', label: 'a2a' });
const settings = getA2AAccessSettings(publishId, OWNER);
assert(settings.entries.length >= 1, 'a2a entries');
pub = db.prepare(`SELECT * FROM workflow_a2a_publications WHERE id = ?`).get(publishId);
check = checkA2AClientIp(pub, '203.0.113.9');
assert(check.ok, 'a2a allow');
check = checkA2AClientIp(pub, '198.51.100.1');
assert(!check.ok, 'a2a deny other');

// central-only A2A owner-wide entry
addOwnerIpWhitelistEntry(OWNER, {
  cidr_or_ip: '192.0.2.55',
  apply_a2a: true,
  label: 'owner-wide-a2a',
});
check = checkA2AClientIp(pub, '192.0.2.55');
assert(check.ok, 'owner-wide a2a allows');

console.log('== update flags ==');
const updated = updateOwnerIpWhitelistEntry(multi.id, OWNER, {
  apply_a2a: true,
  apply_ibkr_bridge: false,
});
assert(updated.apply_a2a && !updated.apply_ibkr_bridge, 'update toggles');

// cleanup
try {
  db.prepare(`DELETE FROM owner_ip_whitelists WHERE owner_user_id = ? AND (label LIKE ? OR id = ? OR label = ?)`).run(
    OWNER,
    `${tag}%`,
    multi.id,
    'owner-wide-a2a'
  );
  db.prepare(`DELETE FROM owner_ip_whitelists WHERE publish_id = ?`).run(publishId);
  db.prepare(`DELETE FROM owner_ip_whitelists WHERE definition_id = ?`).run(DEF_ID);
  db.prepare(`DELETE FROM workflow_a2a_publications WHERE id = ?`).run(publishId);
  db.prepare(`DELETE FROM workflow_desktop_tokens WHERE definition_id = ?`).run(DEF_ID);
  db.prepare(`DELETE FROM browser_worker_tokens WHERE name = ?`).run(tag);
  db.prepare(`DELETE FROM agent_workflow_audit WHERE definition_id = ?`).run(DEF_ID);
  db.prepare(`DELETE FROM agent_workflow_definitions WHERE id = ?`).run(DEF_ID);
  // remove leftovers by label
  db.prepare(`DELETE FROM owner_ip_whitelists WHERE label = ?`).run(tag);
  db.prepare(`DELETE FROM owner_ip_whitelists WHERE label = ? OR label = ?`).run('lab', 'x');
} catch (e) {
  console.warn('cleanup:', e.message);
}

console.log('OK owner-ip-whitelist smoke passed');