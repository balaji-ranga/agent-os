import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {visibleContentTools} from '../../openclaw-extensions/agent-os-content-tools/runtime-access.js';
const dist='/usr/local/lib/node_modules/openclaw/dist/';
const file=readdirSync(dist).find(n=>/^local-model-lean-.*\.js$/.test(n));
assert.ok(file,'Installed native Tool Search runtime required');
const {c:compact,l:createControls,x:createRef}=await import(dist+file);
const config={tools:{toolSearch:{enabled:true,mode:'tools'}}};
const names=Array.from({length:174},(_,i)=>`fixture_capability_${i}`);
const descriptors=names.map(name=>({name}));
const allowed=visibleContentTools('fixture','ordinary',descriptors,{fixture:names},{},{},Date.now(),config);
let calls=0;
const catalogRef=createRef();
const controls=createControls({config,catalogRef});
const fixtures=[...allowed].map(name=>({name,label:name,description:`Read fixture capability ${name}`,parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},execute:async(_id,args)=>{calls++;return {content:[{type:'text',text:args.value}]};}}));
const result=compact({config,catalogRef,tools:[...controls,...fixtures]});
assert.equal(result.catalogToolCount,174);
assert.deepEqual(result.tools.map(t=>t.name).sort(),['tool_call','tool_describe','tool_search']);
assert.ok(result.tools.length<128);
const search=result.tools.find(t=>t.name==='tool_search');
const found=await search.execute('search',{query:names.at(-1)});
assert.ok(JSON.stringify(found).includes(names.at(-1)));
const describe=result.tools.find(t=>t.name==='tool_describe');
assert.ok(JSON.stringify(await describe.execute('describe',{id:names.at(-1)})).includes('value'));
const call=result.tools.find(t=>t.name==='tool_call');
assert.ok(JSON.stringify(await call.execute('call',{id:names.at(-1),args:{value:'tail-reachable'}})).includes('tail-reachable'));
assert.equal(calls,1);
await assert.rejects(()=>call.execute('denied',{id:'ungranted_device_control',args:{}}));
assert.equal(calls,1);
await assert.rejects(()=>call.execute('invalid',{id:names.at(-1),args:{}}));
assert.equal(calls,1);
console.log('NATIVE_TOOL_SEARCH_INSTALLED_OK: 174 catalog tools / 3 visible schemas; tail search/describe/call; unknown tool and invalid input blocked');

// Registered platform capabilities must be discoverable outside connector catalogs.
const {voiceInviteSchema}=await import('../../openclaw-extensions/agent-os-content-tools/voice-invite-schema.js');
const platformRef=createRef();let invitations=0;
const platform=compact({config,catalogRef:platformRef,tools:[...createControls({config,catalogRef:platformRef}),...fixtures,{name:'voice_call_invite',label:'Create Voice Call Invitation',description:'Create a short-lived owner-bound browser Voice call link. Defaults to the calling agent.',parameters:voiceInviteSchema,execute:async()=>{invitations++;return {content:[{type:'text',text:'fixture invitation generated'}]};}}]});
const discovery=await platform.tools.find(t=>t.name==='tool_search').execute('find-platform',{query:'generate a voice call link'});
assert.match(JSON.stringify(discovery),/voice_call_invite/);
const invitationCall=platform.tools.find(t=>t.name==='tool_call');
assert.match(JSON.stringify(await invitationCall.execute('invite-self',{id:'voice_call_invite',args:{}})),/fixture invitation generated/);
await assert.rejects(()=>invitationCall.execute('bad-expiry',{id:'voice_call_invite',args:{ttl_seconds:99999}}));
await assert.rejects(()=>invitationCall.execute('guessed-action',{id:'voice.call.link',args:{}}));
assert.equal(invitations,1,'invalid or invented calls do not execute');
console.log('PLATFORM_INVITE_SEARCH_OK: crowded native catalog; platform discovery; default-self schema; invalid lifetime and invented action rejected');

// Exercise the installed native hook runner, not just a mock api.on callback.
const hookFile=readdirSync(dist).find(n=>/^hook-runner-global-.*\.js$/.test(n)&&/initializeGlobalHookRunner as \w+/.test(readFileSync(dist+n,'utf8')));
assert(hookFile,'Installed native hook runner required');
const hookModule=await import(dist+hookFile),hookSource=readFileSync(dist+hookFile,'utf8');
const symbol=name=>hookModule[hookSource.match(new RegExp(name+' as (\\w+)'))?.[1]];
const initializeHooks=symbol('initializeGlobalHookRunner'),getHooks=symbol('getGlobalHookRunner'),resetHooks=symbol('resetGlobalHookRunner');
assert.equal(typeof initializeHooks,'function');assert.equal(typeof getHooks,'function');assert.equal(typeof resetHooks,'function');
let shaped=0,executed=0,retainedAuthority;
try{
 initializeHooks({hooks:[],typedHooks:[
  {pluginId:'fixture-action-phases',hookName:'before_prompt_build',handler:async()=>{shaped++;return {systemPrompt:'compact fixture staging',toolsAllow:['fixture_export']};}},
  {pluginId:'fixture-action-phases',hookName:'before_prompt_build',requiresToolAuthority:true,handler:async(_event,ctx)=>{retainedAuthority=ctx.toolAuthority;ctx.toolAuthority.assertActive();assert(ctx.toolAuthority.allows('fixture_export'));assert.equal(ctx.toolAuthority.allows('ungranted_action'),false);executed++;return {systemPrompt:'must not override after authority',toolsAllow:[],appendContext:'verified fixture receipt'};}}
 ]});
 const runner=getHooks(),context={agentId:'fixture',sessionKey:'agent:fixture:test'};
 const ordinary=await runner.runBeforePromptBuild({prompt:'fixture',messages:[]},context);
 assert.equal(shaped,1);assert.equal(executed,0);assert.equal(ordinary.systemPrompt,'compact fixture staging');assert.deepEqual(ordinary.toolsAllow,['fixture_export']);
 const authorized=await runner.runAuthorizedPromptBuild({prompt:'fixture',messages:[]},context,{toolAuthorityFingerprint:'fixture-authority',activeToolNames:['fixture_export'],assertHostActive(){}});
 assert.equal(executed,1);assert.equal(authorized.systemPrompt,undefined);assert.equal(authorized.toolsAllow,undefined);assert.equal(authorized.appendContext,'verified fixture receipt');
 assert.throws(()=>retainedAuthority.assertActive(),/no longer active/);
 console.log('NATIVE_ACTION_PHASES_INSTALLED_OK: ordinary shaping cannot dispatch; finalized authority gates execution; authority expires; authorized hooks cannot alter tool surface');
}finally{resetHooks();}
