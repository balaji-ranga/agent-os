import {resolveChoice} from '../web/choice-intent.mjs';
export function assistantResponseSchema(snapshot,{goalStep=false,allowedActionTypes}={}){
 const shape=(properties)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)}),ref=values=>values.length?{type:'string',enum:values}:{type:'string'};
 const fieldRefs=snapshot.fields.map(f=>f.ref),linkRefs=snapshot.links.map(l=>l.ref),allRefs=[...fieldRefs,...linkRefs,...(snapshot.targets||[]).map(t=>t.ref)],actions=[];
 if(fieldRefs.length){actions.push(shape({type:{type:'string',const:'fill'},ref:ref(fieldRefs),value:{type:'string'}}));const lookups=snapshot.fields.filter(f=>f.type==='combobox').map(f=>f.ref);if(lookups.length){actions.push(shape({type:{type:'string',const:'fill'},ref:ref(lookups),value:{type:'string'},select:{type:'boolean',const:false}}));actions.push(shape({type:{type:'string',const:'fill'},ref:ref(lookups),value:{type:'string'},query:{type:'string'}}));}}
 if(snapshot.controls?.length)actions.push(shape({type:{type:'string',const:'activate'},ref:ref(snapshot.controls.map(c=>c.ref))}));
 if(allRefs.length)actions.push(shape({type:{type:'string',const:'highlight'},ref:ref(allRefs)}));
 if(linkRefs.length)actions.push(shape({type:{type:'string',const:'navigate'},ref:ref(linkRefs)}));
 const permitted=goalStep&&Array.isArray(allowedActionTypes)?actions.filter(action=>allowedActionTypes.includes(action.properties.type.const)):actions;
 return shape({...(!goalStep?{intent:{type:'string',enum:['guide','explain','edit','navigate','activate','plan','clarify']}}:{}),message:{type:'string'},actions:{type:'array',maxItems:permitted.length?10:0,items:permitted.length?{anyOf:permitted}:shape({type:{type:'string',const:'highlight'},ref:{type:'string'}})}});
}
// This contract validates proposals; exact-state approval still precedes writes.
export function responseContract(snapshot,{readOnly=false,includeIntent=true}={}){
 const fields=snapshot.fields.length>0,targets=(snapshot.targets||[]).length>0,links=snapshot.links.length>0;
 const contract={intent:{requiredForNewProposals:true,modes:{guide:'Point to observed controls without activating them',explain:'Answer or inspect without host effects',edit:'Prepare requested field changes for review',navigate:'Prepare opening one observed safe destination for review',activate:'Prepare one observed button activation for separate confirmation; never a native form submit',plan:'Hand this multi-operation request to the reviewed goal planner; no host action',clarify:'Ask about genuinely ambiguous or missing intent; no actions'},rule:'Infer intent from the whole request and conversation, never from a verb or control label alone. A control named Save, Update or Open is still only pointed to when the user asks where it is.'},output:{intent:'one of guide, explain, edit, navigate, activate, plan, clarify',message:'string up to 4000 characters',actions:fields||targets||links?'zero to ten action instances':'must be the empty array [] because no actionable live refs exist'},
  allowedActionTypes:[...(fields&&!readOnly?['fill']:[]),...(fields||targets||links?['highlight']:[]),...(links&&!readOnly?['navigate']:[]),...(snapshot.controls?.length&&!readOnly?['activate']:[])],
  controls:snapshot.controls||[],
  actionShapes:{...(snapshot.controls?.length&&!readOnly?{activate:{type:'activate',ref:'one exact controls ref; sole action; awaits explicit confirmation'}}:{}),...(fields&&!readOnly?{fill:{type:'fill',ref:'exact current field ref',value:'string; exact option label for combobox',query:'optional search text, combobox only; the review shows query and selected label',select:'optional boolean, combobox only; false types a search and requests fresh observation before choosing a result'}}:{}),...(links&&!readOnly?{navigate:{type:'navigate',ref:'exact observed safe link ref; sole action'}}:{}),...(fields||targets||links?{highlight:{type:'highlight',ref:'exact current field, observed link or read-only target ref; point only, never activate'}}:{})},
  comboboxModes:[...(!(snapshot.lastOutcome?.lookupOnly&&snapshot.fields.some(f=>f.optionRefs?.length))?[{description:'Type a query only; no option is selected. Observe results next.',example:{type:'fill',ref:'observed combobox ref',value:'search text',select:false},rule:'Do not include query.'}]:[]),{description:'Select an exact result after an optional search.',example:{type:'fill',ref:'observed combobox ref',query:'optional distinct search text',value:'exact requested or freshly observed option label'},rule:'Omit select, or use select:true. Never use select:false with query or with a final option label.'}],
  targets:(snapshot.targets||[]).map(({ref,label,role})=>({ref,label,role})),
  fields:snapshot.fields.map(({ref,label,type,choices,defaultChoice,choicesTruncated,optionRefs})=>({ref,label,type,...(optionRefs?{optionRefs}:{}),...(choices?{choices,defaultChoice,choicesTruncated}:{})})),links:snapshot.links,
  policy:'Field refs, link refs, saved route paths and persistent map keys are separate namespaces. A saved path is never an executable ref. If the known destination has no safe live link, return actions:[] and explain in message which known website page the user should open manually. Source-map fields are hints only. Navigate using an observed safe link and inspect the destination before preparing off-screen fields. Never invent refs, options or writes.'};
 if(!includeIntent){delete contract.intent;delete contract.output.intent;}return contract;
}
export function parseAssistantResponse(content,snapshot,{goalStep=false}={}){
 if(typeof content!=='string'||content.length>32_000)throw new Error('invalid_response_shape');
 const text=content.trim(),fenced=/^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
 let result;try{result=JSON.parse(fenced?fenced[1]:text);}catch{throw new Error('invalid_json');}
 // Goal intent is fixed by the reviewed currentStep, not optional maker metadata.
 if(goalStep&&result&&typeof result==='object'&&!Array.isArray(result))delete result.intent;
 if(!result||Array.isArray(result)||typeof result.message!=='string'||result.message.length>4000||!Array.isArray(result.actions)||result.actions.length>10||Object.keys(result).some(k=>!['intent','message','actions'].includes(k)))throw new Error('invalid_response_shape');
 if(result.intent!==undefined&&!['guide','explain','edit','navigate','activate','plan','clarify'].includes(result.intent))throw new Error('invalid_intent');
 const types={guide:['highlight'],explain:[],edit:['fill'],navigate:['navigate'],activate:['activate'],plan:[],clarify:[]};
 if(['guide','edit','navigate','activate'].includes(result.intent)&&!result.actions.length)throw new Error('intent_action_mismatch');
 if(result.intent&&result.actions.some(action=>!types[result.intent].includes(action?.type)))throw Object.assign(new Error('intent_action_mismatch'),{declaredIntent:result.intent,contractIssues:[{intent:result.intent,actionTypes:result.actions.map(a=>a?.type).slice(0,10)}]});
 const used=new Set();
 for(const action of result.actions){
  if(!action||Array.isArray(action)||!['fill','highlight','navigate','activate'].includes(action.type))throw new Error('unsupported_action');
  const keys=action.type==='fill'?['type','ref','value','query','select']:['type','ref'];
  const unexpected=Object.keys(action).filter(k=>!keys.includes(k));
  if(unexpected.length||used.has(action.ref))throw Object.assign(new Error('invalid_action_shape'),{contractIssues:[{ref:typeof action.ref==='string'?action.ref.slice(0,40):null,issue:used.has(action.ref)?'duplicate_action_ref':'unexpected_action_keys',keys:unexpected.slice(0,10).map(key=>key.slice(0,80))}]});used.add(action.ref);
  if(action.type==='activate'){if(result.actions.length!==1||!snapshot.controls?.some(c=>c.ref===action.ref))throw new Error('unobserved_activation');}
  else if(action.type==='navigate'){
   if(result.actions.length!==1||!snapshot.links.some(l=>l.ref===action.ref))throw new Error('unobserved_navigation');
  }else{
   const field=snapshot.fields.find(f=>f.ref===action.ref);if(!field&&!(action.type==='highlight'&&(snapshot.targets?.some(t=>t.ref===action.ref)||snapshot.links.some(l=>l.ref===action.ref))))throw new Error('unobserved_field');
   if(action.select!==undefined&&(action.type!=='fill'||field?.type!=='combobox'||typeof action.select!=='boolean'||action.select===false&&action.query!==undefined))throw new Error('invalid_lookup_mode');
   if(action.query!==undefined&&(action.type!=='fill'||field?.type!=='combobox'||typeof action.query!=='string'||!action.query.trim()||action.query.length>160))throw new Error('invalid_picklist_query');
   if(action.type==='fill'&&(typeof action.value!=='string'||action.value.length>8000||field.type==='checkbox'&&!['true','false'].includes(action.value)))throw new Error('invalid_field_value');
   if(action.type==='fill'&&!field.choices&&['select-one','radio'].includes(field.type))throw Object.assign(new Error('unobserved_choices'),{fieldRef:field.ref});
   if(action.type==='fill'&&field.choices&&['select-one','radio'].includes(field.type)){const value=resolveChoice(action.value,field.choices);if(value===null)throw Object.assign(new Error('unknown_or_ambiguous_choice'),{fieldRef:field.ref});action.value=value;}
  }
 }
 return result;
}
