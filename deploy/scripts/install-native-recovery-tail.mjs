import {readFileSync,readdirSync,writeFileSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist',repo=process.argv[3]||'/opt/agent-os';let count=0;
for(const file of readdirSync(root).filter(f=>/^history-image-prune-.*\.js$/.test(f))){
 const path=join(root,file);let s=readFileSync(path,'utf8');
 if(s.includes('flolahPruneRecoveryTail')&&s.includes('const removedEntries = flolahPruneRecoveryTail')){count++;continue;}
 const start=s.indexOf('function removeTrailingMidTurnPrecheckAssistantError('),end=s.indexOf('\nasync function loadAttemptSessionEntryAfterQuotaMaintenance(',start);
 if(start<0||end<0)continue;
 let body=s.slice(start,end);const anchor='params.sessionManager.removeTrailingEntries(';
 const expected=s.includes('flolahPruneRecoveryTail')?2:3;
 if(body.split(anchor).length!==expected)throw Error('Unsupported recovery-tail ABI');
 body=body.replaceAll(anchor,'flolahPruneRecoveryTail(params.sessionManager, ');
 const prefix=s.includes('flolahPruneRecoveryTail')?'':"import {pruneRecoveryTail as flolahPruneRecoveryTail} from './flolah-recovery-tail.js';\n";
 s=prefix+s.slice(0,start)+body+s.slice(end);writeFileSync(path,s);count++;
}
if(count!==1)throw Error('Unsupported recovery-tail module count: '+count);
copyFileSync(join(repo,'openclaw-extensions/agent-os-content-tools/recovery-tail.js'),join(root,'flolah-recovery-tail.js'));
console.log('RECOVERY_TAIL_INSTALLED');
