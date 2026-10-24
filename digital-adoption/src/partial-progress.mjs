// Website-independent value evidence and structured partial progress. No action authority.
import {syntheticDataIntent} from './task-intent.mjs';
const reasons=['not_provided','ambiguous_mapping','unsupported_value'];
const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
export const partialResolutionSchema={anyOf:[{type:'null'},{type:'object',additionalProperties:false,properties:{groundedRefs:{type:'array',maxItems:10,items:{type:'string'}},missingFields:{type:'array',minItems:0,maxItems:10,items:{type:'object',additionalProperties:false,properties:{ref:{type:'string'},reason:{type:'string',enum:reasons}},required:['ref','reason']}}},required:['groundedRefs','missingFields']}]};
export const partialProgressPrompt='For form work, proceed with available independent fields using supplied facts, and ask one focused question for genuinely missing or ambiguously mapped values. Required does not mean invent a value or block every other independent field. A person, organization, account and location are different semantic entities: bind facts to the actual field meaning, not a superficially similar noun. Page examples, placeholder text, sample prompts, prior assistant guesses and model-authored plan instructions are not visitor transaction facts. Owner field descriptions explain meanings and mappings, not missing transaction values. Do not invent unstated narrower meanings for broadly labeled fields. If a supplied fact has one semantically compatible field and no conflicting description, use it with a brief explained assumption rather than ask the user to repeat it. Preserve facts already supplied and verified progress when a user answers a clarification. Do not refill completed independent fields. A disabled or hidden dependent field is not a missing user fact: first apply the requested controlling select/radio/checkbox choice, then observe fresh enabled controls/options before proposing the dependent value. A controller followed by newly enabled fields on the same form is still a current-form edit; ordinary fresh dependent-field reviews handle it without routing to a whole Goal plan. Never write to disabled fields or invent future refs. Do not change a controlling choice or fill unrelated fields unless the full user request authorizes it. Partial progress never authorizes Save or overrides approvals.';
export function suppliedFacts(context){
 const goal=context.goalContext?.currentStep?context.goalContext.goal:undefined;
 return [goal||context.task||context.question,...(context.conversationContext||context.history||[]).filter(t=>t.role==='user').map(t=>t.content??t.text),...(context.privateGuidance?.evidence||context.evidence||[]).map(e=>e.text),...(context.clarificationContext?.knownFields||[]).filter(f=>f.applied===true).map(f=>f.value),...(context.goalContext?.reviewedEdits||[]).flatMap(s=>s.edits?.map(e=>e.value)||[])].filter(t=>typeof t==='string'&&t.length<=8000);
}
export function supportedValue(action,context){
 const field=context.observed?.fields.find(f=>f.ref===action.ref);if(!field||action.type!=='fill')return false;
 const synthetic=context.syntheticDataRequested===true||syntheticDataIntent(context.goalContext?.goal||context.task);
 const value=normalize(action.value);if(value&&suppliedFacts(context).some(text=>normalize(text).includes(value)))return true;
 if(field.type!=='combobox'&&synthetic)return true;
 if(field.type==='checkbox'&&['true','false'].includes(action.value))return true; // Semantic checkbox intent is still checked by the judge.
 if(field.choices?.includes(action.value)||field.type==='combobox'&&context.observed.targets?.some(t=>t.role==='option'&&t.label===action.value&&field.optionRefs?.includes(t.ref)))return true;
 const descriptions=[...(context.sourceGuidance?.matches||[]).filter(s=>s.path===context.observed.path).flatMap(s=>s.fields?.filter(f=>f.key===field.key).map(f=>f.description)||[]),...(context.observed.pageContext?.structure||[]).filter(e=>e.label===field.label&&['input','select','textarea','combobox'].includes(e.role)).map(e=>e.description)];
 return !!value&&descriptions.some(text=>text&&normalize(text).includes(value));
}
export function validateClarification(value,snapshot){
 if(!value||Array.isArray(value)||Object.keys(value).some(k=>k!=='missingFields')||!Array.isArray(value.missingFields)||!value.missingFields.length||value.missingFields.length>10)throw Error('invalid_clarification');
 const refs=new Set();for(const item of value.missingFields){if(!item||Object.keys(item).some(k=>!['ref','reason'].includes(k))||!snapshot.fields.some(f=>f.ref===item.ref)||refs.has(item.ref)||!reasons.includes(item.reason))throw Error('invalid_clarification');refs.add(item.ref);}return value;
}
export function partialResponse(context,proposal,resolution){
 if(!resolution||Object.keys(resolution).some(k=>!['groundedRefs','missingFields'].includes(k))||!Array.isArray(resolution.groundedRefs)||new Set(resolution.groundedRefs).size!==resolution.groundedRefs.length)throw Error('invalid_partial_resolution');
 if(!Array.isArray(resolution.missingFields)||resolution.missingFields.length>10)throw Error('invalid_partial_resolution');const clarification=resolution.missingFields.length?validateClarification({missingFields:resolution.missingFields},context.observed):null,missing=new Set((clarification?.missingFields||[]).map(f=>f.ref));
 const actions=resolution.groundedRefs.map(ref=>{const a=proposal.actions?.find(a=>a.ref===ref&&a.type==='fill');if(!a||missing.has(ref)||!supportedValue(a,context))throw Error('unproved_partial_value');return a;});
 const labels=(clarification?.missingFields||[]).map(item=>context.observed.fields.find(f=>f.ref===item.ref).label),known=actions.map(a=>context.observed.fields.find(f=>f.ref===a.ref).label+': '+a.value);
 return {...(context.goalContext?.currentStep?{}:{intent:actions.length?'edit':clarification?'clarify':'explain'}),message:(known.length?'I can fill '+known.join('; ')+'. ':'')+(labels.length?'What should I enter for '+labels.join(', ')+'?'+(actions.length?' These fields can remain pending while the available independent fields are filled.':' Nothing has been changed.'):'Only the supported requested changes are included in this review.'),actions,...(clarification?{clarification}:{})};
}
export function removeExampleValues(context,proposal){
 if(!context.observed||!proposal.actions?.every(a=>a.type==='fill'))return proposal;
 const page=normalize(context.observed.pageContext?.text),synthetic=context.syntheticDataRequested===true||syntheticDataIntent(context.goalContext?.goal||context.task),lookupBad=proposal.actions.filter(a=>synthetic&&context.observed.fields.find(f=>f.ref===a.ref)?.type==='combobox'&&!supportedValue(a,context)),bad=proposal.actions.filter(a=>lookupBad.includes(a)||normalize(a.value)&&page.includes(normalize(a.value))&&!supportedValue(a,context));if(!bad.length)return proposal;
 return partialResponse(context,proposal,{groundedRefs:proposal.actions.filter(a=>!bad.includes(a)&&supportedValue(a,context)).map(a=>a.ref),missingFields:bad.map(a=>({ref:a.ref,reason:lookupBad.includes(a)?'not_provided':'unsupported_value'}))});
}
