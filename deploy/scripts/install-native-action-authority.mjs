import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const marker='FLOLAH_FINALIZED_ACTION_AUTHORITY';
export function adaptNativeActionAuthority(source){
 if(source.includes(marker))return source;
 const assertion='const assertHostActive = resolveAdmittedRunActiveAssertion(attempt.admittedRunContext, attempt.abortSignal);';
 const fingerprint='toolAuthorityFingerprint: attempt.toolAuthorityFingerprint,';
 const condition='!attempt.toolAuthorityFingerprint || !assertHostActive';
 const policyAnchor='applyPromptBuildToolsAllow: (toolsAllow) => {';
 const activeNames='activeToolNames: promptCacheToolNames,';
 if(source.split(assertion).length!==2||source.split(condition).length!==2||!source.includes('const promptCacheToolNames = input.applyPromptBuildToolsAllow(hookResult?.toolsAllow);')||source.split(fingerprint).length!==2||source.split(policyAnchor).length!==2||source.split(activeNames).length!==2)throw Error('Unsupported finalized native action-authority ABI');
 return source.replace(assertion,assertion.replace(';',` || (() => { // ${marker}
 if(!attempt.abortSignal || attempt.abortSignal.aborted)throw new Error('Native action turn was cancelled or has no active lifecycle');
 });`)).replace(policyAnchor,'getPromptBuildAuthorizedToolNames: () => input.toolPolicy.current.uncompactedEffectiveTools.map(tool => tool.name),\n\t\t'+policyAnchor).replace(activeNames,'activeToolNames: input.getPromptBuildAuthorizedToolNames(),').replace(condition,'!assertHostActive').replace(fingerprint,`toolAuthorityFingerprint: attempt.toolAuthorityFingerprint || JSON.stringify([hookCtx.agentId, hookCtx.sessionKey, hookCtx.runId, promptCacheToolNames]),`);
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
 const dist=resolve(process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist');
 const files=readdirSync(dist).filter(n=>/^builtin-openclaw-.*\.js$/.test(n)&&readFileSync(join(dist,n),'utf8').includes('const promptCacheToolNames = input.applyPromptBuildToolsAllow(hookResult?.toolsAllow);'));
 if(!files.length)throw Error('Native finalized-tool authority integration missing');
 for(const f of files){const p=join(dist,f);writeFileSync(p,adaptNativeActionAuthority(readFileSync(p,'utf8')));}
 console.log('NATIVE_ACTION_AUTHORITY_INSTALLED: '+files.length+' finalized-policy host(s)');
}
