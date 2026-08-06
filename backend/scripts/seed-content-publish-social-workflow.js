/**
 * Seed: content-publish-social
 * Phase 1 social publish — switch on platform:
 *   facebook → Meta Graph MCP create_page_post (CEO OAuth on Connectors → MCPs)
 *   linkedin → OpenConnector node (pin action via CONTENT_LINKEDIN_OC_* env or graph)
 *
 * Facebook App ID/Secret: Connectors → MCPs (not required in .env).
 *
 * Run:
 *   node backend/scripts/seed-content-publish-social-workflow.js
 *   WORKFLOW_SEED_OWNER_ID=ceo-... node backend/scripts/seed-content-publish-social-workflow.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '../../deploy/.env') });

import { initDb, getDb } from '../src/db/schema.js';
import * as store from '../src/services/agent-workflow-store.js';
import { META_GRAPH_MCP_ID } from './seed-meta-graph-mcp.js';

initDb();

export const WORKFLOW_ID = 'content-publish-social';
export const CHAT_PHRASE = 'publish social post';

// OpenConnector app/service id for LinkedIn. Products on LI developer app:
// Share on LinkedIn + Sign In with LinkedIn using OpenID Connect
// (scopes: openid profile email w_member_social).
const LI_APP_ID = process.env.CONTENT_LINKEDIN_OC_APP_ID || 'linkedin';
const LI_ACTION_ID =
  process.env.CONTENT_LINKEDIN_OC_ACTION_ID || 'linkedin.create_share';

export const INPUT_SCHEMA = {
  type: 'object',
  required: ['platform', 'body'],
  properties: {
    platform: {
      type: 'string',
      description: 'facebook | linkedin',
      enum: ['facebook', 'linkedin'],
    },
    body: {
      type: 'string',
      minLength: 1,
      description: 'Exact post text / message',
    },
    page_id: {
      type: 'string',
      description: 'Facebook Page id (required for facebook)',
    },
    link: {
      type: 'string',
      description: 'Optional link to attach (Facebook)',
    },
    fingerprint: {
      type: 'string',
      description: 'Optional uniqueness token for logging',
    },
    source_run_id: {
      type: 'string',
      description: 'Optional operate/content run id',
    },
  },
  additionalProperties: true,
};

/**
 * Graph: trigger → if platform=facebook → MCP create_page_post
 *                 → else if platform=linkedin → OpenConnector
 *                 → else agent note (unsupported)
 */
