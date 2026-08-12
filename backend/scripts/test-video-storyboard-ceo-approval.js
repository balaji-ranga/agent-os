/**
 * Video storyboard CEO-gate: parse agent JSON, format summary, export PDF URLs.
 *
 * Usage:
 *   node backend/scripts/test-video-storyboard-ceo-approval.js
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve as pathResolve } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

function isDirectRun() {
  try {
    const entry = process.argv[1] ? pathResolve(process.argv[1]) : '';
    return entry && entry === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

const SAMPLE = {
  title: 'CEO Gate Sample',
  duration_sec: 16,
  logline: 'A short board for approval.',
  tone: 'cinematic',
  characters: [{ id: 'hero', name: 'Hero', role: 'lead' }],
  scenes: [
    {
      index: 1,
      duration_sec: 8,
      description: 'Hero walks into a sunlit courtyard.',
      veo_prompt: 'cinematic courtyard walk',
      negative_prompt: 'text overlay',
    },
    {
      index: 2,
      duration_sec: 8,
      description: 'Close-up smile, then cut.',
      veo_prompt: 'close-up smile',
    },
  ],
};

async function main() {
  const {
    extractStoryboardFromText,
    looksLikeVideoStoryboard,
    formatStoryboardApprovalSummary,
    exportStoryboardForCeoApproval,
  } = await import('../src/services/video-storyboard-export.js');

  const goldenPath = join(
    __dirname,
    '../src/services/company-blueprints/standard/video-content/workflow-reasoning.json'
  );
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
  const ceoGate = (golden.graph?.nodes || []).find((n) => n.id === 'ceo-gate');
  if (ceoGate?.type !== 'ceo_approval') throw new Error('golden ceo-gate missing');
  const bound = (ceoGate.data?.inputBindings || []).some(
    (b) => b.id === 'summary' && b.sourceNodeId === 'prompt-1'
  );
  if (!bound) throw new Error('golden ceo-gate must bind summary from prompt-1');
  if (!ceoGate.data?.taskConfig?.title) throw new Error('golden ceo-gate missing taskConfig.title');

  const wrapped = `Here is the board.\n\`\`\`json\n${JSON.stringify(SAMPLE)}\n\`\`\`\nThanks.`;
  const parsed = extractStoryboardFromText(wrapped);
  if (!parsed || parsed.title !== SAMPLE.title || parsed.scenes.length !== 2) {
    throw new Error('extractStoryboardFromText failed on fenced JSON');
  }
  if (!looksLikeVideoStoryboard(parsed)) throw new Error('looksLikeVideoStoryboard should be true');
  if (looksLikeVideoStoryboard({ intents: [], scenes: [] })) {
    throw new Error('empty scenes must not look like a storyboard');
  }
  if (looksLikeVideoStoryboard({ foo: 1 })) {
    throw new Error('unrelated JSON must not look like a storyboard');
  }

  const nested = extractStoryboardFromText({ storyboard: SAMPLE });
  if (!nested || nested.scenes.length !== 2) throw new Error('nested storyboard unwrap failed');

  const summary = formatStoryboardApprovalSummary(parsed);
  if (!summary.includes('CEO Gate Sample') || !summary.includes('Hero walks')) {
    throw new Error('formatStoryboardApprovalSummary missing title/scene: ' + summary);
  }

  config({ path: join(__dirname, '..', '.env') });
  config({ path: join(__dirname, '../../deploy/.env') });
  const { initDb, getDb } = await import('../src/db/schema.js');
  initDb();
  const ceo =
    getDb()
      .prepare(
        `SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1
         ORDER BY CASE WHEN id = 'ceo-bala' THEN 0 ELSE 1 END LIMIT 1`
      )
      .get() || getDb().prepare(`SELECT id FROM platform_users WHERE role = 'ceo' LIMIT 1`).get();
  if (!ceo?.id) {
    console.log(JSON.stringify({ ok: true, skipped_export: 'no ceo', summary_chars: summary.length }));
    return;
  }

  const attached = await exportStoryboardForCeoApproval(ceo.id, {
    rawText: wrapped,
    workflowRunId: 'test-ceo-gate',
  });
  if (!attached?.pdfUrl || !attached.pdfUrl.toLowerCase().includes('.pdf')) {
    throw new Error('expected pdf relative_url, got ' + JSON.stringify(attached));
  }
  if (!attached.summary.includes(attached.pdfUrl)) {
    throw new Error('Kanban summary must include PDF URL for Artifacts');
  }
  const pdfPath = attached.exported?.exports?.pdf?.local_path;
  if (pdfPath && !existsSync(pdfPath)) throw new Error('PDF file missing: ' + pdfPath);

  console.log(
    JSON.stringify({
      ok: true,
      owner: ceo.id,
      pdfUrl: attached.pdfUrl,
      htmlUrl: attached.htmlUrl,
      summary_preview: attached.summary.slice(0, 240),
    })
  );
}

if (isDirectRun()) {
  main().catch((e) => {
    console.error('[test-video-storyboard-ceo-approval]', e?.message || e);
    process.exit(1);
  });
}
