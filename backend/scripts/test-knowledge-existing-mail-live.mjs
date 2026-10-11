// Bounded read-only probe; no message content logged, persisted or sent to an LLM.
import assert from 'node:assert/strict';
import {mailConnectionRef,mailRecords} from '../src/services/knowledge-mail-adapter.js';
const owner=process.env.KNOWLEDGE_TEST_OWNER;
if(!owner)throw new Error('Explicit authorized owner required');
let failed=false;
for(const kind of ['gmail','outlook']){
  try{
    await mailConnectionRef(owner,kind);
    const iterator=mailRecords(owner,{kind,query:'newer_than:7d -in:spam -in:trash'});
    let count=0;
    try{
      for await(const record of iterator){
        assert.ok(record.object_id);assert.equal(typeof record.text,'string');
        count++;break;
      }
    }finally{await iterator.return();}
    console.log(JSON.stringify({kind,status:count?'passed':'empty_mailbox',records_validated:count,scope:'existing connection identity and first full-body record; no indexing or attachment validation'}));
  }catch(e){failed=true;console.log(JSON.stringify({kind,status:'failed',error:String(e.message).replace(/https?:\/\/\S+/g,'[endpoint]').slice(0,200)}));}
}
process.exitCode=failed?1:0;
