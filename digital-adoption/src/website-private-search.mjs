import {createHash} from 'node:crypto';
import {createPrivateTaskSearch} from './private-task-search.mjs';
const prefix='adoption-private-site-v2-';
const valid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const unavailable=()=>new Error('Private website content unavailable');
export function createWebsitePrivateSearch({request,clock=Date.now,retentionHours=24}){
 if(!Number.isSafeInteger(retentionHours)||retentionHours<1||retentionHours>720)throw new Error('Invalid private content retention');
 const ready=new Map(),indexFor=site=>{if(!valid(site))throw unavailable();return prefix+createHash('sha256').update(site).digest('hex').slice(0,32);};
 async function expire(){try{return await request(`/${prefix}*/_delete_by_query?conflicts=proceed&allow_no_indices=true&ignore_unavailable=true&refresh=true`,'POST',{query:{range:{expires_at:{lte:clock()}}}});}catch(error){if(error.statusCode===404)return {deleted:0};throw error;}}
 async function ensure(site){const index=indexFor(site);try{await request(`/${index}/_mapping`,'GET');}catch(error){if(error.statusCode!==404)throw error;try{await request(`/${index}`,'PUT',{settings:{number_of_shards:1,number_of_replicas:0},mappings:{dynamic:'strict',_meta:{privateWebsiteVersion:2},properties:Object.fromEntries([
   ...['owner_id','task_id','embedding_id','uploader_id','file_id','attempt_id','reference','filename','locator','visitor_scope','conversation_id','doc_kind'].map(key=>[key,{type:'keyword'}]),['text',{type:'text'}],['sequence',{type:'integer'}],['payload',{type:'object',enabled:false}],['expires_at',{type:'date',format:'epoch_millis'}]
 ])}});}catch(createError){if(createError.statusCode!==400)throw createError;await request(`/${index}/_mapping`,'GET');}}return index;}
 async function provision(site){if(!site){await expire();return {retentionHours,perWebsite:true};}if(!ready.has(site))ready.set(site,ensure(site).catch(error=>{ready.delete(site);throw error;}));if(ready.size>1000)ready.delete(ready.keys().next().value);return ready.get(site);}
 const taskReader=files=>createPrivateTaskSearch({clock,request:(path,...args)=>{
   if(!path.includes('/_search'))throw unavailable();
   // Legacy hourly buckets are read-only during migration and expire under
   // their existing ISM policy. Every hit still needs exact live file grants.
   const indexes=[...new Set(files.map(f=>indexFor(f.embeddingId)))];indexes.push('adoption-private-tasks-v1-*');
   return request('/'+indexes.join(',')+'/_search?allow_no_indices=true&ignore_unavailable=true',...args);
 }});
 const conversationFilter=(site,scope,id)=>{if(!valid(site)||typeof scope!=='string'||!/^[a-f0-9]{64}$/.test(scope)||typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw unavailable();return [{term:{embedding_id:site}},{term:{visitor_scope:scope}},{term:{conversation_id:id}},{term:{doc_kind:'chat_message'}}];};
 return {retentionHours,provision,expire,indexFor,
  async index({ownerId,taskId,file,sections}){
   if(![ownerId,taskId,file?.id,file?.embeddingId,file?.uploaderId,file?.attemptId].every(valid)||!Array.isArray(sections)||!sections.length||sections.length>300||Buffer.byteLength(JSON.stringify(sections))>250000||sections.some(s=>typeof s.text!=='string'||typeof s.locator!=='string'||s.locator.length>300))throw unavailable();
   const index=await provision(file.embeddingId),expiresAt=clock()+retentionHours*3600000,documents=[];
   sections.forEach((section,n)=>{for(let offset=0;offset<section.text.length;offset+=1600){const reference=`${file.id}:${n+1}:${Math.floor(offset/1600)+1}`;documents.push({owner_id:ownerId,task_id:taskId,embedding_id:file.embeddingId,uploader_id:file.uploaderId,file_id:file.id,attempt_id:file.attemptId,filename:file.filename,locator:section.locator,reference,text:section.text.slice(offset,offset+1800),expires_at:expiresAt,doc_kind:'task_passage'});}});
   if(documents.length>1000)throw unavailable();if(documents.length)await request('/_bulk?refresh=wait_for','POST',documents.flatMap(doc=>[JSON.stringify({index:{_index:index,_id:`${taskId}:${file.attemptId}:${doc.reference}`}}),JSON.stringify(doc)]).join('\n')+'\n',true);return {indexed:documents.length};
  },
  search(input){return taskReader(input.files||[]).search(input);},
  conversations:{
   async write({embeddingId,visitorScope,id,messages,expiresAt}){conversationFilter(embeddingId,visitorScope,id);if(!Array.isArray(messages)||messages.length>200||!Number.isSafeInteger(expiresAt)||expiresAt<=clock()||expiresAt>clock()+retentionHours*3600000+1000)throw unavailable();const index=await provision(embeddingId);await request('/_bulk?refresh=wait_for','POST',messages.flatMap((message,sequence)=>[JSON.stringify({index:{_index:index,_id:`chat:${id}:${sequence}`}}),JSON.stringify({embedding_id:embeddingId,visitor_scope:visitorScope,conversation_id:id,doc_kind:'chat_message',sequence,payload:message,text:message.text,expires_at:expiresAt})]).join('\n')+'\n',true);},
   async read({embeddingId,visitorScope,id}){const filter=conversationFilter(embeddingId,visitorScope,id);const out=await request(`/${indexFor(embeddingId)}/_search?allow_no_indices=true&ignore_unavailable=true`,'POST',{size:200,sort:[{sequence:'asc'}],_source:['embedding_id','visitor_scope','conversation_id','doc_kind','sequence','payload','expires_at'],query:{bool:{filter:[...filter,{range:{expires_at:{gt:clock()}}}]}}});if(!Array.isArray(out.hits?.hits))throw unavailable();return out.hits.hits.map((hit,n)=>{const d=hit._source;if(d?.embedding_id!==embeddingId||d.visitor_scope!==visitorScope||d.conversation_id!==id||d.doc_kind!=='chat_message'||d.sequence!==n||d.expires_at<=clock())throw unavailable();return d.payload;});},
   async remove({embeddingId,visitorScope,id}){return request(`/${indexFor(embeddingId)}/_delete_by_query?conflicts=proceed&refresh=true`,'POST',{query:{bool:{filter:conversationFilter(embeddingId,visitorScope,id)}}});}
  }
 };
}
