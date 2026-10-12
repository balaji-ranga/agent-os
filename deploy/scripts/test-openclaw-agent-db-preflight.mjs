import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,statSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from '../../backend/node_modules/better-sqlite3/lib/index.js';
import {preflight,loadCanonicalApi} from './openclaw-agent-db-preflight.mjs';
const root=mkdtempSync(join(tmpdir(),'flolah-gateway-preflight-'));process.env.OPENCLAW_DIR=root;
const {upsertAgentByokAuthProfile,clearAgentByokAuthProfile}=await import('../../backend/src/services/openclaw-byok-auth.js');
let checks=0;const check=(condition,message)=>{assert(condition,message);checks++;};
// Local harness uses a minimal test-only adapter; VPS --native uses the installed full schema.
let api=process.argv.includes('--native')?await loadCanonicalApi():{
 open:path=>new Database(path),clear:()=>{},
 initialize:(db,{agentId})=>{db.exec('CREATE TABLE schema_meta(meta_key TEXT PRIMARY KEY,role TEXT,schema_version INTEGER,agent_id TEXT); PRAGMA user_version=19');db.prepare('INSERT INTO schema_meta VALUES (?,?,?,?)').run('primary','agent',19,agentId);},
 verify:(db,{agentId})=>assert.equal(db.prepare("SELECT agent_id FROM schema_meta WHERE meta_key='primary'").get().agent_id,agentId),
};
const args={openclawDir:root,api,hasGatewayProcess:()=>false};
const path=id=>join(root,'agents',id,'agent','openclaw-agent.sqlite');
const read=id=>{const db=new Database(path(id),{readonly:true});try{return {version:db.pragma('user_version',{simple:true}),rows:db.prepare('SELECT store_json FROM auth_profile_store').all(),meta:db.prepare("SELECT agent_id FROM schema_meta WHERE meta_key='primary'").get().agent_id};}finally{db.close();}};
const id='t-qa-preflight--coo',provider='byok-qa-preflight';
upsertAgentByokAuthProfile(id,provider,'TEST-PRIMARY-KEY');
const initial=await preflight(args);check(initial.repaired===1,'First auth-only initialization');
const primary=read(id);check(primary.version===19&&primary.meta===id,'Canonical owner/version');check(primary.rows[0].store_json.includes('TEST-PRIMARY-KEY'),'Primary credentials preserved');
check((await preflight(args)).repaired===0,'Restart is idempotent');
upsertAgentByokAuthProfile(id,provider+'-secondary','TEST-SECONDARY-KEY');
check((await preflight(args)).repaired===0,'Secondary switch keeps schema');
check(read(id).rows[0].store_json.includes('TEST-SECONDARY-KEY'),'Secondary credential present');
clearAgentByokAuthProfile(id,provider+'-secondary');check((await preflight(args)).repaired===0,'Switchback keeps schema');check(read(id).rows[0].store_json.includes('TEST-PRIMARY-KEY'),'Primary retained after switchback');
await assert.rejects(preflight({...args,hasGatewayProcess:()=>true}),/Gateway process/);checks++;
const unsafe='t-qa-preflight--unknown';mkdirSync(join(root,'agents',unsafe,'agent'),{recursive:true});
let db=new Database(path(unsafe));db.exec('CREATE TABLE unrelated(x TEXT)');db.close();
check((await preflight(args)).unsupported===1,'Unknown schema not modified');
db=new Database(path(unsafe),{readonly:true});check(db.pragma('user_version',{simple:true})===0,'Unknown schema remains version zero');db.close();
const failing='t-qa-preflight--failing';upsertAgentByokAuthProfile(failing,provider,'TEST-PRESERVE-KEY');
await assert.rejects(preflight({...args,api:{...api,initialize:()=>{throw new Error('initializer unavailable');}}}),/initializer unavailable/);checks++;
db=new Database(path(failing),{readonly:true});check(db.prepare('SELECT store_json FROM auth_profile_store').get().store_json.includes('TEST-PRESERVE-KEY'),'Failure preserves auth');db.close();
check((await preflight(args)).repaired===1,'Failure can retry');
const backups=join(root,'.flolah-maintenance-backups');check(readdirSync(backups).length===3,'Backups retained before every repair attempt');
if(process.platform!=='win32'){
 check((statSync(backups).mode&0o777)===0o700,'Private backup directory');check(readdirSync(backups).every(name=>(statSync(join(backups,name)).mode&0o777)===0o600),'Private backup files');
 const linked='t-qa-preflight--link';mkdirSync(join(root,'agents',linked,'agent'),{recursive:true});symlinkSync(path(id),path(linked));await assert.rejects(preflight(args),/Symlinked/);checks++;
}
const entrypoint=readFileSync(new URL('../docker/openclaw-entrypoint.sh',import.meta.url),'utf8');
check(entrypoint.includes('sha256sum "${marker}"'),'Same-second switches use content revision');
const branch=entrypoint.slice(entrypoint.indexOf('if [[ "${now}" != "0"'));
check(branch.indexOf('kill_openclaw_gateway "${gpid}"')<branch.indexOf('node "${configure_js}"'),'Stop old gateway before config rewrite');
check(!entrypoint.includes('API_KEY prefix')&&!entrypoint.includes('API_KEY:0:'),'No credential prefixes logged');
console.log(JSON.stringify({passed:true,checks,native:process.argv.includes('--native'),test_directory:root}));
