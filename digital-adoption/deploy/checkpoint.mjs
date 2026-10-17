import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync} from 'node:fs';
const release=process.argv[2];
if(!/^[A-Za-z0-9_-]{1,80}$/.test(release||''))throw new Error('Invalid checkpoint label');
if(existsSync('/data/adoption.sqlite')){
 mkdirSync('/data/checkpoints',{recursive:true,mode:0o700});
 const path=`/data/checkpoints/before-${release}.sqlite`;
 if(!existsSync(path)){const db=new DatabaseSync('/data/adoption.sqlite');try{db.exec('PRAGMA busy_timeout=10000');db.exec(`VACUUM INTO '${path}'`);}finally{db.close();}}
 console.log('Consistent independent database checkpoint retained on deployment host');
}
