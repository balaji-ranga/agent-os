// Website-independent, owner-reviewed intent. Never store task values here.
const limits={purpose:600,use_when:600,not_for:400,examples:800,prerequisites:600,expected_outcome:600};
export function cleanRecipeIntent(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(limits,key)))throw new Error('Invalid workflow intent');
 return Object.fromEntries(Object.entries(limits).map(([key,max])=>{const value=input[key]??'';if(typeof value!=='string'||value.length>max||/dac_(?:session|coach)_|Bearer\s+\S+|-----BEGIN|(?:password|api[_ -]?key|access[_ -]?token)\s*[=:]/i.test(value))throw new Error('Describe workflow intent without values or credentials');return [key,value.trim()];}));
}
export const recipeIntentReady=metadata=>['purpose','use_when','expected_outcome'].every(key=>typeof metadata?.[key]==='string'&&metadata[key].trim());
const stop=new Set('a an and are as at be by can could do for from help i in is it me my of on or please recipe recording recorded lesson the then this to use want with would you your how update change set make open prepare create task'.split(' '));
const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const words=value=>[...new Set(normalize(value).split(/\s+/).filter(word=>word.length>1&&!stop.has(word)).map(word=>word.length>4&&word.endsWith('s')?word.slice(0,-1):word))].slice(0,80);
export function selectWorkflows(recipes,text,snapshot){
 const query=words(text),ranked=[];
 for(const recipe of recipes){
  if(recipe.status!=='published')continue;
  const named=words(recipe.title).length>=2&&` ${normalize(text)} `.includes(` ${normalize(recipe.title)} `);
  if(!recipeIntentReady(recipe.metadata)&&!named)continue;
  if(words(recipe.metadata?.not_for).filter(word=>query.includes(word)).length>=2)continue;
  const primary=new Set(words([recipe.title,recipe.metadata?.purpose,recipe.metadata?.use_when,recipe.metadata?.examples].join(' '))),secondary=new Set(words(recipe.steps.map(step=>(step.field||'')+' '+step.path).join(' ')));
  const main=query.filter(word=>primary.has(word)),other=query.filter(word=>!primary.has(word)&&secondary.has(word)),coverage=(main.length+other.length)/Math.max(1,query.length);
  if(!named&&(main.length<1||main.length+other.length<2||coverage<0.3))continue;
  ranked.push({recipe,score:main.length*4+other.length+coverage*3+(named?20:0),local:recipe.steps.some(step=>step.path===snapshot.path)});
 }
 ranked.sort((a,b)=>b.score-a.score||Number(b.local)-Number(a.local)||a.recipe.id.localeCompare(b.recipe.id));
 const summary=entry=>({id:entry.recipe.id,version:entry.recipe.version,title:entry.recipe.title});
 if(!ranked.length)return {status:'none',candidates:[],matches:[]};
 if(ranked[1]?.score>=ranked[0].score*0.9)return {status:'ambiguous',candidates:ranked.filter(entry=>entry.score>=ranked[0].score*0.9).slice(0,3).map(summary),matches:[]};
 const recipe=ranked[0].recipe,hint={...summary(ranked[0]),metadata:recipe.metadata,steps:recipe.steps};
 if(JSON.stringify(hint).length>12000)return {status:'manual_replay',candidates:[summary(ranked[0])],matches:[]};
 return {status:'matched',candidates:[summary(ranked[0])],matches:[hint]};
}
export function learnedWorkflowGraph(recipes){
 const nodes=new Map(),edges=[],published=recipes.filter(recipe=>recipe.status==='published').slice(0,100);let truncated=false;
 for(const recipe of published){let previous;for(const step of recipe.steps){
  if(!nodes.has(step.path)){if(nodes.size>=200){truncated=true;continue;}nodes.set(step.path,{path:step.path,fields:[],recipes:[]});}
  const node=nodes.get(step.path);if(step.field&&!node.fields.includes(step.field)&&node.fields.length<100)node.fields.push(step.field);if(!node.recipes.includes(recipe.id))node.recipes.push(recipe.id);
  if(previous&&previous!==step.path){if(edges.length<300)edges.push({from:previous,to:step.path,recipeId:recipe.id,version:recipe.version,action:step.action});else truncated=true;}previous=step.path;
 }}
 return {nodes:[...nodes.values()],edges,truncated,recipeLimitReached:published.length===100,limits:{recipes:100,nodes:200,edges:300},evidence:'published_parameterized_guidance_not_live_task_verification'};
}
