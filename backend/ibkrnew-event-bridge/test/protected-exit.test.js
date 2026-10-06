import assert from 'node:assert/strict';
import {IBKRNewGateway} from '../src/gateway.js';
const gateway=new IBKRNewGateway({accountId:'fixture',environment:'paper'},()=>{});
assert.equal(gateway.health().protected_exit_proof_version,'owned-oca-pair-v2');
const auth='IBKRNewAuthorization_fixture',a={parent_trade_authorization_id:auth,quantity:1,side:'SELL'},contract={symbol:'TLT',secType:'STK',conId:42};
gateway.positions=[{symbol:'TLT',security_type:'STK',con_id:42,quantity:1}];
gateway.openOrders=[{order_id:2,status:'Submitted'},{order_id:3,status:'PreSubmitted'}];
const original=new Map([[1,{authorization_id:auth,order_role:'entry'}],[2,{authorization_id:auth,order_role:'target',filled:0,order:{orderRef:auth,parentId:1,ocaGroup:'1907695429',orderType:'LMT',totalQuantity:1,action:'SELL',lmtPrice:78.2}}],[3,{authorization_id:auth,order_role:'protective_stop',order:{orderRef:auth,parentId:1,ocaGroup:'1907695429',orderType:'STP',totalQuantity:1,action:'SELL',auxPrice:77.04}}]]);
let submitted=[];gateway.ib.placeOrder=(...args)=>submitted.push(args);
const reset=()=>{gateway.orderMap=structuredClone(original);submitted=[];};reset();
const result=gateway.repriceProtectedExit(a,contract,{bid:77.42,ask:77.43});
assert.equal(result.exit_order_id,2);assert.equal(result.protected_order_id,3);assert.equal(submitted.length,1);
assert.equal(submitted[0][2].lmtPrice,77.42);assert.equal(submitted[0][2].ocaGroup,'1907695429');assert.equal(gateway.orderMap.get(3).order.auxPrice,77.04);
for(const mutate of [()=>gateway.orderMap.get(3).order.ocaGroup='foreign',()=>gateway.orderMap.get(3).order.parentId=99,()=>gateway.orderMap.get(1).authorization_id='foreign',()=>gateway.orderMap.get(2).order.orderRef='foreign',()=>gateway.orderMap.get(3).order.auxPrice=0,()=>gateway.orderMap.get(2).order.totalQuantity=2,()=>gateway.orderMap.get(3).order.action='BUY']) {
 reset();mutate();assert.throws(()=>gateway.repriceProtectedExit(a,contract,{bid:77.42}),error=>error.message.includes('reconciliation') && error.protected_exit_failed_checks.length>0);assert.equal(submitted.length,0);
}
console.log('Protected exit passed: broker-renamed OCA pair, exact quantity, correlated ownership, preserved stop, foreign/ambiguous/oversized pairs rejected. No broker connected.');
