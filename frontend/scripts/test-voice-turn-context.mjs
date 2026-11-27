import assert from 'node:assert/strict';import {createVoiceTurnContext} from '../src/lib/voice-turn-context.js';
const state=createVoiceTurnContext({uuid:()=> 'fallback-turn'});
state.observe({type:'input_audio_buffer.committed',item_id:'user-one'});state.observe({type:'response.created',response:{id:'response-one'}});
assert.equal(state.forCall({response_id:'response-one',call_id:'call-one'}),'user-one');
state.observe({type:'response.created',response:{id:'continuation-one'}});assert.equal(state.forCall({response_id:'continuation-one',call_id:'call-two'}),'user-one','tool continuations retain the original execution/duplicate scope');
state.observe({type:'input_audio_buffer.committed',item_id:'user-two'});state.observe({type:'response.created',response:{id:'response-two'}});assert.equal(state.forCall({response_id:'response-two'}),'user-two');assert.equal(state.forCall({response_id:'response-one'}),'user-one');assert.equal(state.isCurrent('user-one'),false,'late results cannot restart a superseded utterance');assert.equal(state.isCurrent('user-two'),true);
state.observe({type:'conversation.item.created',item:{role:'assistant',id:'not-a-user'}});assert.equal(state.isCurrent('user-two'),true);
console.log('VOICE_TURN_CONTEXT_OK: transport-defined user scope; multi-tool continuation; independent requests; superseded turns do not restart');
