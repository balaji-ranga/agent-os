import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { IBKRNewGateway } from '../src/gateway.js';
import { installTestClock } from './clock.js';
import { tradingSession } from '../src/session.js';
const clock=installTestClock();
try {
  const gateway=Object.create(IBKRNewGateway.prototype); gateway.ib=new EventEmitter();
  gateway.ib.cancelMktData=()=>{};
  gateway.ib.reqMktData=id=>queueMicrotask(()=>{
    gateway.ib.emit('marketDataType',id,1);
    gateway.ib.emit('tickPrice',id,1,99.95);gateway.ib.emit('tickPrice',id,2,100);
  });
  const quote=await gateway.snapshotQuote({symbol:'EXAMPLE'});
  assert.equal(quote.market_data_type,1);assert.equal(quote.bid,99.95);
  assert.equal(gateway.ib.listenerCount('tickPrice'),0,'completed snapshots clean up listeners');
  gateway.ib.reqMktData=id=>queueMicrotask(()=>{
    gateway.ib.emit('marketDataType',id,3);gateway.ib.emit('tickPrice',id,1,99.95);gateway.ib.emit('tickPrice',id,2,100);gateway.ib.emit('tickSnapshotEnd',id);
  });
  await assert.rejects(()=>gateway.snapshotQuote({symbol:'EXAMPLE'}),/non-delayed/);
  gateway.ib.reqMktData=id=>queueMicrotask(()=>gateway.ib.emit('tickGeneric',id,46,1));
  assert.equal((await gateway.snapshotShortability({symbol:'EXAMPLE'})).shortability_level,1,'unavailable borrow is not a positive share count');
  gateway.ib.reqMktData=id=>queueMicrotask(()=>gateway.ib.emit('tickGeneric',id,46,3));
  assert.equal((await gateway.snapshotShortability({symbol:'EXAMPLE'})).shortability_level,3);
  gateway.snapshotQuote=async()=>({bid:99.95,ask:100,last:100,market_data_type:1,captured_at:new Date().toISOString()});
  const features=await gateway.executableFeatures({symbol:'EXAMPLE',last:100,vwap:99,ema_fast:100,ema_slow:99},{security_type:'ETF',average_daily_volume:1000000},{order_permissions:{allow_hard_to_borrow:false}});
  assert.equal(features.security_type,'ETF');assert.equal(features.average_daily_volume,1000000);assert.equal(features.bid,99.95);assert.equal(features.market_data_type,1);
  assert.equal(tradingSession(new Date('2026-10-05T13:30:00Z')).opening_allowed,true);
  console.log('IBKRNew bridge readiness passed: actual quote callbacks, non-delayed-only gating, fresh borrow responses, ETF enrichment, session clock. No broker connection.');
} finally {clock.restore();}
