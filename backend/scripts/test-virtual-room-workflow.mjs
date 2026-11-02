import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {executeTimeWindow} from '../src/services/workflow-time-window.js';
import {virtualRoomWorkflow} from '../src/services/physical/virtual-room-workflow.js';
import {roomCameraSnapshot} from '../../physical-edge/src/room-camera.js';
import {executePhysicalWorkflowTask} from '../src/services/physical/workflow-task.js';
import {profile} from '../src/services/physical/contracts.js';
const graph=virtualRoomWorkflow({cameraId:'camera',tvId:'tv'}),assets={camera:{description:profile('camera','camera')},tv:{description:profile('tv','tv')}};
const plane={owned(collection,owner,id){if(owner!=='owner'||!assets[id])throw Error('Not found');return assets[id];}};
const cfg=graph.nodes.find(n=>n.id==='clock').data.taskConfig;
const clock=(at)=>executeTimeWindow({at},cfg,{graph,owner:'owner',plane});
for(const [time,expected]of [['12:59:59',false],['13:00:00',true],['17:59:59',true],['18:00:00',false]])assert.equal(clock('2026-11-02T'+time+'+08:00').in_window,expected);
assert.equal(executeTimeWindow({},cfg,{now:Date.parse('2026-11-02T05:00:00Z')}).in_window,true);
assert.equal(executeTimeWindow({},cfg).simulated_clock,false);
assert.throws(()=>clock('tomorrow'));assets.tv.description.flolah.simulated=false;assert.throws(()=>clock('2026-11-02T14:00:00+08:00'),/simulated/);assets.tv.description.flolah.simulated=true;
assert.throws(()=>executeTimeWindow({at:'2026-11-02T14:00:00+08:00'},{...cfg,allowSimulationClock:false},{graph,owner:'owner',plane}),/not enabled/);
assert.throws(()=>clock.call(null,'2026-11-02T14:00:00'),/ISO/);
const unsafe=structuredClone(graph);unsafe.nodes.find(n=>n.id==='power-off').data.inputBindings=[{id:'entity_id'}];assert.throws(()=>executeTimeWindow({at:'2026-11-02T14:00:00+08:00'},cfg,{graph:unsafe,owner:'owner',plane}),/fixed/);
await assert.rejects(()=>executePhysicalWorkflowTask({}, {entityId:'tv',requireSimulated:true},{},{ownerUserId:'owner',runId:'1',nodeId:'test',plane:{assertResource(){return {description:{flolah:{simulated:false}}};}}}),/simulated/);
for(const state of ['on','off','unknown']){const png=Buffer.from(roomCameraSnapshot({on:state==='on',ambiguous:state==='unknown'}).data,'base64');assert.equal(png.readUInt32BE(16),640);assert.equal(png.readUInt32BE(20),360);assert.ok(png.length<40000);assert.ok(!png.includes(Buffer.from('tEXt')));}
// Full runner: isolated DB, actual image-analysis HTTP adapter with an explicitly mocked vision API.
const dir=mkdtempSync(join(tmpdir(),'virtual-room-runner-'));process.env.AGENT_OS_DATA_DIR=dir;process.env.OPENCLAW_DIR=join(dir,'openclaw');process.env.FLOLAH_PHYSICAL_ENABLED='1';
const {createServer}=await import('node:http');let answer={tv_state:'on',confidence:0.98,reason:'Visible illuminated picture on television'},visionCalls=0;
const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const request=JSON.parse(body);assert.match(JSON.stringify(request),/data:image\/png;base64,/);visionCalls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:typeof answer==='string'?answer:JSON.stringify(answer)}}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
process.env.TOOLS_VISION_BASE_URL='http://127.0.0.1:'+server.address().port+'/v1';process.env.TOOLS_VISION_API_KEY='isolated-test-only';process.env.TOOLS_VISION_MODEL='fixture-vision';
const {getDb}=await import('../src/db/schema.js');const db=getDb();const {createDefinition,publishDefinition,getRun}=await import('../src/services/agent-workflow-store.js');const {startAgentWorkflowRun}=await import('../src/services/agent-workflow-runner.js');const {getPhysicalControlPlane}=await import('../src/services/physical/runtime.js');const actor={id:'fixture-owner',name:'Fixture',type:'user'};db.prepare("INSERT INTO platform_users(id,email,password_hash,name,role) VALUES(?,?,'no-login',?,'ceo')").run(actor.id,'virtual@invalid.test',actor.name);
const control=getPhysicalControlPlane(),hub=control.enroll(actor.id,{siteId:'fixture',name:'Fixture'});control.discover(hub.hubId,[profile('cam','camera'),profile('screen','tv')]);control.state.hubs[hub.hubId].candidates.find(c=>c.id==='screen').flolah.evidence={visual:true,kind:'simulator_snapshot'};const camera=control.register(actor.id,{hubId:hub.hubId,candidateId:'cam',actions:{capture:'approval_required'}}),tv=control.register(actor.id,{hubId:hub.hubId,candidateId:'screen',actions:{set_power:'approval_required'}});
let tvOn=true,offCommands=0;control.connect(hub.hubId,{send(raw){const m=JSON.parse(raw);if(m.type!=='command')return;const c=m.command;setTimeout(()=>{if(c.entityId==='screen'){tvOn=c.input.on;offCommands++;}control.event(hub.hubId,{type:'observation',entityId:c.entityId,operationId:c.id,property:c.entityId==='cam'?'captured':'on',value:c.entityId==='cam'?true:tvOn,at:Date.now(),attachments:[roomCameraSnapshot({on:tvOn})]});},10);},close(){}});
const def=createDefinition({name:'Virtual room fixture',ownerUserId:actor.id,actor,graph:virtualRoomWorkflow({cameraId:camera.id,tvId:tv.id}),trigger_modes:['manual']});publishDefinition(def.id,actor.id,actor);
async function run(at){const run=await startAgentWorkflowRun(def.id,actor.id,{actor,input:JSON.stringify({simulation_time:at})});for(let i=0;i<400;i++){for(const op of Object.values(control.state.operations))if(op.status==='awaiting_approval')control.approve(actor.id,op.id,'fixture-human');if(getRun(run.id,actor.id).status!=='running')return getRun(run.id,actor.id);await new Promise(r=>setTimeout(r,20));}throw Error('Run timeout');}
try {
 let r=await run('2026-11-02T14:00:00+08:00');assert.equal(r.status,'completed',JSON.stringify(r));assert.equal(tvOn,false);assert.equal(offCommands,1);
 const {executeAnalyzeImageTask}=await import('../src/services/image-vision-tools.js');const captureOp=control.state.operations[r.context.node_outputs.capture.operation_id],ref='physical-evidence:'+captureOp.id+':0';
 await assert.rejects(()=>executeAnalyzeImageTask({image:ref},{},{owner_user_id:'other',actor:{id:'other'}}),/Not found/);
 await assert.rejects(()=>executeAnalyzeImageTask({image:ref},{},{owner_user_id:actor.id,actor:{id:'unentitled-member'}}),/access denied/);
 const attachment=captureOp.evidence.attachments[0],at=attachment.at;attachment.at=Date.now()-61000;
 await assert.rejects(()=>executeAnalyzeImageTask({image:ref},{},{owner_user_id:actor.id,actor}),/Fresh completed/);attachment.at=at;
 captureOp.evidence.attachments=[];await assert.rejects(()=>executeAnalyzeImageTask({image:ref},{},{owner_user_id:actor.id,actor}),/Fresh completed/);captureOp.evidence.attachments=[attachment];

 tvOn=true;r=await run('2026-11-02T18:00:00+08:00');assert.equal(r.status,'completed');assert.equal(tvOn,true);assert.equal(offCommands,1);
 answer={tv_state:'off',confidence:0.98,reason:'Dark screen'};r=await run('2026-11-02T14:00:00+08:00');assert.equal(r.status,'completed');assert.equal(offCommands,1);
 answer={tv_state:'unknown',confidence:0.3,reason:'Obscured screen'};r=await run('2026-11-02T14:00:00+08:00');assert.equal(r.status,'completed');assert.equal(offCommands,1);
 answer={tv_state:'on',confidence:0.4,reason:'Unclear screen'};r=await run('2026-11-02T14:00:00+08:00');assert.equal(r.status,'completed');assert.equal(offCommands,1);
 answer='invalid';r=await run('2026-11-02T14:00:00+08:00');assert.equal(r.status,'failed');assert.equal(offCommands,1);
 assert.equal(visionCalls,7);console.log('VIRTUAL_ROOM_WORKFLOW_PASS: runner + image HTTP adapter (mocked model), approval, image evidence, on/off/unknown/low-confidence/malformed, SGT boundaries, simulation-only controls.');
}finally{server.close();db.close();rmSync(dir,{recursive:true,force:true});}process.exit(0);

