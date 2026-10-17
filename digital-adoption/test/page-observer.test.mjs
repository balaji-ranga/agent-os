import test from 'node:test';
import assert from 'node:assert/strict';
import {observePage} from '../web/page-observer.mjs';

test('map observation rejects unapproved destinations and cancellation before creating a frame',async()=>{
 let created=0;const document={location:{origin:'https://generic.example'},createElement(){created++;throw new Error('Unexpected frame');}};
 for(const path of ['//foreign.example/','/unapproved','/allowed?delete=1','/allowed#private'])await assert.rejects(observePage(document,path,['/allowed']));
 await assert.rejects(observePage(document,'/allowed',['/allowed'],{active:()=>false}));assert.equal(created,0);
});

test('map frame cannot submit forms or navigate the top window, and is removed after a redirect',async()=>{
 let removed=false;const attributes={},frame={style:{},dataset:{},setAttribute(name,value){attributes[name]=value;},remove(){removed=true;},contentDocument:{location:{origin:'https://generic.example',pathname:'/sign-in'}}};
 const document={location:{origin:'https://generic.example'},createElement(){return frame;},body:{append(){queueMicrotask(()=>frame.onload());}}};
 await assert.rejects(observePage(document,'/public',['/public']),/redirected or blocked/);
 assert.equal(attributes.sandbox,'allow-same-origin allow-scripts');assert.equal(attributes['aria-hidden'],'true');assert.equal(removed,true);assert.equal(frame.src,'https://generic.example/public');
});

