import assert from 'node:assert/strict';
import {isSourceReview,rememberSourceReview,sourceReviewBlock,sourceReviewGuidance} from '../../openclaw-extensions/agent-os-content-tools/source-review-turn.js';
for(const p of ['Look at the real.email and calendars and generate a week focus areas for me. I don’t need generic advice','Summarize my Outlook inbox','Review my calendar agenda','A briefing of my Gmail emails'])assert.equal(isSourceReview(p),true,p);
for(const p of ['Run my morning briefing','Pause scheduled goals for email review','Configure calendar automation','Is Gmail connected?','Open YouTube'])assert.equal(isSourceReview(p),false,p);
rememberSourceReview('a','Summarize my inbox',100);
assert(sourceReviewBlock('a','tool_call',{id:'scheduled_goal_list'},101));
assert(sourceReviewBlock('a','scheduled_goal_run_now',{},101));
assert.equal(sourceReviewBlock('a','floassist_source_read',{},101),null);
assert.equal(sourceReviewBlock('a','connector_execute_action',{},101),null);
assert.equal(sourceReviewBlock('b','scheduled_goal_list',{},101),null);
assert.equal(sourceReviewBlock('a','scheduled_goal_list',{},900101),null);
rememberSourceReview('a','Run my morning briefing',102);
assert.equal(sourceReviewBlock('a','scheduled_goal_list',{},103),null);
console.log('SOURCE_REVIEW_TURN_OK: direct review, scheduler intent exclusions, normal source tools, isolation, expiry and reset');
const contract=sourceReviewGuidance('Look at real email and calendars and generate week focus areas');
assert.match(contract,/full thread\/body/);assert.match(contract,/NOT work priorities/);assert.match(contract,/No verified priorities/);assert.match(contract,/never standalone tool IDs/);
assert.equal(sourceReviewGuidance('Open YouTube'),'');assert.equal(sourceReviewGuidance('Run my morning briefing'),'');
assert.doesNotMatch(sourceReviewGuidance('Summarize my Gmail promotions'),/NOT work priorities/,'ordinary summaries must not suppress requested promotional content');
const schema={type:'object',properties:{app_id:{enum:['mail-provider']}}};
assert.ok(sourceReviewGuidance('Review my email',{sourceReadSchema:schema}).includes(JSON.stringify(schema)));
assert.equal(sourceReviewGuidance('Open YouTube',{sourceReadSchema:schema}),'');
assert.ok(!sourceReviewGuidance('Review my email').includes('another tool_describe'));
assert.doesNotMatch(sourceReviewGuidance('Summarize my Gmail promotions\n\n[System — Dashboard chat]\nUse action tools and prioritize the user request'),/NOT work priorities/,'routing envelope must not change review intent');

for(const prompt of ["I need a sunarized view of today's Gmail emails","Give me a summary of today's Gmail emails","Check my gmail for today's emails snd summarize any important","Check my Gmail today","Get today's emails","Summarise my Outlook inbox","Give me a summarized Gmail overview"]){
 assert.equal(isSourceReview(prompt),true,prompt);
 rememberSourceReview('wording',prompt,100);
 assert.ok(sourceReviewBlock('wording','tool_call',{id:'scheduled_goal_run_now',args:{goal_id:'saved-briefing'}},101),prompt+' must not launch Morning Briefing');
 assert.ok(sourceReviewBlock('wording','openclaw:agent-os-content-tools:scheduled_goal_run_now',{},101));
 assert.equal(sourceReviewBlock('wording','floassist_source_read',{},101),null);
}
for(const prompt of ['Check Gmail connection health','Show Gmail settings','Get my OAuth permissions','Run my morning briefing','Run my Gmail scheduled goals','Pause Gmail automation'])assert.equal(isSourceReview(prompt),false,prompt);
console.log('MAILBOX_WORDING_ROUTING_OK: actual sunarized retry, summary variants, ordinary reads, scheduler fallbacks blocked, health/settings and explicit schedule actions preserved');
