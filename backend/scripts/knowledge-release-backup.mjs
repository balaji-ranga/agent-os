import Database from 'better-sqlite3';
import {mkdir,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(process.env.AGENT_OS_DATA_DIR||'/data/agent-os');
const release=process.env.KNOWLEDGE_RELEASE_ID;
if(!release||!/^knowledge-[a-z0-9-]+$/.test(release))throw new Error('Explicit Knowledge release ID required');
const directory=join(root,'backups',release);
await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
const db=new Database(join(root,'agent-os.db'),{readonly:true,fileMustExist:true});
try{await db.backup(join(directory,'agent-os.sqlite'));await chmod(join(directory,'agent-os.sqlite'),0o600);}finally{db.close();}
console.log('Online SQLite backup complete in restricted release backup directory.');
