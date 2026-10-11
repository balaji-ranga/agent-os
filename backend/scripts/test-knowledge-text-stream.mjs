import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { textFilePassages } from '../src/services/knowledge-text-stream.js';
const dir=await mkdtemp(join(tmpdir(),'knowledge-text-')),path=join(dir,'large.txt');
const input='Text 🦊 multilingual 新加坡\n'.repeat(30000);
try {
  await writeFile(path,input);
  let reconstructed='',count=0;
  for await(const passage of textFilePassages(path)) {
    assert.ok(passage.text.length<=16000);assert.equal(passage.index,count++);
    reconstructed+=passage.text.slice(passage.offset===0?0:200);
  }
  assert.equal(reconstructed,input);assert.ok(count>1);
  console.log('Knowledge text streaming: bounded passages, Unicode and overlap reconstruction passed.');
} finally {await unlink(path);await rmdir(dir);}
