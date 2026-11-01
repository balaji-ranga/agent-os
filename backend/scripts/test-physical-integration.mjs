import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import express from 'express';
import Database from 'better-sqlite3';
const dir=mkdtempSync(join(tmpdir(),'flolah-physical-api-'));process.env.AGENT_OS_DATA_DIR=dir;process.env.OPENCLAW_DIR=join(dir,'openclaw');
const [{physicalRouter},{PhysicalControlPlane,sqliteStore},{profile},{requireAuth,requireTenantFullAccess,resolveAuthenticatedCeoUserId}]=await Promise.all([
  import('../src/routes/physical.js'),import('../src/services/physical/control-plane.js'),import('../src/services/physical/contracts.js'),import('../src/middleware/auth.js')]);
const db=new Database(join(dir,'physical.db'));const plane=new PhysicalControlPlane(sqliteStore(db));
const app=express();app.use(express.json());
// Only authentication decoding is a fixture. Real route authorization and owner resolution run unchanged.
app.use((req,res,next)=>{const token=String(req.headers.authorization||'');if(token==='Bearer a')req.authUser={id:'tenant-a',role:'ceo'};if(token==='Bearer b')req.authUser={id:'tenant-b',role:'ceo'};if(token==='Bearer member')req.authUser={id:'employee',role:'org_user',company_role:'member'};next();});
app.use('/api/physical',physicalRouter({plane,auth:[requireAuth,requireTenantFullAccess],owner:resolveAuthenticatedCeoUserId}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const url='http://127.0.0.1:'+server.address().port+'/api/physical';
async function request(path,method='GET',body,token='a'){const res=await fetch(url+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()};}
try{
  assert.equal((await request('','GET',null,'unknown')).status,401);
  assert.equal((await request('','GET',null,'member')).status,403);
  const catalog=await request('/packages');assert.equal(catalog.status,200);
  if(catalog.data.packages.length){
    assert.ok(catalog.data.packages.every(p=>p.platform==='desktop'),'Phase 1 excludes APK downloads');
    const pkg=catalog.data.packages[0],download=await fetch(url+'/packages/'+pkg.file,{headers:{Authorization:'Bearer a'}});assert.equal(download.status,200);const bytes=Buffer.from(await download.arrayBuffer());assert.equal(bytes.subarray(0,2).toString(),'PK');const {createHash}=await import('node:crypto');assert.equal(createHash('sha256').update(bytes).digest('hex'),pkg.sha256);
  }
  assert.equal((await request('/packages','GET',null,'unknown')).status,401);
  assert.equal((await request('/packages/missing.zip')).status,404);
  const enrolled=await request('/hubs','POST',{siteId:'site-a',name:'Test laptop'});assert.equal(enrolled.status,200);
  const h=enrolled.data;plane.discover(h.hubId,[profile('lamp')]);
  assert.equal((await request('/hubs/'+h.hubId+'/rotate','POST',{},'b')).status,404);
  assert.equal((await request('/entities','POST',{hubId:h.hubId,candidateId:'lamp',actions:{set_state:'autonomous'}},'b')).status,404);
  const entity=(await request('/entities','POST',{hubId:h.hubId,candidateId:'lamp',actions:{set_state:'approval_required'}})).data;
  const o=(await request('/operations','POST',{entityId:entity.id,action:'set_state',input:{on:true},idempotencyKey:randomUUID()})).data;
  assert.equal(o.status,'awaiting_approval');
  assert.equal((await request('/operations/'+o.id+'/approve','POST',{allow:true},'b')).status,404);
  assert.equal((await request('/operations/'+o.id+'/approve','POST',{allow:'false'})).status,400);
  assert.equal((await request('/operations/'+o.id+'/approve','POST',{allow:false})).data.status,'denied');
  assert.equal((await request('/entities/'+entity.id+'/properties/on','GET',null,'b')).status,404);
  assert.ok(!(await request('')).data.hubs[0].tokenHash);
  const reopened=new PhysicalControlPlane(sqliteStore(db));assert.equal(reopened.owned('operations','tenant-a',o.id).status,'denied');
  const reviewed=(await request('/entities/'+entity.id+'/revalidate','POST',{})).data;assert.equal(reviewed.enabled,false);assert.deepEqual(reviewed.actions,{});
  const rotated=(await request('/hubs/'+h.hubId+'/rotate','POST',{})).data;assert.throws(()=>plane.authenticate(h.hubId,h.token),{status:401});assert.equal(plane.authenticate(h.hubId,rotated.token).owner,'tenant-a');
  const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');assert.match(source,/if \(process\.env\.FLOLAH_PHYSICAL_ENABLED === '1'\)/);
  const agentRoutes=readFileSync(new URL('../src/routes/physical-tools.js',import.meta.url),'utf8');assert.ok(!agentRoutes.includes("'/physical-approve'"));
  console.log('PHYSICAL_API_INTEGRATION_PASS: production authorization, owner isolation, SQLite persistence, credential rotation, strict approval input, feature gate, no agent self-approval.');
}finally{await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});}
