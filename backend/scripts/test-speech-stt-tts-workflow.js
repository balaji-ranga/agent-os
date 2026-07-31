/**
 * E2E: free speech_tts (Piper) -> speech_stt (Whisper) workflow round-trip.
 * Usage (backend container or host with SPEECH_* pointing at voice services):
 *   node scripts/test-speech-stt-tts-workflow.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import * as store from '../src/services/agent-workflow-store.js';
import { startAgentWorkflowRun } from '../src/services/agent-workflow-runner.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';

initDb();

const WORKFLOW_ID = 'test-speech-stt-tts-roundtrip';
const SPEAK_TEXT =
  process.env.SPEECH_TEST_TEXT ||
  'Agent OS speech test. Piper speaks and Whisper listens back.';
const ownerUserId = process.env.WORKFLOW_TEST_OWNER_USER_ID || getBalaCeoAuthId();

function buildGraph() {
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 120 },
        data: { label: 'Start', triggerModes: ['manual'] },
      },
      {
        id: 'tts-1',
        type: 'speech_tts',
        position: { x: 260, y: 120 },
        data: {
          label: 'Piper TTS',
          inputBindings: [
            {
              id: 'text',
              mode: 'static',
              value: SPEAK_TEXT,
            },
          ],
          taskConfig: {
            speakClean: 'false',
            lengthScale: '1.0',
          },
        },
      },
      {
        id: 'stt-1',
        type: 'speech_stt',
        position: { x: 500, y: 120 },
        data: {
          label: 'Whisper STT',
          inputBindings: [
            {
              id: 'audio',
              mode: 'dynamic',
              sourceNodeId: 'tts-1',
              sourceOutputKey: 'audio',
            },
          ],
          taskConfig: {
            model: 'whisper-1',
            language: 'en',
          },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'tts-1' },
      { id: 'e2', source: 'tts-1', target: 'stt-1' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

async function waitForRun(runId, maxMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const row = getDb()
      .prepare(`SELECT status, context_json, error_message FROM agent_workflow_runs WHERE id = ?`)
      .get(runId);
    if (!row) throw new Error(`run ${runId} missing`);
    if (row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled') {
      return row;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`run ${runId} timed out`);
}

function parseCtx(row) {
  try {
    return JSON.parse(row.context_json || '{}');
  } catch {
    return {};
  }
}

console.log('[speech-wf] SPEECH_STT_URL=', process.env.SPEECH_STT_URL || '(unset)');
console.log('[speech-wf] SPEECH_TTS_URL=', process.env.SPEECH_TTS_URL || '(unset)');
console.log('[speech-wf] owner=', ownerUserId);
console.log('[speech-wf] text=', SPEAK_TEXT);

if (!process.env.SPEECH_STT_URL || !process.env.SPEECH_TTS_URL) {
  console.error('SPEECH_STT_URL and SPEECH_TTS_URL must be set (optional-voice profile).');
  process.exit(1);
}

const actor = { id: 'speech-wf-test', name: 'Speech Workflow Test', type: 'system' };
const graph = buildGraph();
let def = store.getDefinition(WORKFLOW_ID, ownerUserId);
if (!def) {
  def = store.createDefinition({
    id: WORKFLOW_ID,
    name: 'Speech STT/TTS Roundtrip Test',
    ownerUserId,
    actor,
    graph,
    trigger_modes: ['manual'],
  });
} else {
  store.updateDraft(WORKFLOW_ID, ownerUserId, { graph, trigger_modes: ['manual'] }, actor);
}
store.publishDefinition(WORKFLOW_ID, ownerUserId, actor);

const run = await startAgentWorkflowRun(WORKFLOW_ID, ownerUserId, {
  trigger: 'manual',
  input: 'speech roundtrip',
  actor,
});
console.log('[speech-wf] started run', run.id);

const final = await waitForRun(run.id);
const ctx = parseCtx(final);
const ttsOut = ctx.node_outputs?.['tts-1'] || {};
const sttOut = ctx.node_outputs?.['stt-1'] || {};

console.log('[speech-wf] status=', final.status);
console.log(
  '[speech-wf] tts ok=',
  ttsOut.ok,
  'audio=',
  typeof ttsOut.audio === 'string' ? ttsOut.audio.slice(0, 80) : ttsOut.audio
);
console.log('[speech-wf] stt ok=', sttOut.ok, 'text=', String(sttOut.text || '').slice(0, 240));

if (final.status !== 'completed') {
  console.error('[speech-wf] FAILED', final.error_message || String(final.context_json || '').slice(0, 600));
  const steps = getDb()
    .prepare(
      `SELECT node_id, node_type, status, error_message FROM agent_workflow_run_steps WHERE run_id = ? ORDER BY id`
    )
    .all(run.id);
  console.error('[speech-wf] steps', JSON.stringify(steps, null, 2));
  process.exit(1);
}

const transcript = String(sttOut.text || '').toLowerCase();
const expectBits = ['agent', 'speech', 'test'];
const hits = expectBits.filter((w) => transcript.includes(w));
if (!ttsOut.audio) {
  console.error('[speech-wf] TTS produced no audio ref');
  process.exit(1);
}
if (!transcript || hits.length < 1) {
  console.error('[speech-wf] STT transcript too weak:', transcript);
  process.exit(1);
}

console.log('SPEECH_STT_TTS_WORKFLOW_OK', { runId: run.id, transcriptHits: hits });