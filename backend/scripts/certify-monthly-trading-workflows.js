/**
 * Phase 4: start/poll Workflow Certify for Monthly Trading W1 / W3 / W5.
 *
 * Recommended models (BYOK):
 *   WORKFLOW_CERTIFY_MAKER_MODEL   = Claude Opus (e.g. claude-opus-4-20250514 or platform Opus id)
 *   WORKFLOW_CERTIFY_CHECKER_MODEL = deepseek-v4-flash
 *
 * W2 (laptop desktop package) is intentionally NOT certified here — desktop-runner
 * constraints (no brain/ceo_approval) and local bridge URLs make cloud certify
 * unsuitable; validate W2 via paper e2e + Task Scheduler on the laptop.
 *
 * Usage:
 *   node scripts/certify-monthly-trading-workflows.js --dry-run
 *   node scripts/certify-monthly-trading-workflows.js
 *   node scripts/certify-monthly-trading-workflows.js --poll --timeout-ms 120000
 *   node scripts/certify-monthly-trading-workflows.js --strict   # fail if Opus/DeepSeek keys missing
 *   node scripts/certify-monthly-trading-workflows.js --seed     # seed workflows before certify
 *   node scripts/certify-monthly-trading-workflows.js --workflow w1,w5
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { seedWorkflowBuilderAgent } from './seed-workflow-builder-agent.js';
import { seedAllMonthlyTradingWorkflows } from './seed-monthly-trading-workflows.js';
import { WORKFLOW_ID as W1 } from './seed-monthly-trading-w1-workflow.js';
import { WORKFLOW_ID as W3 } from './seed-monthly-trading-w3-workflow.js';
import { WORKFLOW_ID as W5 } from './seed-monthly-trading-w5-workflow.js';
import * as store from '../src/services/agent-workflow-store.js';
import {
  startCertifyJob,
  getCertifyStatusForOwner,
  getCertifyJob,
  formatCertifyReply,
} from '../src/services/agent-workflow-certify.js';
import { getLlmConfig } from '../src/config/llm.js';

const RECOMMENDED_MAKER = 'claude-opus-4-20250514';
const RECOMMENDED_CHECKER = 'deepseek-v4-flash';

const CERTIFY_TARGETS = {
  w1: {
    id: W1,
    label: 'W1 Post-Close Review & Plan',
    message:
      'Certify Monthly Trading W1 post-close: regime, guardrail, screener, Maker/Checker, hard gates, optional CEO loss-sell approval, plan save, daily digest email. Paper only — no live IBKR orders. success criteria: published graph structural_clean, run can complete or soft-block only on missing BYOK.',
  },
  w3: {
    id: W3,
    label: 'W3 IBKR Event Handler',
    message:
      'Certify Monthly Trading W3 webhook events: parse equity_mark/fill/eod_snapshot, update ledger/guardrail, notify on milestones, async sub_workflow to W1 on eod_snapshot. Paper webhook payloads only.',
  },
  w5: {
    id: W5,
    label: 'W5 Weekly Review',
    message:
      'Certify Monthly Trading W5 weekly review: journal + guardrail + analytics into weekly digest email; monthly metrics section on first weekly run of month. No live orders.',
  },
};

function parseArgs(argv) {
  const out = {
    dryRun: false,
    poll: false,
    strict: false,
    seed: false,
    timeoutMs: 180000,
    workflows: ['w1', 'w3', 'w5'],
    maxAttempts: 2,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--poll') out.poll = true;
    else if (a === '--strict') out.strict = true;
    else if (a === '--seed') out.seed = true;
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i]) || out.timeoutMs;
    else if (a === '--max-attempts') out.maxAttempts = Number(argv[++i]) || out.maxAttempts;
    else if (a === '--workflow' || a === '--workflows') {
      out.workflows = String(argv[++i] || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hasAnthropic() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY);
}
function hasDeepseek() {
  return !!(
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_PRIMARY_API_KEY
  );
}

/**
 * Apply suite defaults for certify models without clobbering explicit env.
 * Falls back to available platform models with WARNING when keys missing.
 */
