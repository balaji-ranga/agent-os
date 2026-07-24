/**
 * Seed Balaji's BYOK Brave workflow:
 *   Trigger (brainApiKey, braveApiKey, query)
 *   → MCP brave_web_search (key from trigger)
 *   → API Brave REST (key from trigger / prior step)
 *   → Brain (LLM key from trigger; summarizes MCP + API)
 *
 * Run: node backend/scripts/seed-balaji-brave-byok-workflow.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '../../deploy/.env') });

import { initDb, getDb } from '../src/db/schema.js';
import * as store from '../src/services/agent-workflow-store.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { BRAVE_MCP_ID } from './seed-brave-search-mcp.js';

initDb();

export const WORKFLOW_ID = 'wf-balaji-brave-byok';

const INPUT_SCHEMA = {
  type: 'object',
  required: ['brainApiKey', 'braveApiKey', 'query'],
  properties: {
    brainApiKey: {
      type: 'string',
      minLength: 1,
      description: 'LLM API key for the Brain node (DeepSeek/OpenAI) — not from platform .env',
    },
    braveApiKey: {
      type: 'string',
      minLength: 1,
      description: 'Brave Search API key for MCP + API nodes — not from MCP container env',
    },
    query: { type: 'string', minLength: 1, description: 'Web search query' },
  },
  additionalProperties: false,
};

export function buildBalajiBraveByokGraph() {
  const deepseekKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  const openaiKey = String(process.env.OPENAI_API_KEY || process.env.OPENAI_PRIMARY_API_KEY || '').trim();
  // Prefer DeepSeek cloud when DEEPSEEK_API_KEY is set; otherwise OpenAI. Never default to Ollama
  // for this BYOK demo — search payloads exceed small local context windows.
  let brainSource = (process.env.BRAIN_BYOK_PROVIDER || '').toLowerCase();
  if (!brainSource) brainSource = deepseekKey ? 'deepseek' : openaiKey ? 'openai' : 'deepseek';
  const brainModel =
    process.env.BRAIN_BYOK_MODEL ||
    (brainSource === 'openai'
      ? process.env.OPENAI_PRIMARY_MODEL || 'gpt-4o-mini'
      : 'deepseek-chat');
  const brainEndpoint =
    process.env.BRAIN_BYOK_ENDPOINT ||
    (brainSource === 'openai'
      ? process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
      : 'https://api.deepseek.com/v1');

  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 160 },
        data: {
          label: 'Start (BYOK keys)',
          triggerModes: ['manual'],
          scheduleCron: '',
          chatPhrase: '',
          inputSchema: INPUT_SCHEMA,
        },
      },
      {
        id: 'mcp-brave',
        type: 'mcp_tool',
        position: { x: 320, y: 40 },
        data: {
          label: 'MCP Brave web search (BYOK)',
          taskConfig: {
            mcpInvokeKind: 'tool',
            mcpServerId: BRAVE_MCP_ID,
            toolName: 'brave_web_search',
            staticArguments: '{}',
            authBearer: '{{trigger-1.trigger_input.braveApiKey}}',
            httpHeadersJson: JSON.stringify({
              'X-Subscription-Token': '{{trigger-1.trigger_input.braveApiKey}}',
            }),
            timeoutMs: 120000,
            timeoutAction: 'fail',
          },
          inputBindings: [
            {
              id: 'arguments',
              label: 'Arguments (JSON)',
              mode: 'static',
              value:
                '{"query":"{{trigger-1.trigger_input.query}}","count":5}',
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
        id: 'api-brave',
        type: 'api',
        position: { x: 600, y: 40 },
        data: {
          label: 'API Brave REST (BYOK)',
          taskConfig: {
            method: 'GET',
            authType: 'none',
            bearerToken: '',
            httpHeadersJson: JSON.stringify({
              Accept: 'application/json',
              'X-Subscription-Token': '{{trigger-1.trigger_input.braveApiKey}}',
            }),
            timeoutMs: 120000,
            timeoutAction: 'fail',
          },
          inputBindings: [
            {
              id: 'url',
              label: 'URL',
              mode: 'static',
              value:
                'https://api.search.brave.com/res/v1/web/search?q={{trigger-1.trigger_input.query}}&count=5',
              sourceNodeId: '',
              sourceOutputKey: 'text',
            },
            {
              id: 'body',
              label: 'Request body',
              mode: 'static',
              value: '',
              sourceNodeId: '',
              sourceOutputKey: 'text',
            },
            {
              id: 'headers',
              label: 'Extra headers (JSON)',
              mode: 'static',
              value: '{}',
              sourceNodeId: '',
              sourceOutputKey: 'text',
            },
          ],
          outputs: [
            { id: 'status', label: 'HTTP status' },
            { id: 'body', label: 'Response body' },
            { id: 'ok', label: 'Success (2xx)' },
          ],
        },
      },
      {
        id: 'brain-1',
        type: 'brain',
        position: { x: 880, y: 160 },
        data: {
          label: 'Brain summarize (BYOK key)',
          taskConfig: {
            modelSource: brainSource,
            apiEndpoint: brainEndpoint,
            apiKey: '{{trigger-1.trigger_input.brainApiKey}}',
            model: brainModel,
            maxTokens: 600,
            mcpToolCalling: false,
            systemPrompt: `You summarize Brave Search results. Cite 2–3 URLs. Be concise (5–8 sentences). Ignore huge raw JSON — use titles/URLs/snippets only.

Query: {{trigger-1.trigger_input.query}}

MCP results (truncated):
{{mcp-brave.text}}

API HTTP status: {{api-brave.status}}
API body (truncated):
{{api-brave.body}}`,
            timeoutMs: 180000,
            timeoutAction: 'fail',
          },
          inputBindings: [
            {
              id: 'userMessage',
              label: 'User message',
              mode: 'static',
              value: 'Summarize the Brave search results for: {{trigger-1.trigger_input.query}}',
              sourceNodeId: '',
              sourceOutputKey: 'text',
            },
          ],
          outputs: [
            { id: 'text', label: 'Response' },
            { id: 'model_used', label: 'Model' },
          ],
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'mcp-brave' },
      { id: 'e2', source: 'mcp-brave', target: 'api-brave' },
      { id: 'e3', source: 'api-brave', target: 'brain-1' },
    ],
    viewport: { x: 0, y: 0, zoom: 0.85 },
  };
}

export function seedBalajiBraveByokWorkflow(ownerUserId, { publish = true } = {}) {
  const actor = { id: 'seed-balaji-brave-byok', name: 'Seed script', type: 'system' };
  const graph = buildBalajiBraveByokGraph();
  const patch = {
    name: 'Balaji Brave BYOK (MCP + API + Brain)',
    description:
      'Trigger supplies brainApiKey + braveApiKey + query. MCP and API call Brave with workflow keys only (no platform BRAVE_API_KEY). Brain uses trigger brainApiKey.',
    graph,
    trigger_modes: ['manual'],
    schedule_cron: '',
    chat_trigger_phrase: '',
  };

  const existing = store.getDefinition(WORKFLOW_ID, ownerUserId);
  if (existing) {
    store.updateDraft(WORKFLOW_ID, ownerUserId, patch, actor);
  } else {
    getDb()
      .prepare(
        `INSERT INTO agent_workflow_definitions (id, name, description, owner_user_id, draft_graph_json, status, trigger_modes)
         VALUES (?, ?, ?, ?, ?, 'draft', ?)`
      )
      .run(
        WORKFLOW_ID,
        patch.name,
        patch.description,
        ownerUserId,
        JSON.stringify(graph),
        patch.trigger_modes.join(',')
      );
  }
  if (publish) return store.publishDefinition(WORKFLOW_ID, ownerUserId, actor);
  return store.getDefinition(WORKFLOW_ID, ownerUserId);
}

if (process.argv[1]?.includes('seed-balaji-brave-byok-workflow')) {
  let owner;
  try {
    owner = process.env.WORKFLOW_SEED_OWNER_ID || getBalaCeoAuthId();
  } catch {
    owner =
      getDb().prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1 LIMIT 1`).get()?.id ||
      'ceo-bala';
  }
  const def = seedBalajiBraveByokWorkflow(owner, { publish: true });
  console.log('Published:', def.id, def.name, 'owner=', owner);
}