export function buildContentPublishSocialGraph() {
  const fbArgs = JSON.stringify({
    page_id: '{{trigger-1.trigger_input.page_id}}',
    message: '{{trigger-1.trigger_input.body}}',
    link: '{{trigger-1.trigger_input.link}}',
  });
  // LinkedIn Share API (Share on LinkedIn + OpenID Connect): text share fields often map as commentary/text.
  // Pin exact actionId after OpenConnector catalog cert (CONTENT_LINKEDIN_OC_ACTION_ID).
  const liInput = JSON.stringify({
    commentary: '{{trigger-1.trigger_input.body}}',
    text: '{{trigger-1.trigger_input.body}}',
    body: '{{trigger-1.trigger_input.body}}',
    shareCommentary: { text: '{{trigger-1.trigger_input.body}}' },
  });

  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 180 },
        data: {
          label: 'Start (platform + body)',
          triggerModes: ['manual', 'chat', 'event'],
          scheduleCron: '',
          chatPhrase: CHAT_PHRASE,
          inputSchema: INPUT_SCHEMA,
          outputs: [{ id: 'trigger_input', label: 'Trigger payload' }],
        },
      },
      {
        id: 'if-facebook',
        type: 'if',
        position: { x: 280, y: 180 },
        data: {
          label: 'If facebook',
          taskConfig: {
            sourceNodeId: 'trigger-1',
            sourceOutputKey: 'trigger_input.platform',
            operator: 'eq',
            compareValue: 'facebook',
          },
        },
      },
      {
        id: 'mcp-fb-post',
        type: 'mcp_tool',
        position: { x: 540, y: 60 },
        data: {
          label: 'Facebook create_page_post',
          taskConfig: {
            mcpInvokeKind: 'tool',
            mcpServerId: META_GRAPH_MCP_ID,
            toolName: 'create_page_post',
            staticArguments: '{}',
            timeoutMs: 120000,
            timeoutAction: 'fail',
          },
          inputBindings: [
            {
              id: 'arguments',
              label: 'Arguments (JSON)',
              mode: 'static',
              value: fbArgs,
              sourceNodeId: '',
              sourceOutputKey: 'text',
            },
          ],
          outputs: [
            { id: 'text', label: 'Response text' },
            { id: 'result', label: 'Full result' },
            { id: 'ok', label: 'Success' },
          ],
        },
      },
      {
        id: 'if-linkedin',
        type: 'if',
        position: { x: 540, y: 260 },
        data: {
          label: 'If linkedin',
          taskConfig: {
            sourceNodeId: 'trigger-1',
            sourceOutputKey: 'trigger_input.platform',
            operator: 'eq',
            compareValue: 'linkedin',
          },
        },
      },
      {
        id: 'connector-li',
        type: 'connector',
        position: { x: 800, y: 200 },
        data: {
          label: 'LinkedIn OpenConnector share',
          inputBindings: [
            {
              id: 'input',
              label: 'Action input',
              mode: 'static',
              value: liInput,
              sourceNodeId: '',
              sourceOutputKey: 'result',
            },
          ],
          outputs: [
            { id: 'text', label: 'Connector response text' },
            { id: 'result', label: 'Full connector result JSON' },
            { id: 'ok', label: 'Success' },
          ],
          taskConfig: {
            appId: LI_APP_ID,
            appName: 'LinkedIn',
            actionId: LI_ACTION_ID,
            connectionName: '',
            timeoutMs: 120000,
            timeoutAction: 'fail',
          },
        },
      },
      {
        id: 'agent-unsupported',
        type: 'agent',
        position: { x: 800, y: 360 },
        data: {
          label: 'Unsupported platform note',
          agentId: 'coo',
          agentName: 'COO',
          prompt:
            'Reply with exactly one line: ERROR unsupported platform for content-publish-social. Only facebook|linkedin. Do not invent success.',
          inputBindings: [
            {
              id: 'prompt',
              mode: 'static',
              value:
                'Trigger was for platform={{trigger-1.trigger_input.platform}}. Report ERROR unsupported.',
              sourceNodeId: '',
              sourceOutputKey: 'text',
            },
          ],
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'if-facebook' },
      { id: 'e2', source: 'if-facebook', target: 'mcp-fb-post', sourceHandle: 'true' },
      { id: 'e3', source: 'if-facebook', target: 'if-linkedin', sourceHandle: 'false' },
      { id: 'e4', source: 'if-linkedin', target: 'connector-li', sourceHandle: 'true' },
      { id: 'e5', source: 'if-linkedin', target: 'agent-unsupported', sourceHandle: 'false' },
    ],
    viewport: { x: 0, y: 0, zoom: 0.85 },
  };
}

export function seedContentPublishSocialWorkflow(ownerUserId, { publish = true } = {}) {
  const actor = { id: 'seed-content-publish-social', name: 'Seed script', type: 'system' };
  const graph = buildContentPublishSocialGraph();
  const patch = {
    name: 'Content Publish Social (FB MCP + LI OC)',
    description:
      'Publish approved post text: platform=facebook → Meta Graph create_page_post; platform=linkedin → OpenConnector share. Requires CEO OAuth (Connectors → MCPs) and for LI a connected LinkedIn app + pinned actionId.',
    graph,
    trigger_modes: ['manual', 'chat', 'event'],
    schedule_cron: '',
    chat_trigger_phrase: CHAT_PHRASE,
    input_schema: INPUT_SCHEMA,
  };

  const existing = store.getDefinition(WORKFLOW_ID, ownerUserId);
  if (existing) {
    store.updateDraft(WORKFLOW_ID, ownerUserId, patch, actor);
  } else {
    store.createDefinition({
      id: WORKFLOW_ID,
      name: patch.name,
      description: patch.description,
      ownerUserId,
      actor,
      graph,
      trigger_modes: patch.trigger_modes,
      schedule_cron: '',
      chat_trigger_phrase: CHAT_PHRASE,
      input_schema: INPUT_SCHEMA,
    });
  }
  if (publish) {
    return store.publishDefinition(WORKFLOW_ID, ownerUserId, actor);
  }
  return store.getDefinition(WORKFLOW_ID, ownerUserId);
}

const isMain =
  process.argv[1] &&
  (process.argv[1].replace(/\\/g, '/').endsWith('seed-content-publish-social-workflow.js') ||
    process.argv[1].includes('seed-content-publish-social-workflow'));

if (isMain) {
  const owner =
    process.env.WORKFLOW_SEED_OWNER_ID ||
    getDb()
      .prepare(
        `SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1 ORDER BY created_at DESC LIMIT 1`
      )
      .get()?.id;
  if (!owner) {
    console.error('No CEO owner — set WORKFLOW_SEED_OWNER_ID');
    process.exit(1);
  }
  const def = seedContentPublishSocialWorkflow(owner, { publish: true });
  console.log('Published', def?.id, def?.name, 'owner=', owner);
  console.log('LI action (set CONTENT_LINKEDIN_OC_ACTION_ID if wrong):', LI_ACTION_ID);
}