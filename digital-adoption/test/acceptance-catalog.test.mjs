import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptanceCases,evaluateRelease} from './acceptance-catalog.mjs';
test('release gate includes F01-F32 and F37-F42, excluding only Phase 3',()=>{
 assert.equal(acceptanceCases.length,38);
 assert.equal(new Set(acceptanceCases.map(c=>c.id)).size,38);
 for(let i=1;i<=42;i++) assert.equal(acceptanceCases.some(c=>c.id===`F${String(i).padStart(2,'0')}`),i<33||i>36);
 assert.equal(evaluateRelease([]).readyForUat,false);
 assert.equal(evaluateRelease([]).missing.length,76);
 assert.equal(evaluateRelease([{id:'F01',environment:'vps',status:'passed',kind:'unit',build:'test',artifact:'test'}]).missing.length,76);
});
