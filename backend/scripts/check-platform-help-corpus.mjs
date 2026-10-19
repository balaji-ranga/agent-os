import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {PLATFORM_HELP_DOCUMENTS,resolvePlatformHelpDir} from '../src/services/ceo-default-master-data.js';

const root=resolvePlatformHelpDir();assert.ok(root,'Platform help corpus is missing');
const filenames=new Set(),titles=new Set();
for(const doc of PLATFORM_HELP_DOCUMENTS){
 assert.ok(/^[A-Za-z0-9-]+\.md$/.test(doc.filename),`Unsafe help filename ${doc.filename}`);
 assert.ok(!filenames.has(doc.filename.toLowerCase()),`Duplicate help filename ${doc.filename}`);
 assert.ok(!titles.has(doc.title),`Duplicate help title ${doc.title}`);
 assert.ok(existsSync(join(root,doc.filename)),`Missing help file ${doc.filename}`);
 assert.ok(readFileSync(join(root,doc.filename),'utf8').trim(),`Empty help file ${doc.filename}`);
 filenames.add(doc.filename.toLowerCase());titles.add(doc.title);
}
console.log(JSON.stringify({registered:filenames.size,autoDiscovered:readdirSync(root).filter(name=>/\.md$/i.test(name)&&!filenames.has(name.toLowerCase())),status:'passed'}));
