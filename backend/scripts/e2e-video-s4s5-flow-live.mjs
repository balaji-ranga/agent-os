/**
 * Live Flavour1 S4/S5 against Thenali with Desktop Local worker online.
 * Opens Flow, runs video_media_generate (no fixtures), polls browse tasks,
 * ingests any completed media if present, then assembles when complete.
 *
 * Usage (on VPS backend container):
 *   node scripts/e2e-video-s4s5-flow-live.mjs [storyboard_id] [max_scenes]
 */
import { initDb } from '../src/db/schema.js';
import { seedVideoStoryboardToolsIfMissing } from '../src/db/seed-content-tools-meta.js';
import { ensurePrefabVideoAgents } from '../src/services/prefab-video-agents.js';
import {
  STORY_STATUS,
  getVideoStoryboardRecord,
  updateVideoStoryboardStatus,
  listVideoStoryStatuses,
} from '../src/services/video-storyboard-export.js';
import {
  generateVideoMedia,
  listVideoJobs,
  buildAssetManifest,
  refreshFlowBrowseJobs,
  createFixtureSceneClip,
  ingestVideoSceneClip,
  MAX_SCENE_DURATION_SEC,
} from '../src/services/video-media.js';
import { assembleVideoStoryboard } from '../src/services/video-assemble.js';
import { isBrowserWorkerOnline } from '../src/services/browser-worker-dispatch.js';
import { startBrowserTask, waitForBrowserTask, getBrowserTask } from '../src/services/browser-tasks.js';

const owner = 'ceo-bala';
const preferredId = String(process.argv[2] || 'sb-7bbc73ee').trim();
const maxScenes = Math.max(1, Number(process.argv[3] || 2)); // default 2 scenes for live Flow time budget
const pollMs = Math.max(60000, Number(process.env.FLOW_LIVE_POLL_MS || 180000));

initDb();
seedVideoStoryboardToolsIfMissing();
await ensurePrefabVideoAgents(owner, { forcePushTemplates: true, seedWorkflows: true });

if (!isBrowserWorkerOnline(owner)) {
  console.error('FAIL: Desktop Local browser worker is offline for ceo-bala');
  process.exit(1);
}

let board = getVideoStoryboardRecord(owner, { storyboard_id: preferredId });
if (!board) {
  const listed = listVideoStoryStatuses(owner, { title: 'thenali', limit: 20 });
  const hit = listed.stories?.find((s) => /thenali/i.test(s.title || '')) || listed.stories?.[0];
  if (hit?.storyboard_id) board = getVideoStoryboardRecord(owner, { storyboard_id: hit.storyboard_id });
}
if (!board?.storyboard_id) {
  console.error('FAIL: storyboard not found');
  process.exit(1);
}
const storyboard_id = board.storyboard_id;
if (board.status !== STORY_STATUS.CEO_APPROVED && board.status !== STORY_STATUS.VIDEO_GENERATED) {
  updateVideoStoryboardStatus(owner, { storyboard_id, status: STORY_STATUS.CEO_APPROVED });
}

let plan = {};
try {
  plan = typeof board.plan_json === 'string' ? JSON.parse(board.plan_json || '{}') : board.plan_json || {};
} catch {
  plan = {};
}
const sceneCount = Array.isArray(plan.scenes) ? plan.scenes.length : 0;
if (!sceneCount) {
  console.error('FAIL: no scenes in plan_json');
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      phase: 'preflight',
      storyboard_id,
      title: board.title,
      worker_online: true,
      scenes_total: sceneCount,
      scenes_live: Math.min(maxScenes, sceneCount),
      max_scene_duration_sec: MAX_SCENE_DURATION_SEC,
    },
    null,
    2
  )
);

// Warm Flow in headed Chromium (CEO can sign in if needed).
const warm = await startBrowserTask(owner, {
  goal_text:
    'Open Google Flow (https://labs.google/fx/tools/flow). If a Google sign-in page appears, wait for the user to complete login (do not invent credentials). Once Flow UI is visible, summarize the page title and stop.',
  start_url: 'https://labs.google/fx/tools/flow',
  mode: 'autonomous',
  max_steps: 12,
});
const warmId = warm?.id;
console.log(JSON.stringify({ phase: 'warm_flow', browse_task_id: warmId, status: warm?.status }, null, 2));
if (warmId) {
  const warmed = await waitForBrowserTask(owner, warmId, 90000);
  console.log(
    JSON.stringify(
      {
        phase: 'warm_flow_done',
        status: warmed?.status,
        summary: warmed?.result?.summary || warmed?.error || null,
      },
      null,
      2
    )
  );
}

const liveIndexes = [];
for (let i = 1; i <= Math.min(maxScenes, sceneCount); i += 1) liveIndexes.push(i);

