// Resolve only known tenant routes from an already-authorized catalog.
// This grants no data access: record APIs retain their own ownership checks.
export function withCurrentCopilotScreen(catalog,path,{tenantFullAccess=false}={}){
  if(typeof path!=='string'||path.length>500||!/^\/[a-zA-Z0-9_/-]*$/.test(path)||path.includes('..')||catalog.screens.some(s=>s.route===path))return catalog;
  const rules=[
    [/^\/objectives\/(?:new|measurement-registry|[\w-]+)$/,'objectives','Objective'],
    [/^\/goal-plans\/[\w-]+$/,'goal-plans','Goal plan'],
    [/^\/avatars\/[\w-]+\/room$/,'avatars','Avatar room'],
    [/^\/vr-rooms\/[\w-]+$/,'avatars','Virtual room'],
    [/^\/workflows\/[\w-]+\/edit$/,'workflows','Workflow Builder'],
    [/^\/integrations\/mcp\/[\w/-]+$/,'mcp','MCP setup'],
  ];
  let parent,label;
  const agent=path.match(/^\/agents\/([\w-]+)\/(chat|workspace|channels|virtual-room)$/);
  if(agent){
    if(!catalog.agents.some(a=>a.id===agent[1]))return catalog;
    parent=agent[2]==='virtual-room'?'avatars':agent[2]==='chat'?'home':'ai-employees';
    label=`Agent ${agent[2]}`;
  }else{
    const rule=rules.find(([pattern])=>pattern.test(path));
    if(rule)[,parent,label]=rule;
    else if(tenantFullAccess&&['/company-setup','/update-company-details','/company-operate'].includes(path)){parent='org';label='Company setup';}
    else return catalog;
  }
  if(!catalog.screens.some(s=>s.id===parent))return catalog;
  return {...catalog,screens:[...catalog.screens,{id:`current:${path}`,route:path,label}]};
}
