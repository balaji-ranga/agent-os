import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const template=readFileSync(new URL('../deploy/nginx-host-locations.conf',import.meta.url),'utf8'),zones=readFileSync(new URL('../deploy/nginx-upload-zones.conf',import.meta.url),'utf8'),script=readFileSync(new URL('../deploy/update-nginx.mjs',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
const original=`server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name login.flolah.cloud;
    ssl_certificate /cert.pem;
    ssl_certificate_key /key.pem;
    location /api/ { proxy_pass http://127.0.0.1:3001; }
    location / { proxy_pass http://127.0.0.1:3000; }
}
server { listen 80; server_name other.example; return 301 https://other.example$request_uri; }
`;
function apply(current){const files={'/nginx/nginx.host-network.conf':current,'/release/deploy/nginx-host-locations.conf':template,'/release/deploy/nginx-upload-zones.conf':zones};try{runInNewContext(script,{readFileSync:p=>{assert.ok(Object.hasOwn(files,p));return files[p];},writeFileSync:(p,s)=>files[p]=s,copyFileSync:(a,b)=>files[b]=files[a],console:{log(){}},process:{exit:()=>{throw new Error('completed');}}});}catch(error){if(error.message!=='completed')throw error;}return files['/nginx/nginx.host-network.conf'];}
test('upload proxy patch preserves TLS and unrelated routes and is idempotent on upgrade',()=>{
 const first=apply(original),second=apply(first);assert.equal(first,second);
 assert.ok(first.includes('ssl_certificate /cert.pem;'));assert.ok(first.includes('location /api/ { proxy_pass http://127.0.0.1:3001; }'));assert.ok(first.includes('server_name other.example;'));
 assert.equal(first.split('zone=adoption_task_uploads:').length,2);assert.equal(first.split('location @adoption_upload_limited').length,2);
 assert.match(first,/proxy_request_buffering off;/);assert.match(first,/Access-Control-Expose-Headers Retry-After/);assert.match(first,/return 429 '\{"error"/);
 assert.match(first,/error_page 429 = @adoption_upload_limited;/);
});
