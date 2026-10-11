// Selection is independent of provider change cursors. Only normalized,
// owner-authorized adapter records enter this module. No executable expressions.
export const selectionOperators=['equals','not_equals','contains','in','gt','gte','lt','lte','exists','within_days'];
const fieldsByKind={
  crm:['name','name.firstName','name.lastName','emails.primaryEmail','companyId','stage','amount','closeDate','domainName'],
  erp:['name','customer','customer_name','customer_type','project','project_name','status','due_date','outstanding_amount','grand_total','currency','email_id'],
  knowledge:['filename','tags'],content:['bytes'],gmail:['sender'],outlook:['sender'],
};
export function selectionSchema(kind){return {fields:['title','text','object_id','modified_at',...(fieldsByKind[kind]||[]).map(f=>`fields.${f}`)],operators:selectionOperators,execution:'Normalized-record filtering after authorized fetch. Provider-native Gmail query/Outlook folder still applies. Dynamic table columns use fields.<column>.',max_rules:20};}
const safePath=p=>typeof p==='string'&&p.length<=160&&/^(title|text|object_id|modified_at|fields\.[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+){0,5})$/.test(p)&&!p.split('.').some(x=>['__proto__','prototype','constructor'].includes(x));
export function validateSelection(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid content selection');
  const mode=input.mode||'all',rules=input.rules||[],include=input.include||[];
  if(!['all','any'].includes(mode)||!Array.isArray(rules)||rules.length>20||!Array.isArray(include)||include.length>50||include.some(p=>!safePath(p)))throw new Error('Invalid selection fields or rules');
  for(const r of rules){
    if(!r||!safePath(r.field)||!selectionOperators.includes(r.operator))throw new Error('Choose a valid field and filter operator');
    if(r.operator==='in'&&(!Array.isArray(r.value)||r.value.length>50))throw new Error('In filter requires up to 50 values');
    if(['gt','gte','lt','lte','within_days'].includes(r.operator)&&(!Number.isFinite(Number(r.value))||r.value===''||(r.operator==='within_days'&&(Number(r.value)<=0||Number(r.value)>36500))))throw new Error('Numeric filter requires a valid number');
    if(JSON.stringify(r.value??null).length>2000||[r.value].flat().some(v=>v!==null&&typeof v==='object'))throw new Error('Filter values must be bounded scalar values');
  }
  return {mode,rules:rules.map(({field,operator,value})=>({field,operator,value})),include:[...new Set(include)].filter(p=>!include.some(parent=>p!==parent&&p.startsWith(`${parent}.`)))};
}
function valueAt(record,path){return path.split('.').reduce((v,k)=>v!=null&&Object.hasOwn(Object(v),k)?v[k]:undefined,record);}
export function recordSelected(record,selection,now=Date.now()){
  const rules=selection?.rules||[];if(!rules.length)return true;
  const match=r=>{const v=valueAt(record,r.field),s=String(v??'').toLowerCase(),wanted=String(r.value??'').toLowerCase();
    switch(r.operator){
      case 'exists':return r.value===false?v==null:v!=null;
      case 'equals':return v!=null&&s===wanted;
      case 'not_equals':return v!=null&&s!==wanted;
      case 'contains':return v!=null&&s.includes(wanted);
      case 'in':return v!=null&&r.value.some(x=>String(x).toLowerCase()===s);
      case 'within_days':{const t=Date.parse(v);return Number.isFinite(t)&&t<=now&&t>=now-Number(r.value)*86400000;}
      default:{if(v==null||v===''||!Number.isFinite(Number(v)))return false;const a=Number(v),b=Number(r.value);return {gt:a>b,gte:a>=b,lt:a<b,lte:a<=b}[r.operator]===true;}
    }
  };return selection.mode==='any'?rules.some(match):rules.every(match);
}
export function projectKnowledgeRecord(record,selection){
  const include=selection?.include||[];if(!include.length)return record;
  const fields={};for(const path of include.filter(p=>p.startsWith('fields.'))){const value=valueAt(record,path);if(value===undefined)continue;const keys=path.slice(7).split('.');let out=fields;keys.forEach((k,i)=>{if(i===keys.length-1)out[k]=value;else out=out[k]||=( {} );});}
  // Selected fields are a whitelist across text AND metadata. Do not retain an
  // excluded field through the old full JSON body, title, URL or native edges.
  const title=include.includes('title')?record.title:record.object_id;
  const text=[include.includes('title')?record.title:null,include.includes('text')?record.text:null,Object.keys(fields).length?JSON.stringify(fields):null].filter(Boolean).join('\n');
  const scalars=value=>value&&typeof value==='object'?Object.values(value).flatMap(scalars):[String(value??'')];
  const selectedValues=new Set(scalars(fields));
  const relations=(record.relations||[]).filter(r=>selectedValues.has(r.target.slice(r.target.indexOf('/')+1)));
  return {object_id:record.object_id,title,text:text||record.object_id,fields,relations,modified_at:record.modified_at};
}
export function sourceReadable(source){return !!source&&(source.retrieval_enabled??source.enabled)&&!!source.revision&&['ready','syncing','paused'].includes(source.status);}

// Push only equivalent numeric predicates. Text collations differ by provider;
// OR cannot safely push a subset. The normalized filter always runs as well.
export function erpSelectionFilters(selection,available){
  if(selection?.mode==='any')return [];
  const operators={gt:'>',gte:'>=',lt:'<',lte:'<='};
  return (selection?.rules||[]).filter(r=>r.field.startsWith('fields.')&&['grand_total','outstanding_amount','amount'].includes(r.field.slice(7))&&available.includes(r.field.slice(7))&&operators[r.operator]).map(r=>[r.field.slice(7),operators[r.operator],Number(r.value)]);
}
