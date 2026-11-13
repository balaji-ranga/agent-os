import assert from 'node:assert/strict';
import {boundedSourceReview} from '../src/services/bounded-source-review.js';
import {reviewSourcePeriod} from '../src/services/floassist/period-review.js';
import {rememberSourceReview,sourceReviewParams} from '../../openclaw-extensions/agent-os-content-tools/source-review-turn.js';
const reads=[],digests=[];
const read=async request=>{
 reads.push(request);
 if(!request.source_id)return {discovery_only:true,effective_window:{time_min:'start',time_max:'end'},source_candidates:Array.from({length:request.cursor?1:40},(_,i)=>({app_id:'mail',source_id:String(request.cursor?40:i)})),more_candidates:!request.cursor,next_request:request.cursor?null:{cursor:'page2'}};
 return {content_verified:true,coverage_complete:true,content:'Complete evidence for source '+request.source_id};
};
const digest=async batch=>{digests.push(batch);return batch.map(s=>({source_id:s.source_id,summary:'Source reviewed',evidence:[s.content]}));};
const out=await boundedSourceReview({request:{app_id:'mail'},read,digest,reduce:async findings=>{assert.equal(findings.length,41);return 'All findings considered.';}});
assert.equal(out.review_complete,true);assert.equal(out.reviewed,41);assert.equal(out.pages,43);assert.equal(out.reviewed_source_ids.length,41);assert.equal(digests.length,7);
assert.ok(digests.every(b=>b.length<=6));assert.equal(reads.filter(r=>r.cursor==='page2').length,1);
const invalid=await boundedSourceReview({request:{},read,digest:async()=>[]});assert.equal(invalid.review_complete,false);assert.deepEqual(invalid.failures,['review_digest_incomplete']);assert.equal(invalid.reviewed,0);
let now=0;const timed=await boundedSourceReview({request:{},clock:()=>now,deadline:1,read:async r=>{now=2;return read(r);},digest});assert.equal(timed.review_complete,false);assert.ok(timed.failures.includes('review_time_limit'));
rememberSourceReview('s','Look at last one month gmail and summarize');
assert.equal(sourceReviewParams('s','tool_call',{id:'floassist_source_read',args:{app_id:'gmail',time_min:'start',time_max:'end'}}).args.review_all,true);
assert.equal(sourceReviewParams('s','tool_call',{id:'floassist_source_read',args:{app_id:'gmail',source_id:'one'}}),null);
assert.equal(sourceReviewParams('s','tool_call',{id:'physical_invoke',args:{}}),null);
const short=await reviewSourcePeriod('fixture',{},async r=>r.source_id?{content_verified:true,coverage_complete:true,content:'Yes\nApproved.'}:{discovery_only:true,source_candidates:[{app_id:'mail',source_id:'short'}],more_candidates:false},{complete:async opts=>({content:JSON.stringify(opts.messages[0].content.startsWith('Summarize')?{sources:[{source_index:'0',summary:'Approval confirmed.',evidence_lines:['0','1',999]}]}:{items:[{text:'Approval confirmed.',source_indices:[0]}]})})});
assert.equal(short.review_complete,true,'short affirmative evidence is valid and numeric string references normalize safely');
const bigText='Long source evidence. '.repeat(3000);
const big=await boundedSourceReview({request:{},read:async r=>r.source_id?{content_verified:true,coverage_complete:true,content:bigText}:{discovery_only:true,source_candidates:[{app_id:'mail',source_id:'large'}],more_candidates:false},digest:async b=>b.map(s=>({source_id:s.source_id,summary:'Segment reviewed.',evidence:[s.content.slice(0,20)]}))});
assert.equal(big.review_complete,true);assert.equal(big.reviewed,1);assert.equal(big.digest_calls,3);assert.equal(big.source_characters,bigText.length);
console.log('BOUNDED_SOURCE_REVIEW_OK: 41 bodies, two discovery pages, seven bounded digests, no silent sampling, invalid digests/timeouts partial, scoped intent');



const routes=[];
const routed=await reviewSourcePeriod('fixture',{},async r=>r.source_id?{content_verified:true,coverage_complete:true,content:'Important source '+r.source_id}:{discovery_only:true,source_candidates:Array.from({length:7},(_,i)=>({app_id:'mail',source_id:String(i)})),more_candidates:false},{complete:async opts=>{
 routes.push({tool:opts.toolName,preference:opts.endpointPreference});
 if(opts.toolName==='source_review_synthesis')return {content:JSON.stringify({items:[{text:'Reviewed findings.',source_indices:[0]}]})};
 const batch=JSON.parse(opts.messages[1].content).sources;
 assert.throws(()=>opts.validateResponse(JSON.stringify({sources:[]})),/incomplete/);
 const content=JSON.stringify({sources:batch.map(s=>({source_index:s.source_index,summary:'Important finding.',evidence_lines:[0]}))});
 assert.equal(opts.validateResponse(content),true);
 return {content,efficiency:{fallback:true}};
}});
assert.equal(routed.review_complete,true);
assert.equal(routes[0].preference,undefined);
assert.equal(routes[1].preference,'primary','failed local backend is not retried for each subsequent batch');
assert.equal(routes[2].tool,'source_review_synthesis','final synthesis is outside local utility workload');
console.log('SOURCE_DIGEST_CONTRACT_OK');
