/**
 * Local + in-process smoke for desktop workflow packages (token, IP whitelist, zip, runtime APIs).
 * Does not require Windows PowerShell — exercises backend + Node runner against local API.
 *
 * Usage: node scripts/test-workflow-desktop-package.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import * as store from '../src/services/agent-workflow-store.js';
import {
  createDesktopToken,
  authenticateDesktopToken,
  addIpWhitelistEntry,
  removeIpWhitelistEntry,
  ipMatchesCidrOrIp,
  hashDesktopToken,
} from '../src/services/agent-workflow-desktop-auth.js';
import { buildDesktopPackageZip } from '../src/services/agent-workflow-desktop-package.js';
import {
  startDesktopOrchestratedRun,
  reportDesktopStep,
  completeDesktopRun,
} from '../src/services/agent-workflow-desktop-runtime.js';
import { writeFileSync, mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';

initDb();
const db = getDb();

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const OWNER = process.env.AGENT_OS_BALA_CEO_ID || 'ceo-bala';
const DEF_ID = `wf-desktop-smoke-${Date.now()}`;

const graph = {
  nodes: [
    { id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Start' } },
    {
      id: 'fs1',
      type: 'filesystem',
      position: { x: 200, y: 0 },
      data: {
        label: 'List',
        taskConfig: { operation: 'list', path: '.' },
        inputBindings: [{ id: 'path', mode: 'static', value: '.' }],
      },
    },
    { id: 'e1', type: 'end', position: { x: 400, y: 0 }, data: { label: 'End' } },
  ],
  edges: [
    { id: 'a', source: 't1', target: 'fs1' },
    { id: 'b', source: 'fs1', target: 'e1' },
  ],
};

console.log('== desktop auth helpers ==');
assert(ipMatchesCidrOrIp('10.0.0.5', '10.0.0.0/8'), 'cidr match');
assert(!ipMatchesCidrOrIp('11.0.0.5', '10.0.0.0/8'), 'cidr miss');
assert(ipMatchesCidrOrIp('127.0.0.1', '127.0.0.1'), 'exact');

console.log('== create published workflow ==');
store.createDefinition({
  id: DEF_ID,
  name: 'Desktop smoke',
  description: 'test',
  ownerUserId: OWNER,
  graph,
  actor: { id: OWNER, name: 'test' },
});
store.publishDefinition(DEF_ID, OWNER, { id: OWNER, name: 'test' });

console.log('== token + IP whitelist ==');
const minted = createDesktopToken(DEF_ID, OWNER, { name: 'smoke' });
assert(minted.token.startsWith('dsk_'), 'token prefix');
let auth = authenticateDesktopToken(minted.token, '203.0.113.9');
assert(auth.ok, 'auth without whitelist');

const entry = addIpWhitelistEntry(OWNER, { cidrOrIp: '203.0.113.0/24', definitionId: DEF_ID, label: 'lab' });
auth = authenticateDesktopToken(minted.token, '198.51.100.1');
assert(!auth.ok && auth.status === 403, 'blocked by whitelist');
auth = authenticateDesktopToken(minted.token, '203.0.113.40');
assert(auth.ok, 'allowed by whitelist');
removeIpWhitelistEntry(entry.id, OWNER);

console.log('== package zip ==');
process.env.AGENT_OS_PUBLIC_URL = process.env.AGENT_OS_PUBLIC_URL || 'http://127.0.0.1:3001';
const lite = await buildDesktopPackageZip(DEF_ID, OWNER, {
  baseUrlOverride: 'http://127.0.0.1:3001',
  includeRuntime: false,
});
assert(lite.filename.includes('desktop-lite'), 'lite filename');
assert(lite.zip.length < 500_000, 'lite zip should be small');
console.log('lite zip bytes', lite.zip.length);

// First-time download of win node.exe from nodejs.org (cached under data/cache/…).
const pkg = await buildDesktopPackageZip(DEF_ID, OWNER, {
  baseUrlOverride: 'http://127.0.0.1:3001',
  includeRuntime: true,
});
assert(pkg.zip.length > 100, 'zip size');
assert(pkg.filename.endsWith('.zip'), 'zip name');
const dir = mkdtempSync(join(tmpdir(), 'aos-desktop-'));
const zipPath = join(dir, pkg.filename);
writeFileSync(zipPath, pkg.zip);
assert(existsSync(zipPath), 'zip written');
console.log('zip at', zipPath, 'bytes', pkg.zip.length);
if (process.env.DESKTOP_PACKAGE_SKIP_NODE_RUNTIME !== '1') {
  assert(pkg.zip.length > 1_000_000, 'zip should include compressed node.exe');
}

console.log('== desktop runtime (filesystem reported locally) ==');
const started = await startDesktopOrchestratedRun(DEF_ID, OWNER, { input: 'hi' });
assert(started.run?.trigger === 'desktop', 'trigger desktop');
assert(started.run?.status === 'running', 'running');
reportDesktopStep(started.run.id, OWNER, {
  node_id: 'fs1',
  status: 'completed',
  outputs: { ok: true, operation: 'list', text: 'a.txt', count: 1 },
});
reportDesktopStep(started.run.id, OWNER, {
  node_id: 'e1',
  status: 'completed',
  outputs: { text: 'end', ended: true },
});
const done = completeDesktopRun(started.run.id, OWNER, { status: 'completed' });
assert(done.status === 'completed', 'completed');

console.log('== hash stability ==');
assert(hashDesktopToken(minted.token) === createHash('sha256').update(minted.token).digest('hex'), 'hash');

// cleanup definition
try {
  db.prepare(`DELETE FROM agent_workflow_run_steps WHERE run_id IN (SELECT id FROM agent_workflow_runs WHERE definition_id = ?)`).run(DEF_ID);
  db.prepare(`DELETE FROM agent_workflow_runs WHERE definition_id = ?`).run(DEF_ID);
  db.prepare(`DELETE FROM workflow_desktop_tokens WHERE definition_id = ?`).run(DEF_ID);
  db.prepare(`DELETE FROM workflow_desktop_ip_whitelist WHERE definition_id = ?`).run(DEF_ID);
  db.prepare(`DELETE FROM agent_workflow_audit WHERE definition_id = ?`).run(DEF_ID);
  db.prepare(`DELETE FROM agent_workflow_definitions WHERE id = ?`).run(DEF_ID);
} catch (e) {
  console.warn('cleanup:', e.message);
}

console.log('OK desktop package smoke passed');
