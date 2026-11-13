import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import Database from 'better-sqlite3';
import {hasTrackedDeliveryReceipt} from '../src/services/tool-delivery-receipt.js';
const root=mkdtempSync(join(tmpdir(),'delivery-receipt-')),job={id:'track-a3bb5b60-b447-4c53-a95c-b81b9378ebaf',owner_user_id:'fixture',agent_id:'t-fixture--assistant',created_at:new Date(1000).toISOString()};
const dir=join(root,'agents',job.agent_id,'agent');mkdirSync(dir,{recursive:true});const db=new Database(join(dir,'openclaw-agent.sqlite'));db.exec('CREATE TABLE transcript_events(event_json TEXT)');
const add=(message,timestamp=2000)=>db.prepare('INSERT INTO transcript_events VALUES(?)').run(JSON.stringify({timestamp:new Date(timestamp).toISOString(),message}));
const message={role:'assistant',provider:'openclaw',model:'delivery-mirror',content:[{type:'text',text:`From: Assistant\nTracking ID: ${job.id}\nCompleted`}]};
try{
 assert.equal(hasTrackedDeliveryReceipt(job,{root}),false);
 add({...message,role:'user'});add({...message,provider:'model-provider'});add(message,500);
 assert.equal(hasTrackedDeliveryReceipt(job,{root}),false,'user text, model claims and old receipts are not delivery');
 add(message);assert.equal(hasTrackedDeliveryReceipt(job,{root}),true);
 assert.equal(hasTrackedDeliveryReceipt({...job,owner_user_id:'other'},{root}),false);
 assert.equal(hasTrackedDeliveryReceipt({...job,id:'track-00000000-0000-0000-0000-000000000000'},{root}),false);
 console.log('DELIVERY_RECEIPT_OK: exact tracking ID, trusted runtime mirror, owner isolation, timestamp boundary, no resend');
}finally{db.close();rmSync(root,{recursive:true,force:true});}
