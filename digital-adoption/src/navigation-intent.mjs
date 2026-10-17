const words=text=>String(text||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean).map(w=>w.endsWith('ies')?w.slice(0,-3)+'y':w.endsWith('s')?w.slice(0,-1):w);
// Constrain allowed actions, not business-form mappings. Only explicit observed
// destination names qualify; semantic/ambiguous requests remain with the model.
export function constrainNavigation(text,snapshot){
 const task=words(text),screen=words(snapshot.screen);
 const matches=snapshot.links.filter(link=>{
  const label=words(link.label);
  return label.length&&label.every(w=>w.length>=3&&task.includes(w))&&link.path!==snapshot.path&&!label.every(w=>screen.includes(w));
 });
 if(matches.length!==1)return snapshot;
 return {...snapshot,fields:[],links:matches,navigationRequired:true};
}
