// Run against the installed gateway bundle; no model/network/device execution.
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root=process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist';
process.env.VITEST='1';
await import(pathToFileURL(root+'/'+readdirSync(root).find(n=>/^builtin-openclaw-.*\.js$/.test(n))));
const t=globalThis[Symbol.for('openclaw.compactionSafeguardTestApi')];
assert.ok(t);
const body=t.buildStructuredFallbackSummary('');
for(const ask of ['Hi','OK','Thanks','Yes','Ｈｉ','Look at my gmail and get back on any important email to respond for today','Read the calendar appointments for today','Transcribe this audio recording']){
 const f=t.budgetCompactionSummary(body,'',t.MAX_COMPACTION_SUMMARY_CHARS,{latestAsk:ask,requiredAskContext:ask,identifiers:[]});
 const q=t.auditSummaryQuality({summary:f.summary,structuralSummary:f.structuralSummary,identifiers:[],latestAsk:ask});
 assert.ok(q.ok,ask+': '+JSON.stringify(q));
 assert.ok(f.summary.length<=t.MAX_COMPACTION_SUMMARY_CHARS);
}
for(const ask of ['Hi','uniqueunmentioneddevicecommand']){
 const q=t.auditSummaryQuality({summary:body+' shipment history',structuralSummary:body,identifiers:[],latestAsk:ask});
 assert.ok(q.reasons.includes('latest_user_ask_not_reflected'),'Absent asks must still fail, not substring-match');
}
const missing=t.auditSummaryQuality({summary:body,structuralSummary:body,identifiers:['fixture-0123456789'],latestAsk:null});
assert.ok(missing.reasons.some(r=>r.startsWith('missing_identifiers')));
console.log('COMPACTION_ASK_MATCH_TEST_OK: short asks, normal connector/audio asks, Unicode, missing asks and identifiers');
