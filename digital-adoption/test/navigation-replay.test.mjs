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
