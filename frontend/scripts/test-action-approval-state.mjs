import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transform } from 'esbuild';
import { parseFragment } from 'parse5';
import { actionApprovalUiState } from '../src/utils/actionApprovalState.js';
import { formatServerDateTime } from '../src/utils/formatDateTime.js';

const now = Date.parse('2026-10-11T07:00:00Z');
const task = {description:'[CHAT_ACTION_APPROVAL]',status:'awaiting_confirmation',action_approval:{status:'pending',expires_at:'2026-10-11T07:30:00Z',can_decide:true}};
assert.equal(actionApprovalUiState(task,now).canDecide,true);
assert.equal(actionApprovalUiState(task,now+1800000).canDecide,false,'drawer expires at boundary without a reload');
assert.match(actionApprovalUiState(task,now+1800000).label,/expired/);
assert.equal(actionApprovalUiState({description:'[CHAT_ACTION_APPROVAL]'},now).canDecide,false,'missing backing record fails closed');
assert.equal(actionApprovalUiState({description:'[GOAL_ACTION_APPROVAL]'},now),null,'durable goal approval behavior unchanged');
assert.equal(actionApprovalUiState({description:'ordinary task'},now),null);
const source=readFileSync(new URL('../src/components/ActionApprovalBanner.jsx',import.meta.url),'utf8');
const compiled=await transform(source.replace(/^import[^\r\n]*(?:\r?\n|$)/gm,'').replace('export default function','function'),{loader:'jsx',jsx:'transform'});
const Banner=new Function('React','formatServerDateTime',`${compiled.code}; return ActionApprovalBanner;`)(React,formatServerDateTime);
function buttons(html) {
 const nodes=[];
 function visit(n) { if(n.tagName==='button') nodes.push(n); for(const c of n.childNodes||[]) visit(c); }
 visit(parseFragment(html)); return nodes;
}
function render(state,canMutate=true) { return renderToStaticMarkup(React.createElement(Banner,{state,expiresAt:task.action_approval.expires_at,timeZone:'Asia/Singapore',canMutate,comment:'',onComment:()=>{},onDecision:()=>{}})); }
const live=render(actionApprovalUiState(task,now));
assert(buttons(live).every(b=>!b.attrs.some(a=>a.name==='disabled')));
assert.match(live,/Approval expires:/);
assert.match(live,/3:30|15:30/,'expiry renders in requested SGT timezone');
for(const state of ['expired','superseded','consumed','rejected','unavailable']) {
 const candidate={...task,action_approval:{...task.action_approval,status:state}};
 const html=render(actionApprovalUiState(candidate,now));
 assert(buttons(html).every(b=>b.attrs.some(a=>a.name==='disabled')),`${state} buttons disabled`);
 assert(!html.includes('<textarea'),'no misleading decision editor for terminal approvals');
}
assert(buttons(render(actionApprovalUiState(task,now),false)).every(b=>b.attrs.some(a=>a.name==='disabled')),'permission guard retained');
assert(buttons(render(null)).every(b=>!b.attrs.some(a=>a.name==='disabled')),'goal approval controls retained');
const page=readFileSync(new URL('../src/pages/Kanban.jsx',import.meta.url),'utf8');
assert.match(page,/setInterval\(\(\) => setApprovalNow\(Date.now\(\)\), 1000\)/);
assert.match(page,/const currentState = actionApprovalUiState\(taskDetail \|\| selectedTask\)/,'fresh click-time check');
assert.match(page,/<ActionApprovalBanner state=\{selectedActionApprovalState\}/,'actual drawer renders tested component');
console.log('PASS approval UI: live/expired/superseded/missing/terminal states, disabled buttons, click-time guard, SGT display, goal/permission controls');
