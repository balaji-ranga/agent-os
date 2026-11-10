import {DatabaseSync} from 'node:sqlite';import {mkdtempSync,rmSync,readdirSync,copyFileSync,renameSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const root=mkdtempSync(join(tmpdir(),'native-reopen-stamp-')),dist='/usr/local/lib/node_modules/openclaw/dist';process.env.OPENCLAW_STATE_DIR=root;process.env.OPENCLAW_DIR=root;
const mod=await import(join(dist,readdirSync(dist).find(f=>/^openclaw-agent-db-[A-Z0-9_-]+\.js$/i.test(f)&&!f.includes('maintenance')&&!f.includes('readonly'))));
const find=name=>Object.values(mod).find(v=>typeof v==='function'&&v.name===name);
const open=find('openOpenClawAgentDatabase'),close=find('closeOpenClawAgentDatabases');assert.ok(open&&close);
let contracts=0;const prepare=DatabaseSync.prototype.prepare;DatabaseSync.prototype.prepare=function(sql,...args){if(/pragma.*(table_info|table_xinfo|index_info|index_xinfo|index_list)/i.test(sql))contracts++;return prepare.call(this,sql,...args)};
try{
 const opts={agentId:'fixture',env:{...process.env}};let first=open(opts);assert.ok(first.path.startsWith(root));const file=first.path;const initial=contracts;assert.ok(initial>10);close();contracts=0;
 const second=open(opts);assert.equal(second.path,file);const reopened=contracts;assert.ok(reopened<initial/4,`${initial}/${reopened}`);close();
 // External DDL invalidates the stamp and invokes full schema verification.
 let other=new DatabaseSync(file);other.exec('CREATE TABLE fixture_added(id INTEGER)');other.close();contracts=0;open(opts);assert.ok(contracts>reopened+10);close();
 copyFileSync(file,file+'.replacement');renameSync(file+'.replacement',file);contracts=0;open(opts);assert.ok(contracts>reopened+10,'replacement file must be revalidated');close();
 // Owner changes do not change schema_version and must still be rejected.
 other=new DatabaseSync(file);other.exec("UPDATE schema_meta SET agent_id='different' WHERE meta_key='primary'");other.close();assert.throws(()=>open(opts),/belongs to agent/);
 other=new DatabaseSync(file);other.exec("UPDATE schema_meta SET agent_id='fixture' WHERE meta_key='primary'");other.close();open(opts);close();
 // A changed SQLite user version also leaves the fast path.
 other=new DatabaseSync(file);other.exec('PRAGMA user_version=9999');other.close();assert.throws(()=>open(opts),/version|newer|schema/i);
 const metaOpts={...opts,agentId:'metadata-fixture'};const metaFile=open(metaOpts).path;close();other=new DatabaseSync(metaFile);other.exec("UPDATE schema_meta SET schema_version=9999 WHERE meta_key='primary'");other.close();assert.throws(()=>open(metaOpts),/version|schema|marker/i);
 console.log(JSON.stringify({test:'NATIVE_REOPEN_SCHEMA_STAMP_OK',initial,reopened,coverage:'same-file unchanged schema fast path; external DDL revalidation; unsupported version rejected'}));
}finally{try{close();}catch{}DatabaseSync.prototype.prepare=prepare;rmSync(root,{recursive:true,force:true});}
