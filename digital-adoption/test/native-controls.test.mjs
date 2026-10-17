import test from 'node:test';
import assert from 'node:assert/strict';
import {createInspector} from '../web/dom.mjs';
function fixture(type){
 class Input{get value(){return this._value||'';}set value(v){this._value=v;}get checked(){return this._checked||false;}set checked(v){this._checked=v;}}
 class Select extends Input{}
 const e=type==='select-one'?new Select():new Input();
 Object.assign(e,{type,tagName:type==='select-one'?'SELECT':'INPUT',name:'test',id:'test',labels:[{textContent:'Test field'}],isConnected:true,events:[],closest:()=>null,getClientRects:()=>[{}],getAttribute:()=>null,dispatchEvent:event=>e.events.push(event.type)});
 if(type==='select-one')e.options=[{value:'one',text:'First',disabled:false},{value:'two',text:'Second',disabled:false}];
 // Native SELECT defines its own setter in the browser.
 Object.defineProperty(Select.prototype,'value',{get(){return this._value||'';},set(v){this._value=v;}});
 const document={location:{href:'https://example.test/form',origin:'https://example.test',pathname:'/form'},defaultView:{HTMLInputElement:Input,HTMLSelectElement:Select,Event:class{constructor(type){this.type=type;}},getComputedStyle:()=>({visibility:'visible'})},querySelectorAll:selector=>selector==='input,textarea,select'?[e]:[]};
 return {e,inspector:createInspector(document)};
}
test('native selection resolves labels locally and rejects stale options without dispatch',()=>{
 const {e,inspector}=fixture('select-one');let snapshot=inspector.snapshot();
 assert.equal('options' in snapshot.fields[0],false);
 const result=inspector.fill({ref:snapshot.fields[0].ref,value:'Second',expectedRevision:snapshot.revision,approved:true});
 assert.equal(e.value,'two');assert.equal(result.valueObserved,true);assert.deepEqual(e.events,['input','change']);
 snapshot=inspector.snapshot();e.options[0].text='Changed';assert.throws(()=>inspector.fill({ref:snapshot.fields[0].ref,value:'First',expectedRevision:snapshot.revision,approved:true}),/Options changed/);
 assert.equal(e.events.length,2);
});
test('checkbox writes require explicit boolean and reject intervening user changes',()=>{
 const {e,inspector}=fixture('checkbox');let snapshot=inspector.snapshot();
 assert.throws(()=>inspector.fill({ref:snapshot.fields[0].ref,value:'yes',expectedRevision:snapshot.revision,approved:true}),/true or false/);
 assert.equal(inspector.fill({ref:snapshot.fields[0].ref,value:'true',expectedRevision:snapshot.revision,approved:true}).valueObserved,true);
 assert.equal(e.checked,true);snapshot=inspector.snapshot();e.checked=false;
 assert.throws(()=>inspector.fill({ref:snapshot.fields[0].ref,value:'false',expectedRevision:snapshot.revision,approved:true}),/Checkbox changed/);
});

test('wrapping labels exclude option and entered control text from inspection',()=>{
 const {e,inspector}=fixture('select-one');
 e.labels=[{textContent:'Shipping method Choose Standard Express',cloneNode(){
   const copy={textContent:'Shipping method Choose Standard Express',querySelectorAll(){return [{remove(){copy.textContent='Shipping method';}}];}};
   return copy;
 }}];
 assert.equal(inspector.snapshot().fields[0].label,'Shipping method');
});
