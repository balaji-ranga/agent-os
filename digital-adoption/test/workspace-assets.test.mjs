import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createAdoptionServer} from '../src/server.mjs';
test('public workspace assets load under the actual widget CSP without relaxing API authorization',async t=>{
 const server=createAdoptionServer({authority:{}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});const url='http://127.0.0.1:'+server.address().port;
 const page=await fetch(url+'/widget.html');assert.equal(page.status,200);assert.match(page.headers.get('Content-Security-Policy'),/style-src 'self' 'unsafe-inline'/);const html=await page.text();const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);assert.equal(new Set(ids).size,ids.length);assert.match(html,/href="workspace.css"/);
 for(const path of ['/workspace.css','/workspace.mjs','/review-card.mjs']){const response=await fetch(url+path);assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),path.endsWith('.css')?/text\/css/:/text\/javascript/);assert.ok((await response.text()).length>100);}
 const api=await fetch(url+'/v1/capabilities',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(api.status,403);
});
