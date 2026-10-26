// Operator maintenance: prove the exact configured route works before clearing
// its billing cooldown. Credentials and response bodies never leave this process.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,realpathSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const [agent,provider,model]=process.argv.slice(2);
assert(agent&&/^[a-zA-Z0-9_.-]+$/.test(agent),'An exact agent ID is required');
assert(provider&&model,'Provider and registered model ID are required');
const configPath=process.env.OPENCLAW_CONFIG_PATH;
assert(configPath,'OPENCLAW_CONFIG_PATH must identify the runtime config');
const config=JSON.parse(readFileSync(configPath,'utf8'));
const route=config.models?.providers?.[provider];
assert(route&&route.api==='openai-completions'&&route.models?.some(m=>m.id===model),'Unsupported or unregistered model route');
const root=dirname(configPath),agentDir=join(root,'agents',agent,'agent');
assert.equal(realpathSync(agentDir),resolve(agentDir),'Symlinked agent directory rejected');
const dist=process.env.OPENCLAW_DIST_DIR||'/usr/local/lib/node_modules/openclaw/dist';
const usageFiles=readdirSync(dist).filter(n=>/^usage-[\w-]+\.js$/.test(n)&&readFileSync(join(dist,n),'utf8').includes('function clearAuthProfileCooldown('));
assert.equal(usageFiles.length,1,'Unsupported installed cooldown API layout');
const usageSource=readFileSync(join(dist,usageFiles[0]),'utf8');
const storeFile=usageSource.match(/from ["']\.\/(store-[\w-]+\.js)["']/)?.[1];
assert(storeFile,'Canonical auth-store dependency missing');
const stores=await import(pathToFileURL(join(dist,storeFile)).href);
const usage=await import(pathToFileURL(join(dist,usageFiles[0])).href);
const fn=(m,name)=>{const f=Object.values(m).find(v=>typeof v==='function'&&v.name===name);assert(f,`Missing canonical API: ${name}`);return f;};
const store=await fn(stores,'ensureAuthProfileStoreForLocalUpdate')(agentDir);
const profileId=provider+':default',profile=store.profiles?.[profileId];
assert(profile?.provider===provider&&profile.type==='api_key'&&profile.key===route.apiKey,'Exact provider credential match required');
assert(store.usageStats?.[profileId]?.disabledReason==='billing','Only a billing cooldown may be recovered');
const response=await fetch(route.baseUrl.replace(/\/$/,'')+'/chat/completions',{
 method:'POST',headers:{Authorization:'Bearer '+profile.key,'content-type':'application/json'},
 body:JSON.stringify({model,messages:[{role:'user',content:'Reply OK.'}],max_tokens:16}),signal:AbortSignal.timeout(45000)
});
const data=await response.json().catch(()=>null);
assert(response.ok&&data?.choices?.[0]?.message?.content,'Model probe failed; cooldown retained');
await fn(usage,'clearAuthProfileCooldown')({store,profileId,agentDir});
const verified=await fn(stores,'ensureAuthProfileStoreForLocalUpdate')(agentDir);
assert(!verified.usageStats?.[profileId]?.disabledUntil,'Cooldown recovery did not persist');
console.log(JSON.stringify({ok:true,provider,model,probeSucceeded:true,cooldownCleared:true,credentialsChanged:false}));
