import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

test('new runtime has no dependency on Platform Help or existing Flolah runtime', async () => {
  const directory = new URL('../src/', import.meta.url);
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    if(!entry.isFile())continue;
    const file=entry.name;
    const code = await readFile(new URL(file, directory), 'utf8');
    for (const match of code.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)) {
      assert.ok(match[2].startsWith('node:') || ['nodemailer','ws'].includes(match[2]) || /^\.\/[^/]+\.mjs$/.test(match[2]), `Unexpected runtime import: ${match[2]}`);
    }
    assert.doesNotMatch(code, /PlatformHelpCopilot|ui-copilot|platform-help-chat|copilot-embed-bridge/);
  }
});
