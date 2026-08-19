/**
 * Gate B (live Places research) + Gate C (owner-scoped CRM path + approval).
 * Provisions a NEW CEO in temp sqlite. Does not register production users
 * and does not provision a Twenty desk.
 *
 *   node scripts/test-gate-bc-live.mjs
 *
 * Places: platform GOOGLE_PLACES_API_KEY, else deploy/.env, else (VPS) copy the
 * operator vault GOOGLE_PLACES_BYOK into the *new* CEO's temp vault so the
 * isolated tenant is entitled the same way a CEO who pasted Places BYOK is.
 * The secret is never logged.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');

function loadPlacesKeyFromDeployEnv() {
  if (process.env.GOOGLE_PLACES_API_KEY) return;
  try {
    const raw = readFileSync(join(repoRoot, 'deploy/.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*GOOGLE_PLACES_API_KEY\s*=\s*(.*)$/);
      if (!m) continue;
      const val = String(m[1] || '')
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (val) process.env.GOOGLE_PLACES_API_KEY = val;
      break;
    }
  } catch {
    /* deploy/.env may be absent in the container; platform env is enough */
  }
}

loadPlacesKeyFromDeployEnv();

let hostPlacesSecret = '';
if (!process.env.GOOGLE_PLACES_API_KEY) {
  const hostDir = process.env.AGENT_OS_PLACES_RESOLVE_DIR || '/data/agent-os';
  if (existsSync(join(hostDir, 'agent-os.db'))) {
    const { resolveFirstVaultSecretFromDataDir, GOOGLE_PLACES_BYOK_KEY_NAME } = await import(
      '../src/services/user-api-keys.js'
    );
    hostPlacesSecret = resolveFirstVaultSecretFromDataDir(hostDir, GOOGLE_PLACES_BYOK_KEY_NAME) || '';
    if (hostPlacesSecret) console.log('ok  Places secret resolved from host vault (not logged)');
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'aos-bc-'));
process.env.AGENT_OS_DATA_DIR = dataDir;

const { initDb } = await import('../src/db/schema.js');
initDb();

const { registerCeoUser } = await import('../src/services/users.js');
const { createUserApiKey, GOOGLE_PLACES_BYOK_KEY_NAME } = await import('../src/services/user-api-keys.js');
const { getGoalRun } = await import('../src/services/agent-goal-run.js');
const { parseOutcomeFromPrompt } = await import('../src/services/goal-outcome.js');
const { parsePlacesSearchText } = await import('../src/services/social-research/adapters/google-places.js');
const {
  GATE_B_LIVE_RESEARCH_PROMPT,
  runLiveResearchMission,
  runLiveCrmApprovalMission,
} = await import('../src/services/live-research-mission.js');
const { getGooglePlacesConfig } = await import('../src/config/tools.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok ', msg);
  }
}

function row(expected, actual, pass) {
  return `| ${expected} | ${actual} | ${pass ? 'PASS' : 'FAIL'} |`;
}

const stamp = randomUUID().slice(0, 8);
const ceo = await registerCeoUser({
  email: `gate-bc-${stamp}@example.test`,
  password: 'GateBC-Pass9-Test',
  name: 'Gate BC New CEO',
  country: 'SG',
  require_terms_accept: false,
  industry: 'personal',
  business_name: 'Gate BC Services',
});
const other = await registerCeoUser({
  email: `gate-bc-other-${stamp}@example.test`,
  password: 'GateBC-Pass9-Test',
  name: 'Other New CEO',
  country: 'SG',
  require_terms_accept: false,
  industry: 'personal',
});

assert(ceo?.id && ceo.id !== other.id, `new CEO provisioned (id redacted, len=${String(ceo?.id || '').length})`);
assert(ceo.role === 'ceo', 'new user is a CEO tenant');

if (hostPlacesSecret) {
  await createUserApiKey(ceo.id, { keyName: GOOGLE_PLACES_BYOK_KEY_NAME, apiKey: hostPlacesSecret });
  console.log('ok  Places BYOK granted to the new CEO in temp sqlite (secret not logged)');
}

const parsedGeo = parsePlacesSearchText(GATE_B_LIVE_RESEARCH_PROMPT);
assert(parsedGeo.locality === 'Singapore', `parser locality from Country-based: ${parsedGeo.locality || '(empty)'}`);
assert(parsedGeo.max_results === 20, `parser max_results from Find N qualified: ${parsedGeo.max_results}`);
assert(parsePlacesSearchText('Find 8 Hong Kong-based firms').locality === 'Hong Kong', 'parser accepts multi-word Country-based');

const parsedOut = parseOutcomeFromPrompt(GATE_B_LIVE_RESEARCH_PROMPT);
assert(parsedOut.target === 20, `outcome target=20 got ${parsedOut.target}`);
assert(parsedOut.budget_usd === 25, `outcome budget=$25 got ${parsedOut.budget_usd}`);
assert(parsedOut.approval_policy?.external_send === 'approval_required', 'do not send → approval required');
assert(parsedOut.kpi === 'verified_count', `kpi verified_count got ${parsedOut.kpi}`);

const placesCfg = getGooglePlacesConfig(ceo.id);
assert(Boolean(placesCfg.apiKey) && !placesCfg.error, placesCfg.error || 'Places key resolved for new CEO (source not logged)');

