/**
 * Purge-all + protected platform docs.
 * Run: node scripts/test-purge-all-documents.js
 */
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmp = mkdtempSync(join(tmpdir(), 'agentos-purge-'));
process.env.AGENT_OS_DATA_DIR = tmp;

let fails = 0;
function check(cond, msg) {
  if (cond) console.log('  OK:', msg);
  else {
    fails += 1;
    console.error('  FAIL:', msg);
  }
}

try {
  const { initDb } = await import('../src/db/schema.js');
  initDb();

  const md = await import('../src/services/master-data.js');
  const { isProtectedPlatformDocument } = await import('../src/services/master-data-protected-docs.js');

  const OWNER = 'ceo-purge-test';

  console.log('== protection detector ==');
  check(isProtectedPlatformDocument({ title: 'Flolah User Guide', filename: 'PROJECT.md' }), 'User Guide protected');
  check(isProtectedPlatformDocument({ title: 'Flolah User Guide', filename: 'README.md' }), 'legacy README filename protected');
  check(isProtectedPlatformDocument({ title: 'Flolah Help — Getting Started', filename: 'platform-help-01-getting-started.md' }), 'Help doc protected');
  check(isProtectedPlatformDocument({ title: 'Flowlah Help — Old', filename: 'x.md' }), 'legacy help protected');
  check(!isProtectedPlatformDocument({ title: 'My Policy', filename: 'policy.pdf' }), 'user upload not protected');

  console.log('== seed docs + user upload ==');
  const guide = await md.uploadDocument(OWNER, {
    title: 'Flolah User Guide',
    filename: 'PROJECT.md',
    contentText: '# Guide\nProtected.',
  });
  const help = await md.uploadDocument(OWNER, {
    title: 'Flolah Help — Getting Started',
    filename: 'platform-help-01-getting-started.md',
    contentText: '# Help\nProtected.',
  });
  const user = await md.uploadDocument(OWNER, {
    title: 'My Leave Policy',
    filename: 'leave.txt',
    contentText: 'Annual leave is 20 days.',
  });
  const user2 = await md.uploadDocument(OWNER, {
    title: 'Handbook',
    filename: 'handbook.pdf',
    contentText: 'Employee handbook text.',
  });

  const listed = md.listDocuments(OWNER);
  check(listed.length === 4, `listed 4 (got ${listed.length})`);
  check(listed.find((d) => d.id === guide.id)?.is_protected === true, 'guide flagged is_protected');
  check(listed.find((d) => d.id === user.id)?.is_protected === false, 'user upload not flagged');

  console.log('== single delete blocked for protected ==');
  let blocked = false;
  try {
    md.deleteDocument(OWNER, help.id);
  } catch (e) {
    blocked = e.code === 'PROTECTED_DOCUMENT';
  }
  check(blocked, 'delete help throws PROTECTED_DOCUMENT');
  check(!!md.getDocument(OWNER, help.id), 'help still exists after blocked delete');

  console.log('== force delete allowed for seed path ==');
  const tempHelp = await md.uploadDocument(OWNER, {
    title: 'Flolah Help — Temp',
    filename: 'platform-help-temp.md',
    contentText: 'temp',
  });
  md.deleteDocument(OWNER, tempHelp.id, { force: true });
  check(!md.getDocument(OWNER, tempHelp.id), 'force delete removes protected doc');

  console.log('== purge all keeps help/guide, removes uploads ==');
  const userPath = md.getDocumentFile(OWNER, user.id).path;
  check(existsSync(userPath), 'user file on disk before purge');

  const result = md.purgeAllUserDocuments(OWNER);
  check(result.deleted_count === 2, `deleted_count=2 (got ${result.deleted_count})`);
  check(result.retained_count === 2, `retained_count=2 (got ${result.retained_count})`);
  check(result.failed_count === 0, `failed_count=0 (got ${result.failed_count})`);
  check(!md.getDocument(OWNER, user.id), 'user doc removed from DB');
  check(!md.getDocument(OWNER, user2.id), 'user2 doc removed from DB');
  check(!!md.getDocument(OWNER, guide.id), 'guide retained');
  check(!!md.getDocument(OWNER, help.id), 'help retained');
  check(!existsSync(userPath), 'user file removed from disk');

  const after = md.listDocuments(OWNER);
  check(after.length === 2, `2 docs remain (got ${after.length})`);
  check(after.every((d) => d.is_protected), 'remaining docs are all protected');
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(`\n=== Done: ${fails === 0 ? 'ALL PASSED' : fails + ' FAILED'} ===`);
process.exit(fails === 0 ? 0 : 1);
