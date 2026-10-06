import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

process.env.AGENT_OS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ibkrnew-sme-'));
process.env.OPENCLAW_DIR = mkdtempSync(join(tmpdir(), 'ibkrnew-sme-oc-'));
process.env.OPENCLAW_TOOLS_LIST_PATH = join(process.env.OPENCLAW_DIR, 'tools.json');
process.env.AGENT_OS_INTERNAL_TOKEN = 'disposable-test-secret';
const { initDb, getDb } = await import('../src/db/schema.js'); initDb();
const s = await import('../src/services/ibkrnew-event-trader.js');
const evidence = await import('../src/services/ibkrnew-sme-evidence.js');
const { draftIbkrStrategyBundle, listIbkrStrategyBundles } = await import('../src/services/ibkr-strategy-bundles.js');
const { IBKR_TRADING_TOOLS, seedIbkrTradingToolsIfMissing } = await import('../src/db/seed-ibkr-trading-tools.js');
const { resolveRiskForTool } = await import('../src/services/action-policy.js');
const { listHireableRoleTemplates } = await import('../src/services/hireable-role-templates.js');
const db = getDb(), owner = 'sme-test-owner', other = 'sme-other-owner';
for (const id of [owner, other]) s.ensureIbkrNewDefaults(id);
const cfg = s.ensureIbkrNewDefaults(owner), now = new Date().toISOString();
const bridge = 'IBKRNewBridge_sme-paper', live = 'IBKRNewBridge_sme-live';
const account = 'IBKRNewAccount_sme_paper', liveAccount = 'IBKRNewAccount_sme_live';
db.prepare("INSERT INTO ibkrnew_bridges(bridge_id,owner_user_id,account_id,environment,token_hash,status,last_seen_at,created_at) VALUES(?,?,?,?,?,'online',?,?)").run(bridge, owner, account, 'paper', 'test-token-hash', now, now);
db.prepare("INSERT INTO ibkrnew_bridges(bridge_id,owner_user_id,account_id,environment,token_hash,status,last_seen_at,created_at) VALUES(?,?,?,?,?,'online',?,?)").run(live, owner, liveAccount, 'live', 'live-token-hash', now, now);
db.prepare("INSERT INTO ibkrnew_execution_modes(owner_user_id,requested_mode,activation_state,attested_bridge_id,attestation_status,attested_at,updated_at) VALUES(?,'paper','ACTIVE',?,'verified',?,?) ON CONFLICT(owner_user_id) DO UPDATE SET activation_state='ACTIVE',requested_mode='paper',attested_bridge_id=excluded.attested_bridge_id,attestation_status='verified',attested_at=excluded.attested_at").run(owner, bridge, now, now);
const components = [{ component_id: 'IBKRNewMarketSubscriptions', status: 'waiting_market', symbols: ['AAPL'], capacity_limited_symbols: ['MSFT'], healthy_symbols: [], pending_symbols: ['AAPL'], details: [{ symbol: 'AAPL', market_data_ready: false, reason: 'outside_regular_session' }] }];
const eventInsert = db.prepare('INSERT INTO ibkrnew_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
eventInsert.run('heartbeat-paper', owner, account, bridge, 'paper', 'bridge.heartbeat', 'hp', 1, now, JSON.stringify({ gateway_connected: true, bridge_version: '1.2.5', components, token: 'must-not-leak', account_attestation: { account_id: 'DUQ123456' } }), 'accepted', null, now);
db.prepare("INSERT INTO ibkrnew_account_state(owner_user_id,account_id,bridge_id,eligible_capital_usd,cash_usd,positions_json,open_orders_json,captured_at) VALUES(?,?,?,?,?,?,?,?)").run(owner, account, bridge, 8000, 7000, JSON.stringify([{ symbol: 'AAPL', quantity: 1, account_id: 'DUQ123456' }]), JSON.stringify([{ symbol: 'AAPL', status: 'PreSubmitted', account_id: 'DUQ123456' }]), now);
db.prepare('DELETE FROM ibkrnew_goal_cycles WHERE owner_user_id=?').run(owner);
db.prepare('DELETE FROM ibkrnew_goals WHERE owner_user_id=?').run(owner);
db.prepare("INSERT INTO ibkrnew_goals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run('goal-paper', owner, 'paper', 'Paper test', 'PERPETUAL', 5, 30, 'CALENDAR_DAYS', 'CYCLE_START_ELIGIBLE_CAPITAL_CAPPED_BY_TOTAL_BUDGET', 'NET_REALIZED_AFTER_COMMISSIONS', 'ACTIVE', now, now);
db.prepare("INSERT INTO ibkrnew_goal_cycles VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run('cycle-paper', 'goal-paper', owner, 'paper', 1, 'ACTIVE', now, new Date(Date.now() + 86400000).toISOString(), 8000, 400, 0, null, null, null, now, now);

// Published configuration and profile caches are independent of legacy drafts.
cfg.universe.profile_data.paper = { fundamentals_provider: 'FMP', earnings_provider: 'FMP' };
cfg.universe.filters.stock.indexes = ['SP500'];
cfg.universe.filters.stock.fundamentals = { enabled: true, fail_closed: true, maximum_age_hours: 36, minimum_market_cap_usd: 100, minimum_revenue_ttm_usd: 100, maximum_debt_to_equity: 3 };
cfg.universe.filters.stock.corporate_events = { enabled: true, fail_closed: true, maximum_age_hours: 36, earnings_blackout_days_before: 1, earnings_blackout_days_after: 1 };
db.prepare("UPDATE ibkrnew_config_versions SET document_json=? WHERE owner_user_id=? AND kind='universe' AND status='published'").run(JSON.stringify(cfg.universe), owner);
const profile = { average_daily_volume: 50_000_000, index_memberships: ['SP500'], fundamentals_source: 'FMP', fundamentals: { market_cap_usd: 1e12, revenue_ttm_usd: 1e11, debt_to_equity: 1, secret: 'must-not-leak' }, corporate_events_source: 'FMP', corporate_events: [{ type: 'earnings', date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0,10) }], earnings_coverage: { verified: true } };
const profileInsert = db.prepare('INSERT INTO ibkrnew_instrument_profiles VALUES(?,?,?,?,?,?,?,?,?,?)');
profileInsert.run(owner, bridge, 'paper', 'AAPL', 'STK', JSON.stringify(profile), now, now, now, now);
profileInsert.run(owner, bridge, 'paper', 'MSFT', 'STK', JSON.stringify({ average_daily_volume: 50_000_000, index_memberships: ['SP500'] }), null, now, null, now);
profileInsert.run(owner, bridge, 'paper', 'EEM', 'ETF', JSON.stringify({ average_daily_volume: 50_000_000, assets_under_management_usd: 1e11, etf_categories: cfg.universe.filters.etf.categories }), null, null, null, now);
profileInsert.run(owner, live, 'live', 'LIVEONLY', 'STK', JSON.stringify(profile), now, now, now, now);
profileInsert.run(other, bridge, 'paper', 'OTHERTENANT', 'STK', JSON.stringify(profile), now, now, now, now);
db.prepare("INSERT INTO ibkrnew_profile_refresh_state VALUES(?,?, 'paper','AAPL','fundamentals','FMP','failed','FMP_RATE_LIMIT',?,?,?,'1')").run(owner, bridge, now, new Date(Date.now()+60000).toISOString(), now);
eventInsert.run('signal-paper', owner, account, bridge, 'paper', 'market.signal', 'sp', 2, now, JSON.stringify({ symbol: 'MSFT', ask: 200, token: 'must-not-leak' }), 'accepted', null, now);
eventInsert.run('signal-live', owner, liveAccount, live, 'live', 'market.signal', 'sl', 1, now, JSON.stringify({ symbol: 'LIVEONLY' }), 'accepted', null, now);
eventInsert.run('signal-other', other, account, bridge, 'paper', 'market.signal', 'so', 3, now, JSON.stringify({ symbol: 'OTHERTENANT' }), 'accepted', null, now);
db.prepare('INSERT INTO ibkrnew_event_reactions VALUES(?,?,?,?,?,?,?)').run('signal-paper', owner, 'blocked', 'fundamentals_missing', '{}', now, now);
db.prepare('INSERT INTO ibkrnew_executions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('fill-paper',owner,account,bridge,null,null,'entry','BOT',1,100,1,0,1,now,now);
db.prepare('INSERT INTO ibkrnew_executions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('fill-live',owner,liveAccount,live,null,null,'entry','BOT',1,100,1,0,1,now,now);

// Prove all evidence reads work with a physically read-only connection.
const ro = new Database(db.prepare('PRAGMA database_list').all().find(x=>x.name==='main').file, { readonly:true, fileMustExist:true });
const options = { db: ro };
const status = evidence.getIbkrNewPaperStrategyEvidence(owner, options);
assert.equal(status.goal.goal_id, 'goal-paper'); assert.equal(status.cycle.cycle_id, 'cycle-paper');
assert.equal(status.goal_opening_permission.allowed, true); assert.equal(status.runtime.execution_context_ready, true);
assert.equal(status.agents.length, 6); assert.ok(status.agents.every(x=>x.enabled));
assert.equal(status.account.orders[0].protective_type_verified, false);
const readiness = evidence.getIbkrNewPaperInstrumentEvidence(owner, options);
assert.equal(readiness.items.length, 3);
assert.equal(readiness.items.find(x=>x.symbol==='AAPL').profile_gates.passed, true);
assert.equal(readiness.items.find(x=>x.symbol==='AAPL').fundamentals.cached_fresh, true);
assert.equal(readiness.items.find(x=>x.symbol==='AAPL').fundamentals.refresh.status, 'failed');
assert.equal(readiness.items.find(x=>x.symbol==='MSFT').profile_gates.reason, 'fundamentals_missing');
assert.equal(readiness.items.find(x=>x.symbol==='EEM').fundamentals.required, false);
assert.equal(evidence.getIbkrNewPaperInstrumentEvidence(owner,{...options,symbol:'aapl'}).total,1);
const history = evidence.getIbkrNewPaperDecisionEvidence(owner, options);
assert.equal(history.decisions.length,1); assert.equal(history.decisions[0].reason,'fundamentals_missing');
assert.equal(history.executions.length,1); assert.equal(history.executions[0].commission_reported,1);
const serialized = JSON.stringify([status,readiness,history]);
assert.doesNotMatch(serialized,/DUQ123456|U123456|must-not-leak|test-token-hash|LIVEONLY|OTHERTENANT/);
assert.equal(ro.prepare('SELECT total_changes() n').get().n,0); ro.close();
for (const method of Object.values(evidence)) {
  assert.throws(()=>method(owner,{environment:'live'}),/Paper-only/);
  assert.throws(()=>method(owner,{owner_user_id:other}),/Caller-selected/);
  assert.throws(()=>method('',{}),/Authenticated owner/);
}
db.prepare("UPDATE ibkrnew_goal_cycles SET net_realized_profit_usd=400 WHERE cycle_id='cycle-paper'").run();
assert.ok(evidence.getIbkrNewPaperStrategyEvidence(owner).goal_opening_permission.block_reasons.includes('goal_target_reached'));
assert.equal(db.prepare("SELECT status FROM ibkrnew_goal_cycles WHERE cycle_id='cycle-paper'").get().status,'ACTIVE','read does not reconcile cycle');
db.prepare("UPDATE ibkrnew_goal_cycles SET net_realized_profit_usd=0,scheduled_end_at=? WHERE cycle_id='cycle-paper'").run(new Date(Date.now()-1000).toISOString());
assert.ok(evidence.getIbkrNewPaperStrategyEvidence(owner).goal_opening_permission.block_reasons.includes('goal_cycle_deadline_reached'));

seedIbkrTradingToolsIfMissing();
const names = IBKR_TRADING_TOOLS.filter(x=>x.name.startsWith('ibkrnew_paper_')).map(x=>x.name);
const role = listHireableRoleTemplates().find(x=>x.id==='ibkr-portfolio-strategy-sme');
for (const name of names) { assert.ok(role.tools.includes(name)); assert.deepEqual({...resolveRiskForTool(name),source:undefined},{risk_tier:'R0',action_family:'read',source:undefined}); }
assert.deepEqual(listIbkrStrategyBundles(owner),[]);
const beforeDrafts = db.prepare('SELECT COUNT(*) n FROM ibkr_strategy_bundles').get().n;
assert.throws(()=>draftIbkrStrategyBundle(owner,{}),/valid|configuration|empty|required/i);
assert.equal(db.prepare('SELECT COUNT(*) n FROM ibkr_strategy_bundles').get().n,beforeDrafts);

// HTTP authentication and scope checks, without external providers or brokers.
const {default: express} = await import('express');
const {default: router} = await import('../src/routes/ibkr-trading.js');
const app = express(); app.use('/api/ibkr-trading',router);
const server = app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
try {
  const base=`http://127.0.0.1:${server.address().port}/api/ibkr-trading`;
  const headers={'x-agent-os-internal':process.env.AGENT_OS_INTERNAL_TOKEN,'x-ceo-user-id':owner};
  for(const path of ['strategy-status','instrument-readiness','decision-history']) {
    const url=`${base}/ibkrnew/paper/${path}`;
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{'x-agent-os-internal':process.env.AGENT_OS_INTERNAL_TOKEN}})).status,403);
    assert.equal((await fetch(`${url}?owner_user_id=${other}`,{headers})).status,400);
    assert.equal((await fetch(`${url}?environment=live`,{headers})).status,400);
    const result=await fetch(url,{headers}); assert.equal(result.status,200); assert.equal((await result.json()).environment,'paper');
  }
  const legacy=await (await fetch(`${base}/strategy-bundles`,{headers})).json();
  assert.deepEqual(legacy.bundles,[]); assert.equal(legacy.active_paper_strategy.goal.goal_id,'goal-paper');
} finally { await new Promise(r=>server.close(r)); }
console.log('IBKRNew SME harness passed: canonical Paper evidence, owner/Live isolation, readonly SQL, profile cache/ETF gates, fills, goal-stop evidence, authentication, R0 tools and empty-draft prevention.');
const {ibkrNewSmeReviewContract,IBKRNEW_SME_REVIEW_TOOLS} = await import('../src/services/ibkrnew-sme-review-contract.js');
const sme={template_base_id:'ibkr-portfolio-strategy-sme'};
const review=ibkrNewSmeReviewContract(sme,'Review my current Paper goal and strategy. Do not change or reset anything.',names);
assert.deepEqual(review.tools,[...IBKRNEW_SME_REVIEW_TOOLS]); assert.deepEqual(review.missing,[]);
assert.match(review.instruction,/outside the market session is NOT disabled/);
assert.equal(ibkrNewSmeReviewContract({template_base_id:'balserve'},'Review Paper strategy',names),null);
assert.equal(ibkrNewSmeReviewContract(sme,'Review my account cash and dividends',names),null);
assert.equal(ibkrNewSmeReviewContract(sme,'Review and change the Paper strategy',names),null);
assert.equal(ibkrNewSmeReviewContract(sme,'Check my Paper goal status',[]).missing.length,3);
console.log('SME current-turn contract passed: canonical read-only review tool scope, missing-capability reporting, no permissions expansion, legacy/change requests unchanged.');
