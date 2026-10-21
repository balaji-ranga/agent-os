import test from 'node:test';
import assert from 'node:assert/strict';
import {deterministicReview} from '../integrations/checker-contract.mjs';
const context=task=>({task,purpose:'digital_adoption_plan',observed:{fields:[{ref:'r1f0',label:'Delivery',type:'select-one',choices:['Standard','Express']}]},proposal:{message:'Review',actions:[{type:'fill',ref:'r1f0',value:'Express'}]}});
for(const verb of ['Set','Change','Update','Edit'])test(verb+' descriptive choice reaches semantic checker instead of literal rejection',()=>{assert.equal(deterministicReview(context(verb+' Delivery to the fastest available option. Do not save.')),null);});
test('unavailable named and quoted choices remain blocked; known wrong choice remains blocked',()=>{for(const value of ['Teleportation','"the fastest available option"','Standard'])assert.match(deterministicReview(context('Set Delivery to '+value+'. Do not save.')),/does not match/);});

test('unique option typo can reach review but an unrelated choice cannot',()=>{assert.equal(deterministicReview(context('Set Delivery to Expres. Do not save.')),null);assert.match(deterministicReview(context('Set Delivery to Different. Do not save.')),/does not match/);});

test('quoted option annotations are context, while the quoted observed value remains exact',()=>{
 assert.equal(deterministicReview(context('Set Delivery to "Express" (resolved from "exp").')),null);
 assert.equal(deterministicReview(context('Set Delivery to "Express". Preserve all other fields.')),null);
 assert.match(deterministicReview(context('Set Delivery to "Standard" (the original choice).')),/does not match/);
 assert.match(deterministicReview(context('Set Delivery to "Unavailable" (use any option).')),/does not match/);
});
test('capitalized question commands are not mistaken for document subjects; actual subject binding stays enforced',()=>{const evidence=[{chunkId:'c1',title:'Synthetic transaction',text:'Company name: Synthetic Orchid. Alpha delivery takes seven days.'}];const proposal={evidenceStatus:'supported',message:'The company is Synthetic Orchid.',citations:[{chunkId:'c1',quote:'Company name: Synthetic Orchid.'}]};for(const task of ['Summarize the company name in my file.','Explain the company name in my file.'])assert.equal(deterministicReview({purpose:'digital_adoption_knowledge',task,evidence,proposal}),null);assert.match(deterministicReview({purpose:'digital_adoption_knowledge',task:'Summarize Beta delivery.',evidence,proposal}),/requested named subject/);});

test('sentence capitalization cannot veto grounded private answers; semantic judge retains ambiguous initial entities',()=>{
 const evidence=[{chunkId:'c1',title:'Transaction',text:'Company name: Synthetic Orchid. Region: Singapore.'}],proposal={evidenceStatus:'supported',message:'Synthetic Orchid, Singapore.',citations:[{chunkId:'c1',quote:'Company name: Synthetic Orchid. Region: Singapore.'}]};
 for(const task of ['From my uploaded files, what company and region should I use? Cite the source.','Using my document, identify the company. Include its region.','Read my file.\nReturn the company and region.'])assert.equal(deterministicReview({purpose:'digital_adoption_knowledge',task,evidence,proposal}),null);
 for(const task of ['What region is assigned to Beta?','Read the file. What region is assigned to Beta?'])assert.match(deterministicReview({purpose:'digital_adoption_knowledge',task,evidence,proposal}),/named subject/);
 assert.equal(deterministicReview({purpose:'digital_adoption_knowledge',task:'Beta details?',evidence,proposal}),null); // Capitalization alone is ambiguous: the model judge must assess entailment.
 assert.match(deterministicReview({purpose:'digital_adoption_knowledge',task:'From my file, cite the company.',evidence,proposal:{...proposal,citations:[{chunkId:'c1',quote:'Invented quotation'}]}}),/exact supporting/);
});

test('discontinuous quotations receive bounded verbatim source help without accepting the claim',()=>{
 const evidence=[{chunkId:'file:1',text:'Company name: Synthetic Orchid\nContact email: orchid@example.test\nRegion: Singapore'}],proposal={evidenceStatus:'supported',message:'The company and region are in the file.',citations:[{chunkId:'file:1',quote:'Company name: Synthetic Orchid\nRegion: Singapore'}]};
 const feedback=deterministicReview({purpose:'digital_adoption_knowledge',task:'From my file, what company and region should I use?',evidence,proposal});assert.match(feedback,/contiguous/);assert.match(feedback,/Contact email: orchid@example.test/);assert.match(feedback,/State the requested values/);assert.ok(feedback.length<1600);
 const corrected={...proposal,message:'Use Synthetic Orchid and Singapore.',citations:[{chunkId:'file:1',quote:'Company name: Synthetic Orchid'},{chunkId:'file:1',quote:'Region: Singapore'}]};assert.equal(deterministicReview({purpose:'digital_adoption_knowledge',task:'From my file, what company and region should I use?',evidence,proposal:corrected}),null);
});