console.log('\n--- Gate B: live research under uncertainty ---');
const b = await runLiveResearchMission({ ownerUserId: ceo.id, agentId: 'balserve' });
assert(b.goal.owner_user_id === ceo.id, 'Gate B goal owned by the new CEO');
assert(!getGoalRun(b.goal.id, other.id), 'other new CEO cannot read this goal');
assert(b.plan_ok, 'typed executable plan from the outcome prompt');
assert(b.discovered_count >= 1, `Places returned businesses discovered=${b.discovered_count}`);

const bMap = [
  ['Precision of qualification ≥90%', b.dimensions.precision.detail, b.dimensions.precision.pass],
  ['Citation/evidence completeness 100%', b.dimensions.citations.detail, b.dimensions.citations.pass],
  ['Contact hallucination = 0', b.dimensions.hallucination.detail, b.dimensions.hallucination.pass],
  ['Duplicate CRM rate = 0 (no live CRM in Gate B)', b.dimensions.duplicates.detail, b.dimensions.duplicates.pass],
  ['Outreach unsupported facts = 0', b.dimensions.outreach_facts.detail, b.dimensions.outreach_facts.pass],
  ['Management burden ≤2', b.dimensions.burden.detail, b.dimensions.burden.pass],
  ['Spend ≤ $25', b.dimensions.spend.detail, b.dimensions.spend.pass],
  ['Do not send', b.dimensions.no_send.detail, b.dimensions.no_send.pass],
];

console.log('| Expected | Actual | Result |');
console.log('|---|---|---|');
for (const [exp, act, pass] of bMap) {
  assert(pass, `${exp} (${act})`);
  console.log(row(exp, act, pass));
}

console.log(
  JSON.stringify(
    {
      locality: b.locality,
      discovered: b.discovered_count,
      qualified: b.qualified.length,
      rejected: b.rejected_count,
      kpi: b.stats.kpi,
      target: b.stats.target,
      spend_usd: b.stats.spend_usd,
      drafts: b.drafts.length,
      invented: b.stats.invented,
      unapproved_sends: b.stats.unapproved_sends,
    },
    null,
    2
  )
);

assert(b.qualified.length >= 1, `at least one verified company (got ${b.qualified.length} of target ${b.stats.target})`);
assert(b.stats.invented === 0, 'zero invented contacts');
assert(b.stats.unapproved_sends === 0, 'zero unapproved sends');
assert(b.allPass, 'Gate B all scored dimensions PASS');

console.log('\n--- Gate C: live CRM path + approval (fail-closed if not entitled) ---');
const c = await runLiveCrmApprovalMission({
  ownerUserId: ceo.id,
  otherOwnerUserId: other.id,
  agentId: 'balserve',
  verified: b.qualified,
});
assert(c.goal.owner_user_id === ceo.id, 'Gate C goal owned by the new CEO');
assert(!getGoalRun(c.goal.id, other.id), 'other new CEO cannot read Gate C goal');

const cMap = [
  ['Research → qualify (verified ≥1)', c.dimensions.research_to_qualify.detail, c.dimensions.research_to_qualify.pass],
  [
    'Production CRM create path (live write if entitled; else 403/409 fail-closed, 0 other-tenant writes)',
    c.dimensions.production_crm_path.detail,
    c.dimensions.production_crm_path.pass,
  ],
  ['Zero cross-tenant CRM writes', c.dimensions.no_cross_tenant.detail, c.dimensions.no_cross_tenant.pass],
  ['Duplicate Knowledge persist skipped on replay', c.dimensions.duplicate_knowledge.detail, c.dimensions.duplicate_knowledge.pass],
  ['Drafts ready; nothing sent without approval', c.dimensions.approval_no_send.detail, c.dimensions.approval_no_send.pass],
];

console.log('| Expected | Actual | Result |');
console.log('|---|---|---|');
for (const [exp, act, pass] of cMap) {
  assert(pass, `${exp} (${act})`);
  console.log(row(exp, act, pass));
}

console.log(
  JSON.stringify(
    {
      candidates: c.stats.candidates,
      live_crm_writes: c.stats.live_crm_writes,
      fail_closed: c.stats.fail_closed,
      fail_closed_reason: c.stats.fail_closed_reason,
      cross_tenant_writes: c.stats.cross_tenant_writes,
      knowledge_new: c.stats.knowledge_new,
      knowledge_skipped_on_replay: c.stats.knowledge_skipped_on_replay,
      drafts: c.stats.drafts,
      unapproved_sends: c.stats.unapproved_sends,
    },
    null,
    2
  )
);

assert(c.stats.cross_tenant_writes === 0, 'zero cross-tenant writes');
assert(c.stats.unapproved_sends === 0, 'zero unapproved sends');
assert(c.stats.live_crm_writes === 0, 'new CEO without Business Core: 0 live CRM writes (no desk provisioned)');
assert(c.stats.fail_closed === c.stats.candidates, 'every create failed closed for the unentitled owner');
assert(c.allPass, 'Gate C all scored dimensions PASS');

if (failed) {
  console.error(`GATE_BC_LIVE_FAIL count=${failed}`);
  process.exit(1);
}
console.log('GATE_BC_LIVE_OK', {
  dataDir,
  gateB: {
    discovered: b.discovered_count,
    qualified: b.qualified.length,
    rejected: b.rejected_count,
    spend_usd: b.stats.spend_usd,
    drafts: b.drafts.length,
  },
  gateC: {
    candidates: c.stats.candidates,
    live_crm_writes: c.stats.live_crm_writes,
    fail_closed: c.stats.fail_closed,
    knowledge_new: c.stats.knowledge_new,
    knowledge_skipped_on_replay: c.stats.knowledge_skipped_on_replay,
    drafts: c.stats.drafts,
  },
});
