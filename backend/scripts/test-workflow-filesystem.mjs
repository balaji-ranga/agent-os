/**
 * Filesystem node: local write/read + transport helpers (no live FTP/SFTP).
 * Run: node scripts/test-workflow-filesystem.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  executeFilesystemTask,
  isWindowsAbsPath,
  normalizeFilesystemTransport,
} from '../src/services/agent-workflow-tasks.js';
import { shouldRunFilesystemLocally } from '../desktop-workflow-runner/runner/local-executors.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(isWindowsAbsPath('C:\\data\\a.txt'), 'win drive');
assert(isWindowsAbsPath('d:/inbox/file.csv'), 'win slash');
assert(!isWindowsAbsPath('/var/data/a.txt'), 'unix abs');
assert(normalizeFilesystemTransport('SFTP') === 'sftp', 'sftp');
assert(normalizeFilesystemTransport('ftps') === 'ftps', 'ftps');
assert(normalizeFilesystemTransport('') === 'local', 'default local');

assert(
  shouldRunFilesystemLocally({ data: { taskConfig: { transport: 'local' } } }),
  'local disk stays on laptop'
);
assert(
  shouldRunFilesystemLocally({ data: { taskConfig: { transport: 'ftp' } } }),
  'ftp auto stays on laptop'
);
assert(
  !shouldRunFilesystemLocally({ data: { taskConfig: { transport: 'sftp' } } }),
  'sftp auto runs on Flolah'
);
assert(
  !shouldRunFilesystemLocally({ data: { taskConfig: { transport: 'ftp', executeOn: 'server' } } }),
  'ftp can be forced to Flolah'
);

const root = mkdtempSync(join(tmpdir(), 'aos-fs-'));
process.env.WORKFLOW_FS_ROOTS = root;
const file = join(root, 'hello.txt');

const written = await executeFilesystemTask(
  { path: file, content: 'hello-os' },
  { operation: 'write_text', transport: 'local', maxBytes: 4096 },
  null
);
assert(written.ok && written.bytes === 8, 'write_text');
assert(readFileSync(file, 'utf8') === 'hello-os', 'disk content');

const read = await executeFilesystemTask({ path: file }, { operation: 'read_text', transport: 'local' }, null);
assert(read.text === 'hello-os', 'read_text');

const listed = await executeFilesystemTask({ path: root, glob: '*.txt' }, { operation: 'list' }, null);
assert(listed.count >= 1 && listed.has_files, 'list');

if (process.platform !== 'win32') {
  let threw = false;
  try {
    await executeFilesystemTask({ path: 'C:\\Users\\me\\a.txt' }, { operation: 'read_text' }, null);
  } catch (e) {
    threw = /Download for Windows/i.test(e.message);
  }
  assert(threw, 'windows path on unix server explains desktop package');
}

writeFileSync(join(root, 'move-me.txt'), 'x');
const moved = await executeFilesystemTask(
  { path: join(root, 'move-me.txt'), destination: join(root, 'moved.txt') },
  { operation: 'move' },
  null
);
assert(moved.ok, 'move');

rmSync(root, { recursive: true, force: true });
console.log('WORKFLOW_FILESYSTEM_OK');
