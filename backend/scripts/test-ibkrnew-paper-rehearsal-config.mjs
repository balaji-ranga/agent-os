import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installTestClock} from '../ibkrnew-event-bridge/test/clock.js';
installTestClock();
process.env.AGENT_OS_DATA_DIR=mkdtempSync(join(tmpdir(),'ibkrnew-paper-config-'));
const {initDb,getDb}=await import('../src/db/schema.js');initDb();
const s=await import('../src/services/ibkrnew-event-trader.js');
const p=await import('../src/services/ibkrnew-paper-rehearsal-config.js');
const {getIbkrNewSchema}=await import('../src/services/ibkrnew-blueprints.js');
const owner='paper-config-fixture',db=getDb(),before=s.ensureIbkrNewDefaults(owner);
const original=structuredClone(before),preview=p.buildPaperRehearsalPreview(before);
assert.deepEqual(before,original);assert.equal(preview.status,'preview_not_active');
for(const kind of ['policy','strategy','universe']) {
 assert.deepEqual(p.effectiveIbkrNewConfig(kind,preview.documents[kind],'live'),preview.documents[kind]);
 assert.ok(!getIbkrNewSchema(kind).required.includes('paper_rehearsal_overrides'));
 assert.throws(()=>p.validatePaperRehearsalOverrides(kind,{...preview.documents[kind],paper_rehearsal_overrides:{daily_budget_usd:10000}}),/Unsupported/);
}
assert.throws(()=>p.validatePaperRehearsalOverrides('strategy',{paper_rehearsal_overrides:{minimum_relative_volume:NaN}}),/finite/);
assert.throws(()=>p.validatePaperRehearsalOverrides('policy',{paper_rehearsal_overrides:{maximum_round_trip_commission_pct_of_expected_gross_profit:100}}),/below 100/);
assert.throws(()=>s.publishConfig(owner,'policy',preview.documents.policy),/confirm|risk|loosening/i);
const goalBefore=s.getIbkrNewGoalState(owner,{environment:'paper'});
const {default:express}=await import('express');const {default:router}=await import('../src/routes/ibkrnew-paper-rehearsal.js');
const {default:eventRouter}=await import('../src/routes/ibkrnew-event-trader.js');
const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.headers['x-test-role'])req.authUser={id:owner,role:req.headers['x-test-role']};next();});app.use('/preset',router);
app.use('/events',eventRouter);
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
try {
 const url=`http://127.0.0.1:${server.address().port}/preset`;
 const post=async(body,role='ceo')=>fetch(url+'/publish',{method:'POST',headers:{'Content-Type':'application/json',...(role?{'x-test-role':role}:{})},body:JSON.stringify(body)});
 const body={environment:'paper',confirm_paper_risk_loosening:true,expected_versions:preview.expected_versions,owner_user_id:'other-owner'};
 assert.equal((await post(body,null)).status,401);assert.equal((await post(body,'applicant')).status,403);
 assert.equal((await post({...body,environment:'live'})).status,409);
 assert.equal((await post({...body,confirm_paper_risk_loosening:false})).status,409);
 assert.equal((await post({...body,expected_versions:{}})).status,409);
 assert.deepEqual(s.ensureIbkrNewDefaults(owner),before);
 const response=await post(body);assert.equal(response.status,200);assert.equal((await response.json()).status,'published');
 assert.equal((await post(body)).status,409);
 const raw=s.ensureIbkrNewDefaults(owner),paper=s.ensureIbkrNewDefaults(owner,{environment:'paper'}),live=s.ensureIbkrNewDefaults(owner,{environment:'live'});
 assert.equal(paper.strategy.entry.minimum_relative_volume,1.1);assert.equal(paper.strategy.exits.single_lot_target_r,2.5);
 assert.equal(paper.universe.filters.stock.maximum_price_usd,500);assert.equal(paper.policy.commissions.minimum_expected_net_profit_usd,3);
 assert.equal(paper.policy.commissions.maximum_round_trip_commission_pct_of_expected_gross_profit,40);
 for(const environment of ['paper','live']) {
  const credentials=s.registerBridge(owner,undefined,environment);
  const boot=await fetch(`http://127.0.0.1:${server.address().port}/events/bridge/bootstrap`,{headers:{'x-ibkrnew-bridge-id':credentials.bridge_id,'x-ibkrnew-bridge-token':credentials.token}});
  assert.equal(boot.status,200);const result=await boot.json();assert.equal(result.environment,environment);
  assert.equal(result.configs.strategy.entry.minimum_relative_volume,environment==='paper'?1.1:before.strategy.entry.minimum_relative_volume);
  assert.equal(result.configs.strategy.exits.single_lot_target_r,environment==='paper'?2.5:before.strategy.exits.single_lot_target_r);
 }
 for(const kind of ['policy','strategy','universe']) {
  const baseline=structuredClone(before[kind]),actual=structuredClone(live[kind]);
  for(const d of [baseline,actual])for(const key of ['id','version','status','published_at','paper_rehearsal_overrides'])delete d[key];
  assert.deepEqual(actual,baseline);assert.equal(raw[kind].version,before[kind].version+1);
 }
 assert.deepEqual(s.getIbkrNewGoalState(owner,{environment:'paper'}),goalBefore);
 assert.equal(s.getIbkrNewExecutionMode(owner).requested_mode,'paper');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM ibkrnew_authorizations WHERE owner_user_id=?').get(owner).n,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM ibkrnew_config_versions WHERE owner_user_id=?').get('other-owner').n,0);
 db.prepare("UPDATE ibkrnew_execution_modes SET requested_mode='live' WHERE owner_user_id=?").run(owner);
 assert.equal((await post({...body,expected_versions:p.buildPaperRehearsalPreview(raw).expected_versions})).status,409);
} finally {await new Promise(r=>server.close(r));}
// Exercise the real event-to-risk path: the same recorded-feature shape is
// screened at base RVOL 1.25, but is authorized with the published Paper preset.
const runSignal=who=>{
 const configs=s.ensureIbkrNewDefaults(who),credentials=s.registerBridge(who),bridge=s.authenticateBridge(credentials.bridge_id,credentials.token);
 let sequence=0;const event=(type,payload)=>s.ingestBridgeEvent(bridge,{event_id:`${who}-${++sequence}`,sequence,event_type:type,occurred_at:new Date().toISOString(),payload});
 event('bridge.heartbeat',{gateway_connected:true,account_attestation:{status:'verified',environment:'paper',execution_ready:true}});
 event('account.snapshot',{eligible_capital_usd:8000,cash_usd:8000,positions:[],open_orders:[]});
 event('instrument.profile_refreshed',{symbol:'EEM',security_type:'ETF',average_daily_volume:50000000,assets_under_management_usd:1e11,etf_categories:configs.universe.filters.etf.categories});
 return event('market.bar_closed',{symbol:'EEM',security_type:'ETF',market_data_type:1,bid:68.49,ask:68.5,last:68.5,quote_at:new Date().toISOString(),feature_at:new Date().toISOString(),average_daily_volume:50000000,quantity:7,limit_price:68.5,relative_volume:1.15,confirmed_15m:true,vwap:68.4,ema_fast:68.6,ema_slow:68.4,atr_extension:0.5,protection:{stop_price:68.1,targets:[{quantity:7,limit_price:69.5}]}});
};
db.prepare("UPDATE ibkrnew_execution_modes SET requested_mode='paper' WHERE owner_user_id=?").run(owner);
assert.equal(runSignal('base-config-fixture').reaction.decision,'no_signal');
const paperSignal=runSignal(owner);assert.equal(paperSignal.reaction.decision,'authorized');
const {IBKRNewFeatureEngine}=await import('../ibkrnew-event-bridge/src/core.js');
for(const environment of ['paper','live']) {
 const configs=p.effectiveIbkrNewConfigs(preview.documents,environment),engine=new IBKRNewFeatureEngine();let bar;
 for(let i=0;i<22;i++)bar=engine.ingest({symbol:'EEM',at:new Date(Date.UTC(2026,9,5,14,i)).toISOString(),open:68+i*0.01,close:68.01+i*0.01,high:68.1+i*0.01,low:67.9+i*0.01,volume:1000},configs.policy,configs.strategy);
 assert.ok(bar);const ratio=Math.abs(bar.protection.targets[0].limit_price-bar.last)/Math.abs(bar.last-bar.protection.stop_price);
 assert.ok(Math.abs(ratio-(environment==='paper'?2.5:before.strategy.exits.single_lot_target_r))<1e-8);
}
console.log('Paper preset passed: explicit authenticated publication, stale-preview rejection, exact Paper values, unchanged Live/base budgets and loss limits, unchanged goal, no orders or broker contacted.');
