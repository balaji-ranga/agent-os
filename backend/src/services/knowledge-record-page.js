import {fingerprint} from './knowledge-contract.js';

export function recordPreview(record){
  const facts=recordDisplayFields(record).slice(0,4).map(({label,value})=>`${label}: ${value.slice(0,100)}`);
  const text=String(record.text||'');
  return (facts.length?facts.join(' · '):/^[\s]*[\[{]/.test(text)?String(record.title||'Structured record; expand evidence for details.'):text).replace(/\s+/g,' ').trim().slice(0,240);
}

export function recordDisplayFields(record){
  const facts=[];
  const visit=(value,path='',depth=0)=>{
    if(depth>3||facts.length>=12)return;
    if(['string','number','boolean'].includes(typeof value)){
      const text=String(value).trim();
      if(text&&!/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(text))facts.push({label:path.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_.]/g,' '),value:text.slice(0,400)});
    }else if(Array.isArray(value))value.slice(0,3).forEach(v=>visit(v,path,depth+1));
    else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
      if(/(^id$|_id$|Id$|token|secret|password|^owner$|^created|^modified|^columns$|^chunk_index$|^filename$|^mime_type$|^relative_path$)/.test(key)||/token|secret|password/i.test(key))continue;
      visit(item,path?`${path}.${key}`:key,depth+1);
    }
  };
  visit(record.fields||{});
  return facts;
}

export function recordPageOptions(owner,source,after,options={}) {
  const query=String(options.query||'').trim();
  const limit=Number(options.limit??100);
  const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
  if(query.length>200)fail('Record search must be 200 characters or fewer');
  if(!Number.isInteger(limit)||limit<1||limit>100)fail('Record page size must be 1–100');
  const scope=fingerprint([owner,source.id,source.revision,query]);
  let entity=null;
  if(after) {
    // Preserve existing unfiltered clients while issuing scoped opaque cursors.
    if(/^[a-f0-9]{64}$/.test(after)&&!query)entity=after;
    else {
      let cursor;
      try{if(typeof after!=='string'||after.length>1024)throw new Error();cursor=JSON.parse(Buffer.from(after,'base64url').toString());}
      catch{fail('Invalid record cursor');}
      if(cursor?.v!==1||!/^[a-f0-9]{64}$/.test(cursor.entity||''))fail('Invalid record cursor');
      if(cursor.scope!==scope)fail('Source or search changed. Refresh the record results.',409);
      entity=cursor.entity;
    }
  }
  return {query,limit,entity,compact:options.compact===true,
    cursor:entity=>Buffer.from(JSON.stringify({v:1,scope,entity})).toString('base64url')};
}
