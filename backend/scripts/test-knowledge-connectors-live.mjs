// Isolated adapter probe. Does not create business records or publish indexes.
import { sourceRecords } from '../src/services/knowledge-source-adapters.js';
const owner=process.env.KNOWLEDGE_TEST_OWNER;
if(!owner)throw new Error('KNOWLEDGE_TEST_OWNER required');
let failed=false;
for(const source of [
  {kind:'crm',collections:['companies','people','opportunities']},
  {kind:'erp',collections:['Customer','Contact','Project','Sales Invoice']},
  {kind:'content',collections:['uploaded','generated']},
  {kind:'knowledge',collections:['tables','documents']},
]) {
  try {
    let count=0;for await(const record of sourceRecords(owner,source)) {
      if(!record.object_id||typeof record.text!=='string')throw new Error('Invalid source record');
      count++;
    }
    console.log(JSON.stringify({source:source.kind,status:'passed',records:count,scope:'adapter read only'}));
  }catch(error){failed=true;console.log(JSON.stringify({source:source.kind,status:'failed',error:error.message}));}
}
process.exit(failed?1:0);
