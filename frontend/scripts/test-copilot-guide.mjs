import assert from 'node:assert/strict';
import {findGuideField,highlightGuideField,revealRegisteredForm} from '../src/utils/copilotGuide.js';
import {captureDomFields,applyDomFields,visibleCopilotOptions} from '../src/utils/copilotDomFill.js';
const field=(overrides={})=>({name:'name',id:'',type:'text',labels:[],getAttribute:()=>null,closest:()=>null,getClientRects:()=>[{}],...overrides});
const root=items=>({querySelectorAll:()=>items});
const name=field();
assert.equal(findGuideField(root([name]),'name'),name);
assert.equal(findGuideField(root([name,field()]),'name'),null,'Ambiguous matches must not select a field');
for(const props of [{type:'password'},{type:'file'},{type:'hidden'},{disabled:true},{hidden:true},{closest:()=>({})},{getClientRects:()=>[]}])assert.equal(findGuideField(root([field(props)]),'name'),null);
const labelled=field({name:'',labels:[{textContent:'Display timezone'}]});
assert.equal(findGuideField(root([labelled]),'display_timezone'),labelled);
let actions=[];
const cleanup=highlightGuideField({isConnected:true,classList:{add:x=>actions.push(['add',x]),remove:x=>actions.push(['remove',x])},scrollIntoView:()=>actions.push(['scroll']),focus:()=>actions.push(['focus'])});
cleanup();assert.deepEqual(actions.map(a=>a[0]),['add','scroll','focus','remove']);
console.log('PASS guided field lookup: labels, ambiguity, protected/hidden/disabled controls and cleanup. No values read or written.');
let revealed=0;
const sections={getElementById:id=>id==='knowledge-documents'?{scrollIntoView:()=>revealed++}:null};
assert.equal(revealRegisteredForm(sections,'/master-data#knowledge-documents'),true);
assert.equal(revealRegisteredForm(sections,'/master-data#missing'),false);
assert.equal(revealRegisteredForm(sections,'/master-data#input[name=secret]'),false);
assert.equal(revealed,1);
const searchInput=field({type:'search',value:'',getAttribute:()=> 'search-control'});
assert.equal(captureDomFields(root([searchInput]),['search-control'])['search-control'].element,searchInput);
assert.throws(()=>captureDomFields(root([searchInput,searchInput]),['search-control']),/ambiguous/);
assert.throws(()=>captureDomFields(root([field({type:'password',getAttribute:()=> 'secret'})]),['secret']),/manual/);
const dropdown=field({getAttribute:()=> 'pages/Connector:1',options:[{value:'ics',label:'Published calendar'},{value:'disabled',label:'Disabled',disabled:true}]});
Object.defineProperty(dropdown,'value',{get(){throw Error('Must not read selection');}});
assert.deepEqual(visibleCopilotOptions(root([dropdown])),{'pages/Connector:1':[{value:'ics',label:'Published calendar'}]});
assert.deepEqual(visibleCopilotOptions(root([field({hidden:true}),field({getAttribute:()=> 'pages/ApiKeys:1'})])),{});
class Input {
  constructor(value){this._value=value;this.events=[];this.type='text';this.tagName='INPUT';this.isConnected=true;this.maxLength=100;this.ownerDocument={defaultView:{HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}}}};}
  get value(){return this._value;}set value(value){this._value=value;}
  getClientRects(){return [{}];}cloneNode(){return {value:'',checkValidity:()=>true};}
  dispatchEvent(event){this.events.push(event.type);}
}
const dependent=new Input('calendar.event.changed');
applyDomFields({event:{element:dependent,value:'email.received'}},{event:'calendar.event.changed'});
assert.deepEqual(dependent.events,[],'Already satisfied dependent fields must not dispatch another write');
dependent.value='User changed';
assert.throws(()=>applyDomFields({event:{element:dependent,value:'email.received'}},{event:'calendar.event.changed'}),/form changed/);
assert.equal(dependent.value,'User changed');
const valid=new Input('Before');
assert.throws(()=>applyDomFields({first:{element:valid,value:'Before'},event:{element:dependent,value:'email.received'}},{first:'After',event:'calendar.event.changed'}),/form changed/);
assert.equal(valid.value,'Before','Preflight rejects the whole batch before writing');
applyDomFields({first:{element:valid,value:'Before'}},{first:'After'});
assert.equal(valid.value,'After');assert.deepEqual(valid.events,['input','change']);
console.log('PASS DOM fill: controlled-input events, dependent no-op, stale-edit protection and all-or-nothing preflight.');
