import test from 'node:test';
import assert from 'node:assert/strict';
import { openRepository } from '../src/repository.mjs';
import { createLearningStore } from '../src/learning-store.mjs';
import { createDiscovery } from '../src/discovery.mjs';

test('learning opt-in, validation, visibility, import and repair stay isolated', () => {
  const repository = openRepository();
  try {
    const store = createLearningStore(repository);
    const a = { embeddingId: 'A', audienceId: 'staff', role: 'maintainer' };
    const b = { ...a, embeddingId: 'B' }, visitor = { ...a, role: 'visitor' };
    const input = { title: 'Open customer draft', consent: true, verified: true,
      steps: [{ action: 'navigate', path: '/customers' }, { action: 'fill', path: '/customers/new', field: 'name', parameter: 'customer_name' }] };
    assert.equal(store.learn(a,input).created, false);
    store.setLearning(a,true);
    assert.equal(store.learn(a,{ ...input, verified: false }).created,false);
    const draft = store.learn(a,input).recipe;
    assert.deepEqual(store.list(visitor), []);
    assert.throws(() => store.publish(visitor,draft.id,draft.version,{ reviewed: true, validated: true }));
    const published = store.publish(a,draft.id,draft.version,{ reviewed: true, validated: true });
    assert.equal(store.list(visitor).length,1);
    assert.deepEqual(store.list(b),[]);
    assert.throws(() => store.export(b,draft.id));
    const imported = store.import(b,store.export(a,draft.id));
    assert.equal(imported.status,'draft');
    assert.throws(() => store.import(b,{ schema: 1, title:'bad', steps:[{ action:'fill', path:'/x', field:'name', parameter:'name', value:'private' }] }));
    const repaired = store.repair(a,draft.id,published.version,[{ action:'navigate', path:'/clients' }]);
    assert.equal(repaired.validated,false);
    assert.deepEqual(store.list(visitor),[]);
    assert.throws(() => store.publish(a,draft.id,published.version,{ reviewed: true, validated: true }));
  } finally { repository.close(); }
});

test('bounded discovery excludes unknown side effects, loops and private values', () => {
  const job = createDiscovery({ origin:'https://site.test', seed:'/', approvedReadOnlyPaths:['/','/customers'], maxPages:2 });
  assert.equal(job.next({ authorized:true }).path,'/');
  job.observe({ path:'/', fields:[{ id:'name', type:'text', value:'private' },{ id:'password',type:'text' }],
    links:['/customers','/customers','/add-and-save','https://other.test/','/?page=2'] });
  assert.equal(job.next({ authorized:true,hasUnsavedWork:true }),null);
  job.resume({ authorized:true });
  assert.equal(job.next({ authorized:true }).path,'/customers');
  job.observe({ path:'/customers',links:['/'] });
  assert.equal(job.next({ authorized:true }),null);
  const report = job.report();
  assert.equal(report.nodes.length,2);
  assert.equal(report.blocked.length,3);
  assert.equal(JSON.stringify(report).includes('private'),false);
  assert.equal(report.nodes[0].status,'discovered-not-tested');
});
