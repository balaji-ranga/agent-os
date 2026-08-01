/**
 * Seed (or refresh) a published "Summarize inbound media" workflow for each CEO.
 * Chat trigger phrase: inbound/attachments
 * Flow: chat path -> Whisper STT (resolves inbound/attachments path) -> Brain summary
 *
 * Usage: node backend/scripts/seed-inbound-media-summarize-workflow.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '../../deploy/.env') });

import { initDb, getDb } from '../src/db/schema.js';
import {
  createDefinition,
  publishDefinition,
  getDefinition,
  updateDraft,
} from '../src/services/agent-workflow-store.js';

initDb();
const db = getDb();
const allCeos = db.prepare(`SELECT id, name FROM platform_users WHERE role = 'ceo' AND enabled = 1`).all();
const ceos = allCeos.filter((ceo) => {
  const id = String(ceo.id || '');
  if (/^ceo-oc-connector-/i.test(id)) return false;
  if (/^ceo-os-rag-/i.test(id)) return false;
  if (/^ceo-md-[ab]-/i.test(id)) return false;
  return true;
});
if (!ceos.length) {
  console.warn('[seed-inbound-media] no eligible CEOs; nothing to seed');
  process.exit(0);
}

function brainProviderConfig() {
  const openaiKey = String(process.env.OPENAI_API_KEY || process.env.OPENAI_PRIMARY_API_KEY || '').trim();
  const deepseekKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  if (openaiKey) {
    return {
      modelSource: 'openai',
      model: process.env.OPENAI_PRIMARY_MODEL || 'gpt-4o-mini',
      apiKey: openaiKey,
      apiEndpoint: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      maxTokens: 900,
    };
  }
  if (deepseekKey) {
    return {
      modelSource: 'deepseek',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      apiKey: deepseekKey,
      apiEndpoint: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      maxTokens: 900,
    };
  }
  return {
    modelSource: 'ollama',
    apiEndpoint: process.env.OLLAMA_BASE_URL || 'http://ollama:11434/v1',
    model: process.env.OLLAMA_MODEL || 'llama3.2',
    apiKey: 'ollama',
    maxTokens: 900,
  };
}

const brainCfg = {
  ...brainProviderConfig(),
  systemPrompt:
    'You summarize uploaded audio/video for the CEO. Be concise (5-10 sentences). ' +
    'Use the transcript below. Mention key facts (numbers, names, actions).\n\n' +
    'Chat/input context:\n{{input}}\n\nTranscript:\n{{stt.text}}\n\n' +
    'If the transcript is empty or nonsense, say so.',
};

const GRAPH = {
  nodes: [
    {
      id: 'trigger',
      type: 'trigger',
      position: { x: 80, y: 120 },
      data: {
        label: 'Chat path trigger',
        triggerModes: ['chat', 'manual'],
        chatPhrase: 'inbound/attachments',
      },
    },
    {
      id: 'stt',
      type: 'speech_stt',
      position: { x: 360, y: 120 },
      data: {
        label: 'Transcribe media',
        taskConfig: { model: 'whisper-1' },
        inputBindings: [
          {
            id: 'audio',
            label: 'Audio/Video path or chat text',
            mode: 'dynamic',
            value: '{{input}}',
            sourceNodeId: 'trigger',
            sourceOutputKey: 'text',
          },
        ],
      },
    },
    {
      id: 'brain_summary',
      type: 'brain',
      position: { x: 640, y: 120 },
      data: {
        label: 'Summarize media',
        taskConfig: brainCfg,
        inputBindings: [
          {
            id: 'userMessage',
            label: 'User message',
            mode: 'dynamic',
            value: 'Summarize this inbound media transcript.',
            sourceNodeId: 'stt',
            sourceOutputKey: 'text',
          },
        ],
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'trigger', target: 'stt' },
    { id: 'e2', source: 'stt', target: 'brain_summary' },
  ],
};

const NAME = 'Summarize inbound media attachment';
let created = 0;
let updated = 0;

for (const ceo of ceos) {
  const existing = db
    .prepare(
      `SELECT id, status FROM agent_workflow_definitions WHERE owner_user_id = ? AND name = ? ORDER BY updated_at DESC LIMIT 1`
    )
    .get(ceo.id, NAME);
  const actor = { id: 'system', name: 'seed-inbound-media' };
  const patch = {
    name: NAME,
    description:
      'Trigger with relative path inbound/attachments/<filename>. Transcribes CEO workspace A/V via Whisper and asks Brain for a summary.',
    graph: GRAPH,
    trigger_modes: ['chat', 'manual'],
    chat_trigger_phrase: 'inbound/attachments',
  };
  if (existing) {
    updateDraft(existing.id, ceo.id, patch, actor);
    publishDefinition(existing.id, ceo.id, actor);
    updated += 1;
    console.log('updated', ceo.id, existing.id, getDefinition(existing.id, ceo.id)?.status);
    continue;
  }
  const safeCeo = String(ceo.id || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const forcedId = `summarize-inbound-media-${safeCeo || 'ceo'}`;
  const def = createDefinition({
    ...patch,
    ownerUserId: ceo.id,
    actor,
    id: forcedId,
  });
  publishDefinition(def.id, ceo.id, actor);
  created += 1;
  console.log('created', ceo.id, def.id, getDefinition(def.id, ceo.id)?.status);
}

console.log(JSON.stringify({ ok: true, created, updated, ceos: ceos.length, brain: brainCfg.modelSource }));