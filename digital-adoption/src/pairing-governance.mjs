const deny=()=>{throw Object.assign(new Error('PAIRING_MANAGEMENT_DENIED'),{publicCode:'PAIRING_MANAGEMENT_DENIED'});};
// Management middleware authorizes the selected registration before entering here.
// This module never exposes reconnect proofs, host identity, files or chat.
export function createPairingGovernance({groups,website,live,instances,validGroup,saveGroup,dropGroup,notifyPolicy=()=>{},clock=Date.now}){
 const owned=(scope,id)=>{const s=website(scope.embeddingId),g=groups.get(id);if(scope.role!=='maintainer'||!s?.verified||s.status!=='approved'||!g||g.owner!==s.organizationId||![...g.participants.values()].some(p=>p.websiteId===scope.embeddingId))deny();return g;};
 const persist=(g,change)=>{const previous=structuredClone({expiresAt:g.expiresAt,idleMs:g.idleMs,policyRevision:g.policyRevision,policyRequest:g.policyRequest});change();try{saveGroup(g);}catch(error){Object.assign(g,previous);throw error;}};
 const view=g=>({groupId:g.id,name:g.name,revision:g.policyRevision||1,expiresAt:g.expiresAt,idleMs:g.idleMs,active:validGroup(g),workflowLinked:!!g.userId,pairCount:g.pairings.length,members:[...g.participants.values()].map(p=>({participantId:p.id,websiteId:p.websiteId,origin:website(p.websiteId)?.origin,online:!!live(instances.get(p.instanceId))}))});
 return {
  list(scope,{offset=0,limit=25}={}){if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)deny();const s=website(scope.embeddingId);if(scope.role!=='maintainer'||!s?.verified||s.status!=='approved')deny();const all=[...groups.values()].filter(g=>g.owner===s.organizationId&&[...g.participants.values()].some(p=>p.websiteId===scope.embeddingId)&&[...g.participants.values()].every(p=>website(p.websiteId)?.organizationId===g.owner));return {groups:all.slice(offset,offset+limit).map(view),total:all.length,offset,limit,nextOffset:offset+limit<all.length?offset+limit:null};},
  revoke(scope,input){const g=owned(scope,input.groupId);if(input.expectedRevision!==(g.policyRevision||1))throw Object.assign(new Error('Pairing changed; refresh before managing it'),{publicCode:'PAIRING_CHANGED'});dropGroup(g,'OWNER_REVOKED');return {revoked:true,groupId:g.id};},
  update(scope,input){const g=owned(scope,input.groupId);if(!validGroup(g)||![...g.participants.values()].every(p=>{const s=website(p.websiteId);return s?.verified&&s.status==='approved'&&s.organizationId===g.owner;})||input.expectedRevision!==(g.policyRevision||1)||![0,1,4,8,24].includes(input.lifetimeHours)||![0,15,60,240].includes(input.inactivityMinutes))throw Object.assign(new Error('Pairing changed or invalid expiry; refresh before managing it'),{publicCode:'PAIRING_CHANGED'});
   const expiresAt=input.lifetimeHours?clock()+input.lifetimeHours*3600000:null,idleMs=input.inactivityMinutes*60000;
   const extension=g.expiresAt!==null&&g.expiresAt!==undefined&&(!expiresAt||expiresAt>g.expiresAt)||g.idleMs>0&&(!idleMs||idleMs>g.idleMs);
   persist(g,()=>{g.policyRevision=(g.policyRevision||1)+1;g.expiresAt=expiresAt;g.idleMs=idleMs;delete g.policyRequest;});if(!validGroup(g))dropGroup(g,'OWNER_EXPIRY');
   notifyPolicy(g);return {status:'updated',extended:!!extension,group:view(g)};
  },
 };
}
