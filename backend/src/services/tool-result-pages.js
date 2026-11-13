import {randomUUID} from 'node:crypto';

/** Exact, bounded tool-result snapshots. Paging never repeats the source action. */
export function toolResultPages({clock=Date.now,ttl=900000,maxBytes=32*1024*1024,maxResultBytes=8*1024*1024,inlineChars=12000,pageChars=6000}={}){
 const entries=new Map();let bytes=0;
 const fail=(code,message,status)=>{throw Object.assign(Error(message),{code,status});};
 const clean=()=>{for(const [id,e] of entries)if(e.expires<=clock()){entries.delete(id);bytes-=e.bytes;}};
 const same=(e,s)=>e.owner===s.owner&&e.agent===s.agent&&e.session===s.session;
 const page=(id,e,offset)=>{
  if(!Number.isInteger(offset)||offset<0||offset>e.text.length)fail('TOOL_RESULT_OFFSET','Invalid result offset',400);
  const end=Math.min(e.text.length,offset+pageChars);
  const ranges=[...e.ranges,[offset,end]].sort((a,b)=>a[0]-b[0]),merged=[];let covered=0;
  for(const range of ranges){const last=merged.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}
  for(const [start,stop] of merged){if(start>covered)break;covered=Math.max(covered,stop);}e.ranges=merged;
  const next=covered>=e.text.length?null:(end<e.text.length?end:covered);
  return {resultId:id,source_tool:e.tool,content:e.text.slice(offset,end),encoding:'json',offset,total_characters:e.text.length,next_offset:next,coverage_complete:covered>=e.text.length,
   next_request:next===null?null:{resultId:id,offset:next},
   instruction:'This is exact serialized tool output, not a summary. Read relevant pages and preserve source references/findings before continuing. Unread pages are not reviewed. Do not repeat the original action to retrieve its result.'};
 };
 return {
  project(scope,value,{deferRead=false}={}){
   const text=JSON.stringify(value);if(text===undefined||text.length<=inlineChars)return value;
   if(!scope.owner||!scope.agent||!scope.session)fail('TOOL_RESULT_SCOPE','Large tool result requires an authenticated conversation',403);
   clean();const size=Buffer.byteLength(text);
   if(size>maxResultBytes||bytes+size>maxBytes) return {ok:false,code:'TOOL_RESULT_CAPACITY',action_may_have_completed:true,coverage_complete:false,instruction:'Result exceeds the bounded result store. Do not repeat a mutation. Inspect the original operation receipt; narrow future read queries.'};
   const id='result-'+randomUUID(),entry={...scope,text,bytes:size,expires:clock()+ttl,ranges:[]};entries.set(id,entry);bytes+=size;
   const receipt={};for(const k of ['ok','status','code','error','id','operationId','trackingId'])if(['string','number','boolean'].includes(typeof value?.[k])&&String(value[k]).length<200)receipt[k]=value[k];
   const first=page(id,entry,0);
   if(deferRead){entry.ranges=[];first.content='';first.next_offset=0;first.next_request={resultId:id,offset:0};first.coverage_complete=false;}
   return {...receipt,_retrieval:first,result_stored:true};
  },
  async read(scope,input,authorize){
   clean();const e=entries.get(input.resultId);
   if(!e||!same(e,scope))fail('TOOL_RESULT_UNAVAILABLE','Result is expired or unavailable in this conversation. Do not repeat a mutation.',410);
   await authorize(e.tool);
   return page(input.resultId,e,input.offset??0);
  },
 };
}
export const sharedToolResultPages=toolResultPages();
