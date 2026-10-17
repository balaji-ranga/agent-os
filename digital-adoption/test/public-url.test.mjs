import test from 'node:test';
import assert from 'node:assert/strict';
import {publicIPv4,approvedUrl,createPublicUrlFetcher} from '../src/public-url.mjs';
test('public help fetch pins checked DNS and rejects private addresses, rebinding, credentialed URLs and cross-origin redirects',async()=>{
 for(const ip of ['0.0.0.0','10.1.2.3','127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.100.100.200','198.18.1.1','224.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicIPv4(ip),false,ip);
 for(const url of ['http://example.com','https://user:secret@example.com','https://127.0.0.1','https://metadata.internal/help','https://example.com:8443/help'])assert.throws(()=>approvedUrl(url));
 const calls=[];const fetcher=createPublicUrlFetcher({dns:async()=>[{address:'1.1.1.1'}],transport:async(url,address)=>{calls.push({url:String(url),address});return calls.length===1?{status:302,location:'/new-help'}:{status:200,mime:'text/html',bytes:Buffer.from('<p>public</p>')};}});
 assert.equal((await fetcher('https://docs.example.com/help')).url,'https://docs.example.com/new-help');assert.equal(calls[1].address,'1.1.1.1');
 const rebinding=createPublicUrlFetcher({dns:async()=>[{address:'1.1.1.1'},{address:'10.0.0.1'}],transport:async()=>{throw new Error('Must never connect');}});await assert.rejects(()=>rebinding('https://docs.example.com/help'),/denied/);
 const redirect=createPublicUrlFetcher({dns:async()=>[{address:'1.1.1.1'}],transport:async()=>({status:302,location:'https://other.example.com/private'})});await assert.rejects(()=>redirect('https://docs.example.com/help'),/separate owner approval/);
});
