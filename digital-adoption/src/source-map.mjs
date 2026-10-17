import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const secret=/password|secret|token|credential|otp|cvv|credit.?card|api.?key|access.?key|private.?key/i;
const pathOK=value=>typeof value==='string'&&/^\/(?!\/)[^?#\\]*$/.test(value)&&value.length<=300&&!decodeURIComponent(value).includes('..')&&!value.split('/').some(p=>/^\d{5,}$/.test(p)||/^[a-f0-9-]{32,36}$/i.test(p));
const allowedKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k));
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
// Explicit owner-supplied STRUCTURE only. Never merge into observed screen maps
// or treat a source-derived recipe as a published executable workflow.
export function createSourceMap(repository,{clock=Date.now}={}){
 const maps=repository.map('source_maps');
 const key=scope=>{const audience=scope.audienceId||scope.audienceIds?.[0];if(!scope.embeddingId||!audience)throw new Error('Source map access denied');return `${scope.embeddingId}:${audience}`;};
 const read=scope=>maps.get(key(scope));
 return {
  refresh(scope,input){
   if(scope.role!=='maintainer'&&!scope.capabilities?.coach)throw new Error('Coaching permission required');
   if(!allowedKeys(input,['schema','origin','screens','reviewed'])||input.schema!==1||input.reviewed!==true||input.origin!==scope.origin||!Array.isArray(input.screens)||input.screens.length>200||JSON.stringify(input).length>480_000)throw new Error('Invalid reviewed source map');
   const paths=new Set();
   const screens=input.screens.map(screen=>{
    if(!allowedKeys(screen,['path','title','forms','fields'])||!pathOK(screen.path)||paths.has(screen.path)||!text(screen.title,160)||!Array.isArray(screen.forms)||screen.forms.length>100||!Array.isArray(screen.fields)||screen.fields.length>500)throw new Error('Invalid source screen');paths.add(screen.path);
    const forms=screen.forms.map(form=>{if(!allowedKeys(form,['id','label'])||!text(form.id,80)||!text(form.label,160))throw new Error('Invalid source form');return {id:form.id,label:form.label};});
    const ids=new Set(),fields=screen.fields.map(field=>{
     if(!allowedKeys(field,['key','label','type','required','form'])||!text(field.key,80)||!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(field.key)||ids.has(field.key)||!text(field.label,160)||!['text','number','email','date','textarea','url','tel','search','select-one','checkbox'].includes(field.type)||field.required!==undefined&&typeof field.required!=='boolean'||field.form!==undefined&&!forms.some(f=>f.id===field.form))throw new Error('Invalid source field');ids.add(field.key);
     if(secret.test(field.key+' '+field.label))return null;
     return {key:field.key,label:field.label,type:field.type,required:field.required===true,...(field.form?{form:field.form}:{})};
    }).filter(Boolean);
    return {path:screen.path,title:screen.title,forms,fields};
   });
   const revision=hash(screens),record={embeddingId:scope.embeddingId,audienceId:scope.audienceId||scope.audienceIds[0],origin:input.origin,revision,screens,refreshedAt:clock(),evidence:'owner_source_metadata_not_live_acceptance'};
   maps.set(key(scope),record);return this.summary(scope);
  },
  summary(scope){const record=read(scope);return record?{revision:record.revision,refreshedAt:record.refreshedAt,evidence:record.evidence,counts:{screens:record.screens.length,forms:record.screens.reduce((n,s)=>n+s.forms.length,0),fields:record.screens.reduce((n,s)=>n+s.fields.length,0)},screens:record.screens}:{revision:null,counts:{screens:0,forms:0,fields:0},screens:[],evidence:'no_source_map'};},
  recipeDraft(scope,{path,form,revision}){
   if(scope.role!=='maintainer'&&!scope.capabilities?.coach)throw new Error('Coaching permission required');
   const record=read(scope),screen=record?.screens.find(s=>s.path===path),sourceForm=screen?.forms.find(f=>f.id===form);
   if(!record||record.revision!==revision||!sourceForm)throw new Error('Refresh the current source map first');
   const fields=screen.fields.filter(f=>f.form===form);
   if(!fields.length||fields.length>22)throw new Error('Teach a bounded workflow with one to twenty-two eligible fields');
   return {title:`${screen.title} — ${sourceForm.label}`.slice(0,120),provenance:'coached',steps:[{action:'navigate',path},...fields.map(f=>({action:'fill',path,field:f.key,parameter:f.key})),{action:'verify',path}]};
  },
  guidance(scope,task,snapshot){
   const record=read(scope);if(!record)return null;
   const words=[...new Set(String(task).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[])].slice(0,30);
   const ranked=record.screens.map(screen=>({screen,score:words.reduce((n,w)=>n+Number(JSON.stringify(screen).toLowerCase().includes(w)),0)})).filter(r=>r.score||r.screen.path===snapshot.path).sort((a,b)=>b.score-a.score);
   let budget=9000;const matches=[];
   for(const {screen} of ranked){const candidate={...screen,fields:screen.fields.filter(f=>words.some(w=>(f.label+' '+f.key).toLowerCase().includes(w))).slice(0,30)},size=JSON.stringify(candidate).length;if(size>budget)continue;budget-=size;matches.push(candidate);if(matches.length===5)break;}
   return {revision:record.revision,evidence:record.evidence,matches,policy:'Guidance only. Open a uniquely observed safe destination, inspect its live controls and options, then prepare requested fields for approval. Do not use source keys as live refs or claim a save.'};
  },
 };
}
