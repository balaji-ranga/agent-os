// Private test process only. Never imported by the runtime or exposed as an API.
import {readFile} from 'node:fs/promises';
import {openRepository} from '../../src/repository.mjs';
import {SessionAuthority} from '../../src/session-authority.mjs';
import {createHostIdentity} from '../../src/host-identity.mjs';
import {createProposalStore} from '../../src/proposals.mjs';
import {createControlPlane} from '../../src/control-plane.mjs';
import {createKnowledgeService} from '../../src/knowledge-service.mjs';
import {createSourceIngestion} from '../../src/source-ingestion.mjs';
import {createBlobStore} from '../../src/blob-store.mjs';
import {createManagement} from '../../src/management.mjs';
import {createOperationalTelemetry} from '../../src/operational-telemetry.mjs';
import {createAdoptionServer} from '../../src/server.mjs';
import {createOwnerIdentity} from '../../src/owner-identity.mjs';
const [dbPath,blobRoot]=process.argv.slice(2),repository=openRepository(dbPath),state=repository.map('test_state'),clock=()=>state.get('clock')?.now||1_000_000,origin='http://127.0.0.1:4194',events=[],faults={},gates=new Map(),counts={extract:0,plan:0};
const gate=async kind=>{if(!gates.has(kind))return;const g=gates.get(kind);process.send({held:kind});await g.promise;};
const hostIdentity=createHostIdentity(repository,{clock}),authority=new SessionAuthority({repository,clock,development:true,hostIdentity});
const search={provision:async()=>({acknowledged:true}),index:async(embeddingId,chunks)=>{await gate('index');if(faults.index)throw new Error('Search operation failed');for(const c of chunks)repository.map('test_search').set(c.chunk_id,c);},remove:async(embeddingId,id)=>{if(faults.remove)throw new Error('Search operation failed');for(const [key,c] of repository.map('test_search').entries())if(c.embedding_id===embeddingId&&c.source_id===id)repository.map('test_search').delete(key);},search:async scope=>{await gate('search');if(faults.search)throw new Error('Search operation failed');return {hits:{hits:repository.map('test_search').values().filter(c=>c.embedding_id===scope.embeddingId).map(c=>({_source:c}))}};}};
const knowledge=createKnowledgeService(repository,search,{clock,leaseMs:1000}),realBlobs=createBlobStore(blobRoot),blobs={...realBlobs,put:async(...args)=>{if(faults.storage)throw Object.assign(new Error('PRIVATE_STORAGE_PATH'),{code:'ENOSPC'});const result=await realBlobs.put(...args);await gate('storage');return result;}};
const telemetry=createOperationalTelemetry({emit:e=>events.push(e)}),ingestion=createSourceIngestion(repository,{knowledge,blobs,clock,onEvent:telemetry.job,extract:async({path})=>{counts.extract++;await gate('extract');if(faults.extract)throw new Error('PRIVATE_PARSER_DIAGNOSTIC');return {sections:[{locator:'Document',text:await readFile(path,'utf8')}]};}});
const owner={id:'fixture-owner',organizationId:'fixture-owner',role:'owner'},admin={id:'fixture-admin',organizationId:'fixture-admin',role:'platform_admin'},control=createControlPlane(repository,authority,{clock,dns:async name=>[[state.get(name)?.value||'']]});
const management=createManagement({control,knowledge,search,ingestion,platformOrigin:origin,authenticate:async authorization=>{if(faults.identity)throw new Error('Management identity unavailable');if(authorization==='Bearer fixture-owner')return owner;if(authorization==='Bearer fixture-admin')return admin;throw new Error('Management authentication required');}});
let ownerCode;const ownerIdentity=createOwnerIdentity(repository,{clock,send:async message=>{ownerCode=message.text.match(/code is (\d{6})/)[1];}}),ownerManagement=createManagement({control,knowledge,search,ingestion,platformOrigin:origin,authenticate:async cookie=>ownerIdentity.authenticate(cookie)});
const server=createAdoptionServer({authority,hostIdentity,knowledge,ingestion,management,ownerIdentity,ownerManagement,platformOrigin:origin,telemetry,development:true,proposals:createProposalStore(repository,{clock}),planner:async()=>{counts.plan++;await gate('plan');if(faults.model)throw new Error('Platform model unavailable');return {message:'Review',actions:[{type:'fill',ref:'r1f0',value:'SYNTHETIC_VALUE'}]};},answer:async({evidence})=>{await gate('answer');return {kind:'answer',message:'Synthetic supported answer.',citations:evidence.slice(0,1)};}});
server.listen(0,'127.0.0.1',()=>process.send({ready:true,base:'http://127.0.0.1:'+server.address().port}));
process.on('message',async({rpc,method,args=[]})=>{try{
 let result;
 if(method==='install')result=authority.registerApproved({embeddingId:args[0],origins:[origin],expiresAt:clock()+3_600_000,visitorUploads:true});
 else if(method==='policy')result=hostIdentity.configure({embeddingId:args[0],origin,role:'maintainer'},{required:true,issuer:origin,publicKeys:[args[1]],roles:['tester']});
 else if(method==='clock')state.set('clock',{now:args[0]});
 else if(method==='dns')state.set(args[0],{value:args[1]});
 else if(method==='arm'){let release;const promise=new Promise(r=>release=r);gates.set(args[0],{promise,release});}
 else if(method==='release'){gates.get(args[0])?.release();gates.delete(args[0]);}
 else if(method==='fault')faults[args[0]]=args[1];
 else if(method==='revoke')authority.revokeSession(args[0],args[1]);
 else if(method==='revoke-install')authority.revokeInstallation(args[0]);
 else if(method==='maintain')result=authority.maintain();
 else if(method==='drain')await ingestion.drain();
 else if(method==='recover')ingestion.start();
 else if(method==='retry')result=ingestion.retry(args[0],args[1]);
 else if(method==='remove')result=await ingestion.remove(args[0],args[1]);
 else if(method==='rawExists'){try{await realBlobs.read(args[0],args[1]);result=true;}catch(e){if(e.code!=='ENOENT')throw e;result=false;}}
 else if(method==='rows')result=repository.map(args[0]).values();
 else if(method==='counts')result=counts;
 else if(method==='owner-code')result=ownerCode;
 else if(method==='events')result=events;
 else if(method==='close-db')repository.close();
 else if(method==='quit'){ingestion.stop();server.closeAllConnections();await new Promise(r=>server.close(r));try{repository.close();}catch{}process.send({rpc,result:true});process.exit(0);}
 else throw new Error('Unknown fixture command');
 process.send({rpc,result:result??null});
 }catch(e){process.send({rpc,error:e.message});}});
