import { IBApi, EventName, OrderAction, OrderType, SecType, TimeInForce } from '@stoqey/ib';
import { tradingSession } from './session.js';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { MarketSubscriptions } from './market-subscriptions.js';
import { VolumeProfiles } from './volume-profiles.js';

const ACCOUNT_VALUE_KEYS = new Set(['NetLiquidation', 'TotalCashValue', 'RealizedPnL', 'UnrealizedPnL']);

export function evaluateAccountAttestation({ environment, configuredAccountId, managedAccounts }) {
  const mode = String(environment || '').toLowerCase(); const accountId = String(configuredAccountId || '').trim();
  const accounts = Array.isArray(managedAccounts) ? managedAccounts.map((value) => String(value || '').trim()).filter(Boolean) : String(managedAccounts || '').split(',').map((value) => value.trim()).filter(Boolean);
  let reason = null;
  if (!['paper', 'live'].includes(mode)) reason = 'TRADING_MODE_INVALID';
  else if (!accountId) reason = 'LOCAL_ACCOUNT_REQUIRED';
  else if (!accounts.includes(accountId)) reason = 'CONFIGURED_ACCOUNT_NOT_MANAGED';
  else if (mode === 'paper' && !accountId.toUpperCase().startsWith('DU')) reason = 'ACCOUNT_ENVIRONMENT_MISMATCH';
  else if (mode === 'live' && accountId.toUpperCase().startsWith('DU')) reason = 'ACCOUNT_ENVIRONMENT_MISMATCH';
  return { status: reason ? 'failed' : 'verified', environment: mode || 'unknown', execution_ready: !reason, reason_code: reason };
}

export function applyReconciliationState(attestation, reconciliation = {}) {
  if (attestation?.status !== 'verified') return { ...attestation, execution_ready: false };
  const executionReady = reconciliation.account === true && reconciliation.open_orders === true;
  return { ...attestation, execution_ready: executionReady, reason_code: executionReady ? null : 'RECONCILIATION_PENDING' };
}

export function normalizeAccountValuesToUsd(accountValues) {
  const entries = accountValues instanceof Map ? accountValues : new Map();
  const usdExchangeRate = Number(entries.get('$LEDGER-ExchangeRate:USD')?.value);
  const baseCurrency = String(entries.get('NetLiquidation')?.currency || '').toUpperCase();
  const toUsd = (key) => {
    const baseLedger = entries.get(`$LEDGER-${key}:BASE`);
    const entry = entries.get(key) || entries.get(`$LEDGER-${key}:USD`) || (baseLedger ? { ...baseLedger, currency: baseCurrency } : null);
    const value = Number(entry?.value);
    if (!Number.isFinite(value)) return 0;
    if (String(entry?.currency || '').toUpperCase() === 'USD') return value;
    if (Number.isFinite(usdExchangeRate) && usdExchangeRate > 0) return Number((value / usdExchangeRate).toFixed(6));
    return 0;
  };
  return {
    eligible_capital_usd: toUsd('NetLiquidation'),
    cash_usd: toUsd('TotalCashValue'),
    realized_pnl_day_usd: toUsd('RealizedPnL'),
    unrealized_pnl_usd: toUsd('UnrealizedPnL'),
  };
}

