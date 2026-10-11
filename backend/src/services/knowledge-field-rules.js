import { fingerprint } from './knowledge-contract.js';

const scalar=value=>typeof value==='string'||typeof value==='number'||typeof value==='boolean';
export function recordFields(record) {
  const result={object_id:[String(record.object_id)]};
  const visit=(value,path,depth)=>{
    if(depth>5||Object.keys(result).length>=200)return;
    if(scalar(value)){
      const text=String(value).trim();
      if(text&&text.length<=500)(result[path]??=[]).push(text);
    }else if(Array.isArray(value))value.slice(0,20).forEach(v=>visit(v,path,depth+1));
    else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
      if(/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)&&!['constructor','prototype','__proto__'].includes(key))visit(item,`${path}.${key}`,depth+1);
    }
  };
  visit(record.fields||{},'fields',0);
  return Object.fromEntries(Object.entries(result).map(([key,values])=>[key,[...new Set(values)]]));
}
export const fieldToken=(field,value,normalization='exact')=>fingerprint([field,normalization,normalization==='casefold'?String(value).trim().toLocaleLowerCase('en-US'):String(value).trim()]);
export function indexedFields(record){
  const fields=recordFields(record);
  return {field_names:Object.keys(fields),field_tokens:Object.entries(fields).flatMap(([field,values])=>values.flatMap(value=>['exact','casefold'].map(mode=>fieldToken(field,value,mode))))};
}
export function validateFieldRule(input={}){
  const out={};
  for(const key of ['from_source','to_source','from_collection','to_collection','from_field','to_field','relation','note']){
    out[key]=String(input[key]||'').trim();
    if(!out[key]||out[key].length>(key==='note'?2000:200))throw new Error(`${key} is required`);
  }
  for(const key of ['from_field','to_field'])if(!/^(object_id|fields\.[a-zA-Z][a-zA-Z0-9_.]{0,160})$/.test(out[key])||out[key].split('.').some(k=>['constructor','prototype','__proto__'].includes(k)))throw new Error('Choose a supported record field');
  if(!/^[a-z][a-z0-9_]{0,63}$/.test(out.relation))throw new Error('Invalid relationship type');
  if(input.identifier_confirmed!==true)throw new Error('Confirm these fields contain authoritative matching identifiers, not names alone');
  out.identifier_confirmed=true;
  out.normalization=input.normalization||'exact';
  if(!['exact','casefold'].includes(out.normalization))throw new Error('Unsupported matching normalization');
  out.enabled=input.enabled!==false;
  return out;
}

// Rules resolve against current indexed revisions, not a permanently copied edge.
// Duplicate target identifiers are deliberately left unresolved.
export async function fieldRuleEdges(owner,frontier,entities,sources,rules,search){
  const bySource=new Map(sources.map(s=>[s.id,s]));const edges=[];let lookups=0;
  for(const rule of rules.filter(r=>r.enabled&&bySource.has(r.from_source)&&bySource.has(r.to_source))){
    for(const direction of ['from','to']){
      const other=direction==='from'?'to':'from';
      for(const id of frontier){
        const record=entities.get(id);
        if(record?.source!==rule[`${direction}_source`]||record.object_id.split('/')[0]!==rule[`${direction}_collection`])continue;
        for(const value of (recordFields(record)[rule[`${direction}_field`]]||[]).slice(0,5)){
          if(++lookups>40)return edges;
          const matches=await search.matchField(owner,bySource.get(rule[`${other}_source`]),rule[`${other}_collection`],rule[`${other}_field`],value,rule.normalization);
          if(matches.length!==1)continue;
          const target=matches[0];
          edges.push({from:direction==='from'?record.entity:target.entity,to:direction==='from'?target.entity:record.entity,relation:rule.relation,evidence:{origin:'field_rule',rule_id:rule.id,note:rule.note,from_field:rule.from_field,to_field:rule.to_field}});
        }
      }
    }
  }
  return edges;
}
