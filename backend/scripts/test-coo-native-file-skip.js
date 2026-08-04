/**
 * Unit: COO must not hard-delegate dont-delegate or find/download/attach file asks.
 * Usage: node scripts/test-coo-native-file-skip.js

 */
import {
  isRefuseDelegationRequest,
  isExplicitDelegateRequest,
  isCooNativeWork
} from '../src/services/coo-specialty-delegation.js';

let failed = 0;
function ok(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else console.log('OK:', msg);
}

const userMsg =
  'dont delegate, you find this file download and attach here RAJISRI_resume_latest (2)-1 (1).pdf';

ok(isRefuseDelegationRequest(userMsg), 'refuse: dont delegate');
ok(!isExplicitDelegateRequest(userMsg), 'not explicit delegate when dont');
ok(isCooNativeWork(userMsg), 'COO-native find/download/attach pdf');

ok(isExplicitDelegateRequest('please delegate this research to a specialist'), 'explicit delegate');
ok(!isRefuseDelegationRequest('please delegate this research to a specialist'), 'not refuse');
ok(!isCooNativeWork('how much water for 1kg biryang'), 'recipe stays specialty-eligible');
ok(isCooNativeWork('list my master data tables'), 'master data list is native');
ok(isCooNativeWork('list_inbound_attachments for the resume'), 'list_inbound tool name native');
ok(isCooNativeWork("don't assign this - you handle it yourself"), 'handle yourself native');

if (failed) {
  console.error('FAILED ' + failed);
  process.exit(1);
}
console.log('test ok');
console.log('COO_NATIVE_FILE_SKIP_OK');
