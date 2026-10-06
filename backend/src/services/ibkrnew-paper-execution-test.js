import crypto from 'node:crypto';
import { getDb } from '../db/schema.js';
import { ensureIbkrNewDefaults, instrumentEligibility, validateIbkrNewSubmission } from './ibkrnew-event-trader.js';
import { getIbkrNewPaperStrategyEvidence } from './ibkrnew-sme-evidence.js';
import { ensurePaperExecutionTestSchema } from './ibkrnew-paper-test-schema.js';

const fail = reason => { throw Object.assign(new Error(reason), { status:409 }); };
const parse = raw => JSON.parse(raw || '{}');
const id = prefix => `${prefix}_${crypto.randomUUID()}`;
const day = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const cents = value => Math.round(value * 100) / 100;

function context(ownerUserId, opening) {
  if (!String(ownerUserId || '').trim()) fail('authenticated_owner_required');
  const db = getDb(); ensureIbkrNewDefaults(ownerUserId); ensurePaperExecutionTestSchema(db);
  const s = getIbkrNewPaperStrategyEvidence(ownerUserId, { db });
  if (s.runtime.mode?.requested_mode !== 'paper' || !s.runtime.execution_context_ready) fail('verified_paper_execution_required');
  if (opening && !s.runtime.opening_evaluation_allowed_now) fail(`paper_opening_blocked:${s.runtime.block_reasons.join(',')}`);
  if (!s.configs.policy.feature_switches.automatic_exit_enabled) fail('protective_management_required');
  if (!s.account || s.account.age_seconds < -1 || s.account.age_seconds > s.configs.policy.freshness.account_max_age_ms / 1000) fail('account_state_stale');
  const bridge = db.prepare("SELECT * FROM ibkrnew_bridges WHERE owner_user_id=? AND bridge_id=? AND environment='paper' AND revoked_at IS NULL").get(ownerUserId,s.runtime.mode.attested_bridge_id);
  if (!bridge) fail('paper_bridge_unavailable');
  return { db, s, bridge, ownerUserId };
}

function command(db, bridge, a) {
  const commandId = id('IBKRNewCommand');
  const c = { command_id:commandId, type:a.action === 'EXIT' ? 'IBKRNewManageProtectedExit' : 'IBKRNewPlaceProtectedOrder', authorization:a };
  const signature = crypto.createHmac('sha256',bridge.token_hash).update(JSON.stringify(c)).digest('hex');
  db.prepare(`INSERT INTO ibkrnew_command_outbox(command_id,owner_user_id,account_id,bridge_id,authorization_id,command_json,signature,status,available_at,expires_at,created_at)
    VALUES(?,?,?,?,?,?,?,'pending',?,?,?)`).run(commandId,bridge.owner_user_id,bridge.account_id,bridge.bridge_id,a.authorization_id,JSON.stringify(c),signature,a.issued_at,a.expires_at,a.issued_at);
  return commandId;
}

function result(db, owner, testId) {
  const t = db.prepare('SELECT * FROM ibkrnew_paper_execution_tests WHERE owner_user_id=? AND test_id=?').get(owner,testId);
  if (!t) fail('paper_execution_test_not_found');
  const a = db.prepare('SELECT status,authorization_json FROM ibkrnew_authorizations WHERE owner_user_id=? AND authorization_id=?').get(owner,t.authorization_id);
  const c = db.prepare('SELECT command_id,status,acknowledged_at FROM ibkrnew_command_outbox WHERE owner_user_id=? AND authorization_id=?').get(owner,t.authorization_id);
  const trade = db.prepare('SELECT status,quantity,actual_commission_usd,net_pnl_usd FROM ibkrnew_trade_records WHERE owner_user_id=? AND authorization_id=?').get(owner,t.authorization_id);
  const orders = db.prepare(`SELECT occurred_at,json_extract(payload_json,'$.order_role') role,json_extract(payload_json,'$.status') status,json_extract(payload_json,'$.filled') filled
    FROM ibkrnew_events WHERE owner_user_id=? AND bridge_id=? AND environment='paper' AND event_type='order.status_changed' AND json_extract(payload_json,'$.authorization_id')=? ORDER BY created_at`).all(owner,t.bridge_id,t.authorization_id);
  const fills = db.prepare('SELECT order_role,quantity,price,commission_usd,commission_reported,occurred_at FROM ibkrnew_executions WHERE owner_user_id=? AND bridge_id=? AND authorization_id=? ORDER BY occurred_at').all(owner,t.bridge_id,t.authorization_id);
  const auth = parse(a?.authorization_json);
  return { test_id:t.test_id,purpose:'paper_execution_test',environment:'paper',symbol:t.symbol,quantity:1,authorization_id:t.authorization_id,authorization_status:a?.status,command:c,trade,orders,fills,exit_authorization_id:t.exit_authorization_id,
    entry_limit:auth.entry?.limit_price,stop_price:auth.protection?.stop_price,target_price:auth.protection?.targets?.[0]?.limit_price,planned_price_loss_usd:auth.budget?.planned_loss_usd,excluded_from_goal_profit:true };
}

