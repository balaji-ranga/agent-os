import test from 'node:test';
import assert from 'node:assert/strict';
import {withHostPreview} from '../deploy/nginx-preview.mjs';
test('preview injection targets only exact host HTML proxies and is idempotent',()=>{
 const source='server { listen 443 ssl; server_name any.example.test; location / { proxy_pass http://frontend; } location = / { try_files /index.html =404; } }\nserver { listen 443 ssl; server_name other.example.test; location / { proxy_pass http://other; } }';
 const next=withHostPreview(source,'any.example.test','<script src="/loader.mjs"></script>');assert.match(next,/sub_filter/);assert.equal(next.split('server_name other.example.test;')[1],source.split('server_name other.example.test;')[1]);assert.equal(next.includes('location = / { try_files /index.html =404; }'),true);const repeat=withHostPreview(next,'any.example.test','<script src="/loader.mjs"></script>');assert.equal((repeat.match(/# digital-adoption-preview\n/g)||[]).length,1);assert.throws(()=>withHostPreview(source,'missing.example.test','x'));
});
