import test from 'node:test';
import assert from 'node:assert/strict';
import {replayNavigation} from '../web/recording.mjs';
test('recorded navigation clicks a current safe target and verifies destination; draft and cancellation block',async()=>{
 const document={location:{origin:'https://site.test',pathname:'/start'}};let clicks=0,draft=false;
 const link={href:'https://site.test/destination',getClientRects:()=>[1],closest:()=>null,click(){clicks++;document.location.pathname='/destination';}};
 document.querySelectorAll=selector=>selector==='input,textarea,select'?(draft?[{value:'edited',defaultValue:'',closest:()=>null,getClientRects:()=>[1]}]:[]):[link];
 await assert.rejects(()=>replayNavigation(document,{path:'/destination',approved:false}));
 const result=await replayNavigation(document,{path:'/destination',approved:true});assert.equal(result.verified,true);assert.equal(clicks,1);
 draft=true;await assert.rejects(()=>replayNavigation(document,{path:'/destination',approved:true}),/draft/);assert.equal(clicks,1);
 draft=false;await assert.rejects(()=>replayNavigation(document,{path:'/destination',approved:true,active:()=>false}),/stopped/);assert.equal(clicks,1);
 await assert.rejects(()=>replayNavigation(document,{path:'https://other.test/',approved:true}));
});

test('reviewed mouse-down profile dispatches once even when navigation removes the old target',async()=>{
 const document={location:{origin:'https://site.test',pathname:'/start'}};let downs=0,clicks=0;
 class MouseEvent{constructor(type){this.type=type;}}
 const link={href:'https://site.test/destination',getClientRects:()=>[1],closest:()=>null,ownerDocument:{defaultView:{MouseEvent}},dispatchEvent(event){assert.equal(event.type,'mousedown');downs++;document.location.pathname='/destination';this.removed=true;return false;},click(){clicks++;throw new Error('Unsafe extra click');}};
 document.querySelectorAll=selector=>selector==='input,textarea,select'?[]:[link];
 const result=await replayNavigation(document,{path:'/destination',activation:'mousedown',approved:true});assert.equal(result.verified,true);assert.equal(downs,1);assert.equal(clicks,0);assert.equal(link.removed,true);
 await assert.rejects(()=>replayNavigation(document,{path:'/destination',activation:'double-click',approved:true}),/Unsupported/);assert.equal(downs,1);
});
