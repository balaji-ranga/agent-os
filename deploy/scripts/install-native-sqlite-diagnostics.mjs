// Add call-site labels to existing slow transaction diagnostics; no SQL or content.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist';let count=0;
for(const file of readdirSync(root).filter(x=>/^node-sqlite-.*\.js$/.test(x))){
 const path=join(root,file);let s=readFileSync(path,'utf8');
 const anchor='elapsedMs: Date.now() - transactionStartedAt,\n\t\t\toptions';
 const replacement='elapsedMs: Date.now() - transactionStartedAt,\n\t\t\toptions: options?.operationLabel ? options : { ...options, operationLabel: new Error("slow transaction call site").stack }';
 if(s.includes(replacement)){count++;continue;}if(!s.includes(anchor))continue;
 s=s.replaceAll(anchor,replacement);writeFileSync(path,s);count++;
}if(!count)throw Error('Unsupported transaction diagnostics ABI');console.log('SQLITE_CALLSITE_DIAGNOSTICS',count);
