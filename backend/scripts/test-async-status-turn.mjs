import assert from 'node:assert/strict';
import {isTrackingStatusQuestion,rememberStatusTurn,statusTurnBlock} from '../../openclaw-extensions/agent-os-content-tools/async-status-turn.js';
for(const text of ['What is the status of my latest tracked tool request?','Has the previous operation completed?','Any update on the pending task?','Check progress for track-abc123','What is the status?','Any update?','Did it work?'])assert.equal(isTrackingStatusQuestion(text),true,text);
for(const text of ['Update the task status to done','Open the app','Send this message','Read this audio recording'])assert.equal(isTrackingStatusQuestion(text),false,text);
rememberStatusTurn('session','What is the status of my latest tracked tool request?',100);
assert(statusTurnBlock('session','tool_call',{id:'physical_invoke'},101));
assert(statusTurnBlock('session','email_send',{},101));
assert(statusTurnBlock('session','exec',{},101));
assert.equal(statusTurnBlock('session','tool_call',{id:'tool_execution_status'},101),null);
assert.equal(statusTurnBlock('session','tool_call',{id:'openclaw:agent-os-content-tools:tool_execution_status'},101),null);
assert(statusTurnBlock('session','tool_call',{id:'openclaw:agent-os-content-tools:physical_invoke'},101));
assert.equal(statusTurnBlock('session','tool_search',{},101),null);
assert.equal(statusTurnBlock('other','physical_invoke',{},101),null);
rememberStatusTurn('session','Send the authorized message now',102);
assert.equal(statusTurnBlock('session','email_send',{},103),null,'fresh explicit action clears observational restriction');
console.log('ASYNC_STATUS_TURN_OK: observational turns block new actions across tools; status/discovery allowed; session isolation and fresh-action reset');

const webPrefix='[ceo_user_id: fixture]\n[owner_user_id: fixture]\nImportant: You are assisting CEO user id fixture only. Use agent_workflow_runs for workflow run status.\n[chat_attachments]\nFor A/V use speech_stt.\n[/chat_attachments]\n\n';
const webSuffix='\n\n[System \u2014 Dashboard chat] First decide whether this request is in your specialty. Never mark completed without doing the work.';
assert.equal(isTrackingStatusQuestion(webPrefix+'Please transcribe this audio only. Return the words spoken; do not operate devices or send messages.'+webSuffix),false);
assert.equal(isTrackingStatusQuestion(webPrefix+'What is the status of my previous request?'+webSuffix),true);
rememberStatusTurn('web',webPrefix+'What is the status of my previous request?'+webSuffix,200);
rememberStatusTurn('web',webPrefix+'Please transcribe this audio only.'+webSuffix,201);
assert.equal(statusTurnBlock('web','speech_stt',{},202),null);
console.log('WEB_PROMPT_ENVELOPE_OK: routing instructions do not classify audio as status; real status requests remain protected');
for(const text of [
 'Execute this goal run now. Do not create a generic scan-progress task. Check the status of previous requests only when needed.',
 'Coverage is incomplete: source pages below remain unread. Continue this same bounded check. Report the status of pending tasks only after reading sources.',
 'Read my mail and generate a briefing. Check progress for the previous task in the source content.'
])assert.equal(isTrackingStatusQuestion(text),false,text);
assert.equal(isTrackingStatusQuestion('Please check the status of my previous request'),true);
console.log('SCHEDULE_RECOVERY_STATUS_OK: executable tasks and coverage continuations are not status-only turns');
