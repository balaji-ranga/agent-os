import assert from 'node:assert/strict';
import {mailRecords,mailConnectionRef} from '../src/services/knowledge-mail-adapter.js';
async function collect(source,execute){const rows=[];for await(const row of mailRecords('alice',source,{execute}))rows.push(row);return rows;}
let calls=0;
const gmail=await collect({kind:'gmail',query:'label:contracts'},async(owner,action,input)=>{
  assert.equal(owner,'alice');assert.equal(action,'gmail.fetch_emails');assert.equal(input.detail,'full');assert.equal(input.query,'label:contracts');
  if(calls++)assert.equal(input.pageToken,'page2');
  return {ok:true,data:{messages:[{messageId:`m${calls}`,subject:'Renewal',messageText:'Contract terms',sender:'test@example.invalid'}],nextPageToken:calls===1?'page2':null}};
});
assert.deepEqual(gmail.map(row=>row.object_id),['messages/m1','messages/m2']);
assert.equal(gmail[0].fields.attachment_indexing,'not_enabled');
await assert.rejects(collect({kind:'gmail'},async()=>({data:{messages:[],nextPageToken:'repeat'}})),/repeated/);
await assert.rejects(collect({kind:'gmail'},async()=>({data:{unexpected:[]}})),/incomplete/);
await assert.rejects(collect({kind:'gmail'},async()=>({data:{messages:[{messageId:'m'}]}})),/body missing/);
let outlookCalls=0;
const outlook=await collect({kind:'outlook',folder_id:'inbox'},async(owner,action,input)=>{
  assert.equal(action,'outlook.list_messages');assert.equal(input.bodyContentType,'text');
  outlookCalls++;
  return {data:{messages:[{id:`o${outlookCalls}`,subject:'Contract',body:{content:'Renewal'}}],nextLink:outlookCalls===1?'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=abc':null}};
});
assert.equal(outlook.length,2);
await assert.rejects(collect({kind:'outlook'},async()=>({data:{messages:[],nextLink:'http://127.0.0.1/private'}})),/pagination origin/);
const connections=async(owner)=>({connections:[{app_id:'gmail',connected:true,connection_name:owner,account_name:'fixture'}]});
assert.notEqual(await mailConnectionRef('alice','gmail',{connections}),await mailConnectionRef('bob','gmail',{connections}));
await assert.rejects(mailConnectionRef('alice','gmail',{connections:async()=>({connections:[]})}),/Connect one/);
console.log('Mail adapters: owner-bound calls, Gmail/Outlook pagination, malformed-page fencing, full-body requirement, unsafe cursor rejection and connection identity passed (provider fixtures). Attachments and real OAuth tests remain separate.');
