import assert from 'node:assert/strict';
import {isSourceReview,rememberSourceReview,sourceReviewBlock,sourceReviewGuidance,sourceReviewParams} from '../../openclaw-extensions/agent-os-content-tools/source-review-turn.js';
const intent={mode:'source_review',whole_period:true,app_id:'gmail',relative_day:'today',actionable_only:true};
// Text alone is never an intent classifier. The semantic contract drives guards.
assert.equal(isSourceReview('summarize Gmail'),false);
assert.equal(isSourceReview('Retry',intent),true);
assert.equal(isSourceReview('Read Gmail',{mode:'schedule_run'}),false);
rememberSourceReview('a','Retry',100,intent);
assert.ok(sourceReviewBlock('a','tool_call',{id:'scheduled_goal_run_now'},101));
assert.equal(sourceReviewBlock('b','scheduled_goal_run_now',{},101),null);
assert.equal(sourceReviewBlock('a','scheduled_goal_run_now',{},900101),null);
const corrected=sourceReviewParams('a','tool_call',{id:'floassist_source_read',args:{app_id:'gmail',source_id:'mailbox@example.test'}},101);
assert.deepEqual(corrected.args,{app_id:'gmail',review_all:true,relative_day:'today'});
rememberSourceReview('a','Do the usual saved run',102,{mode:'schedule_run'});
assert.equal(sourceReviewBlock('a','scheduled_goal_run_now',{},103),null);
const contract=sourceReviewGuidance('Retry',{intent});
assert.match(contract,/full thread\/body/);assert.match(contract,/No verified priorities/);
assert.equal(sourceReviewGuidance('Summarize my Gmail'),'', 'without a semantic verdict text must not select a route');
assert.doesNotMatch(sourceReviewGuidance('irrelevant wording',{intent:{...intent,actionable_only:false}}),/NOT work priorities/);
console.log('SEMANTIC_SOURCE_GUARDS_OK: no keyword inference, explicit typed decisions, contextual retry, schedule isolation, expiry and whole-period scope');

rememberSourceReview('single','Read the requested mailbox period',Date.now(),{mode:'source_review',whole_period:false,relative_day:'today'});
const recovery=sourceReviewParams('single','tool_call',{id:'floassist_source_read',args:{app_id:'gmail',source_id:'mailbox@example.test'}});
assert.deepEqual(recovery.args,{app_id:'gmail',relative_day:'today'},'ID validation and owner-day routing cannot depend on a separate batching decision');
