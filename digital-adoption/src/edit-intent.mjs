import {resolveChoice} from '../web/choice-intent.mjs';
import {booleanIntent,readOnlyIntent} from './task-intent.mjs';
export function hasSemanticMapContext(guidance,snapshot){return guidance?.matches?.some(screen=>screen.path===snapshot.path&&(screen.description||screen.forms?.some(f=>f.description)||screen.fields?.some(f=>f.description)))===true;}
// Narrow explicit partial edits to observed controls, never infer business values.
// Creation and ambiguous requests retain the full form for model reasoning.
export function constrainEdit(text, snapshot) {
  const escape=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const preserved=field=>[field.label,field.key].filter(Boolean).some(name=>new RegExp(`(?:\\b(?:keep|leave)\\s+(?:the\\s+)?${escape(name)}\\s+(?:unchanged|as is|at (?:its )?current value)|\\b(?:do not|don't|never)\\s+change\\s+(?:the\\s+)?${escape(name)}\\b)`,'i').test(text));
  if(snapshot.fields.some(preserved)){const fields=snapshot.fields.filter(f=>!preserved(f));snapshot={...snapshot,fields,forms:(snapshot.forms||[]).map(form=>({...form,fields:form.fields.filter(key=>fields.some(f=>f.key===key&&f.form===form.key))}))};}
  if (!/^\s*(set|change|update|edit)\b/i.test(text) || snapshot.navigationRequired) return snapshot;
  const normalized = String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const matching = snapshot.fields.filter(field => {
    const label = field.label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return label.length >= 3 && ` ${normalized} `.includes(` ${label} `);
  });
  if (!matching.length) return snapshot;
  // A label may be referred to by a shorter natural name. Do not discard that
  // control merely because another target in the same request matched exactly.
  const targets=[...String(text).matchAll(/(?:^\s*(?:set|change|update|edit)\s+|,\s*(?:and\s+)?|\band\s+)([^,.;]+?)\s+(?:to|as)\s+/gi)].map(match=>match[1].toLowerCase().replace(/^the\s+|\s+field$/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim());
  if(targets.some(target=>!matching.some(field=>[field.label,field.key].filter(Boolean).some(name=>name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()===target))))return snapshot;
  const selected=new Set(matching.map(field=>field.key));
  return {...snapshot, fields:matching,forms:(snapshot.forms||[]).map(form=>({...form,fields:form.fields.filter(key=>selected.has(key))})).filter(form=>form.fields.length), links:[], partialEdit:true};
}

// Resolve only fully explicit, uniquely named assignments. This does not infer
// business values or stored mappings, and still produces an ordinary review.
export function explicitEditProposal(text,snapshot){
 if(readOnlyIntent(text))return null;
 // A concrete keep/reset choice still needs a review: current values were not
 // sent to the server. Resolve any uniquely named native control, independent
 // of website vocabulary. Descriptive preferences continue to model planning.
 if(/^\s*(?:please\s+)?(?:keep|leave|reset)\b/i.test(text)){
  const candidates=new Map(),escape=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  for(const field of snapshot.fields.filter(f=>f.choices&&['select-one','radio'].includes(f.type)))for(const name of [field.label,field.key].filter(Boolean)){
   const match=new RegExp(`^\\s*(?:please\\s+)?(?:keep|leave|reset)\\s+(?:the\\s+)?${escape(name)}\\s+(?:(?:at|as|to)\\s+)?(.+)$`,'i').exec(text);if(!match)continue;
   const raw=match[1].replace(/[.!]?\s+(?:do not|don't|never)\b[\s\S]*$/i,'').trim().replace(/[.!]$/,'').trim(),value=resolveChoice(raw,field.choices);
   if(value!==null)candidates.set(field.ref,{type:'fill',ref:field.ref,value});
  }
  if(candidates.size===1)return {message:'Review the requested choice. Nothing has changed.',actions:[...candidates.values()]};
 }
 if(/\b(?:keep|leave)\b[\s\S]*\b(?:unchanged|as is|current value)\b/i.test(text))return null;
 if(/\b(?:and|then)\s+(?:keep|leave|reset)\b/i.test(text))return null;
 // Mixed assignment/selection language belongs to semantic planning. Never
 // consume the second instruction as a dropdown's literal value.
 if(/\b(?:and|then)\s+(?:select|check|uncheck|choose|clear|tick|enable|disable)\b/i.test(text))return null;
 const booleanActions=snapshot.fields.filter(f=>f.type==='checkbox').flatMap(f=>{const value=booleanIntent(text,f);return value===null?[]:[{type:'fill',ref:f.ref,value}];});
 if(booleanActions.length&&snapshot.fields.every(f=>f.type==='checkbox'||!String(text).toLowerCase().includes(f.label.toLowerCase())))return {message:'Review the requested selections. Nothing has changed.',actions:booleanActions};
 if(snapshot.navigationRequired||!/^\s*(?:set|change|update|edit)\b/i.test(text))return null;
 const normalize=value=>String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const matches=[...String(text).matchAll(/(?:^\s*(?:set|change|update|edit)\s+|[,;]\s*(?:and\s+)?|\band\s+)([^,;.]+?)\s+(?:to|as)\s+/gi)];
 if(!matches.length||matches.length>10)return null;
 const actions=[],used=new Set();
 for(const [index,match] of matches.entries()){
  const name=normalize(match[1]).replace(/^the\s+|\s+(?:field|input)$/g,''),words=name.split(' ').filter(word=>!['query','value','text'].includes(word));
  const exact=snapshot.fields.filter(field=>[field.label,field.key].filter(Boolean).some(label=>normalize(label)===name));
  const candidates=exact.length?exact:snapshot.fields.filter(field=>words.length&&[field.label,field.key].filter(Boolean).some(label=>words.every(word=>normalize(label).split(' ').includes(word))));
  if(candidates.length!==1||used.has(candidates[0].ref))return null;
  let value=String(text).slice(match.index+match[0].length,matches[index+1]?.index??text.length).trim().replace(/[.!]?\s+(?:do not|don't|never)\b[\s\S]*$/i,'').trim();
  value=value.replace(/(['"])[.!]$/,'$1');
  if(/^(['"]).*\1$/s.test(value))value=value.slice(1,-1);else value=value.replace(/[.!]$/,'').trim();
  if(!value||value.length>8000)return null;
  if(candidates[0].type==='combobox')return null; // Dynamic result selection requires model reasoning over fresh observations.
  if(candidates[0].type==='checkbox'&&!['true','false'].includes(value))return null;
  if(['select-one','radio','select-multiple'].includes(candidates[0].type)){if(!candidates[0].choices||candidates[0].type==='select-multiple')return null;value=resolveChoice(value,candidates[0].choices);if(value===null)return null;}
  used.add(candidates[0].ref);actions.push({type:'fill',ref:candidates[0].ref,value});
 }
 return {message:`Review these ${actions.length} explicit field changes. Nothing has been changed yet.`,actions};
}
