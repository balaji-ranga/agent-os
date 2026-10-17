import test from 'node:test';
import assert from 'node:assert/strict';
import {createScreenCapture} from '../web/screen-capture.mjs';
test('screen capture waits for explicit start, supports pause/review/discard and ends tracks',async()=>{
 let calls=0,stops=0,recorder;const states=[];const track={stop:()=>stops++,addEventListener:()=>{}};
 class Recorder{
  static isTypeSupported(type){return type==='video/webm';}
  constructor(){recorder=this;this.state='inactive';}
  start(){this.state='recording';}
  pause(){this.state='paused';}resume(){this.state='recording';}
  stop(){this.state='inactive';this.ondataavailable({data:new Blob(['synthetic recording'])});this.onstop();}
 }
 const capture=createScreenCapture({Recorder,mediaDevices:{getDisplayMedia:async constraints=>{calls++;assert.equal(constraints.audio,false);return {getTracks:()=>[track],getVideoTracks:()=>[track]};}},onChange:value=>states.push(value)});
 assert.equal(calls,0);await capture.start();assert.equal(calls,1);capture.pause();assert.equal(capture.state(),'paused');capture.resume();capture.stop();assert.equal(capture.state(),'review');assert.ok(states.at(-1).blob.size);assert.ok(stops>0);capture.discard();assert.equal(states.at(-1).blob,null);assert.equal(capture.state(),'discarded');
});
test('denied capture offers upload fallback without uploading or retrying consent',async()=>{
 let calls=0;const capture=createScreenCapture({Recorder:class{},mediaDevices:{getDisplayMedia:async()=>{calls++;throw new Error('User denied capture');}}});
 await assert.rejects(()=>capture.start(),/denied/);assert.equal(calls,1);assert.equal(capture.state(),'idle');
 const absent=createScreenCapture({mediaDevices:{},Recorder:null});await assert.rejects(()=>absent.start(),/Upload an existing/);
});
test('shared audio is requested only by explicit opt-in and uses an audio-capable format',async()=>{
 let requested,format,stopped=0;
 const track={stop:()=>stopped++,addEventListener:()=>{}};
 class Recorder{
  static isTypeSupported(type){return type==='video/webm;codecs=vp8,opus';}
  constructor(stream,options){format=options.mimeType;this.state='inactive';}
  start(){this.state='recording';}
  stop(){this.state='inactive';this.onstop();}
 }
 const capture=createScreenCapture({Recorder,mediaDevices:{getDisplayMedia:async constraints=>{requested=constraints;return {getTracks:()=>[track],getVideoTracks:()=>[track]};}}});
 await capture.start({audio:true});assert.deepEqual(requested,{video:true,audio:true});assert.equal(format,'video/webm;codecs=vp8,opus');capture.stop();assert.equal(capture.state(),'review');assert.ok(stopped>0);
});
