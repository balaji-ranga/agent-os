import {readFileSync,readdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
const root=process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist';let callers=0,maintenance=0;
for(const file of readdirSync(root).filter(x=>/^openclaw-agent-db-.*\.js$/.test(x))){const p=join(root,file);let s=readFileSync(p,'utf8');
 const call='assertAgentDatabaseIntegrityBeforeMutation(db, agentId, pathname)';
 const patched='assertAgentDatabaseIntegrityBeforeMutation(db, agentId, pathname, isValidatedReopen)';
 if(s.includes(patched)||s.includes('const flolahValidatedSchemaStamps = new Map();'))callers++;else if(s.includes(call)&&s.includes('let isValidatedReopen = validatedAgentDatabasePaths.get(pathname) === agentId;')){s=s.replace(call,patched);
 const cache='const validatedAgentDatabasePaths = /* @__PURE__ */ new Map();';
 const reopen='let isValidatedReopen = validatedAgentDatabasePaths.get(pathname) === agentId;';
 const record='validatedAgentDatabasePaths.set(pathname, agentId);';
 for(const anchor of [cache,reopen,record])if(!s.includes(anchor))throw Error('Unsupported reopen cache ABI');
 s="import {statSync as flolahDatabaseStat} from 'node:fs';\n"+s.replace(cache,cache+'\nconst flolahValidatedFileIds = new Map();\nconst flolahFileIdentity = pathname => { const st=flolahDatabaseStat(pathname); return `${st.dev}:${st.ino}`; };').replace(reopen,reopen+'\n\t\tisValidatedReopen = isValidatedReopen && flolahValidatedFileIds.get(pathname) === flolahFileIdentity(pathname);').replace(record,record+'\n\t\t\tflolahValidatedFileIds.set(pathname, flolahFileIdentity(pathname));');
 callers++;}
 const signature='function assertAgentDatabaseIntegrityBeforeMutation(database, agentId, pathname) {';
 const next='function assertAgentDatabaseIntegrityBeforeMutation(database, agentId, pathname, validatedReopen = false) {';
 if(s.includes(signature)){
  const start=s.indexOf(signature),end=s.indexOf('\nfunction ensureAgentSchema(',start);if(end<0)throw Error('Unknown integrity ABI');let body=s.slice(start,end);
  const anchor='verifyAndRepairCanonicalSqliteIndexes(database, pathname, OPENCLAW_AGENT_SCHEMA_SQL, {';
  if(body.split(anchor).length!==2)throw Error('Unknown validation call ABI');
  body=body.replace(signature,next).replace(anchor,'(validatedReopen ? repairCanonicalSqliteIndexes : verifyAndRepairCanonicalSqliteIndexes)(database, pathname, OPENCLAW_AGENT_SCHEMA_SQL, {\n\t\t\tverifyPhysicalIntegrity: !validatedReopen,');
  s=s.slice(0,start)+body+s.slice(end);maintenance++;
 }else if(s.includes(next))maintenance++;
 writeFileSync(p,s);
}if(callers!==1||maintenance!==1)throw Error(`Unsupported agent DB ABI ${callers}/${maintenance}`);
// Reopened handles need owner/version checks, but a previously validated,
// unchanged schema does not need every table/index contract rebuilt again.
for(const file of readdirSync(root).filter(x=>/^openclaw-agent-db-.*\.js$/.test(x))){
 const p=join(root,file);let s=readFileSync(p,'utf8');
 if(!s.includes('const flolahValidatedFileIds = new Map();')||s.includes('const flolahValidatedSchemaStamps = new Map();'))continue;
 const anchor='isValidatedReopen = isValidatedReopen && flolahValidatedFileIds.get(pathname) === flolahFileIdentity(pathname);';
 const check='const requiresCurrentVersionConvergence = assertAgentDatabaseIntegrityBeforeMutation(db, agentId, pathname, isValidatedReopen);';
 const record='flolahValidatedFileIds.set(pathname, flolahFileIdentity(pathname));';
 for(const a of [anchor,check,record])if(s.split(a).length!==2)throw Error('Unsupported schema-stamp reopen ABI');
 s=s.replace('const flolahValidatedFileIds = new Map();',`const flolahValidatedFileIds = new Map();
const flolahValidatedSchemaStamps = new Map();
const flolahSchemaStamp = db => JSON.stringify([db.prepare('PRAGMA schema_version').get(), db.prepare('PRAGMA user_version').get(), db.prepare("SELECT role, schema_version, agent_id FROM schema_meta WHERE meta_key='primary'").get()]);`)
 .replace(anchor,anchor+'\n\t\tisValidatedReopen = isValidatedReopen && flolahValidatedSchemaStamps.get(pathname) === flolahSchemaStamp(db);')
 .replace(check,'const requiresCurrentVersionConvergence = isValidatedReopen ? false : assertAgentDatabaseIntegrityBeforeMutation(db, agentId, pathname, false);')
 .replace(record,record+'\n\t\t\tflolahValidatedSchemaStamps.set(pathname, flolahSchemaStamp(db));');
 writeFileSync(p,s);
}
console.log('SQLITE_VALIDATED_REOPEN_INSTALLED');
