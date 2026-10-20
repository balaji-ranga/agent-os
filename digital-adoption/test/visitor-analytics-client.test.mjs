import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {createVisitorAnalytics} from '../web/visitor-analytics.mjs';

function fixture(enabled){
 const intervals=new Map(),events=new Map(),requests=[],body={children:[],append(node){this.children.push(node);}};let sequence=0;
 const storage=new Map(),node=tag=>({tag,dataset:{},style:{},children:[],append(...items){this.children.push(...items);},remove(){this.removed=true;},setAttribute(){}});
 const document={body,visibilityState:'visible',createElement:node,querySelector:()=>null,addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:(type,fn)=>{if(events.get(type)===fn)events.delete(type);},defaultView:{crypto,location:{pathname:'/synthetic'},navigator:{userAgent:'Chrome'},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},sessionStorage:{getItem:()=>null,setItem(){}},setInterval:fn=>{const id=++sequence;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id)}};
 const analytics=createVisitorAnalytics({document,request:async(path,body)=>{requests.push({path,body});return path==='/v1/analytics/policy'?{enabled,websiteId:'synthetic',revision:1,retentionDays:30}:{};}});
 return {analytics,intervals,events,requests,body};
}

test('disabled/unaccepted analytics has no recurring timers and avoids host DOM work',async()=>{
 for(const enabled of [false,true]){
  const f=fixture(enabled);await setImmediate();assert.equal(f.intervals.size,0);
  assert.doesNotThrow(()=>f.events.get('click')({target:{closest(){throw Error('Unconsented host traversal');}}}));
  assert.deepEqual(f.requests.map(r=>r.path),['/v1/analytics/policy']);
  f.analytics.destroy();assert.equal(f.events.size,0);assert.equal(f.intervals.size,0);
 }
});

test('analytics schedules only after explicit opt-in and releases all timers on opt-out',async()=>{
 const f=fixture(true);await setImmediate();assert.equal(f.intervals.size,0);
 f.body.children[0].children[1].onclick();await setImmediate();assert.equal(f.intervals.size,3);
 await f.analytics.stop();assert.equal(f.intervals.size,0);
 f.analytics.destroy();assert.equal(f.events.size,0);assert.equal(f.intervals.size,0);
});
