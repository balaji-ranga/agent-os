import {createHash} from 'node:crypto';
import {validateSnapshot} from './proposals.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scopeOf=scope=>({...scope,audienceId:scope.audienceId||scope.audienceIds?.[0],role:scope.role==='maintainer'||scope.capabilities?.coach?'maintainer':'visitor'});
const requireMaintainer=scope=>{const result=scopeOf(scope);if(result.role!=='maintainer')throw new Error('Coaching permission required');return result;};
const key=(scope,path)=>`${scope.embeddingId}:${scope.audienceId}:${path}`;
const safePath=path=>typeof path==='string'&&/^\/(?!\/)[^?#\\]*$/.test(path)&&path.length<=300&&!decodeURIComponent(path).includes('..')&&!path.split('/').some(p=>/^[a-f0-9-]{32,36}$/i.test(p)||/^\d{5,}$/.test(p));

// Shared learning contains semantic structure only; task parameters and approvals
// stay in the requesting session. Website maps do not contain current values.
export function createLearningRuntime(repository,store,{clock=Date.now,knowledge}={}){
 const maps=repository.map('screen_maps'),validations=repository.map('recipe_validations');
 // Add explicit scope metadata to earlier structural maps without changing any
 // recorded fields. Customer list operations can then filter in SQLite itself.
 for(const [id,map] of maps.entries())if(!map.embeddingId){const [embeddingId,audienceId]=id.split(':');if(/^[A-Za-z0-9_-]{1,80}$/.test(embeddingId)&&/^[A-Za-z0-9_-]{1,80}$/.test(audienceId))maps.set(id,{...map,embeddingId,audienceId});}
 const indexPublication=(scope,result)=>{
  if(!knowledge)return result;
  return (async()=>{try{const source=knowledge.createText(scope,{title:`Workflow: ${result.title}`,text:`Published workflow ${result.title}, version ${result.version}.\n${result.steps.map((s,i)=>`${i+1}. ${s.action} ${s.path}${s.field?' field '+s.field+' using parameter '+s.parameter:''}`).join('\n')}`,recipeBinding:{id:result.id,version:result.version}});await knowledge.ingest(scope,source.id);return {...result,indexed:true};}catch{return {...result,indexed:false,indexingError:'Workflow published; its searchable summary needs indexing retry.'};}})();
 };
 const service={
  list(scope){return store.list(scopeOf(scope));},
  observe(scope,input){
   const access=requireMaintainer(scope),snapshot=validateSnapshot(input);
   if(!safePath(snapshot.path))throw new Error('This record-specific route cannot be saved as shared learning');
   const structure={path:snapshot.path,fields:snapshot.fields.map(({key,label,type,required})=>({key:key||null,label,type,required})),links:snapshot.links.filter(l=>safePath(l.path)).map(({label,path})=>({label,path}))};
   const record={...structure,embeddingId:access.embeddingId,audienceId:access.audienceId,fingerprint:hash(structure),observedAt:clock()};maps.set(key(access,snapshot.path),record);
   return {path:record.path,fieldCount:record.fields.length,fingerprint:record.fingerprint,status:'observed-not-tested'};
  },
  maps(scope){const access=requireMaintainer(scope);return maps.values({embeddingId:access.embeddingId,audienceId:access.audienceId});},
  create(scope,input){return store.create(requireMaintainer(scope),input);},
  repair(scope,{id,version,steps}){return store.repair(requireMaintainer(scope),id,version,steps);},
  validate(scope,{id,version}){
   const access=requireMaintainer(scope),recipe=store.get(access,id);if(recipe.version!==version)throw new Error('Recipe version changed');
   const issues=[],fingerprints={};
   for(const step of recipe.steps){
    const map=maps.get(key(access,step.path));
    if(!map||map.observedAt+24*3_600_000<=clock()){issues.push(`${step.path}: inspect this screen in a coaching session first`);continue;}
    fingerprints[step.path]=map.fingerprint;
    if(step.action==='fill'&&map.fields.filter(f=>f.key===step.field).length!==1)issues.push(`${step.path}: ${step.field} is missing or ambiguous`);
   }
   const report={id,version,compatible:issues.length===0,issues,fingerprints,validatedAt:clock()};
   validations.set(`${access.embeddingId}:${id}:${version}`,report);return report;
  },
  publish(scope,{id,version,reviewed}){
   const access=requireMaintainer(scope),report=validations.get(`${access.embeddingId}:${id}:${version}`);
   if(reviewed!==true||!report?.compatible||report.validatedAt+24*3_600_000<=clock()||Object.entries(report.fingerprints).some(([path,fingerprint])=>{const map=maps.get(key(access,path));return map?.fingerprint!==fingerprint||map.observedAt+24*3_600_000<=clock();}))throw new Error('Validate the current screens and review this version before publication');
   return indexPublication(access,store.publish(access,id,version,{reviewed:true,validated:true}));
  },
  disable(scope,{id,version}){return store.disable(requireMaintainer(scope),id,version);},
  versions(scope,{id}){return store.versions(requireMaintainer(scope),id);},
  rollback(scope,{id,version,targetVersion,reviewed}){
   const access=requireMaintainer(scope),target=store.versions(access,id).find(v=>v.version===targetVersion);
   if(!target||reviewed!==true||target.steps.some(step=>{const map=maps.get(key(access,step.path));return !map||map.observedAt+24*3_600_000<=clock()||step.action==='fill'&&map.fields.filter(f=>f.key===step.field).length!==1;}))throw new Error('Rollback target needs current compatibility inspection');
   return indexPublication(access,store.rollback(access,id,version,targetVersion,{reviewed:true,validated:true}));
  },
  export(scope,{id}){
   const access=requireMaintainer(scope),bundle=store.export(access,id);
   const payload={format:'flolah-learning',schema:1,sdk:1,sourceOrigin:access.origin,bundle};return {...payload,checksum:hash(payload)};
  },
  import(scope,{package:pack,operationId,routes={}}){
   const access=requireMaintainer(scope);
   if(!pack||JSON.stringify(pack).length>24_000||Object.keys(pack).some(k=>!['format','schema','sdk','sourceOrigin','bundle','checksum'].includes(k))||pack.format!=='flolah-learning'||pack.schema!==1||pack.sdk!==1||typeof pack.sourceOrigin!=='string'||new URL(pack.sourceOrigin).origin!==pack.sourceOrigin)throw new Error('Unsupported learning package');
   const {checksum,...payload}=pack;if(checksum!==hash(payload))throw new Error('Learning package integrity mismatch');
   if(!routes||Array.isArray(routes)||Object.entries(routes).some(([from,to])=>!safePath(from)||!safePath(to)))throw new Error('Invalid route mapping');
   if(!Array.isArray(pack.bundle?.steps))throw new Error('Invalid learning steps');
   const bundle={...pack.bundle,steps:pack.bundle.steps.map(step=>({...step,path:routes[step.path]||step.path,...(step.expectedPath?{expectedPath:routes[step.expectedPath]||step.expectedPath}:{})}))};
   return store.import(access,bundle,{operationId});
  },
  bindingAllowed(scope,binding){
   try{if(binding.preview&&!scope.capabilities?.coach)return false;const recipe=store.get(scopeOf(scope),binding.id);return recipe.version===binding.version&&(recipe.status==='published'||binding.preview&&scope.capabilities?.coach===true);}catch{return false;}
  },
  review(scope,snapshot,{id,version,parameters={},step=0}){
   const access=scopeOf(scope),recipe=store.get(access,id),observed=validateSnapshot(snapshot);
   if(recipe.version!==version||!Number.isInteger(step)||step<0||step>recipe.steps.length||!parameters||Array.isArray(parameters))throw new Error('Recipe version or step changed');
   const parameterNames=new Set(recipe.steps.filter(s=>s.action==='fill').map(s=>s.parameter));
   if(Object.keys(parameters).some(p=>!parameterNames.has(p)||typeof parameters[p]!=='string'||parameters[p].length>8000))throw new Error('Invalid recipe parameters');
   let cursor=step;
   while(cursor<recipe.steps.length&&recipe.steps[cursor].action==='verify'){
    if(observed.path!==(recipe.steps[cursor].expectedPath||recipe.steps[cursor].path))throw new Error('Recipe outcome not verified');cursor++;
   }
   if(cursor===recipe.steps.length)return {response:{message:'All recorded draft steps were observed. No Save or business submission is implied.',actions:[]},nextStep:cursor,complete:true,binding:{id,version,preview:recipe.status!=='published'}};
   const next=recipe.steps[cursor],actions=[];
   if(next.action==='navigate'){
    if(observed.path===next.path)return service.review(scope,snapshot,{id,version,parameters,step:cursor+1});
    const links=observed.links.filter(l=>l.path===next.path);if(links.length!==1)throw new Error('Recorded navigation is missing or ambiguous');actions.push({type:'navigate',ref:links[0].ref});cursor++;
   }else{
    if(observed.path!==next.path)throw new Error(`Open ${next.path} before this recorded step`);
    while(cursor<recipe.steps.length&&recipe.steps[cursor].action==='fill'&&recipe.steps[cursor].path===observed.path&&actions.length<10){
     const item=recipe.steps[cursor],fields=observed.fields.filter(f=>f.key===item.field);
     if(fields.length!==1)throw new Error(`The field ${item.field} changed or is ambiguous. Inspect and repair the recipe.`);
     if(!Object.hasOwn(parameters,item.parameter))throw new Error(`Enter the ${item.parameter} parameter`);
     actions.push({type:'fill',ref:fields[0].ref,value:parameters[item.parameter]});cursor++;
    }
   }
   return {response:{message:'Review the recorded next step against the current screen.',actions},nextStep:cursor,complete:false,binding:{id,version,preview:recipe.status!=='published'}};
  },
 };
 return service;
}
