import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,cpSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyExtensionIntegrity} from '../../scripts/lib/openclaw-extension-integrity.js';
const temp=mkdtempSync(join(tmpdir(),'floassist-integrity-'));
try{
 const source=join(temp,'source'),runtime=join(temp,'runtime');
 for(const id of ['agent-os-content-tools','agent-os-bootstrap-watcher']){
  mkdirSync(join(source,id),{recursive:true});
  writeFileSync(join(source,id,'index.js'),id==='agent-os-content-tools'?"import {floassistSchemas} from './floassist-schemas.js'; const schemas={...floassistSchemas};":'export default {};');
 }
 writeFileSync(join(source,'agent-os-content-tools','floassist-schemas.js'),'export const floassistSchemas={};');
 cpSync(source,runtime,{recursive:true});
 assert.equal(verifyExtensionIntegrity(source,runtime).runtime_verified,true);
 const code=join(source,'agent-os-content-tools','index.js');
 writeFileSync(code,readFileSync(code,'utf8')+'\n');
 writeFileSync(join(runtime,'agent-os-content-tools','index.js'),readFileSync(code,'utf8').replace(/\n/g,'\r\n'));
 assert.equal(verifyExtensionIntegrity(source,runtime).runtime_verified,true);
 writeFileSync(join(runtime,'agent-os-content-tools','index.js'),'old plugin');
 assert.throws(()=>verifyExtensionIntegrity(source,runtime),/mismatch/);
 cpSync(source,runtime,{recursive:true});
 rmSync(join(runtime,'agent-os-content-tools','floassist-schemas.js'));
 assert.throws(()=>verifyExtensionIntegrity(source,runtime),/mismatch/);
 writeFileSync(join(source,'agent-os-content-tools','index.ts'),'const schemas={};');
 assert.throws(()=>verifyExtensionIntegrity(source),/not registered/);
 console.log('OPENCLAW_EXTENSION_INTEGRITY_OK: matching, equivalent EOLs, stale, missing dependency, TS registration');
}finally{if(dirname(resolve(temp))===resolve(tmpdir()))rmSync(temp,{recursive:true,force:true});}
