import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENT_OS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ibkr-sme-'));
process.env.OPENCLAW_DIR = mkdtempSync(join(tmpdir(), 'ibkr-sme-openclaw-'));
process.env.OPENCLAW_TOOLS_LIST_PATH = join(process.env.OPENCLAW_DIR, 'agent-os-tools.json');
const { initDb } = await import('../src/db/schema.js');
initDb();
const { listHireableRoleTemplates } = await import('../src/services/hireable-role-templates.js');
const { seedIbkrTradingToolsIfMissing, IBKR_TRADING_TOOLS } = await import('../src/db/seed-ibkr-trading-tools.js');
const { inferIbkrQuantSignal, listIbkrQuantRuns } = await import('../src/services/ibkr-quant-inference.js');
const bundles = await import('../src/services/ibkr-strategy-bundles.js');
const { getDb } = await import('../src/db/schema.js');

const role = listHireableRoleTemplates().find((r) => r.id === 'ibkr-portfolio-strategy-sme');
assert.ok(role, 'IBKR SME role is hireable');
assert.ok(role.tools.includes('ibkr_quant_signal_infer'), 'SME has quant tool');
assert.ok(role.tools.includes('brave_web_search') && role.tools.includes('web_scrape_url'), 'SME has research tools');

seedIbkrTradingToolsIfMissing();
const toolNames = new Set(getDb().prepare('SELECT name FROM content_tools_meta').all().map((r) => r.name));
for (const name of ['ibkr_quant_signal_infer', 'ibkr_strategy_bundle_draft', 'ibkr_strategy_bundle_validate', 'ibkr_strategy_replay']) assert.ok(toolNames.has(name), `${name} seeded`);

const owner = 'testuser-ibkr-sme';
const q = await inferIbkrQuantSignal(owner, { task: 'regime_classification', features: { momentum_pct: 1.2, volatility_pct: 2.5, volume_ratio: 1.1 } });
assert.equal(q.ok, true); assert.equal(q.advisory_only, true); assert.match(q.evidence_id, /^iq-/);
assert.equal(listIbkrQuantRuns(owner).length, 1, 'quant evidence is owner-audited');

const invalid = bundles.validateIbkrStrategyBundle({ policy: { environment: 'live' } });
assert.equal(invalid.valid, false); assert.ok(invalid.errors.some((x) => /paper environment/i.test(x)));
const draft = bundles.draftIbkrStrategyBundle(owner, { name: 'Test paper strategy', bundle: { goal: {}, strategy: {}, strategy_skill: {}, policy: { environment: 'paper' }, universe: {}, market_data: { allow_delayed_for_execution: false } } });
assert.equal(draft.status, 'draft'); assert.equal(draft.validation.valid, true);
const replay = bundles.replayIbkrStrategyBundle({ series: [100, 101, 99, 103] });
assert.equal(replay.ok, true); assert.equal(replay.status, 'replay_only');

console.log('IBKR SME local harness passed: role, grants, quant evidence, paper-only validation and replay.');
