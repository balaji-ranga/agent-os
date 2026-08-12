/**
 * E2E S4 Flavour1 (flow_browser) + S5 assemble on existing Thenali storyboard.
 * Usage: node scripts/e2e-video-s4s5-flow-thenali.mjs [storyboard_id]
 *
 * Flavour1 durable path: per-scene ≤8s clips via flow_browser (fixture clips stand in for
 * Flow downloads when worker cannot complete UI gens) → video_assemble → video_generated.
 */
import { initDb, getDb } from '../src/db/schema.js';
import { seedVideoStoryboardToolsIfMissing } from '../src/db/seed-content-tools-meta.js';
import { ensurePrefabVideoAgents } from '../src/services/prefab-video-agents.js';
import { seedVideoContentWorkflowsForOwner } from '../src/services/video-content-workflows.js';
import {
  STORY_STATUS,
  getVideoStoryboardRecord,
  updateVideoStoryboardStatus,
  listVideoStoryStatuses,
} from '../src/services/video-storyboard-export.js';
import { generateVideoMedia, listVideoJobs, buildAssetManifest } from '../src/services/video-media.js';
import { assembleVideoStoryboard } from '../src/services/video-assemble.js';
import { isBrowserWorkerOnline } from '../src/services/browser-worker-dispatch.js';

const owner = 'ceo-bala';
const preferredId = String(process.argv[2] || 'sb-7bbc73ee').trim();

initDb();
seedVideoStoryboardToolsIfMissing();
await ensurePrefabVideoAgents(owner, { forcePushTemplates: true, seedWorkflows: true });
seedVideoContentWorkflowsForOwner(owner);

let board = getVideoStoryboardRecord(owner, { storyboard_id: preferredId });
if (!board) {
  const listed = listVideoStoryStatuses(owner, { title: 'thenali', limit: 20 });
  const hit =
    listed.stories?.find((s) => /thenali/i.test(s.title || '')) ||
    listed.stories?.find((s) => s.has_exports) ||
    listed.stories?.[0];
  if (hit?.storyboard_id) board = getVideoStoryboardRecord(owner, { storyboard_id: hit.storyboard_id });
}
if (!board?.storyboard_id) {
  console.error('FAIL: no Thenali/storyboard row for', owner);
  process.exit(1);
}

const storyboard_id = board.storyboard_id;
let plan = {};
try {
  plan = typeof board.plan_json === 'string' ? JSON.parse(board.plan_json || '{}') : board.plan_json || {};
} catch {
  plan = {};
}
if (!Array.isArray(plan.scenes) || !plan.scenes.length) {
  console.error('FAIL: storyboard has no scenes in plan_json', storyboard_id);
  process.exit(1);
}
// Cap scenes to ≤8s in plan awareness for S4
plan.scenes = plan.scenes.map((sc, i) => ({
  ...sc,
  index: sc.index ?? i + 1,
  duration_sec: Math.min(8, Number(sc.duration_sec) || 8),
}));

if (board.status !== STORY_STATUS.CEO_APPROVED && board.status !== STORY_STATUS.VIDEO_GENERATED) {
  updateVideoStoryboardStatus(owner, { storyboard_id, status: STORY_STATUS.CEO_APPROVED });
  board = getVideoStoryboardRecord(owner, { storyboard_id });
}

const workerOnline = isBrowserWorkerOnline(owner);
console.log(
  JSON.stringify(
    {
      phase: 'preflight',
      storyboard_id,
      title: board.title,
      status: board.status,
      worker_online: workerOnline,
      note: 'Flavour1 uses ≤8s/scene; fixtures stand in for Flow downloads when use_test_clips=true',
    },
    null,
    2
  )
);

const s4 = await generateVideoMedia(owner, {
  storyboard_id,
  provider: 'flow_browser',
  force: true,
  use_test_clips: true,
});
console.log(
  JSON.stringify(
    {
      phase: 's4_flow_browser',
      provider: s4.provider,
      complete: s4.manifest?.complete,
      missing: s4.manifest?.missing_scenes,
      actions: s4.results?.map((r) => ({ scene: r.scene_index, action: r.action, status: r.status })),
    },
    null,
    2
  )
);

const jobs = listVideoJobs(owner, { storyboard_id });
const manifest = buildAssetManifest(owner, storyboard_id);
if (!manifest.complete) {
  console.error('FAIL: S4 manifest incomplete', manifest.missing_scenes, jobs.jobs);
  process.exit(1);
}

const s5 = await assembleVideoStoryboard(owner, { storyboard_id });
const after = getVideoStoryboardRecord(owner, { storyboard_id });
const pass = s5.ok && after?.status === STORY_STATUS.VIDEO_GENERATED && Boolean(s5.final_video_path);

console.log(
  JSON.stringify(
    {
      phase: 's5_assemble',
      ok: s5.ok,
      status: after?.status,
      final_video_path: s5.final_video_path,
      paste_preview: String(s5.paste_block || '').slice(0, 200),
      scenes_assembled: s5.scenes_assembled,
      pass,
    },
    null,
    2
  )
);

if (!pass) process.exit(1);
console.log('PASS: S4 Flavour1 + S5 Thenali → video_generated');