export class IBKRNewGateway {
  constructor(config, onEvent) { this.config = config; this.onEvent = onEvent; this.nextOrderId = null; this.connected = false; this.reconciliation = { account: false, open_orders: false }; this.accountAttestation = { status: 'failed', environment: config.environment, execution_ready: false, reason_code: 'GATEWAY_NOT_ATTESTED' }; this.positions = []; this.openOrders = []; this.accountValues = new Map(); this.orderMap = new Map(); this.executionMap = new Map(); this.ib = new IBApi({ host: config.host, port: config.port, clientId: config.clientId }); }
  connect() {
    return new Promise((resolve, reject) => {
      let orderIdReady = false; let accountsReady = false; let settled = false;
      const finish = (error = null) => {
        if (settled) return;
        if (error) { settled = true; clearTimeout(timeout); reject(error); return; }
        if (!orderIdReady || !accountsReady) return;
        if (this.accountAttestation.status !== 'verified') { settled = true; clearTimeout(timeout); reject(new Error(this.accountAttestation.reason_code || 'ACCOUNT_ATTESTATION_FAILED')); return; }
        settled = true; clearTimeout(timeout); this.connected = true; this.installCallbacks(); resolve();
      };
      const timeout = setTimeout(() => finish(new Error('IBKRNew Gateway account attestation timeout')), 15000);
      this.ib.on(EventName.error, (e, code, reqId) => { if (Number(code) >= 500 && Number(reqId) === -1) this.onEvent('bridge.gateway_error', { component_id: 'IBKRNewGateway', component_type: 'ibkr_gateway', code, message: e?.message || String(e) }); });
      this.ib.on(EventName.disconnected, () => { this.connected = false; this.accountAttestation = { ...this.accountAttestation, status: 'failed', execution_ready: false, reason_code: 'GATEWAY_DISCONNECTED' }; this.onEvent('bridge.gateway_disconnected', { component_id: 'IBKRNewGateway', component_type: 'ibkr_gateway', message: 'IBKR Gateway disconnected' }); });
      this.ib.on(EventName.managedAccounts, (accountsList) => { this.accountAttestation = applyReconciliationState(evaluateAccountAttestation({ environment: this.config.environment, configuredAccountId: this.config.accountId, managedAccounts: accountsList }), this.reconciliation); accountsReady = true; finish(); });
      this.ib.on(EventName.nextValidId, (orderId) => { this.nextOrderId = Number(orderId); orderIdReady = true; this.ib.reqManagedAccts(); finish(); });
      this.ib.connect();
    });
  }
  installCallbacks() {
    if (this.config.correlationPath && existsSync(this.config.correlationPath)) {
      const saved = JSON.parse(readFileSync(this.config.correlationPath,'utf8'));
      this.orderMap = new Map(saved.orders || []); this.executionMap = new Map(saved.executions || []);
    }
    this.ib.on(EventName.updateAccountValue, (key, value, currency, accountName) => {
      if (accountName && accountName!==this.config.accountId) return;
      const normalizedKey = String(key || '');
      const normalizedCurrency = String(currency || '').toUpperCase();
      if (ACCOUNT_VALUE_KEYS.has(normalizedKey)) this.accountValues.set(normalizedKey, { value: Number(value), currency: normalizedCurrency });
      if (['$LEDGER-ExchangeRate', '$LEDGER-RealizedPnL', '$LEDGER-UnrealizedPnL'].includes(normalizedKey)) this.accountValues.set(`${normalizedKey}:${normalizedCurrency}`, { value: Number(value), currency: normalizedCurrency });
    });
    this.ib.on(EventName.updatePortfolio, (contract, position, marketPrice, marketValue, averageCost, unrealizedPNL, realizedPNL) => { const item = { con_id: contract.conId, symbol: contract.symbol, security_type: contract.secType, quantity: position, market_price: marketPrice, market_value: marketValue, average_cost: averageCost, unrealized_pnl_usd: unrealizedPNL, realized_pnl_usd: realizedPNL, multiplier: contract.multiplier }; this.positions = this.positions.filter((p) => p.con_id !== item.con_id); if (Number(position)) this.positions.push(item); this.onEvent('position.changed', { positions: this.positions }); });
    this.ib.on(EventName.openOrder, (orderId, contract, order, orderState) => {
      if (order.account && order.account !== this.config.accountId) return;
      this.openOrders = this.openOrders.filter((x) => x.order_id !== Number(orderId));
      this.openOrders.push({ order_id: Number(orderId), order_ref: order.orderRef, symbol: contract.symbol, status: orderState?.status, parent_id: order.parentId });
      if (String(order.orderRef || '').startsWith('IBKRNewAuthorization_')) {
        const {account,...safeOrder}=order;
        this.orderMap.set(Number(orderId), { authorization_id: order.orderRef, order_role: Number(order.parentId) ? String(order.orderType).startsWith('STP') ? 'protective_stop' : 'target' : 'entry', order: safeOrder });
      }
      this.saveCorrelation();
    });
    this.ib.on(EventName.accountDownloadEnd, () => { this.reconciliation.account = true; this.accountAttestation = applyReconciliationState(this.accountAttestation, this.reconciliation); this.onEvent('account.snapshot', this.snapshot()); });
    this.ib.on(EventName.openOrderEnd, () => { this.reconciliation.open_orders = true; this.accountAttestation = applyReconciliationState(this.accountAttestation, this.reconciliation); this.ib.reqExecutions?.(900001,{acctCode:this.config.accountId}); });
    this.ib.on(EventName.orderStatus, (orderId,status,filled,remaining,avgFillPrice) => {
      const mapped=this.orderMap.get(Number(orderId)) || {};
      if(mapped.authorization_id) {this.orderMap.set(Number(orderId),{...mapped,filled:Number(filled),remaining:Number(remaining)});this.saveCorrelation();}
      this.openOrders=this.openOrders.map(x=>x.order_id===Number(orderId)?{...x,status}:x);
      this.onEvent('order.status_changed',{order_id:orderId,authorization_id:mapped.authorization_id,order_role:mapped.order_role,status,filled,remaining,average_fill_price:avgFillPrice});
    });
    this.ib.on(EventName.execDetails, (requestId, contract, execution) => {
      if (execution.acctNumber && execution.acctNumber !== this.config.accountId) return;
      const mapped = this.orderMap.get(Number(execution.orderId)) || {};
      const payload = { execution_id: execution.execId, order_id: execution.orderId, authorization_id:mapped.authorization_id,order_role:mapped.order_role, symbol: contract.symbol, side: execution.side, quantity: execution.shares, price: execution.price, occurred_at: new Date().toISOString() };
      this.executionMap.set(String(execution.execId), payload); this.saveCorrelation(); this.onEvent('execution.fill', payload);
    });
    this.ib.on(EventName.commissionReport, (report) => {
      const mapped = this.executionMap.get(String(report.execId)); if (!mapped) return;
      const currency = String(report.currency || '').toUpperCase();
      const fx = currency === 'USD' ? 1 : Number(this.accountValues.get('$LEDGER-ExchangeRate:USD')?.value);
      const base = String(this.accountValues.get('NetLiquidation')?.currency || '').toUpperCase();
      if (currency !== 'USD' && (currency !== base || !(fx > 0))) { this.onEvent('desktop.component_error', { component_id: 'IBKRNewPositionMonitor', code: 'COMMISSION_CURRENCY_UNAVAILABLE', message: 'Commission conversion unavailable; broker commission reconciliation required.' }); return; }
      const realized = Number(report.realizedPNL);
      this.onEvent('commission.report', { ...mapped, execution_id: report.execId, commission_usd: Number(report.commission) / fx, ...(Number.isFinite(realized) && Math.abs(realized) < 1e100 ? { realized_pnl_usd: realized / fx } : {}), currency: 'USD' });
    });
    this.ib.reqAccountUpdates(true, this.config.accountId); this.ib.reqAllOpenOrders();
  }
  contract(c) { const out = { conId: Number(c.con_id) || 0, symbol: c.symbol, secType: c.security_type === 'OPT' ? SecType.OPT : SecType.STK, exchange: c.exchange || 'SMART', currency: c.currency || 'USD' }; if (out.secType === SecType.OPT) Object.assign(out, { lastTradeDateOrContractMonth: c.expiry, strike: Number(c.strike), right: c.right, multiplier: String(c.multiplier || 100) }); return out; }
  saveCorrelation() {
    if (!this.config.correlationPath) return;
    const path = this.config.correlationPath;
    writeFileSync(`${path}.tmp`,JSON.stringify({orders:[...this.orderMap],executions:[...this.executionMap]}),{mode:0o600}); renameSync(`${path}.tmp`,path);
  }
  snapshotQuote(contract) {
    return new Promise((resolve, reject) => {
      const requestId = 500000 + Math.floor(Math.random() * 400000); const quote = {}; let settled = false;
      const cleanup = () => { clearTimeout(timer); this.ib.off(EventName.tickPrice, onPrice); this.ib.off(EventName.tickSnapshotEnd, onEnd); this.ib.off(EventName.marketDataType, onType); try { this.ib.cancelMktData(requestId); } catch {} };
      const finish = () => {
        if (settled) return; settled = true; cleanup();
        const bid = Number(quote.bid), ask = Number(quote.ask), last = Number(quote.last);
        const capturedAt = Math.min(Date.parse(quote.bid_at), Date.parse(quote.ask_at));
        if (!(bid > 0 && ask >= bid) || quote.market_data_type !== 1 || !Number.isFinite(capturedAt) || Date.now() - capturedAt > 5000) reject(new Error('fresh non-delayed local IBKR bid/ask unavailable'));
        else resolve({ bid, ask, last, market_data_type: 1, captured_at: new Date(capturedAt).toISOString() });
      };
      const completeQuote = () => { if (quote.market_data_type === 1 && quote.bid > 0 && quote.ask >= quote.bid) finish(); };
      const onPrice = (id, field, value) => { if (id !== requestId || !(Number(value) > 0)) return; const key = ({1:'bid',2:'ask',4:'last'})[Number(field)]; if (key) { quote[key] = Number(value); quote[`${key}_at`] = new Date().toISOString(); completeQuote(); } };
      const onType = (id, type) => { if (id === requestId) { quote.market_data_type = Number(type); completeQuote(); } };
      const onEnd = id => { if (id === requestId) finish(); };
      const timer = setTimeout(finish, 6000);
      this.ib.on(EventName.tickPrice,onPrice); this.ib.on(EventName.tickSnapshotEnd,onEnd); this.ib.on(EventName.marketDataType,onType);
      this.ib.reqMktData(requestId,contract,'',true,false,[]);
    });
  }
  subscribe(symbol, requestId, profile = {}) {
    const profiles = [...(this.marketSubscriptions?.entries.values() || [])].map(e => e.profile).filter(p => p.symbol !== symbol);
    this.setSubscriptionProfiles([...profiles, { ...profile, symbol }]);
  }
  setSubscriptionProfiles(profiles) {
    this.marketSubscriptions ||= new MarketSubscriptions(this.ib, p => this.contract(p), this.onEvent, { regular: () => tradingSession().regular });
    this.marketSubscriptions.setProfiles(profiles);
    this.refreshSubscriptions();
  }
  setVolumeProfiles(profiles) {
    // This rollout is Paper-only. It cannot activate a Live data/entry path.
    if (this.config.environment !== 'paper') return;
    this.volumeProfiles ||= new VolumeProfiles(this.ib, p => this.contract(p), this.onEvent);
    this.volumeProfiles.setProfiles(profiles);
  }
  refreshSubscriptions() {
    this.marketSubscriptions?.refresh();
    this.volumeProfiles?.refresh();
    this.quotes = new Map([...(this.marketSubscriptions?.entries.values() || [])].map(e => [e.symbol, e.quote]));
  }
  async executableFeatures(features, profile, policy) {
    const contract = this.contract({ ...profile, symbol: features.symbol });
    const quote = await this.snapshotQuote(contract);
    const short = features.last < features.vwap && features.ema_fast < features.ema_slow ? await this.snapshotShortability(contract) : this.quotes?.get(features.symbol) || {};
    const volume = this.volumeProfiles?.get(features.symbol);
    return { ...features, security_type: profile?.security_type || 'STK', average_daily_volume: profile?.average_daily_volume, ...volume, bid: quote.bid, ask: quote.ask, last: quote.last || features.last, quote_at: quote.captured_at, market_data_type: quote.market_data_type, shortable: short.shortability_level > 2.5 || policy.order_permissions?.allow_hard_to_borrow === true && short.shortability_level > 1.5, shortability_level: short.shortability_level, shortability_at: short.shortability_at };
  }
  snapshotShortability(contract) {
    return new Promise((resolve,reject) => {
      const requestId=950000+Math.floor(Math.random()*40000);
      const cleanup=()=>{clearTimeout(timer);this.ib.off(EventName.tickGeneric,onTick);try{this.ib.cancelMktData(requestId);}catch{}};
      const onTick=(id,field,value)=>{if(id!==requestId || Number(field)!==46)return;cleanup();resolve({shortability_level:Number(value),shortability_at:new Date().toISOString()});};
      const timer=setTimeout(()=>{cleanup();reject(new Error('fresh shortability unavailable'));},6000);
      this.ib.on(EventName.tickGeneric,onTick);this.ib.reqMktData(requestId,contract,'236',false,false,[]);
    });
  }
  async placeProtected(command, revalidate) {
    const original = this.ib?.placeOrder;
    let submissionStarted = false;
    if (typeof original === 'function') this.ib.placeOrder = (...args) => {
      submissionStarted = true;
      return original.apply(this.ib, args);
    };
    try { return await this.placeProtectedUnchecked(command, revalidate); }
    catch (error) {
      if (submissionStarted) error.submission_uncertain = true;
      throw error;
    } finally {
      if (typeof original === 'function') this.ib.placeOrder = original;
    }
  }
  async placeProtectedUnchecked(command, revalidate) {
    const a = command.authorization;
    if (a.environment !== this.config.environment) throw new Error('ACCOUNT_ENVIRONMENT_MISMATCH');
    if (this.accountAttestation?.status !== 'verified' || this.accountAttestation?.execution_ready !== true) throw new Error('ACCOUNT_ATTESTATION_OR_RECONCILIATION_REQUIRED');
    if (this.config.executionEnabled !== true) throw new Error('LOCAL_EXECUTION_GATE_DISABLED');
    const checkTime = () => {
      if (!Number.isFinite(Date.parse(a.expires_at)) || Date.parse(a.expires_at) <= Date.now()) throw new Error('authorization expired');
      const session = tradingSession(new Date(), a.session_rules?.new_entry_cutoff_minutes_before_close ?? 60);
      if (a.action==='EXIT' ? !session.regular : !session.opening_allowed) throw new Error(session.reason);
    };
    checkTime();
    if (!a.protection?.stop_price || a.entry?.order_type !== 'LIMIT') throw new Error('bounded entry and protective stop required');
    const contract = this.contract(a.contract); const quote = await this.snapshotQuote(contract);
    if (a.action!=='EXIT' && a.side === 'SELL') {
      const borrow = await this.snapshotShortability(contract);
      if (!(borrow.shortability_level > 2.5 || a.order_permissions?.allow_hard_to_borrow === true && borrow.shortability_level > 1.5)) throw new Error('fresh borrow permission unavailable');
    }
    if (typeof revalidate !== 'function') throw new Error('submission context revalidation required');
    await revalidate(); checkTime();
    if (this.accountAttestation?.execution_ready !== true || this.connected !== true) throw new Error('GATEWAY_RECONCILIATION_CHANGED_BEFORE_SUBMISSION');
    if (quote.market_data_type !== 1 || Date.now() - Date.parse(quote.captured_at) > 5000) throw new Error('fresh local quote expired before submission');
    if (a.action==='EXIT') return this.repriceProtectedExit(a,contract,quote);
    const reference = Number(quote.ask), sellReference = Number(quote.bid);
    if (a.side === 'BUY' && Number(a.entry.limit_price) > reference * 1.005) throw new Error('entry limit exceeds fresh local IBKR quote bound');
    if (a.side === 'SELL' && Number(a.entry.limit_price) < sellReference * 0.995) throw new Error('short entry limit is below fresh local IBKR quote bound');
    const entryId = this.nextOrderId++, targetId = this.nextOrderId++, stopId = this.nextOrderId++;
    const exitAction = a.side === 'BUY' ? OrderAction.SELL : OrderAction.BUY;
    const target = a.protection.targets?.[0]; if (!target?.limit_price) throw new Error('profit target required');
    const ocaGroup = `IBKRNew:${a.authorization_id}`;
    this.orderMap.set(entryId,{authorization_id:a.authorization_id,order_role:'entry'}); this.orderMap.set(targetId,{authorization_id:a.authorization_id,order_role:'target'}); this.orderMap.set(stopId,{authorization_id:a.authorization_id,order_role:'protective_stop'});
    this.saveCorrelation();
    this.ib.placeOrder(entryId,contract,{account:this.config.accountId,action:a.side==='BUY'?OrderAction.BUY:OrderAction.SSHORT,orderType:OrderType.LMT,totalQuantity:a.quantity,lmtPrice:a.entry.limit_price,tif:TimeInForce.DAY,transmit:false,orderRef:a.authorization_id});
    this.ib.placeOrder(targetId,contract,{account:this.config.accountId,action:exitAction,orderType:OrderType.LMT,totalQuantity:a.quantity,lmtPrice:target.limit_price,parentId:entryId,ocaGroup,ocaType:2,tif:TimeInForce.GTC,transmit:false,orderRef:a.authorization_id});
    this.ib.placeOrder(stopId,contract,{account:this.config.accountId,action:exitAction,orderType:OrderType.STP,totalQuantity:a.quantity,auxPrice:a.protection.stop_price,parentId:entryId,ocaGroup,ocaType:2,tif:TimeInForce.GTC,transmit:true,orderRef:a.authorization_id});
    return {entry_order_id:entryId,target_order_id:targetId,protective_order_id:stopId,local_quote:quote};
  }
  repriceProtectedExit(a,contract,quote) {
    const orders=[...this.orderMap].filter(([,mapped])=>mapped.authorization_id===a.parent_trade_authorization_id);
    const target=orders.find(([orderId,mapped])=>mapped.order_role==='target' && mapped.order && this.openOrders.some(x=>x.order_id===orderId && !/filled|cancel|inactive/i.test(x.status || '')));
    const stop=orders.find(([orderId,mapped])=>mapped.order_role==='protective_stop' && mapped.order && this.openOrders.some(x=>x.order_id===orderId && !/filled|cancel|inactive/i.test(x.status || '')));
    if(!target || !stop) throw new Error('owned reconciled target and protective stop required for managed exit');
    const position=this.positions.find(p=>Number(p.con_id)===Number(contract.conId) && Number(contract.conId)>0 || p.symbol===contract.symbol && String(p.security_type)===String(contract.secType));
    if(!position || Number(position.quantity)*(a.side==='SELL'?1:-1)<=0 || Math.abs(Number(position.quantity))<Number(a.quantity)) throw new Error('broker position does not support risk-reducing exit');
    const [orderId,mapped]=target;
    // IBKR may replace the submitted OCA name with a broker-generated identifier.
    // Prove ownership and protection from both returned children and their entry,
    // rather than requiring the broker to echo our original OCA label verbatim.
    const stopOrder=stop[1].order, parentId=Number(mapped.order.parentId), parent=this.orderMap.get(parentId);
    const remaining=Number(mapped.order.totalQuantity)-Number(mapped.filled || 0);
    if (!mapped.order.ocaGroup || mapped.order.ocaGroup!==stopOrder.ocaGroup
      || !parentId || parentId!==Number(stopOrder.parentId)
      || parent?.authorization_id!==a.parent_trade_authorization_id || parent?.order_role!=='entry'
      || mapped.order.orderRef!==a.parent_trade_authorization_id || stopOrder.orderRef!==a.parent_trade_authorization_id
      || !String(stopOrder.orderType).startsWith('STP') || !(Number(stopOrder.auxPrice)>0)
      || mapped.order.action!==a.side || stopOrder.action!==a.side
      || !Number.isFinite(remaining) || remaining<=0 || remaining!==Number(a.quantity)
      || Number(stopOrder.totalQuantity)<remaining) throw new Error('target remaining quantity requires reconciliation before managed exit');
    const price=a.side==='SELL'?Number(quote.bid):Number(quote.ask);
    if(!(price>0)) throw new Error('fresh executable exit quote required');
    // Modify the existing OCA target; never cancel or loosen its protective stop.
    const order={...mapped.order,account:this.config.accountId,lmtPrice:price,transmit:true};
    this.ib.placeOrder(orderId,contract,order);
    this.onEvent('position.exit_submitted',{authorization_id:a.parent_trade_authorization_id,exit_authorization_id:a.authorization_id,order_id:orderId,reason:a.exit_reason,quantity:a.quantity});
    return {exit_order_id:orderId,protected_order_id:stop[0],exit_reason:a.exit_reason,local_quote:quote};
  }
  disconnect() { this.marketSubscriptions?.dispose(); this.volumeProfiles?.dispose(); this.ib.disconnect(); }
  snapshot() { return { ...normalizeAccountValuesToUsd(this.accountValues), positions: [...this.positions], open_orders: [...this.openOrders] }; }
  health() { return { connected: this.connected, positions: this.positions.length, open_orders: this.openOrders.length, account_attestation: { ...this.accountAttestation } }; }
}
