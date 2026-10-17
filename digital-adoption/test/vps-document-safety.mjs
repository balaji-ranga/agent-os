import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createBlobStore} from '../src/blob-store.mjs';
import {createDocumentExtractor} from '../src/document-extractor.mjs';
const fixtures=JSON.parse(readFileSync('/data/document-acceptance-result.json')),video=fixtures.records.find(r=>r.kind==='VIDEO');
const extract=createDocumentExtractor({python:'/opt/adoption-python/bin/python'}),path=createBlobStore('/data/objects').path('adoption-demo-alpha',video.sourceId);
const result=await extract({path,kind:'video'});assert.ok(result.sections.some(s=>s.locator==='00:05'&&/forty two hours/i.test(s.text)));
const unsafe='/data/acceptance-fixtures/rejected-playlist.mp4';writeFileSync(unsafe,'#EXTM3U\nhttp://169.254.169.254/metadata');
try{await assert.rejects(()=>extract({path:unsafe,kind:'video'}));}finally{unlinkSync(unsafe);}
console.log(JSON.stringify({build:process.env.ADOPTION_BUILD,videoDemuxerRestricted:true,realOcrTimestampVerified:true,playlistRejected:true,fullPhaseCertification:false}));
