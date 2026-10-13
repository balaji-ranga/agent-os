import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../public/copilot-embed-bridge.js',import.meta.url),'utf8');
let listener,replies=[],focus=0;
const parent={postMessage:(message,origin)=>replies.push({message,origin})};
const input={type:'text',disabled:false,hidden:false,getClientRects:()=>[{}],getAttribute:k=>k==='placeholder'?'Name':null,style:{outline:''},dataset:{},scrollIntoView(){},focus(){focus++;}};
Object.defineProperty(input,'value',{get(){throw new Error('Bridge must not read field values');},set(){throw new Error('Bridge must not write field values');}});
const window={parent,addEventListener:(event,fn)=>{listener=fn;}};
vm.runInNewContext(code,{window,document:{querySelectorAll:()=>[input]},location:{pathname:'/test'}});
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
 closest(){return null;}
 dispatchEvent(e){this.events.push(e.type);}focus(){this.focused=true;}blur(){assert.equal(this.focused,true);this.events.push('blur');}
}
const editable=new NativeInput();let handler,writes=[];
const parent2={postMessage:m=>writes.push(m)},window2={parent:parent2,addEventListener:(_,fn)=>handler=fn};
vm.runInNewContext(code,{requestAnimationFrame:fn=>fn(),window:window2,document:{querySelectorAll:()=>[editable]},location:{pathname:'/objects/companies'},crypto:{randomUUID:()=>String(writes.length)},HTMLInputElement:NativeInput,Event:class{constructor(type){this.type=type;}}});
const send=data=>handler({origin:'https://login.flolah.cloud',source:parent2,data:{type:'flolah-copilot-guide',request:'r',...data}});
await send({command:'prepare'});let snapshot=writes.at(-1).snapshot;
assert(!JSON.stringify(writes).includes('Original'),'No existing values leave the embedded page');
editable.value='User changed';await send({command:'fill',snapshot,values:{name:'Proposed'}});assert.equal(writes.at(-1).ok,false);assert.equal(editable.value,'User changed');
await send({command:'prepare'});snapshot=writes.at(-1).snapshot;await send({command:'fill',snapshot,values:{name:'Approved synthetic'}});assert.equal(writes.at(-1).ok,true);assert.equal(editable.value,'Approved synthetic');assert.deepEqual(editable.events,['input','change','blur']);
await send({command:'fill',snapshot,values:{name:'Replay'}});assert.equal(writes.at(-1).ok,false);assert.equal(editable.value,'Approved synthetic');
console.log('PASS embedded reviewed fill: private baseline, stale-edit rejection, native events, one-use snapshot.');
const second=new NativeInput();second.getAttribute=k=>k==='placeholder'?'Description':null;
const multiParent={postMessage:m=>writes.push(m)};let multiHandler;
vm.runInNewContext(code,{requestAnimationFrame:fn=>fn(),window:{parent:multiParent,addEventListener:(_,fn)=>multiHandler=fn},document:{querySelectorAll:()=>[editable,second]},location:{pathname:'/object/company/test'},crypto:{randomUUID:()=>String(writes.length)},HTMLInputElement:NativeInput,Event:class{constructor(type){this.type=type;}}});
const multi=data=>multiHandler({origin:'https://login.flolah.cloud',source:multiParent,data:{type:'flolah-copilot-guide',request:'multi',...data}});
await multi({command:'prepare'});const firstSnapshot=writes.at(-1).snapshot;
await multi({command:'fill',snapshot:firstSnapshot,values:{name:'First guided field'}});
const nextSnapshot=writes.at(-1).next_snapshot;assert(nextSnapshot);assert.notEqual(nextSnapshot,firstSnapshot);
await multi({command:'fill',snapshot:firstSnapshot,values:{description:'Replay'}});assert.equal(writes.at(-1).ok,false);
second.value='Manual edit between steps';
await multi({command:'fill',snapshot:nextSnapshot,values:{description:'Must not overwrite'}});assert.equal(writes.at(-1).ok,false);assert.equal(second.value,'Manual edit between steps');
await multi({command:'prepare'});const refreshed=writes.at(-1).snapshot;
await multi({command:'clear'});await multi({command:'fill',snapshot:refreshed,values:{name:'Cancelled'}});assert.equal(writes.at(-1).ok,false);
console.log('PASS guided multi-field bridge: rotated tokens, preserved remaining baselines, intervening edits and cancellation.');
let recipeHandler,recipeInput=null,clicks=0;const recipeReplies=[];
const recipeParent={postMessage:m=>recipeReplies.push(m)};
const opener={getClientRects:()=>[{}],click(){throw Error('Layout wrapper is not the editable title');},querySelector(){return {click(){clicks++;recipeInput=new NativeInput();recipeInput.closest=()=>opener;}};}};
vm.runInNewContext(code,{KeyboardEvent:class{constructor(type){this.type=type;}},window:{parent:recipeParent,addEventListener:(_,fn)=>recipeHandler=fn},document:{querySelectorAll:s=>s.includes('top-bar-title')?[opener]:recipeInput?[recipeInput]:[]},location:{pathname:'/object/company/test'},requestAnimationFrame:fn=>fn(),crypto:{randomUUID:()=>String(recipeReplies.length)},HTMLInputElement:NativeInput,Event:class{constructor(type){this.type=type;}}});
const recipe=data=>recipeHandler({origin:'https://login.flolah.cloud',source:recipeParent,data:{type:'flolah-copilot-guide',request:'recipe',...data}});
await recipe({command:'inspect'});assert.deepEqual(Array.from(recipeReplies.at(-1).fields),['name']);assert.equal(clicks,0);
await recipe({command:'prepare',fields:['name']});const recipeSnapshot=recipeReplies.at(-1).snapshot;assert.equal(clicks,1);
recipeInput.isConnected=false;recipeInput=null;
await recipe({command:'fill',snapshot:recipeSnapshot,values:{name:'Reviewed recipe value'}});
assert.equal(recipeReplies.at(-1).ok,true);assert.equal(recipeInput.value,'Reviewed recipe value');assert.equal(clicks,2);
assert.deepEqual(recipeInput.events,['input','change','keydown','keyup','blur']);
console.log('PASS CRM inline recipe: metadata discovery is read-only, approved editor reopening retains baseline.');
