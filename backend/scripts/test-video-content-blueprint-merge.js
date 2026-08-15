/**
 * Assert video_content + Balaji demo blueprints expose the tested studio
 * (Content Orchestrator + W-Reasoning/Media/Assembly graphs from standard/).
 *
 * Usage: node backend/scripts/test-video-content-blueprint-merge.js
 */
import assert from 'assert';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '../../deploy/.env') });

const { initDb } = await import('../src/db/schema.js');
const { invalidateBlueprintCache, getBlueprint } = await import('../src/services/company-blueprints/index.js');
const {
  blueprintWantsVideoContent,
  isVideoWorkflowTemplate,
} = await import('../src/services/company-blueprints/video-content-pack.js');

initDb();
invalidateBlueprintCache();

function videoTemplates(bp) {
  return (bp.workflow_templates || []).filter((t) => isVideoWorkflowTemplate(t));
}

function agentNames(bp) {
  return (bp.agents || []).map((a) => String(a.name || ''));
}

const video = getBlueprint('video_content');
assert.ok(video?.id === 'video_content', 'video_content pack loads');
assert.ok(blueprintWantsVideoContent(video), 'video_content wants video studio');
assert.ok(agentNames(video).includes('Content Orchestrator'), 'video pack has Content Orchestrator');
assert.ok(
  (video.agents || []).find((a) => a.name === 'Content Orchestrator')?.id_pattern === 'video-orch-{ownerSlug}',
  'orchestrator id_pattern is tested prefab id'
);
const vWf = videoTemplates(video);
assert.strictEqual(vWf.length, 3, `video pack should have 3 graphs, got ${vWf.length}`);
for (const key of ['video-reasoning', 'video-media', 'video-assembly']) {
  const t = vWf.find((w) => w.template_key === key);
  assert.ok(t, `missing ${key}`);
  assert.ok((t.graph?.nodes || []).length > 0, `${key} must embed tested graph nodes`);
}

const demo = getBlueprint('demo_balaji_ranganathan');
assert.ok(demo?.id === 'demo_balaji_ranganathan', 'demo pack loads');
assert.ok((demo.companion_packs || []).includes('video_content'), 'demo companions video_content');
assert.ok(blueprintWantsVideoContent(demo), 'Balaji demo wants tested video studio');
assert.ok(agentNames(demo).includes('Content Orchestrator'), 'demo includes Content Orchestrator');
assert.ok(agentNames(demo).includes('Story Agent'), 'demo includes Story Agent');
assert.ok(
  (demo.knowledge_tables || []).some((t) => t.name === 'video_characters'),
  'demo includes video_characters Master Data'
);
const dWf = videoTemplates(demo);
assert.strictEqual(dWf.length, 3, `demo should overlay 3 video graphs, got ${dWf.length}`);
const reasoning = dWf.find((w) => w.template_key === 'video-reasoning');
assert.ok((reasoning?.graph?.nodes || []).some((n) => n.type === 'ceo_approval'), 'tested cast/storyboard CEO gates');

const general = getBlueprint('general_ops');
assert.ok(!blueprintWantsVideoContent(general), 'general_ops does not get video studio');

console.log(
  JSON.stringify(
    {
      ok: true,
      video_content: {
        agents: agentNames(video),
        workflows: vWf.map((w) => ({ key: w.template_key, nodes: (w.graph?.nodes || []).length })),
      },
      demo_balaji_ranganathan: {
        companion_packs: demo.companion_packs,
        video_agents: agentNames(demo).filter((n) =>
          /content orchestrator|story agent|scene planner|prompt agent/i.test(n)
        ),
        video_workflows: dWf.map((w) => ({ key: w.template_key, nodes: (w.graph?.nodes || []).length })),
      },
    },
    null,
    2
  )
);