function ensureCertifyModelEnv({ strict = false, owner } = {}) {
  const warnings = [];
  const llm = (() => {
    try {
      return getLlmConfig(owner);
    } catch {
      return {};
    }
  })();

  if (!process.env.WORKFLOW_CERTIFY_MAKER_MODEL) {
    if (hasAnthropic()) {
      process.env.WORKFLOW_CERTIFY_MAKER_MODEL =
        process.env.ANTHROPIC_MODEL || RECOMMENDED_MAKER;
      console.log(
        `[certify-monthly] WORKFLOW_CERTIFY_MAKER_MODEL defaulted → ${process.env.WORKFLOW_CERTIFY_MAKER_MODEL}`
      );
    } else {
      const fallback =
        llm.primary?.model ||
        process.env.OPENAI_PRIMARY_MODEL ||
        process.env.OPENCLAW_MODEL_PRIMARY?.replace(/^openai\//, '') ||
        RECOMMENDED_CHECKER;
      process.env.WORKFLOW_CERTIFY_MAKER_MODEL = fallback;
      warnings.push(
        `ANTHROPIC key missing — Maker certify model fell back to "${fallback}" (recommend Opus: ${RECOMMENDED_MAKER})`
      );
    }
  }

  if (!process.env.WORKFLOW_CERTIFY_CHECKER_MODEL) {
    if (hasDeepseek()) {
      process.env.WORKFLOW_CERTIFY_CHECKER_MODEL =
        process.env.DEEPSEEK_MODEL ||
        process.env.DEEPSEEK_CLOUD_MODEL ||
        RECOMMENDED_CHECKER;
      console.log(
        `[certify-monthly] WORKFLOW_CERTIFY_CHECKER_MODEL defaulted → ${process.env.WORKFLOW_CERTIFY_CHECKER_MODEL}`
      );
    } else {
      const fallback =
        llm.secondary?.model ||
        llm.primary?.model ||
        process.env.OPENAI_SECONDARY_MODEL ||
        RECOMMENDED_CHECKER;
      process.env.WORKFLOW_CERTIFY_CHECKER_MODEL = fallback;
      warnings.push(
        `DeepSeek/OpenAI key missing — Checker certify model fell back to "${fallback}" (recommend ${RECOMMENDED_CHECKER})`
      );
    }
  }

  for (const w of warnings) console.warn(`[certify-monthly] WARNING: ${w}`);
  if (strict && warnings.length) {
    throw new Error(`--strict: certify model keys incomplete (${warnings.length} warning(s))`);
  }
  return { warnings, maker: process.env.WORKFLOW_CERTIFY_MAKER_MODEL, checker: process.env.WORKFLOW_CERTIFY_CHECKER_MODEL };
}

async function pollJob(owner, jobId, timeoutMs) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = getCertifyStatusForOwner(owner, { jobId });
    const st = String(last.status || '');
    console.log(`  … ${jobId} status=${st} attempt=${last.attempt}/${last.max_attempts} verdict=${last.verdict || '-'}`);
    if (['certified', 'failed', 'blocked_on_input', 'completed'].includes(st)) return last;
    if (last.verdict === 'certified') return last;
    await sleep(4000);
  }
  return last || { ok: false, error: 'poll timeout', job_id: jobId };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/certify-monthly-trading-workflows.js [options]
  --dry-run          Print plan only (no startCertifyJob)
  --seed             Seed W1–W5 before certify
  --poll             Poll until terminal / timeout
  --timeout-ms N     Poll timeout (default 180000)
  --max-attempts N   Certify budget (default 2)
  --strict           Exit 1 if Anthropic/DeepSeek keys missing for recommended models
  --workflow w1,w3,w5
`);
    process.exit(0);
  }

  initDb();
  seedWorkflowBuilderAgent();
  const owner = getBalaCeoAuthId();
  const actor = { id: 'workflowbuilder', name: 'Workflow Builder', type: 'workflow_builder' };

  console.log('=== Certify Monthly Trading Workflows ===');
  console.log('owner', owner);
  console.log('recommended Maker', RECOMMENDED_MAKER);
  console.log('recommended Checker', RECOMMENDED_CHECKER);
  console.log('NOTE: W2 (monthly-trading-w2-execute) is skipped — laptop desktop package; certify on VPS/cloud is not appropriate.');

  const models = ensureCertifyModelEnv({ strict: args.strict, owner });
  console.log('effective models', { maker: models.maker, checker: models.checker });

  if (args.seed) {
    console.log('\n--- Seeding workflows ---');
    await seedAllMonthlyTradingWorkflows(owner, { publish: true });
  }

  const selected = args.workflows.filter((k) => CERTIFY_TARGETS[k]);
  if (!selected.length) {
    console.error('No valid workflows selected (use w1,w3,w5)');
    process.exit(1);
  }

  console.log('\n--- Plan ---');
  for (const key of selected) {
    const t = CERTIFY_TARGETS[key];
    const def = store.getDefinition(t.id, owner);
    console.log(`- ${key}: ${t.id} (${t.label}) status=${def?.status || 'MISSING'}`);
  }

  if (args.dryRun) {
    console.log('\n--dry-run: not starting certify jobs');
    console.log('Would set WORKFLOW_CERTIFY_MAKER_MODEL=', models.maker);
    console.log('Would set WORKFLOW_CERTIFY_CHECKER_MODEL=', models.checker);
    process.exit(0);
  }

  const jobs = [];
  for (const key of selected) {
    const t = CERTIFY_TARGETS[key];
    const def = store.getDefinition(t.id, owner);
    if (!def) {
      console.error(`FAIL: workflow ${t.id} not found — run with --seed`);
      process.exit(1);
    }
    console.log(`\n--- startCertifyJob ${key} ---`);
    const started = startCertifyJob({
      ownerUserId: owner,
      workflowId: t.id,
      message: t.message,
      actor,
      async: true,
      maxAttempts: args.maxAttempts,
    });
    console.log(formatCertifyReply(getCertifyJob(started.job_id, owner)));
    jobs.push({ key, ...started });
  }

  if (args.poll) {
    console.log('\n--- Polling ---');
    let failed = 0;
    for (const j of jobs) {
      const st = await pollJob(owner, j.job_id, args.timeoutMs);
      console.log(`  ${j.key}:`, JSON.stringify({
        status: st.status,
        verdict: st.verdict,
        last_error: st.last_error,
        input_requests: (st.input_requests || []).length,
      }));
      if (st.status === 'failed') failed += 1;
    }
    if (failed) {
      console.error(`\n${failed} certify job(s) failed`);
      process.exit(1);
    }
  } else {
    console.log('\nStarted jobs (poll later with --poll or agent_workflow_certify_status):');
    for (const j of jobs) console.log(`  ${j.key}: job_id=${j.job_id}`);
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
