/** Offline startup bridge for Flolah BYOK auth-only stores. Never invent OpenClaw schemas. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {chmodSync,existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const authTables=['auth_profile_state','auth_profile_store'];
function digest(db){return createHash('sha256').update(JSON.stringify(authTables.map(table=>({table,rows:db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()})))).digest('hex');}
function fenced(path,root){assert.equal(realpathSync(path),resolve(path),'Symlinked database path rejected');assert(resolve(path).startsWith(resolve(root)+'/')||resolve(path).startsWith(resolve(root)+'\\'),'Database outside agent root');}

export async function loadCanonicalApi(dist='/usr/local/lib/node_modules/openclaw/dist'){
 const load=async prefix=>{
  const files=readdirSync(dist).filter(name=>name.startsWith(prefix+'-')&&name.endsWith('.js'));
  assert.equal(files.length,1,`Unsupported installed OpenClaw module layout: ${prefix}`);
  return import(pathToFileURL(join(dist,files[0])).href);
 };
 const maintenanceFiles=readdirSync(dist).filter(name=>/^openclaw-agent-db-maintenance-[\w-]+\.js$/.test(name));
 assert.equal(maintenanceFiles.length,1,'Unsupported OpenClaw maintenance module layout');
 const maintenanceSource=readFileSync(join(dist,maintenanceFiles[0]),'utf8');
 // A release can contain multiple SQLite bundles. Use the initializer's own bundle.
 const sqliteName=maintenanceSource.match(/from\s+["']\.\/(node-sqlite-[\w-]+\.js)["']/)?.[1];
 assert(sqliteName,'Canonical initializer SQLite dependency missing');
 const maintenance=await load('openclaw-agent-db-maintenance'),sqlite=await import(pathToFileURL(join(dist,sqliteName)).href);
 const find=(module,name)=>{const fn=Object.values(module).find(value=>typeof value==='function'&&value.name===name);assert(fn,`Installed OpenClaw initializer unavailable: ${name}`);return fn;};
 return {open:find(sqlite,'openNodeSqliteDatabase'),clear:find(sqlite,'clearNodeSqliteKyselyCacheForDatabase'),initialize:find(maintenance,'ensureOpenClawAgentDatabaseSchema'),verify:find(maintenance,'assertOpenClawAgentDatabaseForMaintenance')};
}

export function gatewayProcessRunning(proc='/proc'){
 if(!existsSync(proc))return false;
 return readdirSync(proc).filter(name=>/^\d+$/.test(name)&&Number(name)!==process.pid).some(name=>{
  try{const cmd=readFileSync(join(proc,name,'cmdline'),'utf8').replaceAll('\0',' ');return /(?:^|\s)(?:[^\s]*\/)?openclaw-gateway(?:\s|$)/.test(cmd)||/openclaw(?:\.mjs)?\s+gateway(?:\s|$)/.test(cmd);}catch{return false;}
 });
}

export async function preflight({openclawDir=process.env.OPENCLAW_DIR||'/root/.openclaw',api,hasGatewayProcess=gatewayProcessRunning}={}){
 assert(!hasGatewayProcess(),'Refusing agent schema initialization while a Gateway process is running');
 const root=resolve(openclawDir),agents=join(root,'agents'),result={repaired:0,unchanged:0,unsupported:0};
 if(!existsSync(agents))return result;
 assert.equal(realpathSync(root),root,'Symlinked state root rejected');assert.equal(realpathSync(agents),agents,'Symlinked agent root rejected');
 api??=await loadCanonicalApi();
 for(const entry of readdirSync(agents,{withFileTypes:true})){
  if(!entry.isDirectory()||! /^[a-z0-9][a-z0-9_-]{0,127}$/.test(entry.name))continue;
  const path=join(agents,entry.name,'agent','openclaw-agent.sqlite');if(!existsSync(path))continue;
  fenced(path,agents);assert(!lstatSync(path).isSymbolicLink());
  const db=api.open(path);
  try{
   db.exec('PRAGMA busy_timeout = 5000');
   const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
   const version=Number(db.prepare('PRAGMA user_version').get().user_version);
   if(version!==0||tables.includes('schema_meta')){result.unchanged++;continue;}
   if(JSON.stringify(tables)!==JSON.stringify(authTables)){result.unsupported++;continue;}
   assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok','Auth database integrity failure');
   // Backup with SQLite, not filesystem copies (WAL may contain the latest credentials).
   const backupRoot=join(root,'.flolah-maintenance-backups');mkdirSync(backupRoot,{recursive:true,mode:0o700});
   assert.equal(realpathSync(backupRoot),backupRoot,'Symlinked backup directory rejected');chmodSync(backupRoot,0o700);
   const backup=join(backupRoot,`auth-only-${entry.name}-${Date.now()}-${randomUUID()}.sqlite`);
   db.prepare('VACUUM INTO ?').run(backup);chmodSync(backup,0o600);
   const before=digest(db),reader=api.open(backup);
   try{assert.equal(digest(reader),before,'Auth writer changed data during backup; retry offline initialization');}finally{api.clear(reader);reader.close();}
   api.initialize(db,{agentId:entry.name,path,register:false});api.verify(db,{agentId:entry.name,pathname:path});
   assert.equal(digest(db),before,'Auth data changed during initialization');
   assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
   result.repaired++;
  }finally{api.clear(db);db.close();}
 }
 return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log('[openclaw] Auth-store schema preflight: '+JSON.stringify(await preflight()));}
 catch(error){console.error('[openclaw] Auth-store schema preflight failed; refusing startup: '+error.message);process.exitCode=1;}
}
