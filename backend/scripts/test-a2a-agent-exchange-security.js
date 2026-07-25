/**
 * Test AgentExchange A2A access policy + owner-scoped unpublish.
 * Usage: node scripts/test-a2a-agent-exchange-security.js
 */
import { initDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import * as store from '../src/services/agent-workflow-store.js';
import {
  getPublicationById,
  publishWorkflowAsA2A,
  unpublishA2APublicationById,
} from '../src/services/workflow-a2a-publish.js';
import {
  addA2AIpWhitelistEntry,
  checkA2AClientIp,
  getA2AAccessSettings,
  removeA2AIpWhitelistEntry,
  setA2AAccessPolicy,
} from '../src/services/workflow-a2a-access.js';

initDb();

const owner = getBalaCeoAuthId();
const otherOwner = `${owner}-not-owner`;
const workflowId = 'test-a2a-exchange-security';
const actor = { id: owner, name: 'A2A Security Test' };
const graph = {
  nodes: [
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 20, y: 20 },
      data: { label: 'Start', triggerModes: ['manual', 'a2a'] },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

let def = store.getDefinition(workflowId, owner);
if (!def) {
  def = store.createDefinition({
    id: workflowId,
    name: 'A2A Exchange Security Test',
    description: 'Access policy and unpublish test',
    ownerUserId: owner,
    actor,
    graph,
    trigger_modes: ['manual', 'a2a'],
  });
} else {
  store.updateDraft(workflowId, owner, { graph }, actor);
}
store.publishDefinition(workflowId, owner, actor);

const pub = publishWorkflowAsA2A(
  owner,
  workflowId,
  {
    name: `A2A Security Test ${Date.now()}`,
    auth_mode: 'public',
    invoke_mode: 'sync',
    as_new_agent: true,
  },
  actor
);

if (pub.access_policy !== 'deny_all') throw new Error('New publication must default to deny_all');
let access = checkA2AClientIp(getPublicationById(pub.id), '127.0.0.1');
if (access.ok || access.policy !== 'deny_all') throw new Error('deny_all must reject');
console.log('PASS: new A2A agent defaults to deny_all');

if (setA2AAccessPolicy(pub.id, otherOwner, 'allow_all') !== null) {
  throw new Error('Non-owner must not update access');
}
console.log('PASS: access policy is owner-scoped');

setA2AAccessPolicy(pub.id, owner, 'allow_all');
access = checkA2AClientIp(getPublicationById(pub.id), '203.0.113.9');
if (!access.ok) throw new Error('allow_all must accept');
console.log('PASS: allow_all accepts any IP');

setA2AAccessPolicy(pub.id, owner, 'whitelist');
access = checkA2AClientIp(getPublicationById(pub.id), '203.0.113.9');
if (access.ok) throw new Error('Empty whitelist must reject');

let settings = addA2AIpWhitelistEntry(pub.id, owner, {
  cidr_or_ip: '203.0.113.0/24',
  label: 'Test network',
});
const entry = settings.entries.find((row) => row.cidr_or_ip === '203.0.113.0/24');
if (!entry) throw new Error('Whitelist entry missing');
access = checkA2AClientIp(getPublicationById(pub.id), '203.0.113.9');
if (!access.ok) throw new Error('Matching CIDR must accept');
access = checkA2AClientIp(getPublicationById(pub.id), '198.51.100.9');
if (access.ok) throw new Error('Non-matching IP must reject');
console.log('PASS: whitelist accepts matching CIDR and rejects others');

settings = removeA2AIpWhitelistEntry(pub.id, entry.id, owner);
if (settings.entries.length) throw new Error('Whitelist removal failed');

const result = unpublishA2APublicationById(owner, pub.id, actor);
if (!result.workflow_remains_published) throw new Error('Workflow should remain published');
if (getPublicationById(pub.id)) throw new Error('Unpublished public endpoint should disappear');
const stillPrivate = store.getDefinition(workflowId, owner);
if (stillPrivate?.status !== 'published') {
  throw new Error('Underlying workflow must remain published for authenticated UI/API');
}
if (getA2AAccessSettings(pub.id, owner) !== null) {
  throw new Error('Unpublished agent should not expose access settings');
}
console.log('PASS: unpublish removes A2A endpoints; workflow remains published/private');

console.log('\nALL AgentExchange security tests passed');
