import {createHash} from 'node:crypto';
import {arrayPage} from './pagination.mjs';
import {mergeSourceScreen} from './source-map-structure.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const secret=/password|secret|token|credential|otp|cvv|credit.?card|api.?key|access.?key|private.?key/i;
const pathOK=value=>typeof value==='string'&&/^\/(?!\/)[^?#\\]*$/.test(value)&&value.length<=300&&!decodeURIComponent(value).includes('..')&&!value.split('/').some(p=>/^\d{5,}$/.test(p)||/^[a-f0-9-]{32,36}$/i.test(p));
const allowedKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k));
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const description=value=>value===undefined||typeof value==='string'&&value.length<=1500&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const prose=value=>value?.trim()?{description:value.trim()}:{};
const fail=(message,publicCode='SOURCE_MAP_INVALID')=>{throw Object.assign(new Error(message),{publicCode});};
// Explicit owner-supplied STRUCTURE only. Never merge into observed screen maps
// or treat a source-derived recipe as a published executable workflow.
export function createSourceMap(repository,{clock=Date.now}={}){
 const maps=repository.map('source_maps');
 const key=scope=>{const audience=scope.audienceId||scope.audienceIds?.[0];if(!scope.embeddingId||!audience)throw new Error('Source map access denied');return `${scope.embeddingId}:${audience}`;};
 const read=scope=>maps.get(key(scope));
 const maintain=scope=>{if(scope.role!=='maintainer'&&!scope.capabilities?.coach)throw new Error('Coaching permission required');};
 const observations=scope=>repository.map('screen_maps').values({embeddingId:scope.embeddingId,audienceId:scope.audienceId||scope.audienceIds?.[0]});
 const merged=(scope,path)=>mergeSourceScreen(observations(scope).find(s=>s.path===path),read(scope)?.screens.find(s=>s.path===path));
 const revision=(scope,screen)=>hash({revision:read(scope)?.revision||null,screen});
 return {
  refresh(scope,input){
   if(scope.role!=='maintainer'&&!scope.capabilities?.coach)throw new Error('Coaching permission required');
   if(!allowedKeys(input,['schema','origin','screens','reviewed'])||input.schema!==1||input.reviewed!==true||input.origin!==scope.origin||!Array.isArray(input.screens)||input.screens.length>200||Buffer.byteLength(JSON.stringify(input))>480_000)throw new Error('Invalid reviewed source map');
   const paths=new Set();
   const screens=input.screens.map(screen=>{
    if(!allowedKeys(screen,['path','title','description','forms','fields','links'])||!pathOK(screen.path)||paths.has(screen.path)||!text(screen.title,160)||!description(screen.description)||!Array.isArray(screen.forms)||screen.forms.length>100||!Array.isArray(screen.fields)||screen.fields.length>500)throw new Error('Invalid source screen');paths.add(screen.path);
    const formIds=new Set(),forms=screen.forms.map(form=>{if(!allowedKeys(form,['id','label','description'])||!text(form.id,80)||formIds.has(form.id)||!text(form.label,160)||!description(form.description))throw new Error('Invalid source form');formIds.add(form.id);return {id:form.id,label:form.label,...prose(form.description)};});
    const ids=new Set(),fields=screen.fields.map(field=>{
     if(!allowedKeys(field,['key','label','type','required','form','description'])||!text(field.key,80)||!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(field.key)||ids.has(field.key)||!text(field.label,160)||!description(field.description)||!['text','number','email','date','textarea','url','tel','search','select-one','select-multiple','radio','checkbox','combobox'].includes(field.type)||field.required!==undefined&&typeof field.required!=='boolean'||field.form!==undefined&&!forms.some(f=>f.id===field.form))throw new Error('Invalid source field');ids.add(field.key);
     if(secret.test(field.key+' '+field.label))return null;
     return {key:field.key,label:field.label,type:field.type,required:field.required===true,...(field.form?{form:field.form}:{}),...prose(field.description)};
    }).filter(Boolean);
    if(screen.links!==undefined&&(!Array.isArray(screen.links)||screen.links.length>100))throw new Error('Invalid source navigation');
    const links=screen.links?.map(link=>{if(!allowedKeys(link,['path','label'])||!pathOK(link.path)||!text(link.label,160))throw new Error('Invalid source navigation');return {path:link.path,label:link.label};});
    return {path:screen.path,title:screen.title,...prose(screen.description),forms,fields,...(links?{links}:{})};
   });
   const revision=hash(screens),record={embeddingId:scope.embeddingId,audienceId:scope.audienceId||scope.audienceIds[0],origin:input.origin,revision,screens,refreshedAt:clock(),evidence:'owner_source_metadata_not_live_acceptance'};
   maps.set(key(scope),record);return this.summary(scope);
  },
  summary(scope){const record=read(scope);return record?{revision:record.revision,refreshedAt:record.refreshedAt,evidence:record.evidence,counts:{screens:record.screens.length,forms:record.screens.reduce((n,s)=>n+s.forms.length,0),fields:record.screens.reduce((n,s)=>n+s.fields.length,0)},screens:record.screens}:{revision:null,counts:{screens:0,forms:0,fields:0},screens:[],evidence:'no_source_map'};},
  page(scope,input={}){const result=this.summary(scope),out=arrayPage(result.screens,input,s=>s.path+' '+s.title);return {...result,screens:out.items,pagination:out.pagination};},
  screen(scope,{path}){maintain(scope);key(scope);if(!pathOK(path))fail('Choose a safe saved page.');const screen=merged(scope,path);if(!screen)fail('Inspect this page or import its structure first.');return {screen,revision:revision(scope,screen),policy:'Reviewed descriptions are shared guidance for this website/content scope. Do not enter visitor values, secrets or task data.'};},
  export(scope,{path}={}){maintain(scope);key(scope);const paths=path?[path]:[...new Set([...observations(scope).map(s=>s.path),...(read(scope)?.screens||[]).map(s=>s.path)])];if(paths.length>200)fail('Export individual pages: the full map exceeds the 200-page import limit.');const screens=paths.map(path=>this.screen(scope,{path}).screen),manifest={schema:1,origin:scope.origin,reviewed:false,screens};if(Buffer.byteLength(JSON.stringify(manifest))>480_000)fail('Export individual pages: the full map exceeds the 480 KB import limit.');return {manifest,notes:'Observed structure combined with reviewed hints; no live refs or entered values. Descriptions are advisory. Review before re-import. Unkeyed, ambiguous or unsupported fields are omitted from the importable structure; the original observations remain unchanged.'};},
  describe(scope,input){return repository.transaction(()=>{maintain(scope);if(!allowedKeys(input,['path','revision','target','description','reviewed'])||input.reviewed!==true||!description(input.description)||typeof input.description!=='string'||!allowedKeys(input.target,['kind','id']))fail('Review one page, form or field description, up to 1500 characters.');const current=this.screen(scope,input);if(input.revision!==current.revision)fail('The map changed. Reload saved map, then reopen the context editor before saving.','SOURCE_MAP_CHANGED');const screen=current.screen;let entity;if(input.target.kind==='page'&&!input.target.id)entity=screen;else if(input.target.kind==='form')entity=screen.forms.find(f=>f.id===input.target.id);else if(input.target.kind==='field')entity=screen.fields.find(f=>f.key===input.target.id);if(!entity)fail('This form or field is no longer in the map. Reload it first.');delete entity.description;Object.assign(entity,prose(input.description));const screens=(read(scope)?.screens||[]).filter(s=>s.path!==screen.path);screens.push(screen);this.refresh(scope,{schema:1,origin:scope.origin,reviewed:true,screens});return this.screen(scope,input);});},
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
   const relevance=value=>words.reduce((n,w)=>n+Number(JSON.stringify(value).toLowerCase().includes(w)),0);
   const ranked=record.screens.filter(screen=>!snapshot.currentFormMatchesTask||screen.path===snapshot.path).map(screen=>({screen,score:relevance(screen)+(screen.path===snapshot.path?1000:0)})).filter(r=>r.score).sort((a,b)=>b.score-a.score);
   let budget=9000;const matches=[];
   for(const {screen} of ranked){
    const liveKeys=new Set((snapshot.fields||[]).map(f=>f.key)),fields=screen.fields.filter(f=>screen.path===snapshot.path||liveKeys.has(f.key)||relevance(f)).sort((a,b)=>(Number(liveKeys.has(b.key))*100+relevance(b))-(Number(liveKeys.has(a.key))*100+relevance(a))).slice(0,30),formIds=new Set(fields.map(f=>f.form));
    const candidate={path:screen.path,title:screen.title,...prose(screen.description),forms:[],fields:[],links:[]};let used=JSON.stringify(candidate).length;if(used>budget)continue;
    const append=(key,item)=>{const size=JSON.stringify(item).length+1;if(used+size>budget)return;candidate[key].push(item);used+=size;};
    for(const form of screen.forms.filter(f=>formIds.has(f.id)||relevance(f)).sort((a,b)=>relevance(b)-relevance(a)))append('forms',form);
    for(const field of fields)append('fields',field);
    for(const link of screen.links||[])append('links',link);
    candidate.omittedFields=screen.fields.length-candidate.fields.length;candidate.omittedForms=screen.forms.length-candidate.forms.length;
    budget-=JSON.stringify(candidate).length;matches.push(candidate);if(matches.length===5)break;
   }
   return {revision:record.revision,evidence:record.evidence,matches,policy:'Guidance only. Open a uniquely observed safe destination, inspect its live controls and options, then prepare requested fields for approval. Do not use source keys as live refs or claim a save.'};
  },
 };
}
