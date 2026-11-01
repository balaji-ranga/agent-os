import {fault} from './contracts.js';
const integer=(value,fallback,max)=>{if(value==null||value==='')return fallback;const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>max)throw fault('Invalid pagination bounds');return n;};
const compare=(a,b)=>(b.createdAt||0)-(a.createdAt||0)||b.id.localeCompare(a.id);
export function physicalPage(plane,owner,query={},principal='owner'){
 if(!owner)throw fault('Company scope required',403);
 const resource=query.resource||'devices';if(!['devices','operations','hubs'].includes(resource))throw fault('Unsupported physical resource');
 const page=integer(query.page,1,1000000),pageSize=integer(query.pageSize,20,100),site=String(query.siteId||''),hubId=String(query.hubId||''),search=String(query.q||'').trim().toLowerCase();
 if(search.length>100||site.length>96||hubId.length>96)throw fault('Filter too long');
 plane.expire();
 const admin=principal==='owner';
 const ownedEntities=Object.values(plane.state.entities).filter(e=>e.owner===owner&&plane.authorized(e,principal));
 const entityById=new Map(ownedEntities.map(e=>[e.id,e])),allowedHubs=new Set(ownedEntities.map(e=>e.hubId));
 const hubs=Object.values(plane.state.hubs).filter(h=>h.owner===owner&&(admin||allowedHubs.has(h.id)));
 const hubById=new Map(hubs.map(h=>[h.id,h]));if(hubId&&!hubById.has(hubId))throw fault('Hub not found',404);
 const counts=new Map();for(const e of ownedEntities)counts.set(e.hubId,(counts.get(e.hubId)||0)+1);
 const hubView=h=>({id:h.id,name:h.name,siteId:h.siteId,revoked:h.revoked,online:plane.connections.has(h.id),registeredCount:counts.get(h.id)||0,candidateCount:admin?h.candidates.length:0});
 const atLocation=e=>(!site||e.siteId===site)&&(!hubId||e.hubId===hubId);
 const matches=(...values)=>!search||values.some(v=>String(v||'').toLowerCase().includes(search));
 let rows;
 if(resource==='devices')rows=ownedEntities.filter(e=>atLocation(e)&&matches(e.description.title,e.deviceId,e.id)).sort(compare);
 else if(resource==='hubs')rows=hubs.filter(h=>(!site||h.siteId===site)&&(!hubId||h.id===hubId)&&matches(h.name,h.siteId,h.id)).sort(compare);
 else rows=Object.values(plane.state.operations).filter(o=>{const e=entityById.get(o.entityId);return o.owner===owner&&e&&atLocation(e)&&matches(e.description.title,o.action,o.status,o.id);}).sort(compare);
 const total=rows.length,totalPages=Math.max(1,Math.ceil(total/pageSize)),currentPage=Math.min(page,totalPages);rows=rows.slice((currentPage-1)*pageSize,currentPage*pageSize);
 const summarizeEntity=e=>{const {entitlements,...publicEntity}=e;return {...publicEntity,...(admin?{entitlements}:{}),readiness:plane.deviceReadiness(e),actions:Object.fromEntries(Object.entries(e.actions).map(([a,m])=>[a,plane.authorized(e,principal,a)?m:'prohibited'])),observations:Object.fromEntries(Object.entries(e.observations).map(([k,v])=>[k,{...v,stale:plane.now()-v.at>60000,ageMs:Math.max(0,plane.now()-v.at)}]))};};
 const selectedEntities=resource==='devices'?rows:resource==='operations'?[...new Set(rows.map(o=>o.entityId))].map(id=>entityById.get(id)):[];
 const selectedHubs=new Set(resource==='hubs'?rows.map(h=>h.id):selectedEntities.map(e=>e.hubId));if(hubId)selectedHubs.add(hubId);
 const eligibleHubs=hubs.filter(h=>!site||h.siteId===site).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 const options=eligibleHubs.slice(0,200);for(const id of selectedHubs)if(!options.some(h=>h.id===id)&&hubById.has(id))options.push(hubById.get(id));
 const allSites=[...new Set(hubs.map(h=>h.siteId))].sort(),sites=allSites.slice(0,200);if(site&&!sites.includes(site)&&allSites.includes(site))sites.push(site);
 return {resource,page:currentPage,pageSize,total,totalPages,summary:{sites:allSites.length,hubs:hubs.length,entities:ownedEntities.length},sites,locationsLimited:allSites.length>200||eligibleHubs.length>200,hubs:options.map(hubView),hubRows:resource==='hubs'?rows.map(hubView):[],entities:selectedEntities.map(summarizeEntity),operations:resource==='operations'?rows:[]};
}

export function physicalOnboardingPage(plane,owner,query={},principal='owner'){
 const pageSize=integer(query.pageSize,5,20),base={page:query.page,pageSize,siteId:query.siteId,hubId:query.hubId,q:query.q};
 const devices=physicalPage(plane,owner,{...base,resource:'devices'},principal),operations=physicalPage(plane,owner,{...base,resource:'operations'},principal),hubs=physicalPage(plane,owner,{...base,resource:'hubs'},principal);
 return {hubs:(Number(query.page||1)<=hubs.totalPages?hubs.hubRows:[]).map(h=>({...h,candidates:principal==='owner'?plane.state.hubs[h.id].candidates:[]})),entities:Number(query.page||1)<=devices.totalPages?devices.entities:[],operations:Number(query.page||1)<=operations.totalPages?operations.operations:[],audit:principal==='owner'?plane.state.audit.filter(a=>a.owner===owner).slice(-20):[],pagination:{page:Math.max(devices.page,operations.page,hubs.page),pageSize,totalPages:Math.max(devices.totalPages,operations.totalPages,hubs.totalPages),totals:{hubs:hubs.total,entities:devices.total,operations:operations.total}}};
}
