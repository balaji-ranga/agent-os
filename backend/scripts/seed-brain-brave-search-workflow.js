/**
 * Seed a simple Brain workflow that uses Brave Search MCP tool-calling.
 * Run: node backend/scripts/seed-brain-brave-search-workflow.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '../../deploy/.env') });

import { initDb, getDb } from '../src/db/schema.js';
import * as store from '../src/services/agent-workflow-store.js';
import { BRAVE_MCP_ID } from './seed-brave-search-mcp.js';

initDb();

export const WORKFLOW_ID = 'test-brain-brave-search';

function brainProviderConfig() {
  const source = (process.env.BRAIN_BRAVE_TEST_PROVIDER || 'deepseek').toLowerCase();
  // Workflow Brain requires per-node apiKey (no platform .env fallback at publish/run).
  const deepseekKey = String(
    process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENAI_PRIMARY_API_KEY || ''
  ).trim();
  const openaiKey = String(process.env.OPENAI_API_KEY || process.env.OPENAI_PRIMARY_API_KEY || '').trim();

  if (source === 'openai') {
    if (!openaiKey) throw new Error('OPENAI_API_KEY required for BRAIN_BRAVE_TEST_PROVIDER=openai');
    return {
      modelSource: 'openai',
      model: process.env.OPENAI_PRIMARY_MODEL || 'gpt-4o-mini',
      apiKey: openaiKey,
      maxTokens: 1200,
    };
  }
  if (source === 'ollama') {
    return {
      modelSource: 'ollama',
      apiEndpoint: process.env.OLLAMA_BASE_URL || 'http://ollama:11434/v1',
      model: process.env.OLLAMA_MODEL || 'llama3.2',
      apiKey: 'ollama',
      maxTokens: 1200,
    };
  }
  if (!deepseekKey) {
    throw new Error(
      'Set DEEPSEEK_API_KEY or OPENAI_API_KEY in env for Brain node (workflow keys are per-node)'
    );
  }
  return {
    modelSource: 'deepseek',
    apiEndpoint: process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    model: process.env.OPENAI_PRIMARY_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    apiKey: deepseekKey,
    maxTokens: 1200,
  };
}

export function buildBrainBraveSearchGraph() {
  const brainCfg = {
    ...brainProviderConfig(),
    mcpToolCalling: true,
    mcpServerIds: [BRAVE_MCP_ID],
    mcpToolAllowlist: ['brave_web_search'],
    mcpMaxToolRounds: 4,
    systemPrompt: `You are a research assistant with Brave Search MCP.

User question:
{{input}}

Instructions:
1. Call brave_web_search once with a clear query derived from the user question (count 5).
2. Read the titles/snippets/URLs returned.
3. Reply with a short answer (5–8 sentences max) citing 2–3 source URLs.

Do not invent URLs. If search fails, say so plainly. Do not greet — answer the question.`,
  };

  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 120 },
        data: {
          label: 'Start',
          triggerModes: ['manual'],
          scheduleCron: '',
          chatPhrase: '',
        },
      },
      {
        id: 'brain-1',
        type: 'brain',
        position: { x: 280, y: 120 },
        data: {
          label: 'Brain + Brave Search',
          inputBindings: [
            {
              id: 'userMessage',
              label: 'User message',
              mode: 'dynamic',
              sourceNodeId: 'trigger-1',
              sourceOutputKey: 'text',
            },
          ],
          taskConfig: brainCfg,
          outputs: [
            { id: 'text', label: 'Response' },
            { id: 'mcp_tool_calls', label: 'MCP tool calls' },
          ],
        },
      },
    ],
    edges: [{ id: 'e1', source: 'trigger-1', target: 'brain-1' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function seedBrainBraveSearchWorkflow(ownerUserId, { publish = true } = {}) {
  const actor = { id: 'seed-brain-brave', name: 'Seed script', type: 'system' };
  const graph = buildBrainBraveSearchGraph();
  const patch = {
    name: 'Brain Brave Search (test)',
    description: 'Simple Brain node with Brave Search MCP (brave_web_search) tool-calling.',
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

if (process.argv[1]?.includes('seed-brain-brave-search-workflow')) {
  const owner =
    process.env.WORKFLOW_SEED_OWNER_ID ||
    getDb().prepare(`SELECT id FROM platform_users WHERE role = 'ceo' LIMIT 1`).get()?.id ||
    'ceo-bala';
  const def = seedBrainBraveSearchWorkflow(owner, { publish: true });
  console.log('Published:', def.id, def.name, 'owner=', owner);
}
