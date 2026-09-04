import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual worker callback with a page-like evaluation boundary.
const worker = fs.readFileSync(new URL('../local-browser-worker/src/server.js', import.meta.url), 'utf8');
const callback = worker.match(/p\.evaluate\(\(source\) => \{([\s\S]*?)\}, expression\)/);
assert.ok(callback, 'worker callback exists');
const evaluate = vm.runInNewContext(`(source) => {${callback[1]}}`);
assert.equal(evaluate('() => JSON.stringify({ price: 42 })'), '{"price":42}');
assert.equal(evaluate('JSON.stringify({ price: 42 })'), '{"price":42}');
assert.equal(await evaluate('async () => 42'), 42);

// Isolate the production parser without initializing databases or providers.
const tasks = fs.readFileSync(new URL('../src/services/browser-tasks.js', import.meta.url), 'utf8');
const start = tasks.indexOf('export function structuredReadOnlyDocumentEvidence(');
const end = tasks.indexOf('\nexport function structuredDocumentError', start);
assert.ok(start >= 0 && end > start);
const parser = vm.runInNewContext(tasks.slice(start, end).replace('export function', 'function') + '\nstructuredReadOnlyDocumentEvidence');
assert.equal(parser('{"ok":true,"kind":"evaluate"}'), null);
assert.equal(parser('{"ok":true}'), null);
assert.equal(parser('{"price":42,"previousClose":40}').value.price, 42);
assert.equal(parser(JSON.stringify({result:'{"price":42}'})).value.price, 42);
console.log('PASS: function invocation, expression, async result, acknowledgement rejection, document parsing');
