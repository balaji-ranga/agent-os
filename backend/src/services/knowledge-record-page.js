import {fingerprint} from './knowledge-contract.js';

export function recordPreview(record){
  const facts=Object.entries(record.fields||{}).filter(([key,value])=>
    !/(^id$|_id$|^name$|^columns$|^owner$|^created|^modified|^filename$|^chunk_index$|^mime_type$|^relative_path$)/i.test(key)&&['string','number','boolean'].includes(typeof value)&&String(value).trim()
  ).slice(0,4).map(([key,value])=>`${key.replace(/_/g,' ')}: ${String(value).slice(0,100)}`);
  return (facts.length?facts.join(' · '):String(record.text||'')).replace(/\s+/g,' ').trim().slice(0,240);
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
