import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MODEL_GATEWAY_TIMEOUT_MS,MODEL_CLIENT_TIMEOUT_MS,MODEL_SESSION_TIMEOUT_MS,WIDGET_REQUEST_TIMEOUT_MS,sessionRequestTimeoutMs} from '../web/model-timeouts.mjs';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('cold-start review has bounded, nested end-to-end deadlines',()=>{
 assert.equal(MODEL_GATEWAY_TIMEOUT_MS,180_000);
 assert.ok(MODEL_GATEWAY_TIMEOUT_MS<MODEL_CLIENT_TIMEOUT_MS);
 assert.ok(MODEL_CLIENT_TIMEOUT_MS<WIDGET_REQUEST_TIMEOUT_MS);
 assert.ok(MODEL_CLIENT_TIMEOUT_MS<MODEL_SESSION_TIMEOUT_MS&&MODEL_SESSION_TIMEOUT_MS<WIDGET_REQUEST_TIMEOUT_MS);
 for(const path of ['/v1/plan','/v1/recipe/plan','/v1/ask','/v1/tasks/plan','/v1/tasks/summary','/v1/tasks/command-plan'])assert.equal(sessionRequestTimeoutMs(path),MODEL_SESSION_TIMEOUT_MS);
 assert.equal(sessionRequestTimeoutMs('/v1/sessions'),8_000);
 for(const path of ['/v1/approve','/v1/tasks/effect','/v1/renew'])assert.equal(sessionRequestTimeoutMs(path),55_000);
 assert.match(source('web/session-client.mjs'),/timeoutMs\|\|Math\.min\(sessionRequestTimeoutMs\(path\),requestTimeoutMs\)/);
 assert.ok(WIDGET_REQUEST_TIMEOUT_MS<=210_000);
 for(const path of ['integrations/model-gateway-server.mjs','integrations/platform-gateway.mjs']){
  assert.match(source(path),/AbortSignal\.timeout\(MODEL_GATEWAY_TIMEOUT_MS\)/);
 }
 for(const path of ['src/platform-model.mjs','src/knowledge-answer.mjs']){
  assert.match(source(path),/requestDeadlineMs=MODEL_CLIENT_TIMEOUT_MS/);
  assert.match(source(path),/deadline-Date\.now\(\)/);
 }
 assert.match(source('web/widget.mjs'),/hostRequestTimeoutMs=WIDGET_REQUEST_TIMEOUT_MS/);
 assert.ok(source('src/server.mjs').includes("['/model-timeouts.mjs', ['../web/model-timeouts.mjs', 'text/javascript']]"));
 assert.match(source('integrations/model-gateway-server.mjs'),/controller\.abort\(\)/);
});
test('both proxy templates and existing-install updater outlast model budgets',()=>{
 const proxy=source('deploy/nginx-host-locations.conf');
 const deadlines=[...proxy.matchAll(/proxy_read_timeout (\d+)s;/g)].map(m=>Number(m[1])*1000);
 assert.equal(deadlines.length,2);
 assert.ok(deadlines[0]>WIDGET_REQUEST_TIMEOUT_MS);
 assert.ok(deadlines[1]>MODEL_CLIENT_TIMEOUT_MS);
 assert.match(source('deploy/nginx-location.conf.example'),/proxy_read_timeout 210s;/);
 assert.match(source('deploy/update-nginx.mjs'),/proxy_read_timeout 210s;/);
 assert.match(source('deploy/update-nginx.mjs'),/proxy_read_timeout 195s;/);
});