// Explicit manual simulation, not a strategy signal. Real accepted market
// observations supply the quote; EMA/RVOL values are never fabricated.
// No goal_trade_link is inserted, so test P&L cannot inflate goal progress.
export function createPaperExecutionTest(ownerUserId, body = {}) {
  if (body.confirm_paper_execution_test !== true || body.environment !== 'paper') fail('explicit_paper_test_confirmation_required');
  const requestId = String(body.request_id || '');
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId) || !['EEM','TLT'].includes(body.symbol)) fail('bounded_test_request_required');
  const priorDb=getDb(); ensurePaperExecutionTestSchema(priorDb);
  const prior=priorDb.prepare('SELECT test_id,symbol FROM ibkrnew_paper_execution_tests WHERE owner_user_id=? AND request_id=?').get(ownerUserId,requestId);
  if(prior) {
    if(prior.symbol!==body.symbol) fail('paper_test_request_identity_changed');
    return {...result(priorDb,ownerUserId,prior.test_id),duplicate:true};
  }
  const { db, s, bridge } = context(ownerUserId,true);
  const existing = db.prepare('SELECT test_id FROM ibkrnew_paper_execution_tests WHERE owner_user_id=? AND request_id=?').get(ownerUserId,requestId);
  if (existing) return { ...result(db,ownerUserId,existing.test_id),duplicate:true };
  if (db.prepare('SELECT 1 FROM ibkrnew_paper_execution_tests WHERE owner_user_id=? AND trading_day=?').get(ownerUserId,day())) fail('one_paper_execution_test_per_day');
  if (s.account.positions.some(p => p.symbol === body.symbol && Number(p.quantity))) fail('test_symbol_position_already_exists');
  if (s.account.orders.some(p => p.symbol === body.symbol)) fail('test_symbol_open_orders_exist');
  if (db.prepare(`SELECT 1 FROM ibkrnew_trade_records WHERE owner_user_id=? AND bridge_id=? AND symbol=? AND status NOT IN ('closed','rejected','expired','cancelled')`).get(ownerUserId,bridge.bridge_id,body.symbol)) fail('test_symbol_pending_trade_exists');
  const event = db.prepare(`SELECT event_id,payload_json FROM ibkrnew_events WHERE owner_user_id=? AND bridge_id=? AND environment='paper' AND status='accepted' AND event_type='market.bar_closed'
    AND json_extract(payload_json,'$.symbol')=? ORDER BY created_at DESC LIMIT 1`).get(ownerUserId,bridge.bridge_id,body.symbol);
  const p = parse(event?.payload_json), at = Date.parse(p.quote_at);
  if (!event || !Number.isFinite(at) || Date.now()-at > 3000 || at > Date.now()+1000 || p.market_data_type !== 1) fail('fresh_accepted_quote_required');
  if (!(Number(p.bid)>0 && Number(p.ask)>=Number(p.bid))) fail('executable_bid_ask_required');
  const eligibility = instrumentEligibility(db,ownerUserId,'paper',s.configs.universe,body.symbol,'LONG_STOCK',p);
  if (!eligibility.eligible) fail(`test_profile_veto:${eligibility.reason}`);
  const entry = cents(Number(p.ask)), stop = cents(entry*0.995), target = cents(entry*1.01);
  const commission = 2*Math.max(Number(s.configs.policy.commissions.stock_minimum_per_order_usd||1),Number(s.configs.policy.commissions.stock_per_share_usd||0.005))+target*Number(s.configs.policy.commissions.estimated_regulatory_exit_pct||0)/100;
  const amount = entry + commission, risk = cents(entry-stop), policy = s.configs.policy;
  if (!(entry>0 && entry<=100 && risk>0 && risk<=1 && amount<=103 && commission<=3)) fail('small_test_bounds_exceeded');
  if (amount>policy.budgets.max_stock_position_usd || risk>policy.loss_limits.max_planned_loss_per_trade_usd) fail('published_position_or_loss_limit');
  if (s.account.cash_usd<amount || s.account.realized_pnl_day_usd+s.account.unrealized_pnl_usd<=-policy.loss_limits.daily_loss_limit_usd) fail('account_cash_or_loss_limit');
  const testId=id('IBKRNewPaperExecutionTest'),authId=id('IBKRNewAuthorization'),ts=new Date().toISOString();
  const a={authorization_id:authId,owner_user_id:ownerUserId,account_ref:bridge.account_id,bridge_id:bridge.bridge_id,environment:'paper',action:'OPEN',expression:'LONG_STOCK',side:'BUY',quantity:1,
    execution_test:{test_id:testId,purpose:'paper_execution_test',source_event_id:event.event_id},
    goal:{...s.cycle,goal_id:s.goal.goal_id},strategy:{id:s.configs.strategy.id,version:s.configs.strategy.version},strategy_skill:{id:s.configs.strategy_skill.id,version:s.configs.strategy_skill.version},policy:{id:policy.id,version:policy.version},universe:{id:s.configs.universe.id,version:s.configs.universe.version},
    config_versions:Object.fromEntries(Object.entries(s.configs).map(([k,v])=>[k,v.version])),contract:{symbol:body.symbol,security_type:'ETF',exchange:'SMART',currency:'USD'},entry:{order_type:'LIMIT',limit_price:entry},protection:{stop_price:stop,targets:[{quantity:1,limit_price:target}]},session_rules:policy.session_rules,order_permissions:policy.order_permissions,
    budget:{daily_opening_reserved_usd:amount,total_exposure_reserved_usd:amount,planned_loss_usd:risk,estimated_round_trip_commission_usd:commission},observed:{bid:p.bid,ask:p.ask,quote_at:p.quote_at},issued_at:ts,expires_at:new Date(Date.now()+Number(policy.freshness.authorization_ttl_ms||15000)).toISOString(),idempotency_key:`paper-test:${requestId}`,nonce:crypto.randomBytes(16).toString('hex')};
  db.transaction(()=>{
    const reservations=db.prepare(`SELECT r.*,a.expression FROM ibkrnew_budget_reservations r JOIN ibkrnew_authorizations a ON a.authorization_id=r.authorization_id AND a.owner_user_id=r.owner_user_id WHERE r.owner_user_id=? AND a.bridge_id=? AND r.status IN ('reserved','partially_filled','filled')`).all(ownerUserId,bridge.bridge_id);
    const daily=reservations.filter(r=>r.trading_day===day()).reduce((n,r)=>n+r.daily_reserved_usd-r.daily_released_usd,0);
    const pending=reservations.reduce((n,r)=>n+r.gross_reserved_usd-r.gross_released_usd,0);
    const account=db.prepare('SELECT positions_json FROM ibkrnew_account_state WHERE owner_user_id=? AND bridge_id=?').get(ownerUserId,bridge.bridge_id);
    const positions=JSON.parse(account.positions_json); const gross=positions.reduce((n,p)=>n+Math.abs(Number(p.quantity??p.qty??0))*Number(p.market_price??p.price??0)*(Number(p.multiplier)||1)*(Number(p.quantity??p.qty)<0?1+policy.budgets.short_stress_buffer_pct/100:1),0);
    if (daily+amount>policy.budgets.daily_opening_exposure_usd || gross+pending+amount>Math.min(policy.budgets.total_gross_exposure_usd,s.account.eligible_capital_usd)) fail('test_budget_limit');
    if (positions.filter(p=>Number(p.quantity??p.qty)).length+reservations.filter(r=>r.gross_reserved_usd>r.gross_released_usd).length>=policy.budgets.max_open_positions) fail('max_open_positions_exceeded');
    db.prepare(`INSERT INTO ibkrnew_paper_execution_tests VALUES(?,?,?,?,?,?,?,NULL,?,?)`).run(testId,ownerUserId,bridge.bridge_id,requestId,day(),event.event_id,authId,body.symbol,ts);
    db.prepare('INSERT INTO ibkrnew_authorizations VALUES(?,?,?,?,?,?,?,?,?,?)').run(authId,ownerUserId,bridge.account_id,bridge.bridge_id,`paper-test:${testId}`,'LONG_STOCK',JSON.stringify(a),'issued',a.expires_at,ts);
    db.prepare('INSERT INTO ibkrnew_budget_reservations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id('IBKRNewReservation'),ownerUserId,bridge.account_id,day(),authId,'LONG_STOCK',amount,amount,0,0,0,'reserved',ts,ts);
    db.prepare(`INSERT INTO ibkrnew_trade_records(trade_id,owner_user_id,account_id,bridge_id,authorization_id,symbol,expression,quantity,estimated_round_trip_commission_usd,expected_net_profit_usd,required_profitable_exit_price,status,economics_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,1,?,?,?,'authorized',?,?,?)`).run(id('IBKRNewTrade'),ownerUserId,bridge.account_id,bridge.bridge_id,authId,body.symbol,'LONG_STOCK',commission,target-entry-commission,entry+commission,JSON.stringify({purpose:'paper_execution_test',test_id:testId,expected_net_profit_usd:target-entry-commission,planned_loss_usd:risk}),ts,ts);
    validateIbkrNewSubmission(bridge,authId);command(db,bridge,a);
  })();
  return result(db,ownerUserId,testId);
}

