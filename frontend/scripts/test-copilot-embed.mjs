import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../public/copilot-embed-bridge.js',import.meta.url),'utf8');
let listener,replies=[],focus=0;
const parent={postMessage:(message,origin)=>replies.push({message,origin})};
const input={type:'text',disabled:false,hidden:false,getClientRects:()=>[{}],getAttribute:k=>k==='placeholder'?'Name':null,style:{outline:''},dataset:{},scrollIntoView(){},focus(){focus++;}};
Object.defineProperty(input,'value',{get(){throw new Error('Bridge must not read field values');},set(){throw new Error('Bridge must not write field values');}});
const window={parent,addEventListener:(event,fn)=>{listener=fn;}};
vm.runInNewContext(code,{window,document:{querySelectorAll:()=>[input]}});
const event=(overrides={})=>({origin:'https://login.flolah.cloud',source:parent,data:{type:'flolah-copilot-guide',request:'test',command:'focus',field:'name'},...overrides});
listener(event({origin:'https://evil.example'}));listener(event({source:{}}));assert.equal(focus,0);
listener(event());assert.equal(focus,1);assert.equal(replies[0].origin,'https://login.flolah.cloud');
listener(event({data:{type:'flolah-copilot-guide',request:'test',command:'fill',field:'name',value:'Must not write'}}));assert.equal(replies.at(-1).message.ok,false);
listener(event({data:{type:'flolah-copilot-guide',request:'test',command:'inspect'}}));assert.deepEqual(JSON.parse(JSON.stringify(replies.at(-1).message.fields)),['name']);
assert(!JSON.stringify(replies).includes('Must not write'));
listener(event({data:{type:'flolah-copilot-guide',request:'test',command:'clear'}}));assert.equal(input.style.outline,'');
console.log('PASS embedded guide: exact origin/window, no write commands, no field values exported, highlight cleanup.');
class NativeInput {
 constructor(){this._value='Original';this.type='text';this.tagName='INPUT';this.isConnected=true;this.style={};this.dataset={};this.maxLength=100;this.events=[];}
 get value(){return this._value;}set value(value){this._value=value;}
 getAttribute(k){return k==='placeholder'?'Name':null;}
 getClientRects(){return [{}];}cloneNode(){return {value:'',checkValidity:()=>true};}
 dispatchEvent(e){this.events.push(e.type);}blur(){this.events.push('blur');}
}
const editable=new NativeInput();let handler,writes=[];
const parent2={postMessage:m=>writes.push(m)},window2={parent:parent2,addEventListener:(_,fn)=>handler=fn};
vm.runInNewContext(code,{window:window2,document:{querySelectorAll:()=>[editable]},location:{pathname:'/objects/companies'},crypto:{randomUUID:()=>String(writes.length)},HTMLInputElement:NativeInput,Event:class{constructor(type){this.type=type;}}});
const send=data=>handler({origin:'https://login.flolah.cloud',source:parent2,data:{type:'flolah-copilot-guide',request:'r',...data}});
send({command:'prepare'});let snapshot=writes.at(-1).snapshot;
assert(!JSON.stringify(writes).includes('Original'),'No existing values leave the embedded page');
editable.value='User changed';send({command:'fill',snapshot,values:{name:'Proposed'}});assert.equal(writes.at(-1).ok,false);assert.equal(editable.value,'User changed');
send({command:'prepare'});snapshot=writes.at(-1).snapshot;send({command:'fill',snapshot,values:{name:'Approved synthetic'}});assert.equal(writes.at(-1).ok,true);assert.equal(editable.value,'Approved synthetic');assert.deepEqual(editable.events,['input','change','blur']);
send({command:'fill',snapshot,values:{name:'Replay'}});assert.equal(writes.at(-1).ok,false);assert.equal(editable.value,'Approved synthetic');
console.log('PASS embedded reviewed fill: private baseline, stale-edit rejection, native events, one-use snapshot.');
