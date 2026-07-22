/**
 * Smoke test: A2A public vs secured (client credentials → Bearer).
 * Usage: node scripts/test-workflow-a2a-oauth.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import * as store from '../src/services/agent-workflow-store.js';
import {
  publishWorkflowAsA2A,
  getPublicationById,
  handleA2AJsonRpc,
  issueA2AAccessToken,
  unpublishWorkflowA2A,
} from '../src/services/workflow-a2a-publish.js';

initDb();

const owner = getBalaCeoAuthId();
const WORKFLOW_ID = 'test-a2a-oauth-smoke';
const actor = { id: 'test-a2a-oauth', name: 'Test' };

const graph = {
  nodes: [
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 40, y: 120 },
      data: { label: 'Start', triggerModes: ['manual'] },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

let def = store.getDefinition(WORKFLOW_ID, owner);
if (!def) {
  def = store.createDefinition({
    id: WORKFLOW_ID,
    name: 'A2A OAuth Smoke Test',
    description: 'Minimal workflow for A2A OAuth smoke test',
    ownerUserId: owner,
    actor,
    graph,
    trigger_modes: ['manual'],
  });
} else {
  store.updateDraft(WORKFLOW_ID, owner, { graph }, actor);
}
store.publishDefinition(WORKFLOW_ID, owner, actor);

function rpcBody(text) {
  return {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        messageId: randomUUID(),
        parts: [{ kind: 'text', text }],
      },
      metadata: { skillId: 'default' },
    },
  };
}

// --- Public ---
const publicPub = publishWorkflowAsA2A(
  owner,
  WORKFLOW_ID,
  {
    name: 'A2A OAuth Public Agent',
    description: 'Public access',
    auth_mode: 'public',
    skill_id: 'default',
  },
  actor
);
if (publicPub.auth_mode !== 'public') throw new Error('Expected public auth_mode');
if (publicPub.credentials) throw new Error('Public publish must not return credentials');
if (publicPub.agent_card?.securitySchemes) throw new Error('Public card must not require oauth');

const publicOk = await handleA2AJsonRpc(publicPub.id, rpcBody('hello public'));
if (publicOk.error?.code === -32003) throw new Error('Public invoke should not require auth');
console.log('OK: public invoke allowed without token');

// --- Secured ---
const secured = publishWorkflowAsA2A(
  owner,
  WORKFLOW_ID,
  {
    name: 'A2A OAuth Secured Agent',
    description: 'Secured access',
    auth_mode: 'secured',
    skill_id: 'default',
  },
  actor
);
if (secured.auth_mode !== 'secured') throw new Error('Expected secured auth_mode');
if (!secured.credentials?.client_id || !secured.credentials?.client_secret) {
  throw new Error('Secured publish must return client credentials once');
}
if (!secured.agent_card?.securitySchemes?.oauth2) throw new Error('Secured card missing oauth2 scheme');
if (!secured.token_url) throw new Error('Missing token_url');
console.log('OK: secured publish issued credentials', secured.credentials.client_id);

const denied = await handleA2AJsonRpc(secured.id, rpcBody('no auth'));
if (denied.error?.code !== -32003) throw new Error('Secured invoke without token must be Unauthorized');
console.log('OK: secured invoke denied without token');

let failed = false;
try {
  issueA2AAccessToken(secured.id, {
    clientId: secured.credentials.client_id,
    clientSecret: 'wrong-secret',
  });
} catch (e) {
  failed = e.status === 401;
}
if (!failed) throw new Error('Bad client secret must fail');
console.log('OK: bad client secret rejected');

const token = issueA2AAccessToken(secured.id, {
  clientId: secured.credentials.client_id,
  clientSecret: secured.credentials.client_secret,
});
if (!token.access_token || token.token_type !== 'Bearer') throw new Error('Token response invalid');
console.log('OK: access token issued, expires_in=', token.expires_in);

const allowed = await handleA2AJsonRpc(secured.id, rpcBody('hello secured'), {
  authHeader: `Bearer ${token.access_token}`,
});
if (allowed.error?.code === -32003) throw new Error('Valid access token must authorize invoke');
console.log('OK: secured invoke with Bearer access token');

const secretAsBearer = await handleA2AJsonRpc(secured.id, rpcBody('client secret as bearer'), {
  authHeader: `Bearer ${secured.credentials.client_secret}`,
});
if (secretAsBearer.error?.code !== -32003) {
  throw new Error('client_secret must not work as A2A Bearer token');
}
console.log('OK: client_secret rejected as invoke Bearer');

const rotated = publishWorkflowAsA2A(
  owner,
  WORKFLOW_ID,
  {
    name: 'A2A OAuth Secured Agent',
    auth_mode: 'secured',
    rotate_credentials: true,
  },
  actor
);
if (!rotated.credentials?.client_secret) throw new Error('Rotate must issue new secret');
if (rotated.credentials.client_secret === secured.credentials.client_secret) {
  throw new Error('Rotated secret must differ');
}

const oldDenied = await handleA2AJsonRpc(secured.id, rpcBody('old token'), {
  authHeader: `Bearer ${token.access_token}`,
});
if (oldDenied.error?.code !== -32003) throw new Error('Old access token must be revoked on rotate');
console.log('OK: rotate credentials revokes prior tokens');

const listed = getPublicationById(rotated.id);
if (listed?.credentials) throw new Error('getPublication must never return client_secret');
if (!listed?.client_id) throw new Error('client_id should be visible on secured pubs');
console.log('OK: sanitize hides secret, exposes client_id');

unpublishWorkflowA2A(owner, WORKFLOW_ID, actor);
console.log('\nALL A2A OAuth TESTS PASSED');
