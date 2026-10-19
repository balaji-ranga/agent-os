import {resolveChoice} from '../web/choice-intent.mjs';
// This contract validates proposals; exact-state approval still precedes writes.
export function responseContract(snapshot){
 const fields=snapshot.fields.length>0,targets=(snapshot.targets||[]).length>0,links=snapshot.links.length>0;
 return {output:{message:'string up to 4000 characters',actions:fields||targets||links?'zero to ten action instances':'must be the empty array [] because no actionable live refs exist'},
  allowedActionTypes:[...(fields?['fill']:[]),...(fields||targets?['highlight']:[]),...(links?['navigate']:[])],
  actionShapes:{...(fields?{fill:{type:'fill',ref:'exact current field ref',value:'string; exact option label for combobox',query:'optional search text, combobox only; the review shows query and selected label',select:'optional boolean, combobox only; false types a search and requests fresh observation before choosing a result'}}:{}),...(links?{navigate:{type:'navigate',ref:'exact observed safe link ref; sole action'}}:{}),...(fields||targets?{highlight:{type:'highlight',ref:'exact current field or read-only target ref'}}:{})},
  comboboxModes:[...(!(snapshot.lastOutcome?.lookupOnly&&snapshot.fields.some(f=>f.optionRefs?.length))?[{description:'Type a query only; no option is selected. Observe results next.',example:{type:'fill',ref:'observed combobox ref',value:'search text',select:false},rule:'Do not include query.'}]:[]),{description:'Select an exact result after an optional search.',example:{type:'fill',ref:'observed combobox ref',query:'optional distinct search text',value:'exact requested or freshly observed option label'},rule:'Omit select, or use select:true. Never use select:false with query or with a final option label.'}],
  targets:(snapshot.targets||[]).map(({ref,label,role})=>({ref,label,role})),
  fields:snapshot.fields.map(({ref,label,type,choices,defaultChoice,choicesTruncated,optionRefs})=>({ref,label,type,...(optionRefs?{optionRefs}:{}),...(choices?{choices,defaultChoice,choicesTruncated}:{})})),links:snapshot.links,
  policy:'Field refs, link refs, saved route paths and persistent map keys are separate namespaces. A saved path is never an executable ref. If the known destination has no safe live link, return actions:[] and explain in message which known website page the user should open manually. Source-map fields are hints only. Navigate using an observed safe link and inspect the destination before preparing off-screen fields. Never invent refs, options or writes.'};
}
export function parseAssistantResponse(content,snapshot){
 if(typeof content!=='string'||content.length>32_000)throw new Error('invalid_response_shape');
 const text=content.trim(),fenced=/^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
 let result;try{result=JSON.parse(fenced?fenced[1]:text);}catch{throw new Error('invalid_json');}
 if(!result||Array.isArray(result)||typeof result.message!=='string'||result.message.length>4000||!Array.isArray(result.actions)||result.actions.length>10||Object.keys(result).some(k=>!['message','actions'].includes(k)))throw new Error('invalid_response_shape');
 const used=new Set();
 for(const action of result.actions){
  if(!action||Array.isArray(action)||!['fill','highlight','navigate'].includes(action.type))throw new Error('unsupported_action');
  const keys=action.type==='fill'?['type','ref','value','query','select']:['type','ref'];
  if(Object.keys(action).some(k=>!keys.includes(k))||used.has(action.ref))throw new Error('invalid_action_shape');used.add(action.ref);
  if(action.type==='navigate'){
   if(result.actions.length!==1||!snapshot.links.some(l=>l.ref===action.ref))throw new Error('unobserved_navigation');
  }else{
   const field=snapshot.fields.find(f=>f.ref===action.ref);if(!field&&!(action.type==='highlight'&&snapshot.targets?.some(t=>t.ref===action.ref)))throw new Error('unobserved_field');
   if(action.select!==undefined&&(action.type!=='fill'||field?.type!=='combobox'||typeof action.select!=='boolean'||action.select===false&&action.query!==undefined))throw new Error('invalid_lookup_mode');
   if(action.query!==undefined&&(action.type!=='fill'||field?.type!=='combobox'||typeof action.query!=='string'||!action.query.trim()||action.query.length>160))throw new Error('invalid_picklist_query');
   if(action.type==='fill'&&(typeof action.value!=='string'||action.value.length>8000||field.type==='checkbox'&&!['true','false'].includes(action.value)))throw new Error('invalid_field_value');
   if(action.type==='fill'&&!field.choices&&['select-one','radio'].includes(field.type))throw Object.assign(new Error('unobserved_choices'),{fieldRef:field.ref});
   if(action.type==='fill'&&field.choices&&['select-one','radio'].includes(field.type)){const value=resolveChoice(action.value,field.choices);if(value===null)throw Object.assign(new Error('unknown_or_ambiguous_choice'),{fieldRef:field.ref});action.value=value;}
  }
 }
 return result;
}
