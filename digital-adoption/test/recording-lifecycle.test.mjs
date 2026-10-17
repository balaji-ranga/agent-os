import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecorder} from '../web/recording.mjs';
test('recorder pause retains steps, stop removes listeners, and secrets never persist',()=>{
 const handlers=new Map(),document={location:{pathname:'/customer',origin:'https://customer.example'},addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name)};
 const recorder=createRecorder(document);
 const change=(name,type='text',autocomplete='')=>handlers.get('change')?.({type:'change',target:{name,type,autocomplete,value:'PRIVATE_VALUE_MUST_NOT_PERSIST',getAttribute:()=>null,closest:()=>null,matches:()=>true}});
 assert.throws(()=>recorder.resume());recorder.start();change('company');recorder.pause();change('ignored');assert.throws(()=>recorder.start());
 recorder.resume();change('contact');change('password');change('attachment','file');change('card','text','credit-card');
 const steps=recorder.stop();assert.equal(steps.length,2);assert.equal(handlers.size,0);assert.equal(JSON.stringify(steps).includes('PRIVATE_VALUE'),false);
 assert.throws(()=>recorder.resume());recorder.start();assert.deepEqual(recorder.stop(),[]);
});
