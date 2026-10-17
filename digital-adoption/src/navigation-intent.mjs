const words=text=>String(text||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean).map(w=>w.endsWith('ies')?w.slice(0,-3)+'y':w.endsWith('s')?w.slice(0,-1):w);
// Constrain allowed actions, not business-form mappings. Only explicit observed
// destination names qualify; semantic/ambiguous requests remain with the model.
export function constrainNavigation(text,snapshot){
 // A self link is not the next step. Keeping it available can make a model
 // repeatedly reopen the destination instead of continuing with its fields.
 const otherLinks=snapshot.links.filter(link=>link.path!==snapshot.path);
 if(otherLinks.length!==snapshot.links.length)snapshot={...snapshot,links:otherLinks};
 const task=words(text),screen=words(snapshot.screen);
 const matches=snapshot.links.filter(link=>{
  const label=words(link.label);
  return label.length&&label.every(w=>w.length>=3&&task.includes(w))&&link.path!==snapshot.path&&!label.every(w=>screen.includes(w));
 });
 if(matches.length===1)return {...snapshot,fields:[],forms:[],submissions:[],links:matches,navigationRequired:true};
 const normalized=value=>String(value||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim(),taskText=` ${normalized(text)} `;
 const currentMatches=snapshot.fields.filter(field=>normalized(field.label).length>=3&&taskText.includes(` ${normalized(field.label)} `));
 // When multiple requested fields are already here, unrelated destinations
 // must not distract planning. An explicitly named other destination wins above.
 return currentMatches.length>=2?{...snapshot,links:[],currentFormMatchesTask:true}:snapshot;
}
