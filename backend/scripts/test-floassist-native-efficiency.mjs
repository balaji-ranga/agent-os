import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {auditNativeEfficiency} from './audit-floassist-native-efficiency.mjs';
const db=new DatabaseSync(':memory:');
try{
 db.exec('CREATE TABLE session_windows(session_id TEXT,session_key TEXT);CREATE TABLE transcript_events(session_id TEXT,event_json TEXT);');
 db.prepare('INSERT INTO session_windows VALUES (?,?)').run('s','agent:sched-fixture');
 const add=event=>db.prepare('INSERT INTO transcript_events VALUES (?,?)').run('s',JSON.stringify({timestamp:'2026-10-27T01:00Z',...event}));
 const secret='private fixture body MUST NOT appear in output';
 const response={id:'one',message:{role:'assistant',model:'secondary',usage:{totalTokens:0},content:[{type:'toolCall',name:'floassist_source_read',arguments:{body:secret}}]}};
 add(response);add(response);
 add({id:'two',message:{role:'toolResult',isError:true,content:[{type:'text',text:JSON.stringify({app_id:'gmail',source_id:'source',content:secret,offset:0})}]}});
 add({id:'three',message:{role:'toolResult',content:[{type:'text',text:JSON.stringify({app_id:'gmail',source_id:'source',content:secret,offset:0})}]}});
 add({id:'four',type:'compaction',summary:secret});
 add({id:'outside',timestamp:'2026-10-26T01:00Z',message:{role:'assistant',usage:{totalTokens:100}}});
 const window={since:'2026-10-27T00:00Z',until:'2026-10-28T00:00Z'};
 const result=auditNativeEfficiency(db,window);
 assert.equal(result.duplicateEvents,1);assert.equal(result.sourceReads,1);assert.equal(result.repeatedInitialPages,1);
 assert.equal(result.compactions,1);assert.equal(result.toolErrors,1);assert.equal(result.reportedTokens,null);assert.equal(result.usageComplete,false);
 assert.equal(JSON.stringify(result).includes(secret),false);
 add({id:'five',message:{role:'assistant',model:'secondary',usage:{totalTokens:123},content:[]}});
 const partial=auditNativeEfficiency(db,window);assert.equal(partial.reportedTokens,123);assert.equal(partial.usageComplete,false);
 assert.throws(()=>auditNativeEfficiency(db,{since:'invalid',until:window.until}));
 console.log('FLOASSIST_NATIVE_EFFICIENCY_OK: content-free counts, copied-event deduplication, actual event dates and unknown/partial usage');
}finally{db.close();}