export function getPaperExecutionTest(ownerUserId,testId) { const db=getDb();ensurePaperExecutionTestSchema(db);return result(db,ownerUserId,testId); }

// Close only the test's own filled lot by repricing its existing OCA target.
// The normal bridge retains the protective stop during the modification.
export function closePaperExecutionTest(ownerUserId,testId,body={}) {
  if (body.confirm_paper_test_close!==true) fail('explicit_test_close_confirmation_required');
  const {db,s,bridge}=context(ownerUserId,false);
  const t=db.prepare('SELECT * FROM ibkrnew_paper_execution_tests WHERE owner_user_id=? AND bridge_id=? AND test_id=?').get(ownerUserId,bridge.bridge_id,testId);
  if(!t) fail('paper_execution_test_not_found');
  if(t.exit_authorization_id) return {...result(db,ownerUserId,testId),duplicate:true};
  const trade=db.prepare('SELECT status FROM ibkrnew_trade_records WHERE owner_user_id=? AND bridge_id=? AND authorization_id=?').get(ownerUserId,bridge.bridge_id,t.authorization_id);
  if(trade?.status==='closed') return result(db,ownerUserId,testId);
  if(trade?.status!=='open') fail('filled_test_trade_required');
  const original=parse(db.prepare('SELECT authorization_json FROM ibkrnew_authorizations WHERE owner_user_id=? AND authorization_id=?').get(ownerUserId,t.authorization_id).authorization_json);
  const authId=id('IBKRNewAuthorization'),ts=new Date().toISOString();
  const a={...original,authorization_id:authId,action:'EXIT',side:'SELL',parent_trade_authorization_id:t.authorization_id,exit_reason:'paper_execution_test_close',config_versions:Object.fromEntries(Object.entries(s.configs).map(([k,v])=>[k,v.version])),issued_at:ts,expires_at:new Date(Date.now()+15000).toISOString()};
  db.transaction(()=>{
    db.prepare('UPDATE ibkrnew_paper_execution_tests SET exit_authorization_id=? WHERE test_id=? AND owner_user_id=? AND exit_authorization_id IS NULL').run(authId,testId,ownerUserId);
    db.prepare('INSERT INTO ibkrnew_authorizations VALUES(?,?,?,?,?,?,?,?,?,?)').run(authId,ownerUserId,bridge.account_id,bridge.bridge_id,`paper-test-close:${testId}`,'LONG_STOCK',JSON.stringify(a),'issued',a.expires_at,ts);
    validateIbkrNewSubmission(bridge,authId);command(db,bridge,a);
  })();
  return result(db,ownerUserId,testId);
}