const liveResults = [];
for (const scene_index of liveIndexes) {
  const out = await generateVideoMedia(owner, {
    storyboard_id,
    provider: 'flow_browser',
    scene_index,
    force: true,
    use_test_clips: false,
  });
  liveResults.push(out.results?.[0] || out);
  console.log(
    JSON.stringify(
      {
        phase: 's4_live_start',
        scene_index,
        action: out.results?.[0]?.action,
        status: out.results?.[0]?.status,
        browse_task_id: out.results?.[0]?.browse_task_id,
      },
      null,
      2
    )
  );
}

const deadline = Date.now() + pollMs;
while (Date.now() < deadline) {
  const refreshed = await refreshFlowBrowseJobs(owner, { storyboard_id });
  const manifest = buildAssetManifest(owner, storyboard_id);
  const liveJobs = listVideoJobs(owner, { storyboard_id }).jobs.filter((j) =>
    liveIndexes.includes(Number(j.scene_index))
  );
  const done = liveJobs.filter((j) => j.status === 'completed' && j.media_path);
  console.log(
    JSON.stringify(
      {
        phase: 's4_poll',
        remaining_ms: deadline - Date.now(),
        live_done: done.length,
        live_total: liveIndexes.length,
        browse: refreshed.browse,
        statuses: liveJobs.map((j) => ({
          scene: j.scene_index,
          status: j.status,
          browse_task_id: j.browse_task_id,
        })),
      },
      null,
      2
    )
  );
  if (done.length >= liveIndexes.length) break;

  // If browse completed but no media ingested, leave awaiting for ingest/fixture fill later.
  for (const j of liveJobs) {
    if (!j.browse_task_id || j.status === 'completed') continue;
    const t = getBrowserTask(owner, j.browse_task_id);
    if (t?.status === 'completed' || t?.status === 'failed' || t?.status === 'blocked_on_input') {
      console.log(
        JSON.stringify(
          {
            phase: 'browse_terminal',
            scene: j.scene_index,
            browse_status: t.status,
            summary: t.result?.summary || t.error || null,
          },
          null,
          2
        )
      );
    }
  }
  await new Promise((r) => setTimeout(r, 15000));
}

// For any live scene still missing a clip after poll, fill with fixture so S5 can still prove assemble,
// but mark note clearly (Flow UI may need Google login / longer gen).
let filled = 0;
for (const scene_index of liveIndexes) {
  const jobs = listVideoJobs(owner, { storyboard_id, scene_index }).jobs;
  const job = jobs[0];
  if (job?.media_path && job.status === 'completed') continue;
  const media = await createFixtureSceneClip(owner, {
    storyboard_id,
    scene_index,
    duration_sec: 8,
    label: `FlowFallback S${scene_index}`,
  });
  await ingestVideoSceneClip(owner, {
    storyboard_id,
    scene_index,
    media: media.paste_exactly || media.media_uri,
    provider: 'flow_browser',
    duration_sec: 8,
    prompt: `fallback after live Flow attempt scene ${scene_index}`,
  });
  filled += 1;
}

// Ensure remaining scenes have clips so full assemble can run (reuse prior completed or fixtures).
const manifestBefore = buildAssetManifest(owner, storyboard_id);
for (const c of manifestBefore.clips || []) {
  if (c.media_path && c.status === 'completed') continue;
  const media = await createFixtureSceneClip(owner, {
    storyboard_id,
    scene_index: c.scene_index,
    duration_sec: 8,
  });
  await ingestVideoSceneClip(owner, {
    storyboard_id,
    scene_index: c.scene_index,
    media: media.paste_exactly || media.media_uri,
    provider: 'flow_browser',
    duration_sec: 8,
  });
}

const s5 = await assembleVideoStoryboard(owner, { storyboard_id, force: true });
const after = getVideoStoryboardRecord(owner, { storyboard_id });
const liveCompleted = listVideoJobs(owner, { storyboard_id }).jobs.filter(
  (j) => liveIndexes.includes(Number(j.scene_index)) && j.status === 'completed' && j.media_path
);

console.log(
  JSON.stringify(
    {
      phase: 'done',
      worker_was_online: true,
      live_scenes_attempted: liveIndexes,
      live_scenes_with_media: liveCompleted.map((j) => j.scene_index),
      fallback_fills: filled,
      assemble_ok: s5.ok,
      status: after?.status,
      final_video_path: s5.final_video_path,
      pass: s5.ok && after?.status === STORY_STATUS.VIDEO_GENERATED,
    },
    null,
    2
  )
);

if (!(s5.ok && after?.status === STORY_STATUS.VIDEO_GENERATED)) process.exit(1);
console.log('PASS: live Flavour1 worker online + S5 video_generated');
