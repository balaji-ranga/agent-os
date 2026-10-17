import test from 'node:test';
import assert from 'node:assert/strict';
import {recordedPackage,validateLearningPackage} from '../web/learning-package.mjs';
test('owner import checks package integrity and versions before sending it to the server',async()=>{
 const pack=await recordedPackage({title:'Reusable input',origin:'https://source.test',steps:[{action:'fill',path:'/form',field:'query',parameter:'query'}]});
 assert.deepEqual(await validateLearningPackage(pack),pack);
 await assert.rejects(()=>validateLearningPackage({...pack,bundle:{...pack.bundle,title:'Changed'}}),/checksum does not match/);
 await assert.rejects(()=>validateLearningPackage({...pack,sdk:2}),/SDK version/);
 await assert.rejects(()=>validateLearningPackage({...pack,sourceOrigin:'https://source.test/private'}),/invalid source website/);
});
