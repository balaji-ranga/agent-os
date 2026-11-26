import assert from 'node:assert/strict';
import {adaptNativeActionAuthority} from '../../deploy/scripts/install-native-action-authority.mjs';
const fixture=`const promptCacheToolNames = input.applyPromptBuildToolsAllow(hookResult?.toolsAllow);
const assertHostActive = resolveAdmittedRunActiveAssertion(attempt.admittedRunContext, attempt.abortSignal);
const authorizedHookResult = !attempt.toolAuthorityFingerprint || !assertHostActive ? undefined : runner({toolAuthorityFingerprint: attempt.toolAuthorityFingerprint,
		activeToolNames: promptCacheToolNames,assertHostActive});
return authorizedHookResult;
const unusedFixturePolicy = {applyPromptBuildToolsAllow: (toolsAllow) => {}};`;
const patched=adaptNativeActionAuthority(fixture);assert.equal(adaptNativeActionAuthority(patched),patched);assert.throws(()=>adaptNativeActionAuthority('unknown ABI'),/Unsupported/);
const run=new Function('input','hookResult','attempt','hookCtx','resolveAdmittedRunActiveAssertion','runner',patched);
let executed=0;const input={applyPromptBuildToolsAllow:()=>['tool_call'],getPromptBuildAuthorizedToolNames:()=>['fixture_export']},hookResult={toolsAllow:['fixture_export']},ctx={agentId:'fixture',sessionKey:'agent:fixture:test',runId:'fixture-run'};
const runner=a=>{a.assertHostActive();assert.deepEqual(a.activeToolNames,['fixture_export']);assert(!a.activeToolNames.includes('ungranted_action'));executed++;return true;};
assert.equal(run(input,hookResult,{abortSignal:new AbortController().signal},ctx,()=>undefined,runner),true);assert.equal(executed,1);
const abort=new AbortController();abort.abort();assert.throws(()=>run(input,hookResult,{abortSignal:abort.signal},ctx,()=>undefined,runner),/cancelled/);assert.equal(executed,1);
assert.throws(()=>run(input,hookResult,{},ctx,()=>undefined,runner),/no active lifecycle/);
assert.throws(()=>run(input,hookResult,{},ctx,()=>()=>{throw Error('admission revoked');},runner),/admission revoked/);assert.equal(executed,1);
console.log('NATIVE_ACTION_AUTHORITY_OK: exact finalized tools; ungranted actions absent; native cancellation; stronger admitted-run guard retained; idempotent; unknown ABI rejected');
