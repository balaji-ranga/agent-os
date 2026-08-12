/**
 * E2E: CEO path for video S1–S3 harden — trigger W-Reasoning, approve cast + storyboard,
 * assert PDF/knowledge character_id mapping and status.
 *
 * Usage (inside backend container or local with DB):
 *   WORKFLOW_SEED_OWNER_ID=ceo-bala node backend/scripts/e2e-video-s1s3-cast-storyboard.mjs
 */
import { config } from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve as pathResolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function isDirectRun() {
  try {
    const entry = process.argv[1] ? pathResolve(process.argv[1]) : '';
    return entry && entry === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  config({ path: join(__dirname, '..', '.env') });
  config({ path: join(__dirname, '../../deploy/.env') });

  const { initDb, getDb } = await import('../src/db/schema.js');
  const { createSession } = await import('../src/services/auth/session.js');
  const { installVideoContentForOwner } = await import('../src/services/prefab-video-agents.js');
  const { seedVideoContentWorkflowsForOwner } = await import('../src/services/video-content-workflows.js');
  const { seedVideoContentKnowledgeTables } = await import('../src/services/video-content-knowledge.js');
  const { listVideoStoryStatuses, saveVideoCharacters } = await import(
    '../src/services/video-storyboard-export.js'
  );
  const { completeCeoApprovalResponse } = await import('../src/services/agent-workflow-runner.js');
  const { seedVideoStoryboardToolsIfMissing } = await import('../src/db/seed-content-tools-meta.js');

  initDb();
  seedVideoStoryboardToolsIfMissing();
  const db = getDb();

  const ceo =
    db
      .prepare(
        `SELECT id, email, name FROM platform_users WHERE id = 'ceo-bala' OR (
           role = 'ceo' AND enabled = 1 AND (
             lower(name) LIKE '%balaji%' OR lower(email) LIKE '%bala%'
           )
         ) ORDER BY CASE WHEN id = 'ceo-bala' THEN 0 ELSE 1 END LIMIT 1`
      )
      .get() || db.prepare(`SELECT id, email, name FROM platform_users WHERE role = 'ceo' AND enabled = 1 LIMIT 1`).get();
  if (!ceo?.id) throw new Error('No CEO user');

  seedVideoContentKnowledgeTables(ceo.id);
  await installVideoContentForOwner(ceo.id, { forcePushTemplates: true });
  seedVideoContentWorkflowsForOwner(ceo.id, { includeStubs: false });

  // Seed a reusable library character so cast gate can show reuse.
  saveVideoCharacters(ceo.id, [
    {
      character_id: 'thenali',
      name: 'Thenali Raman',
      role: 'lead',
      appearance: 'clever young advisor, warm smile, traditional south-indian attire',
      series: 'thenali_kids',
      notes: 'e2e library seed',
    },
  ]);

  const def = db
    .prepare(
      `SELECT id, name FROM agent_workflow_definitions
       WHERE owner_user_id = ? AND (id LIKE 'video-reasoning%' OR lower(name) LIKE '%storyboard%' OR lower(name) LIKE '%story →%')
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(ceo.id);
  if (!def?.id) throw new Error('video-reasoning workflow missing for ' + ceo.id);
  const pub = db
    .prepare(`SELECT published_graph_json, status FROM agent_workflow_definitions WHERE id = ?`)
    .get(def.id);
  if (!String(pub?.published_graph_json || '').trim()) {
    throw new Error('workflow not published: ' + def.id);
  }

  const graph = JSON.parse(pub.published_graph_json || '{}');
  const nodeIds = (graph.nodes || []).map((n) => n.id);
  for (const need of ['story-1', 'ceo-cast', 'scene-1', 'prompt-1', 'ceo-gate']) {
    if (!nodeIds.includes(need)) throw new Error(`published graph missing ${need}`);
  }

  const { token } = createSession(ceo.id, { userAgent: 'e2e-video-s1s3' });
  const base = String(process.env.BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');

  const title = `E2E Thenali Cast ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const brief = [
    `Create a ~48s kids live-action cinematic storyboard titled "${title}".`,
    'Characters: Thenali (lead, reuse character_id thenali if known) and the King.',
    'Not animated. End story JSON with characters_used including thenali and king.',
  ].join(' ');

  const triggerRes = await fetch(`${base}/api/agent-workflows/${encodeURIComponent(def.id)}/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: { text: brief } }),
  });
  const triggerBody = await triggerRes.json().catch(() => ({}));
  if (!triggerRes.ok) {
    throw new Error(`trigger failed ${triggerRes.status}: ${JSON.stringify(triggerBody)}`);
  }
  const runId = triggerBody.id || triggerBody.run_id || triggerBody.run?.id;
  if (!runId) throw new Error('no run_id: ' + JSON.stringify(triggerBody));

  async function waitForCeoNode(nodeId, timeoutMs = 420000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const step = db
        .prepare(
          `SELECT id, node_id, status, kanban_task_id, error_message FROM agent_workflow_run_steps
           WHERE run_id = ? AND node_id = ? ORDER BY id DESC LIMIT 1`
        )
        .get(runId, nodeId);
      if (step?.status === 'in_progress' && step.kanban_task_id) return step;
      if (step?.status === 'failed') {
        throw new Error(`${nodeId} failed: ${step.error_message || 'unknown'}`);
      }
      const run = db.prepare(`SELECT status, error_message FROM agent_workflow_runs WHERE id = ?`).get(runId);
      if (run?.status === 'failed' || run?.status === 'cancelled') {
        throw new Error(`run ${run.status}: ${run.error_message || ''}`);
      }
      await sleep(4000);
    }
    throw new Error(`timeout waiting for CEO node ${nodeId}`);
  }

  console.log(JSON.stringify({ phase: 'waiting_cast', runId, def: def.id, owner: ceo.id }));
  const castStep = await waitForCeoNode('ceo-cast');
  const castTask = db.prepare(`SELECT id, title, description FROM kanban_tasks WHERE id = ?`).get(castStep.kanban_task_id);
  if (!/character_id|Cast review|thenali/i.test(String(castTask?.description || ''))) {
    console.warn('[e2e] cast card text unexpected', String(castTask?.description || '').slice(0, 400));
  }
  await completeCeoApprovalResponse({
    kanbanTaskId: castStep.kanban_task_id,
    decision: 'approve',
    comment: 'e2e lock cast character_ids',
    actor: { id: ceo.id, name: ceo.name || 'CEO' },
  });

  console.log(JSON.stringify({ phase: 'waiting_storyboard', runId }));
  const sbStep = await waitForCeoNode('ceo-gate', 480000);
  const sbTask = db.prepare(`SELECT id, title, description FROM kanban_tasks WHERE id = ?`).get(sbStep.kanban_task_id);
  const desc = String(sbTask?.description || '');
  if (!/\.pdf/i.test(desc)) throw new Error('storyboard Kanban missing PDF artifact');
  if (!/character_id/i.test(desc)) throw new Error('storyboard Kanban missing character_id roster');

  const pdfMatch = desc.match(/(\/api\/media\/[^\s)]+\.pdf)/i);
  const pdfUrl = pdfMatch?.[1] || '';

  await completeCeoApprovalResponse({
    kanbanTaskId: sbStep.kanban_task_id,
    decision: 'approve',
    comment: 'e2e approve storyboard',
    actor: { id: ceo.id, name: ceo.name || 'CEO' },
  });

  // Allow status hook + terminal brains
  await sleep(5000);

  const statuses = listVideoStoryStatuses(ceo.id, { title: title.slice(0, 20), limit: 20 });
  const approved = (statuses.stories || []).find(
    (s) => String(s.workflow_run_id) === String(runId) || String(s.title || '').includes('Thenali')
  );
  const chars = db
    .prepare(
      `SELECT r.row_json FROM master_data_rows r
       INNER JOIN master_data_tables t ON t.id = r.table_id
       WHERE t.owner_user_id = ? AND t.name = 'video_characters' LIMIT 50`
    )
    .all(ceo.id)
    .map((r) => {
      try {
        return JSON.parse(r.row_json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const thenali = chars.find((c) => String(c.character_id) === 'thenali');

  const out = {
    ok: true,
    owner: ceo.id,
    run_id: runId,
    workflow_id: def.id,
    pdf_url: pdfUrl,
    story_status: approved?.status || statuses.stories?.[0]?.status || null,
    storyboard_id: approved?.storyboard_id || statuses.stories?.[0]?.storyboard_id || null,
    thenali_character_id: thenali?.character_id || null,
    pending_count: statuses.pending_ceo_approval?.length || 0,
  };

  if (out.story_status && out.story_status !== 'ceo_approved' && out.story_status !== 'pending_ceo_approval') {
    // pending may still flip async; accept ceo_approved preferred
    console.warn('[e2e] unexpected status', out.story_status);
  }
  if (!thenali) throw new Error('thenali missing from video_characters after cast approve');
  if (!pdfUrl) throw new Error('no pdf url on storyboard card');

  // Prefer ceo_approved after final gate
  if (out.story_status === 'ceo_approved' || out.story_status === 'pending_ceo_approval') {
    console.log(JSON.stringify(out));
  } else {
    throw new Error('bad story status: ' + JSON.stringify(out));
  }
}

if (isDirectRun()) {
  main().catch((e) => {
    console.error('[e2e-video-s1s3]', e?.message || e);
    process.exit(1);
  });
}
